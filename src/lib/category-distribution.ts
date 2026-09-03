// R67 E-29 (R-255). The per-category BOQ split, combined from the two real
// VERIDIAN reports that already answer half of it each.
//
// WHY IT MOVED HERE. The combination lived inside the company-scoped route
// /api/dashboard-hierarchy/companies/[companyId]/projects/[projectId]/
// category-distribution, so the chart it feeds could only be mounted on a
// screen that had a COMPANY. R-255 asks for that same chart on the project
// dashboard, which has a project and no company. Copying the arithmetic into a
// second route would be two derivations of one figure, which is the defect
// class this programme keeps closing; so the arithmetic is pure and lives
// here, and both routes call it.
//
// NEITHER SIDE IS FABRICATED. category-boq-amounts gives the real BOQ line
// amounts grouped by category; category-progress gives the real Work Progress
// completion percentage per category. completedAmount is their product, and it
// is the only derived figure in the module.

export type CategoryBoqAmounts = {
  categories: { categoryId: string; name: string; totalAmount: number }[];
  uncategorizedAmount: number;
  totalAmount: number;
};

export type CategoryProgress = {
  categories: { categoryId: string; name: string; percentComplete: number }[];
};

export type CategoryDistributionEntry = {
  categoryId: string;
  name: string;
  totalAmount: number;
  /** This category's share of the whole BOQ, as a percentage. */
  sharePercent: number;
  /** The real Work Progress Report completion % for this category; 0 when nothing is logged against it yet. */
  percentComplete: number;
  /** totalAmount x percentComplete/100 -- the "completed" bar drawn over the total. */
  completedAmount: number;
};

/**
 * Line items with no category at all are REAL BOQ money too. They are surfaced
 * as an "Uncategorized" row rather than dropped, so the shares still sum to
 * 100% and a reader can see how much of their BOQ is unclassified -- which is
 * itself a thing worth knowing.
 */
export const UNCATEGORIZED_LABEL = "Uncategorized";

export function buildCategoryDistribution(
  amounts: CategoryBoqAmounts,
  progress: CategoryProgress
): { categories: CategoryDistributionEntry[]; totalAmount: number } {
  const percentByCategory = new Map(progress.categories.map((c) => [c.categoryId, c.percentComplete]));
  const total = amounts.totalAmount;
  const share = (amount: number) => (total > 0 ? (amount / total) * 100 : 0);

  // A zero-amount category has no bar to draw and no share to state; keeping it
  // would put a row on the chart that says nothing.
  const categories: CategoryDistributionEntry[] = amounts.categories
    .filter((c) => c.totalAmount > 0)
    .map((c) => {
      const percentComplete = percentByCategory.get(c.categoryId) ?? 0;
      return {
        categoryId: c.categoryId,
        name: c.name,
        totalAmount: c.totalAmount,
        sharePercent: share(c.totalAmount),
        percentComplete,
        completedAmount: c.totalAmount * (percentComplete / 100),
      };
    });

  if (amounts.uncategorizedAmount > 0) {
    categories.push({
      categoryId: "uncategorized",
      name: UNCATEGORIZED_LABEL,
      totalAmount: amounts.uncategorizedAmount,
      sharePercent: share(amounts.uncategorizedAmount),
      // Progress is reported per CATEGORY, so a line with no category has
      // nowhere for its progress to be reported from. 0 here is "we have no
      // completion figure for these lines", and the chart says so by drawing
      // no completed portion -- it is not a claim that nothing was done.
      percentComplete: 0,
      completedAmount: 0,
    });
  }

  return { categories, totalAmount: total };
}

/**
 * R67 E-40 (R-272 / R-297): is EVERY BOQ line uncategorised?
 *
 * A single bar labelled "Uncategorized" is not a distribution -- it is a chart
 * of one thing, and the reader has no way to tell "this project has one trade"
 * from "nobody has assigned categories yet". Those are different situations and
 * only the second has a fix, which is why the screen names it and links to the
 * place it is done.
 *
 * Pure and here rather than in the component, beside the rule that CREATED the
 * bucket (buildCategoryDistribution above), so the two cannot drift: the
 * detection and the construction share one id.
 */
export function isAllUncategorized(categories: { categoryId: string }[]): boolean {
  return categories.length === 1 && categories[0].categoryId === "uncategorized";
}
