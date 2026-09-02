import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

// Premise correction (R42 seq24, found only after committing -- git status
// showed this file as MODIFIED, not new): this route and a real consumer
// (ReportsClient.tsx) already existed. This seq's own new consumers
// (DashboardProjectClient/WorkProgressAnalyticalClient/
// CostVarianceAnalyticalClient) needed "category-progress"/"budget-variance"
// -- report names ReportsClient never happened to request, so its own
// projectId(+weekStart)-only query building never exercised the gap: the
// old version only ever forwarded projectId/weekStart, silently dropping
// date/trade for manpower-cost. Generalised to forward every query param
// unexamined -- the compliance-tracker route is the one place that knows
// which reports need which extra params. Verified this is NOT a
// behavioural change for ReportsClient's own existing calls (it never
// sends any param this route didn't already forward).
export async function GET(request: NextRequest, { params }: { params: Promise<{ reportName: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { reportName } = await params;
  const qs = request.nextUrl.searchParams.toString();
  try {
    const data = await callVeridian(`/reports/${encodeURIComponent(reportName)}${qs ? `?${qs}` : ""}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, `Failed to generate ${reportName} report`);
  }
}
