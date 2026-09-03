import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, combineAbortSignals, VeridianApiError } from "@/lib/veridian-client";

/**
 * R67 E-28 (R-244): "a run over 30 s is cancelled server-side". The measured
 * run is 2.7 s; anything an order of magnitude past that is not a slow report,
 * it is a report nobody is going to wait for.
 */
export const REPORT_DEADLINE_MS = 30_000;
import {
  buildManpowerBreakdown,
  buildVendorBreakdown,
  buildWorkProgressReport,
  type Activity,
  type Attendance,
  type BoqLineItem,
  type Category,
  type LabourRoster,
  type ProgressEntry,
  type Vendor,
} from "@/lib/work-progress-report";

// lineItems carry `category` as of R67 I-05 (drizzle/0532) -- BoqLineItem
// already declares it optional, so an older VERIDIAN that does not send it
// still parses, and those rows fall back to the activity -> category path.
type BoqResponse = { id: string; status: string; version: number; title: string; lineItems: BoqLineItem[] };
type VeridianVendor = { id: string; vendorName: string };

// Real Work Progress Report, assembled from VERIDIAN's real construction
// data (BoQ line items + progress entries + attendance/labour-roster/
// vendors) -- see PROGRESS.md for why this needs 5 separate VERIDIAN calls
// instead of one: PROJEXA stores no construction domain data itself, and
// each of these was already its own real, separately-scoped endpoint.
export async function GET(request: NextRequest) {
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
  // R67 E-28 (C-04): `from` is now OPTIONAL, and that is the point. The screen
  // used to default it to the first of the current month and then tell the
  // reader to "Pick a date range and click Run Report" over a range that was
  // already filled -- and on a project whose work started in June, a
  // month-to-date default reports a project as having done nothing.
  //
  // The default now comes from the DATA: the earliest progress entry this
  // project has. That is computed below, from the entries this route already
  // fetches, so it costs no extra call, and the effective range comes back on
  // the response so the screen shows what it really ran. `to` still has a
  // sensible client-side default (today) and is still required here, because a
  // missing end date is a different mistake from an unspecified start.
  if (!to) return NextResponse.json({ error: "to (YYYY-MM-DD) query param is required" }, { status: 400 });

  const orgId = ctx.organizationId!;
  const qp = `projectId=${encodeURIComponent(projectId)}`;

  // R67 E-28 (R-244): this report fans out to six upstream calls on a
  // five-connection pool, and before this it had no way to stop. Two things
  // now abandon it: the browser giving up (request.signal -- the Cancel button
  // on the WPR header aborts its fetch, and that reaches here), and this
  // route's own 30-second deadline. Either way the upstream calls are aborted
  // rather than left running for an answer nobody is waiting for.
  const deadline = AbortSignal.timeout(REPORT_DEADLINE_MS);
  const signal = combineAbortSignals(request.signal, deadline);
  const call = { organizationId: orgId, signal };

  try {
    const [scopeData, workProgressData, progressData, attendanceData, rosterData, vendorsData] = await Promise.all([
      callVeridian<{ boqs: BoqResponse[] }>(`/scope?${qp}`, call),
      callVeridian<{ activities: Activity[]; categories: Category[] }>(`/work-progress/activities?${qp}`, call),
      callVeridian<{ entries: ProgressEntry[] }>(`/work-progress?${qp}`, call),
      callVeridian<{ attendance: Attendance[] }>(`/attendance?${qp}`, call),
      callVeridian<{ roster: LabourRoster[] }>(`/construction/labour-roster?${qp}`, { ...call, root: true }),
      callVeridian<{ vendors: VeridianVendor[] }>("/vendors", call),
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

    const vendors: Vendor[] = (vendorsData.vendors ?? []).map((v) => ({ id: v.id, name: v.vendorName }));

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

    const report = buildWorkProgressReport({
      lineItems,
      entries,
      activities: workProgressData.activities ?? [],
      categories: workProgressData.categories ?? [],
      from: effectiveFrom,
      to,
      categoryFilter,
    });
    const byManpower = buildManpowerBreakdown({ roster: rosterData.roster ?? [], attendance: attendanceData.attendance ?? [], from: effectiveFrom, to });
    const byVendor = buildVendorBreakdown({ roster: rosterData.roster ?? [], attendance: attendanceData.attendance ?? [], vendors, from: effectiveFrom, to });

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
      byManpower,
      byVendor,
    });
  } catch (err) {
    // The deadline gets its own words. "The service did not answer" would be
    // false -- it was still working, and we stopped waiting; the reader's fix
    // is a narrower range, not a retry of the same thing.
    if (deadline.aborted) {
      return NextResponse.json(
        { error: `The Work Progress Report was still running after ${REPORT_DEADLINE_MS / 1000} s and was cancelled. Narrow the date range and run it again.` },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to generate work progress report" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
