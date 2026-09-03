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
  /** vendorAmount - budget, or null while there is no quote to compare. */
  variance: number | null;
};

export type BudgetReport = {
  lines: BudgetLine[];
  totalBudget: number;
  totalVendorAmount: number;
  totalVariance: number;
  totalMaterialAmount: number;
  totalManpowerAmount: number;
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
  variance: number | null;
  quotedLines: number;
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
    variance: sum(lines.map((l) => l.variance)),
    quotedLines: lines.filter((l) => l.vendorAmount !== null).length,
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
