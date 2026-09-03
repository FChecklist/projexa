// R67 D-62 (audit R-202). The Budget module's own rules, kept out of the
// component so the filtering, the totals and — above all — the null wording can
// be proved without a DOM.
//
// Deliberately NOT "use client": pure functions over numbers and strings.

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
   */
  committed: number | null;
  variance: number | null;
};

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
