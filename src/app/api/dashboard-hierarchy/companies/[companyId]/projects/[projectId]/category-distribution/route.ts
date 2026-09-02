import { NextResponse } from "next/server";
import { requireCompanyScope } from "@/lib/company-scope";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

type CategoryBoqAmounts = { categories: { categoryId: string; name: string; totalAmount: number }[]; uncategorizedAmount: number; totalAmount: number };
type CategoryProgress = { categories: { categoryId: string; name: string; percentComplete: number }[] };

export type CategoryDistributionEntry = {
  categoryId: string;
  name: string;
  totalAmount: number;
  sharePercent: number; // this category's totalAmount as a % of the whole BOQ -- the pie slice
  percentComplete: number; // real WPR completion % for this category (0 if no progress logged yet)
  completedAmount: number; // totalAmount * percentComplete/100 -- the bar chart's "completed" series
};

// Per-project BOQ category distribution (Gypsum/Civil/Joinery/Paint/Misc-
// style split): pie = each category's share of the BOQ total, bar =
// completed-vs-total amount per category. Sourced from two real VERIDIAN
// reports -- category-boq-amounts (real BOQ line-item amounts, grouped by
// category via activityId -> activity.categoryId) and category-progress
// (real Work Progress Report completion %, already landed) -- combined
// here rather than fabricating either side. Line items with no activityId
// (or an activity whose category no longer exists) are real BOQ amounts
// too; they're surfaced as an "Uncategorized" slice instead of being
// dropped, so shares still sum to 100%.
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; projectId: string }> }) {
  const { companyId, projectId } = await params;
  const scope = await requireCompanyScope(companyId);
  if (scope.response) return scope.response;

  try {
    const [amounts, progress] = await Promise.all([
      callVeridian<CategoryBoqAmounts>(`/reports/category-boq-amounts?projectId=${encodeURIComponent(projectId)}`, { organizationId: scope.companyId }),
      callVeridian<CategoryProgress>(`/reports/category-progress?projectId=${encodeURIComponent(projectId)}`, { organizationId: scope.companyId }),
    ]);

    const percentByCategory = new Map(progress.categories.map((c) => [c.categoryId, c.percentComplete]));
    const total = amounts.totalAmount;

    const categories: CategoryDistributionEntry[] = amounts.categories
      .filter((c) => c.totalAmount > 0)
      .map((c) => {
        const percentComplete = percentByCategory.get(c.categoryId) ?? 0;
        return {
          categoryId: c.categoryId,
          name: c.name,
          totalAmount: c.totalAmount,
          sharePercent: total > 0 ? (c.totalAmount / total) * 100 : 0,
          percentComplete,
          completedAmount: c.totalAmount * (percentComplete / 100),
        };
      });

    if (amounts.uncategorizedAmount > 0) {
      categories.push({
        categoryId: "uncategorized",
        name: "Uncategorized",
        totalAmount: amounts.uncategorizedAmount,
        sharePercent: total > 0 ? (amounts.uncategorizedAmount / total) * 100 : 0,
        percentComplete: 0,
        completedAmount: 0,
      });
    }

    return NextResponse.json({ categories, totalAmount: total });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load category distribution");
  }
}
