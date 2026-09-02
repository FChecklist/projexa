// R67 lane D22 (item D-41, recs R-107/R-113): the pure arithmetic behind the
// project Budget screen -- category grouping, per-category subtotals and the
// Grand Total that has to tie to the BOQ's own total.
//
// Pure on purpose (no fetch, no React state), the same discipline
// boq-helpers.ts and work-progress-report.ts already follow in this repo, so
// "the two category subtotals sum to the Grand Total" is provable in a unit
// test rather than only in a browser.
//
// THE ONE RULE THAT IS EASY TO GET WRONG: a weighted sub-task line's amount is
// a SHARE of its parent's amount (schema.ts's canonical child-rate rule:
// AMOUNT_child = AMOUNT_root x breakdownPercentage/100), so adding a child on
// top of its parent double-counts that money. Children are listed -- a QS
// needs to see the breakdown -- but only root lines (parentLineItemId === null)
// contribute to any subtotal or total. This matches the identical rule in
// compliance-tracker's rollUpLinesByCategory() and boq-helpers.ts's boqTotal().

/** One line of GET /api/reports/budget-variance's `lines` array. */
export type BudgetLine = {
  lineItemId: string;
  code: string | null;
  description: string;
  category: string | null;
  quantity: number;
  unit: string;
  rate: number;
  parentLineItemId: string | null;
  amount: number;
  budgetPercentage: number;
  budget: number;
  materialAmount: number | null;
  manpowerAmount: number | null;
  vendorId: string | null;
  vendorName: string | null;
  vendorAmount: number | null;
  variance: number | null;
  /**
   * R67 lane D22 (item D-54): vendor + material + manpower, computed by
   * compliance-tracker's boqBudgetVarianceReport. null when none of the three
   * has been entered. Optional here because the project Budget screen (D-41)
   * reads the same payload and predates the field.
   */
  actual?: number | null;
  /** What the interim/RA bills have billed against this line. null = never billed. */
  revenue?: number | null;
};

export type BudgetSubtotal = {
  amount: number;
  budget: number;
  vendorAmount: number;
  materialAmount: number;
  manpowerAmount: number;
  actual: number;
  revenue: number;
};

export type BudgetCategoryGroup = {
  category: string;
  lines: BudgetLine[];
  subtotal: BudgetSubtotal;
};

// Same label compliance-tracker's construction-reports-service.ts uses for the
// same state, so one BOQ never reads "Uncategorized" in the report and
// "No category" on the Budget screen.
export const UNCATEGORIZED_LABEL = "Uncategorized";

/**
 * What this line has actually cost so far: the vendor's quoted amount plus the
 * material and manpower split entered against it. null (not 0) when none of
 * the three has been entered -- "nothing has been costed yet" is a real state
 * and must stay distinguishable from "costed at zero".
 */
export function lineActual(line: Pick<BudgetLine, "vendorAmount" | "materialAmount" | "manpowerAmount">): number | null {
  const parts = [line.vendorAmount, line.materialAmount, line.manpowerAmount];
  if (parts.every((p) => p === null || p === undefined)) return null;
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}

/** True when this line's actual cost has passed the budget set for it. */
export function isOverBudget(line: BudgetLine): boolean {
  const actual = lineActual(line);
  return actual !== null && actual > line.budget;
}

/**
 * R67 lane D22 (item D-54): the Variance column of the Scope > Budget tab --
 * Budget MINUS Actual, so a NEGATIVE number means the line has spent more than
 * it was given and the cell reads "over". Deliberately not the report's own
 * `variance` field, which is the older vendorAmount - budget figure with the
 * opposite sign; one screen must not print two different variances.
 *
 * null while nothing has been costed: a line with no actual has no variance,
 * and showing its whole budget as an "under" would read as savings that have
 * not happened.
 */
export function budgetVariance(line: BudgetLine): number | null {
  const actual = lineActual(line);
  if (actual === null) return null;
  return Math.round((line.budget - actual) * 100) / 100;
}

function emptySubtotal(): BudgetSubtotal {
  return { amount: 0, budget: 0, vendorAmount: 0, materialAmount: 0, manpowerAmount: 0, actual: 0, revenue: 0 };
}

function addRootLine(into: BudgetSubtotal, line: BudgetLine): void {
  into.amount += line.amount;
  into.budget += line.budget;
  into.vendorAmount += line.vendorAmount ?? 0;
  into.materialAmount += line.materialAmount ?? 0;
  into.manpowerAmount += line.manpowerAmount ?? 0;
  into.actual += lineActual(line) ?? 0;
  into.revenue += line.revenue ?? 0;
}

function round2(subtotal: BudgetSubtotal): BudgetSubtotal {
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    amount: r(subtotal.amount), budget: r(subtotal.budget), vendorAmount: r(subtotal.vendorAmount),
    materialAmount: r(subtotal.materialAmount), manpowerAmount: r(subtotal.manpowerAmount),
    actual: r(subtotal.actual), revenue: r(subtotal.revenue),
  };
}

/**
 * Groups the report's lines into the categories the screen prints, in first-
 * appearance order with Uncategorized always last, and totals each group plus
 * the whole BOQ. Rounding happens ONCE, at the end of each subtotal, over raw
 * values -- the same single-rounding rule compliance-tracker's own
 * boqBudgetVarianceReport uses, so the Grand Total reconciles exactly to a raw
 * SQL sum instead of drifting by fractions of a currency unit.
 *
 * `categoryFilter` (case-insensitive) narrows to the named categories; an
 * empty or all-blank filter means every category, never none.
 */
export function groupBudgetLinesByCategory(
  lines: BudgetLine[],
  categoryFilter?: string[],
  vendorFilter?: string[]
): { groups: BudgetCategoryGroup[]; grandTotal: BudgetSubtotal } {
  const wanted = (categoryFilter ?? []).map((c) => c.trim().toLowerCase()).filter((c) => c.length > 0);
  const wantedVendors = (vendorFilter ?? []).map((v) => v.trim()).filter((v) => v.length > 0);

  const visible = lines.filter((line) => {
    const label = line.category?.trim() || UNCATEGORIZED_LABEL;
    if (wanted.length > 0 && !wanted.includes(label.toLowerCase())) return false;
    if (wantedVendors.length > 0 && !wantedVendors.includes(line.vendorId ?? "")) return false;
    return true;
  });

  const order: string[] = [];
  const byCategory = new Map<string, BudgetLine[]>();
  for (const line of visible) {
    const label = line.category?.trim() || UNCATEGORIZED_LABEL;
    if (!byCategory.has(label)) { byCategory.set(label, []); order.push(label); }
    byCategory.get(label)!.push(line);
  }

  // Uncategorized last: it is a gap to close, not a category of work, and a
  // reader scanning trades should not hit it in the middle of the list.
  order.sort((a, b) => (a === UNCATEGORIZED_LABEL ? 1 : 0) - (b === UNCATEGORIZED_LABEL ? 1 : 0));

  const grandRaw = emptySubtotal();
  const groups = order.map((category) => {
    const groupLines = byCategory.get(category)!;
    const raw = emptySubtotal();
    for (const line of groupLines) {
      if (line.parentLineItemId) continue; // a weighted child is a share of its parent, never money of its own
      addRootLine(raw, line);
      addRootLine(grandRaw, line);
    }
    return { category, lines: groupLines, subtotal: round2(raw) };
  });

  return { groups, grandTotal: round2(grandRaw) };
}

/** Every distinct category present in the data, Uncategorized last -- the options a category filter offers. */
export function budgetCategoryOptions(lines: BudgetLine[]): string[] {
  return groupBudgetLinesByCategory(lines).groups.map((g) => g.category);
}

/**
 * R67 lane D22 (item D-54): the vendors the Vendor filter offers -- only those
 * actually named on a line of THIS BOQ, in first-appearance order. Offering the
 * org's whole supplier list would let a QS pick a vendor that empties the table.
 */
export function budgetVendorOptions(lines: BudgetLine[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const line of lines) {
    if (!line.vendorId || seen.has(line.vendorId)) continue;
    seen.set(line.vendorId, line.vendorName ?? line.vendorId);
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

/**
 * R67 lane D22 (item D-54): the Grand Total has to tie to the BOQ's own total.
 * "Ties" is to the last currency unit, not exactly: the two figures come from
 * two independent code paths (this screen sums the report's root lines; the
 * scope report sums the same rows in SQL) that round at different moments, so
 * a sub-cent difference is arithmetic, and anything larger is a real
 * disagreement worth a banner.
 */
export function grandTotalTies(grandTotalAmount: number, boqTotalValue: number): boolean {
  return Math.abs(grandTotalAmount - boqTotalValue) < 0.01;
}

/**
 * R67 lane D22 (item D-54): folds the response of PATCH
 * /api/scope/line-items/{id} back into the row that was edited.
 *
 * Pure, and shared by both budget screens, because the arithmetic after an
 * inline edit is where a budget table quietly goes wrong: Budget is
 * Amount x Budget % / 100 and Actual is vendor + material + manpower, so
 * changing one cell moves two OTHER columns and every subtotal beneath them.
 * The value comes from the SERVER's response, never from the typed string, so
 * a rejected or coerced value can never be left on screen as if it had saved.
 */
export function applyLineItemPatch(
  line: BudgetLine,
  patched: Record<string, unknown>,
  vendorNameById: (vendorId: string | null) => string | null
): BudgetLine {
  const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
  const next: BudgetLine = { ...line };
  if (patched.budgetPercentage !== undefined) {
    next.budgetPercentage = Number(patched.budgetPercentage);
    next.budget = Math.round(next.amount * (next.budgetPercentage / 100) * 100) / 100;
  }
  if (patched.vendorId !== undefined) {
    next.vendorId = (patched.vendorId as string | null) ?? null;
    next.vendorName = vendorNameById(next.vendorId);
  }
  if (patched.vendorAmount !== undefined) next.vendorAmount = num(patched.vendorAmount);
  if (patched.materialAmount !== undefined) next.materialAmount = num(patched.materialAmount);
  if (patched.manpowerAmount !== undefined) next.manpowerAmount = num(patched.manpowerAmount);
  next.actual = lineActual(next);
  return next;
}
