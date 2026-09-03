// R67 D-62 (audit R-202). The Budget module's own rules, kept out of the
// component so the filtering, the totals and — above all — the null wording can
// be proved without a DOM.
//
// Deliberately NOT "use client": pure functions over numbers and strings.
//
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
  amount: number;
  /** The line's own category column (lane I, I-05). null when it has none. */
  category: string | null;
  /** The per-line override. The column's own default is 25, so an untouched line reads 25. */
  budgetPercentage: number;
  /** amount x budgetPercentage / 100, rounded once by the backend. */
  budget: number;
  /**
   * R67 lane D22 (item D-41): the BOQ columns Sumeet's printed budget sheet
   * carries beside the money. OPTIONAL, because the payload gained them after
   * the Budget screen shipped and every fixture written before that is still a
   * valid BudgetLine -- `parentLineItemId` in particular is only read as a
   * truthiness test (a weighted child is a share of its parent, never money of
   * its own), so an absent one behaves exactly like a root line.
   */
  quantity?: number;
  unit?: string;
  rate?: number;
  parentLineItemId?: string | null;
  /**
   * The budget-side split of this line, as the QS enters it -- lane I's
   * material_amount / manpower_amount columns, NOT Wave 125's per-unit
   * materialCost / labourCost rate-analysis inputs, which mean something else
   * on the same row (schema.ts states the distinction at both pairs). null,
   * never 0, when nobody has split the line: "unsplit" and "split as zero" are
   * different facts and only the second is worth reporting.
   */
  materialAmount: number | null;
  manpowerAmount: number | null;
  vendorId: string | null;
  vendorName: string | null;
  /** null until this line has actually been quoted -- never 0. */
  vendorAmount: number | null;
  /**
   * R67 MERGE (D-11, lane D1 x lane D21, 2026-09-03). CONTRACT CHANGED UNDER
   * THIS TYPE -- git auto-merged this file without a conflict because lane D21
   * never touched it, but the BACKEND it describes was rewritten by D-26.
   *
   * `committed` is vendor + material + manpower, not the subcontract alone, and
   * `variance` is now BUDGET REMAINING (budget - committed), the OPPOSITE SIGN
   * of the `vendorAmount - budget` this field used to carry. A POSITIVE
   * variance now means under budget. Reading it the old way turns every
   * healthy line red and every overrun green, which is exactly what the
   * unreviewed auto-merge left this module doing.
   *
   * Both are null -- never 0 -- while nothing at all has been costed on the
   * line: "nothing quoted yet" and "quoted at zero" are different facts.
   *
   * R67 lane D22 (item D-54) folded in: `actual` is Sumeet's name for exactly
   * what `committed` is -- vendor + material + manpower -- so it is an ALIAS,
   * optional because the project Budget screen predates the field, and
   * compliance-tracker computes the two from one expression. `revenue` is what
   * the interim/RA bills have billed against this line; null = never billed.
   */
  committed: number | null;
  variance: number | null;
  actual?: number | null;
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
  // R67 merge: `committed` is the same three components under D-26's name, so
  // it moves with `actual` rather than being left stale on the patched row.
  next.committed = next.actual;
  return next;
}

export type BudgetReport = {
  lines: BudgetLine[];
  /** The BOQ these lines belong to, so an empty state can link to it. null when the project has no BOQ. */
  boqId: string | null;
  totalBudget: number;
  totalVendorAmount: number;
  /** null when NO line carries any committed cost -- see the note on BudgetLine.committed. */
  totalCommitted: number | null;
  totalVariance: number | null;
  totalMaterialAmount: number;
  totalManpowerAmount: number;
  linesOverBudget: number;
  lineCount: number;
};

/** The Budget Report's two filters. An empty string means "all". */
export type BudgetFilters = { category: string; vendor: string };

export const NO_CATEGORY_LABEL = "No category";
export const NO_VENDOR_LABEL = "No vendor";

/**
 * A line's category as the filter shows it: the real name, or the one word for
 * "this line is classified under nothing". Never a blank cell that reads as a
 * loading state.
 */
export function categoryLabel(line: BudgetLine): string {
  return line.category ?? NO_CATEGORY_LABEL;
}

export function vendorLabel(line: BudgetLine): string {
  return line.vendorName ?? NO_VENDOR_LABEL;
}

/** Every value the Category filter can take, in the order a person reads them. */
export function categoryOptions(lines: readonly BudgetLine[]): string[] {
  return [...new Set(lines.map(categoryLabel))].sort((a, b) =>
    a === NO_CATEGORY_LABEL ? 1 : b === NO_CATEGORY_LABEL ? -1 : a.localeCompare(b)
  );
}

export function vendorOptions(lines: readonly BudgetLine[]): string[] {
  return [...new Set(lines.map(vendorLabel))].sort((a, b) =>
    a === NO_VENDOR_LABEL ? 1 : b === NO_VENDOR_LABEL ? -1 : a.localeCompare(b)
  );
}

export function filterBudgetLines(lines: readonly BudgetLine[], filters: BudgetFilters): BudgetLine[] {
  return lines.filter(
    (l) =>
      (!filters.category || categoryLabel(l) === filters.category) &&
      (!filters.vendor || vendorLabel(l) === filters.vendor)
  );
}

/**
 * Totals over whatever is on screen, so the Budget Report's figures always
 * describe the rows below them. Nulls are SKIPPED, not counted as zero -- an
 * unquoted line must not drag the vendor total down, and a line with no rate
 * breakdown is not a line with no material cost.
 */
export function budgetTotals(lines: readonly BudgetLine[]): {
  budget: number;
  material: number | null;
  labour: number | null;
  vendorAmount: number | null;
  committed: number | null;
  variance: number | null;
  quotedLines: number;
  overBudgetLines: number;
} {
  const sum = (values: (number | null)[]): number | null => {
    const real = values.filter((v): v is number => v !== null);
    return real.length > 0 ? Math.round(real.reduce((s, v) => s + v, 0) * 100) / 100 : null;
  };
  return {
    budget: Math.round(lines.reduce((s, l) => s + l.budget, 0) * 100) / 100,
    material: sum(lines.map((l) => l.materialAmount)),
    labour: sum(lines.map((l) => l.manpowerAmount)),
    vendorAmount: sum(lines.map((l) => l.vendorAmount)),
    // R67 D-26, folded in at the D1 x D21 merge: committed cost is vendor PLUS
    // material PLUS manpower. null when NOTHING on screen has been costed.
    committed: sum(lines.map((l) => l.committed)),
    variance: sum(lines.map((l) => l.variance)),
    quotedLines: lines.filter((l) => l.vendorAmount !== null).length,
    // R67 D-26: a line is over budget when its committed cost EXCEEDS its
    // budget -- i.e. a NEGATIVE remaining variance. Mirrors
    // isLineOverBudget() in compliance-tracker's construction-reports-service,
    // which is the single definition this must not drift from.
    overBudgetLines: lines.filter((l) => l.variance !== null && l.variance < 0).length,
  };
}

/** "Showing 4 of 12" -- the count every filtered list in this product states. */
export function showingCount(shown: number, total: number): string {
  return `Showing ${shown} of ${total}`;
}

/**
 * A budget percent typed into the inline editor. The backend refuses anything
 * outside 0-100 with a 400; saying so at the field is the difference between a
 * correction and a failed save.
 */
export function budgetPercentError(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return "Enter a budget percent between 0 and 100";
  const value = Number(trimmed);
  if (Number.isNaN(value)) return "Budget percent must be a number";
  if (value < 0 || value > 100) return "Budget percent must be between 0 and 100";
  return undefined;
}

/** A vendor amount typed into the inline editor. Empty clears the quote (null), which is legitimate. */
export function vendorAmountError(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (Number.isNaN(value)) return "Vendor amount must be a number";
  if (value < 0) return "Vendor amount cannot be negative";
  return undefined;
}

/** The rows an Export writes, in the order the table shows them. */
export const BUDGET_EXPORT_HEADERS = [
  "Code",
  "Description",
  "Category",
  "Budget %",
  "Budget",
  "Material",
  "Manpower",
  "Vendor",
  "Vendor amount",
  "Variance",
];

export function budgetExportRows(lines: readonly BudgetLine[]): unknown[][] {
  return lines.map((l) => [
    l.code ?? "",
    l.description,
    l.category ?? "",
    l.budgetPercentage,
    l.budget,
    l.materialAmount ?? "",
    l.manpowerAmount ?? "",
    l.vendorName ?? "",
    l.vendorAmount ?? "",
    l.variance ?? "",
  ]);
}
