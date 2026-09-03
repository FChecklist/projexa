import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, combineAbortSignals } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";
import {
  buildManpowerBreakdown,
  buildVendorBreakdown,
  buildWorkProgressReport,
  vendorsFromRoster,
  type Activity,
  type Attendance,
  type BoqLineItem,
  type Category,
  type LabourRoster,
  type ProgressEntry,
} from "@/lib/work-progress-report";

// lineItems carry `category` as of R67 I-05 (drizzle/0532) -- BoqLineItem
// already declares it optional, so an older VERIDIAN that does not send it
// still parses, and those rows fall back to the activity -> category path.
type BoqResponse = { id: string; status: string; version: number; title: string; lineItems: BoqLineItem[] };

/**
 * R67 E-28 (R-244): "a run over 30 s is cancelled server-side". The measured
 * run is 2.7 s; anything an order of magnitude past that is not a slow report,
 * it is a report nobody is going to wait for.
 */
export const REPORT_DEADLINE_MS = 30_000;

// Real Work Progress Report, assembled from VERIDIAN's real construction
// data (BoQ line items + progress entries + attendance/labour-roster/
// vendors) -- see PROGRESS.md for why this needs separate VERIDIAN calls
// instead of one: PROJEXA stores no construction domain data itself, and
// each of these was already its own real, separately-scoped endpoint.
//
// R67 F-13 (R-193/R-217) -- SIX CALLS, PULLING WHOLE HISTORIES, DOWN TO FIVE
// SCOPED ONES. Three separate wastes, all fixed here and none of which changes
// a single number this report produces:
//
//   1. GET /vendors fetched the org's ENTIRE vendor master to turn a handful of
//      vendorIds into names. VERIDIAN's listRoster now returns vendorName on
//      each roster row (resolved in the transaction it already holds), so the
//      names arrive with the roster and the call is gone.
//   2. GET /attendance pulled every attendance row this project has ever
//      recorded -- workers x days, unbounded -- and both breakdowns then
//      discarded everything outside [from, to]. It is now asked for that window.
//   3. GET /work-progress pulled every progress entry ever logged. The report
//      never looks past `to` (see computeLineItemProgress: `d < from`,
//      `d >= from && d <= to`, `d <= to`), so it is now capped at `to`. The
//      LOWER bound is deliberately NOT sent: the "previous" column IS the
//      entries before `from` -- and, per E-28/C-04 below, `from` itself may
//      not be known yet when this call goes out.
//
// R67 MERGE (D-11, lane E2's E-28 x lane F-13). Both lanes touched this exact
// route and both fixes are real and independent, so both survive:
//
//   * F-13's three scoping wins above are kept in full.
//   * E-28/C-04 -- `from` is now OPTIONAL. The screen used to default it to
//     the first of the current month and then tell the reader to "Pick a date
//     range and click Run Report" over a range that was already filled -- and
//     on a project whose work started in June, a month-to-date default reports
//     a project as having done nothing. The default now comes from the DATA:
//     the earliest progress entry this project has, computed from the SAME
//     work-progress read F-13 already scoped to `dateTo=to` (that call has no
//     lower bound, so it still carries the true earliest entry). Because the
//     effective `from` is not known until that read lands, the attendance
//     call -- the one F-13 scopes with a LOWER bound too -- cannot join the
//     first Promise.all; it fires right after, still windowed, at the cost of
//     one sequential round trip only on the (uncommon) defaulted-range path.
//     An explicit `from` keeps the original all-parallel shape exactly.
//   * E-28/R-244 -- this report fans out to several upstream calls on a
//     shared connection pool, and before this it had no way to stop. Two
//     things now abandon it: the browser giving up (request.signal -- the
//     Cancel button on the WPR header aborts its fetch, and that reaches
//     here), and this route's own 30-second deadline. Built with an explicit
//     AbortController + setTimeout, NOT AbortSignal.timeout() -- see
//     veridian-client.ts's own header comment: that API never fires its abort
//     event on Bun 1.3.14 (Windows), the runtime this repo's unit tests run
//     in, so a deadline built from it would silently never expire there.
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("projectId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  // R36/P5 (B5 decision, cc_spec point 177): a project can legitimately hold
  // two or more INDEPENDENT (non-revision-chain) BOQs at once -- e.g. an
  // older approved scope kept for records alongside a new draft -- so
  // forcing "one active BOQ per project" would mean silently blocking or
  // destroying real approved data. Chose the additive option instead: an
  // explicit boqId query param lets the caller pick which BOQ this report is
  // for; omitting it keeps the exact previous auto-pick behaviour (latest
  // non-superseded, deterministic since PR #1325's createdAt DESC
  // tiebreaker) so every existing caller/test is unaffected.
  const requestedBoqId = searchParams.get("boqId");
  // R67 lane I (WS-I item I-05, R-177): the Category multi-select on the WPR
  // parameter bar. Repeatable `category` params (?category=Civil&category=Paint)
  // rather than one comma-joined value -- a real category name may legitimately
  // contain a comma, and splitting on it would silently filter for a category
  // nobody has. Applied server-side, inside buildWorkProgressReport, before the
  // roll-up, so the subtotals AND the Grand Total both describe the filtered
  // set and still tie to each other.
  const categoryFilter = searchParams.getAll("category").filter((c) => c.trim() !== "");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  // R67 E-28 (C-04): `from` is now OPTIONAL, and that is the point -- see the
  // merge note above. `to` is still required here, because a missing end
  // date is a different mistake from an unspecified start.
  if (!to) return NextResponse.json({ error: "to (YYYY-MM-DD) query param is required" }, { status: 400 });

  const orgId = ctx.organizationId!;
  const qp = `projectId=${encodeURIComponent(projectId)}`;

  // R67 E-28 (R-244): an explicit AbortController + setTimeout, matching
  // veridian-client.ts's own attemptFetch() -- AbortSignal.timeout() is not
  // used here for the same reason it was dropped there.
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(), REPORT_DEADLINE_MS);
  const signal = combineAbortSignals(request.signal, deadlineController.signal);

  try {
    const [scopeData, workProgressData, progressData, rosterData] = await Promise.all([
      callVeridian<{ boqs: BoqResponse[] }>(`/scope?${qp}`, { organizationId: orgId, signal }),
      callVeridian<{ activities: Activity[]; categories: Category[] }>(`/work-progress/activities?${qp}`, { organizationId: orgId, signal }),
      callVeridian<{ entries: ProgressEntry[] }>(`/work-progress?${qp}&dateTo=${encodeURIComponent(to)}`, { organizationId: orgId, signal }),
      callVeridian<{ roster: LabourRoster[] }>(`/construction/labour-roster?${qp}`, { organizationId: orgId, root: true, signal }),
    ]);

    // Scope-wise / category-wise are computed from the latest, non-superseded
    // BOQ revision -- same "latest active revision" convention VERIDIAN's own
    // scopeReport() already uses, so this report doesn't double-count line
    // items across a BOQ's revision history.
    const boqs = scopeData.boqs ?? [];
    const requestedBoq = requestedBoqId ? boqs.find((b) => b.id === requestedBoqId) : undefined;
    if (requestedBoqId && !requestedBoq) {
      return NextResponse.json({ error: `boqId "${requestedBoqId}" does not belong to this project` }, { status: 400 });
    }
    const latestBoq = requestedBoq ?? boqs.find((b) => b.status !== "superseded") ?? boqs[0];
    const lineItems = latestBoq?.lineItems ?? [];

    const roster = rosterData.roster ?? [];
    // The vendors this report can attribute cost to are exactly the ones its
    // own roster names -- see vendorsFromRoster's comment for why that is the
    // whole set, not a subset.
    const vendors = vendorsFromRoster(roster);

    const entries = progressData.entries ?? [];
    // R67 E-28 (C-04): the data-derived default start date. The earliest
    // progress entry is the first day this project recorded anything, so a
    // report that starts there covers the whole of it.
    //
    // NOT "the project start", which R-244 also names: nothing in this app's
    // payloads carries one (resolveSelectedProject returns {id, name}, and the
    // dashboard payload has no start date either), so claiming a project start
    // here would mean inventing one. With no entries at all there is no
    // earliest date, and the range collapses to the single day `to` -- an empty
    // report the screen then explains in words.
    const earliestEntryDate = entries.reduce<string | null>(
      (earliest, e) => (earliest === null || e.entryDate < earliest ? e.entryDate : earliest),
      null
    );
    const effectiveFrom = from ?? earliestEntryDate ?? to;

    // R67 F-13: windowed to [effectiveFrom, to] rather than fetched whole and
    // filtered downstream. Fired after the batch above because `effectiveFrom`
    // is not known until progressData lands when `from` was not supplied (see
    // the merge note above) -- an explicit `from` still reaches this point in
    // the same request, just one microtask later than the fully-parallel path.
    const attendanceData = await callVeridian<{ attendance: Attendance[] }>(
      `/attendance?${qp}&from=${encodeURIComponent(effectiveFrom)}&to=${encodeURIComponent(to)}`,
      { organizationId: orgId, signal }
    );

    const report = buildWorkProgressReport({
      lineItems,
      entries,
      activities: workProgressData.activities ?? [],
      categories: workProgressData.categories ?? [],
      from: effectiveFrom,
      to,
      categoryFilter,
    });
    const byManpower = buildManpowerBreakdown({ roster, attendance: attendanceData.attendance ?? [], from: effectiveFrom, to });
    const byVendor = buildVendorBreakdown({ roster, attendance: attendanceData.attendance ?? [], vendors, from: effectiveFrom, to });

    return NextResponse.json({
      projectId,
      // The range it REALLY ran, so the parameter bar and the URL can show the
      // truth rather than what the client guessed before it asked.
      from: effectiveFrom,
      to,
      /** null when this project has logged nothing at all. */
      earliestEntryDate,
      /** True when `from` was defaulted here rather than chosen by the caller. */
      fromWasDefaulted: !from,
      boqTitle: latestBoq?.title ?? null,
      boqId: latestBoq?.id ?? null,
      // R36/P5: the full list of this project's BOQs (id/title/status/
      // version only, no line items) so the client can render a selector --
      // additive field, existing callers that don't read it are unaffected.
      availableBoqs: boqs.map((b) => ({ id: b.id, title: b.title, status: b.status, version: b.version })),
      rows: report.rows, // scope-wise: one row per BoQ line item
      byCategory: report.byCategory,
      // R67 I-05: every category present BEFORE the filter, so the multi-select
      // still offers the ones currently filtered out (otherwise selecting
      // "Civil" would remove every other option from the control that filtered
      // them) -- plus the filter actually applied, so the UI can render the
      // parameters it really ran with rather than what it thinks it sent.
      availableCategories: report.availableCategories,
      categoryFilter,
      // R67 B-09: entries this window holds that no BOQ line can claim, and
      // that are therefore in none of the figures above. Reported so the
      // screen can say so rather than showing a total the site engineer
      // knows is short and cannot account for.
      unlinkedEntryCount: report.unlinkedEntryCount,
      byManpower,
      byVendor,
    });
  } catch (err) {
    // The deadline gets its own words. "The service did not answer" would be
    // false -- it was still working, and we stopped waiting; the reader's fix
    // is a narrower range, not a retry of the same thing.
    if (deadlineController.signal.aborted && !request.signal.aborted) {
      return NextResponse.json(
        { error: `The Work Progress Report was still running after ${REPORT_DEADLINE_MS / 1000} s and was cancelled. Narrow the date range and run it again.` },
        { status: 504 }
      );
    }
    return veridianErrorResponse(err, "Failed to generate work progress report");
  } finally {
    clearTimeout(deadlineTimer);
  }
});
