import { NextRequest, NextResponse } from "next/server";
import { requireCompanyScope } from "@/lib/company-scope";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

export type HierarchyDashboard = {
  totalProjects: number;
  totalBudget: number;
  totalRevenue: number;
  totalExpenses: number;
  projects: { id: string; name: string; revenue: number; expenses: number; taskCount: number; delayedTaskCount: number }[];
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

  const departmentId = request.nextUrl.searchParams.get("departmentId");
  const path = departmentId ? `/dashboard?departmentId=${encodeURIComponent(departmentId)}` : "/dashboard";

  try {
    const data = await callVeridian<HierarchyDashboard>(path, { organizationId: scope.companyId });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load dashboard");
  }
});
