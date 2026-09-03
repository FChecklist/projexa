import { NextResponse } from "next/server";
import { requireCompanyScope } from "@/lib/company-scope";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import {
  buildCategoryDistribution,
  type CategoryBoqAmounts,
  type CategoryProgress,
} from "@/lib/category-distribution";

// Per-project BOQ category distribution (Gypsum/Civil/Joinery/Paint/Misc-
// style split): a sorted horizontal bar per category with the completed value
// drawn over the total. Sourced from two real VERIDIAN reports --
// category-boq-amounts (real BOQ line-item amounts, grouped by category via
// activityId -> activity.categoryId) and category-progress (real Work Progress
// Report completion %) -- combined rather than fabricating either side.
//
// R67 E-29 (R-255): the combination itself moved into
// src/lib/category-distribution.ts, because the project dashboard needs the
// same chart and has no company to scope this route by. Two routes, ONE
// derivation -- see that module's header. This route's own job is unchanged:
// resolve and enforce the company scope, then ask.
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; projectId: string }> }) {
  const { companyId, projectId } = await params;
  const scope = await requireCompanyScope(companyId);
  if (scope.response) return scope.response;

  try {
    const [amounts, progress] = await Promise.all([
      callVeridian<CategoryBoqAmounts>(`/reports/category-boq-amounts?projectId=${encodeURIComponent(projectId)}`, { organizationId: scope.companyId }),
      callVeridian<CategoryProgress>(`/reports/category-progress?projectId=${encodeURIComponent(projectId)}`, { organizationId: scope.companyId }),
    ]);
    return NextResponse.json(buildCategoryDistribution(amounts, progress));
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load category distribution" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
