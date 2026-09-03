import { NextResponse } from "next/server";
import { requireCompanyScope } from "@/lib/company-scope";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";
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
//
// R67 MERGE (D-11, lane E2 x lane F-13/F-20/F-28): the withTiming() wrapper
// and veridianErrorResponse() catch are F2's -- kept, since they are the same
// Server-Timing/typed-error infra every other route in this file's family
// now carries, and this route had nothing of its own reason not to.
// CategoryDistributionEntry's own local, duplicate declaration (main's, before
// this shared module existed) is dropped: category-distribution.ts already
// exports the identical type, and this route already returns it.
export const GET = withTiming("GET", async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; projectId: string }> }) {
  const { companyId, projectId } = await params;
  const scope = await requireCompanyScope(companyId);
  if (scope.response) return scope.response;

  try {
    // `format=legacy`: see the project-scoped twin for the full reason. In
    // short, E-32 made the generic table the default body and the table has no
    // categoryId column, so a chart built from category ids has to ask for the
    // handler's own payload by name.
    const [amounts, progress] = await Promise.all([
      callVeridian<CategoryBoqAmounts>(`/reports/category-boq-amounts?format=legacy&projectId=${encodeURIComponent(projectId)}`, { organizationId: scope.companyId }),
      callVeridian<CategoryProgress>(`/reports/category-progress?format=legacy&projectId=${encodeURIComponent(projectId)}`, { organizationId: scope.companyId }),
    ]);
    return NextResponse.json(buildCategoryDistribution(amounts, progress));
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load category distribution");
  }
});
