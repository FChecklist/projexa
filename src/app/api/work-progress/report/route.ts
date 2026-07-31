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
    const latestBoq = boqs.find((b) => b.status !== "superseded") ?? boqs[0];
    const lineItems = latestBoq?.lineItems ?? [];

    const vendors: Vendor[] = (vendorsData.vendors ?? []).map((v) => ({ id: v.id, name: v.vendorName }));

    const report = buildWorkProgressReport({
      lineItems,
      entries: progressData.entries ?? [],
      activities: workProgressData.activities ?? [],
      categories: workProgressData.categories ?? [],
      from,
      to,
    });
    const byManpower = buildManpowerBreakdown({ roster: rosterData.roster ?? [], attendance: attendanceData.attendance ?? [], from, to });
    const byVendor = buildVendorBreakdown({ roster: rosterData.roster ?? [], attendance: attendanceData.attendance ?? [], vendors, from, to });

    return NextResponse.json({
      projectId, from, to,
      boqTitle: latestBoq?.title ?? null,
      rows: report.rows, // scope-wise: one row per BoQ line item
      byCategory: report.byCategory,
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
