import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
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
  if (!from || !to) return NextResponse.json({ error: "from and to (YYYY-MM-DD) query params are required" }, { status: 400 });

  const orgId = ctx.organizationId!;
  const qp = `projectId=${encodeURIComponent(projectId)}`;

  try {
    const [scopeData, workProgressData, progressData, attendanceData, rosterData, vendorsData] = await Promise.all([
      callVeridian<{ boqs: BoqResponse[] }>(`/scope?${qp}`, { organizationId: orgId }),
      callVeridian<{ activities: Activity[]; categories: Category[] }>(`/work-progress/activities?${qp}`, { organizationId: orgId }),
      callVeridian<{ entries: ProgressEntry[] }>(`/work-progress?${qp}`, { organizationId: orgId }),
      callVeridian<{ attendance: Attendance[] }>(`/attendance?${qp}`, { organizationId: orgId }),
      callVeridian<{ roster: LabourRoster[] }>(`/construction/labour-roster?${qp}`, { organizationId: orgId, root: true }),
      callVeridian<{ vendors: VeridianVendor[] }>("/vendors", { organizationId: orgId }),
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

    const report = buildWorkProgressReport({
      lineItems,
      entries: progressData.entries ?? [],
      activities: workProgressData.activities ?? [],
      categories: workProgressData.categories ?? [],
      from,
      to,
      categoryFilter,
    });
    const byManpower = buildManpowerBreakdown({ roster: rosterData.roster ?? [], attendance: attendanceData.attendance ?? [], from, to });
    const byVendor = buildVendorBreakdown({ roster: rosterData.roster ?? [], attendance: attendanceData.attendance ?? [], vendors, from, to });

    return NextResponse.json({
      projectId, from, to,
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
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to generate work progress report" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
