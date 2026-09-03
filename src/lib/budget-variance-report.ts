// R67 E-07 (R-114) + E-08 (R-115). The pure half of the Cost Variance /
// Budget Summary screen and its Revenue-Budget-Actual sibling: the URL
// contract, the CSV, the empty-state sentence and the chart ordering.
//
// It is pure and separate so the rules can be tested without a browser, and
// so BOTH screens read ONE definition of "what the URL means" -- Back has to
// restore the same filters the Export sent, and that is only true if one
// module decides it.
//
// NOTHING IS RECOMPUTED HERE. Every figure arrives already aggregated by
// compliance-tracker's boqBudgetVarianceReport / aggregateRevenueBudgetActual,
// which is the one place this report's arithmetic lives (D-3).

export type VarianceGroupBy = "scope" | "category";

export type VarianceLine = {
  lineItemId: string;
  boqId: string;
  sNo: number | null;
  isRootLine: boolean;
  parentLineItemId: string | null;
  code: string | null;
  description: string;
  category: string | null;
  quantity: number;
  rate: number;
  unit: string;
  amount: number;
  budgetPercentage: number;
  budget: number;
  materialAmount: number | null;
  manpowerAmount: number | null;
  vendorId: string | null;
  vendorName: string | null;
  vendorAmount: number | null;
  variance: number | null;
};

export type RevenueBudgetActualRow = {
  key: string;
  item: string;
  description: string;
  category: string;
  revenue: number;
  budget: number;
  actual: number | null;
  variance: number | null;
  percentUsed: number | null;
  lineItemId: string | null;
  lineCount: number;
};

export type VarianceReport = {
  boqId: string | null;
  boqTitle: string | null;
  lines: VarianceLine[];
  subTaskLineCount: number;
  /** null (not 0) when the project has no BOQ -- rendered as an en dash, never "0". */
  totalBudget: number | null;
  totalVendorAmount: number;
  totalVariance: number;
  totalMaterialAmount: number;
  totalManpowerAmount: number;
  availableCategories: string[];
  availableVendors: { id: string; name: string }[];
  filters: { categories: string[]; vendorId: string | null; groupBy: VarianceGroupBy };
  revenueBudgetActual: {
    groupBy: VarianceGroupBy;
    rows: RevenueBudgetActualRow[];
    totals: { revenue: number; budget: number; actual: number | null; variance: number | null; percentUsed: number | null };
  };
  /**
   * The per-category fold, ALWAYS returned whatever groupBy asked for -- a
   * scope-wise table still owes the reader its subtotals, and taking them from
   * the same fold as the category-wise view is what stops a subtotal and a
   * category row disagreeing.
   */
  categorySubtotals: RevenueBudgetActualRow[];
};

/** The filter state, which lives in the URL so Back restores it. */
export type VarianceFilters = { categories: string[]; vendorId: string | null; groupBy: VarianceGroupBy };

/**
 * Reads the filters OUT of the URL. Repeatable `?category=` rather than one
 * comma-joined value, for the same reason the backend takes them that way: a
 * real category name may contain a comma, and splitting on one would filter
 * for a category nobody has.
 */
export function readVarianceFilters(params: URLSearchParams): VarianceFilters {
  return {
    categories: params.getAll("category").filter((c) => c.trim() !== ""),
    vendorId: params.get("vendorId")?.trim() || null,
    groupBy: params.get("groupBy") === "category" ? "category" : "scope",
  };
}

/**
 * Writes them back. `base` carries whatever else the screen's URL holds
 * (projectId, tab) so switching a filter never drops the tab the reader is on.
 */
export function varianceSearchParams(filters: VarianceFilters, base: Record<string, string | null | undefined> = {}): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(base)) {
    if (value) qs.set(key, value);
  }
  for (const category of filters.categories) qs.append("category", category);
  if (filters.vendorId) qs.set("vendorId", filters.vendorId);
  if (filters.groupBy === "category") qs.set("groupBy", filters.groupBy);
  return qs;
}

/** The API query for one run -- the same parameters the export relay is given, so a file can never disagree with the screen. */
export function varianceApiQuery(projectId: string, filters: VarianceFilters): string {
  return varianceSearchParams(filters, { projectId }).toString();
}

/**
 * R-114: "An empty filter result reads 'No lines for {category} / {vendor}'".
 * Both dimensions are always named, so the reader can see WHICH of the two
 * filters emptied the table.
 */
export function emptyFilterMessage(filters: VarianceFilters, vendorName: string | null): string {
  const category = filters.categories.length > 0 ? filters.categories.join(", ") : "All categories";
  const vendor = vendorName ?? (filters.vendorId ? filters.vendorId : "All vendors");
  return `No lines for ${category} / ${vendor}`;
}

/** Where a BOQ code links to: the line inside its own BOQ on the Scope screen. */
export function scopeLineHref(line: { boqId: string; lineItemId: string }): string {
  return `/scope/${encodeURIComponent(line.boqId)}#line-${line.lineItemId}`;
}

/** The contract lines -- what the table shows and what the totals total. */
export function contractLines(report: VarianceReport | null): VarianceLine[] {
  return (report?.lines ?? []).filter((l) => l.isRootLine);
}

/**
 * R-114: per-category subtotals under the scope-wise table. The category-wise
 * fold the backend already returns IS the subtotal set -- reusing it here
 * rather than re-adding the column in the browser is what keeps one number
 * meaning one thing.
 */
export function categorySubtotalOf(rows: RevenueBudgetActualRow[], category: string): RevenueBudgetActualRow | null {
  return rows.find((r) => r.key === category) ?? null;
}

/** R-115: the bar's tone, its glyph and its WORD -- so the state never depends on colour alone. */
export type VarianceBar = {
  key: string;
  label: string;
  value: number;
  tone: "late" | "done";
  glyph: string;
  word: "over" | "under";
  /** What a screen reader is given, since a bar's own length says nothing on its own. */
  ariaLabel: string;
};

/**
 * R-115: "sorted by variance descending, tone 'late' for over budget and
 * 'done' otherwise, each bar labelled with an arrow glyph plus the word
 * 'over' or 'under'".
 *
 * A row with nothing costed yet carries variance null and is LEFT OUT rather
 * than drawn at zero -- a bar at the origin reads as "on budget", which is a
 * claim nobody made.
 *
 * R67 D-26 (merged 2026-09-03): `variance` is BUDGET REMAINING, so a NEGATIVE
 * figure is the overrun. "Sorted by variance descending" therefore puts the
 * healthiest rows first, which is the wrong way round for a chart whose job is
 * "which trade is over" -- so the sort is ASCENDING on the new sign, which is
 * the same worst-first order R-115 asked for.
 */
export function varianceBars(rows: RevenueBudgetActualRow[]): VarianceBar[] {
  return rows
    .filter((r): r is RevenueBudgetActualRow & { variance: number } => r.variance !== null)
    .slice()
    .sort((a, b) => a.variance - b.variance)
    .map((r) => {
      const over = r.variance < 0;
      return {
        key: r.key,
        label: r.item,
        value: r.variance,
        tone: over ? ("late" as const) : ("done" as const),
        glyph: over ? "▲" : "▼",
        word: over ? ("over" as const) : ("under" as const),
        ariaLabel: `${r.item}: ${Math.abs(r.variance)} ${over ? "over" : "under"} budget`,
      };
    });
}

/**
 * OWASP formula-injection guard, restated here for the same reason
 * material-cost-report.ts states it: this CSV is built in the BROWSER from the
 * rows on screen and never passes through compliance-tracker's
 * report-export-shared.ts, and BOQ descriptions, categories and vendor names
 * are user-typed free text.
 */
export function csvEscape(value: string | number | null): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The en dash. "We do not have this figure" is not "this figure is zero". */
const EMPTY = "–";

export const VARIANCE_CSV_HEADERS = ["S.No", "Category", "Code", "Description", "Qty", "Rate", "Amt", "Budget", "Vendor", "Vendor Amt", "Variance"];

/**
 * CSV from the rows ON SCREEN, filters included, exactly as the Work Progress
 * report tab does it -- so what a reader exports is what they were looking at.
 * The first line states the filters, so a shared file cannot be mistaken for a
 * different run, and the Grand Total travels WITH the rows it totals.
 */
export function buildVarianceCsv(report: VarianceReport, vendorName: string | null): string {
  const rows = contractLines(report);
  const caption = `Budget Summary / Cost Variance · ${report.boqTitle ?? "no BOQ"} · ${emptyFilterMessage(
    { categories: report.filters.categories, vendorId: report.filters.vendorId, groupBy: report.filters.groupBy },
    vendorName
  ).replace("No lines for ", "")}`;
  return [
    csvEscape(caption),
    VARIANCE_CSV_HEADERS.join(","),
    ...rows.map((l) =>
      [
        l.sNo ?? EMPTY,
        csvEscape(l.category ?? EMPTY),
        csvEscape(l.code ?? EMPTY),
        csvEscape(l.description),
        l.quantity,
        l.rate,
        l.amount,
        l.budget,
        csvEscape(l.vendorName ?? EMPTY),
        l.vendorAmount === null ? EMPTY : l.vendorAmount,
        l.variance === null ? EMPTY : l.variance,
      ].join(",")
    ),
    ["Grand Total", "", "", "", "", "", "", report.totalBudget ?? EMPTY, "", report.totalVendorAmount, report.totalVariance].join(","),
  ].join("\n");
}

/**
 * The tie check R-114 and R-103 both require: the rows on screen must sum to
 * the total printed under them, or Export is disabled WITH this sentence as
 * its reason. A wrong file outlives a wrong screen.
 *
 * Returns null when the arithmetic is sound.
 */
export function checkVarianceTies(report: VarianceReport, money: (n: number) => string): string | null {
  const rows = contractLines(report);
  if (rows.length === 0) return null;
  const summed = Math.round(rows.reduce((s, l) => s + l.budget, 0) * 100) / 100;
  const stated = report.totalBudget ?? 0;
  // One-unit tolerance: the rows are each rounded to 2dp for display while the
  // total is rounded once, so a cent of drift is expected arithmetic, not a
  // discrepancy worth blocking an export over.
  if (Math.abs(summed - stated) <= 0.01) return null;
  return `Totals do not tie: the lines add up to ${money(summed)} but the total says ${money(stated)}`;
}
