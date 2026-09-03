import { NextRequest, NextResponse } from "next/server";
import { requireCompanyScope } from "@/lib/company-scope";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R67 E-23 (R-206): the row now carries what Sumeet's company chart plots --
// boqBudget (BOQ x budget %, root lines only) and progressPercent alongside
// the earned value -- and the route forwards a from/to range. The range
// narrows revenue and expenses ONLY; the BOQ-derived budget is a property of
// the BOQ line, not of a period, which is why the chart says so above itself
// whenever a range is set. Both come from getOrgDashboard, so this stays a
// thin pass-through with no arithmetic of its own.
export type HierarchyDashboardProject = {
  id: string;
  name: string;
  revenue: number | null;
  expenses: number | null;
  spent?: number | null;
  taskCount: number;
  delayedTaskCount: number;
  tasksDue?: number;
  tasksLate?: number;
  hasSchedule?: boolean;
  value: number | null;
  contractValue?: number | null;
  earnedValue: number | null;
  earnedValuePrevWeek?: number | null;
  percentByValue: number | null;
  progressPercent?: number | null;
  budget?: number | null;
  boqBudget?: number | null;
};

export type HierarchyDashboard = {
  totalProjects: number;
  totalBudget: number | null;
  totalRevenue: number | null;
  totalExpenses: number | null;
  projects: HierarchyDashboardProject[];
};

// "Project list" for a given Company + (optional) Department: a thin
// pass-through to VERIDIAN's own getOrgDashboard(orgId, {departmentId}),
// the same function that already backs the live /dashboard page -- this
// route just lets the caller pick which membership org (Company) and which
// department to scope it to, instead of always using the caller's default
// org with no department filter.
export const GET = withTiming("GET", async function GET(request: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const scope = await requireCompanyScope(companyId);
  if (scope.response) return scope.response;

  const search = new URLSearchParams();
  for (const key of ["departmentId", "from", "to"] as const) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  const path = qs ? `/dashboard?${qs}` : "/dashboard";

  try {
    const data = await callVeridian<HierarchyDashboard>(path, { organizationId: scope.companyId });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load dashboard");
  }
});
