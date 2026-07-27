// Pure client-side pivot/aggregation math over a report_definitions
// execution result (a bounded, already-fetched JSON array -- see
// STRICT_THIN_CLIENT_EXTENSION in this task's spec). No DB access, no
// network calls: this is the ONLY place row/column/value grouping happens,
// so PivotTable.tsx and ReportChart.tsx both stay thin UI wrappers around it.
export type AggregationFn = "sum" | "avg" | "count";

export const AGGREGATION_LABELS: Record<AggregationFn, string> = {
  sum: "Sum",
  avg: "Average",
  count: "Count",
};

function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function bucketKey(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(blank)";
  return String(v);
}

function aggregate(values: number[], agg: AggregationFn): number {
  if (agg === "count") return values.length;
  if (values.length === 0) return 0;
  const total = values.reduce((a, b) => a + b, 0);
  return agg === "avg" ? total / values.length : total;
}

export type PivotResult = {
  rowKeys: string[];
  colKeys: string[];
  /** rowKey -> colKey -> aggregated value */
  cells: Record<string, Record<string, number>>;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grandTotal: number;
};

/**
 * Groups `rows` by `rowField` (and optionally `colField`), aggregating
 * `valueField` with `agg`. Row/col ordering follows first-seen order in the
 * input data, not alphabetical -- keeps a report's natural ordering (e.g.
 * months, project phases) instead of re-sorting it.
 */
export function computePivot(
  rows: Record<string, unknown>[],
  opts: { rowField: string; colField?: string | null; valueField?: string | null; agg: AggregationFn }
): PivotResult {
  const { rowField, colField, valueField, agg } = opts;
  const rowOrder: string[] = [];
  const colOrder: string[] = [];
  const buckets = new Map<string, Map<string, number[]>>();

  for (const row of rows) {
    const rk = bucketKey(row[rowField]);
    const ck = colField ? bucketKey(row[colField]) : "value";
    if (!buckets.has(rk)) {
      buckets.set(rk, new Map());
      rowOrder.push(rk);
    }
    const rowBucket = buckets.get(rk)!;
    if (!rowBucket.has(ck)) {
      rowBucket.set(ck, []);
      if (!colOrder.includes(ck)) colOrder.push(ck);
    }
    const raw = agg === "count" ? 1 : toNumber(valueField ? row[valueField] : 1);
    rowBucket.get(ck)!.push(raw);
  }

  const cells: Record<string, Record<string, number>> = {};
  const rowTotals: Record<string, number> = {};
  const colValuesForTotal = new Map<string, number[]>();
  let allValues: number[] = [];

  for (const rk of rowOrder) {
    cells[rk] = {};
    const rowValues: number[] = [];
    for (const ck of colOrder) {
      const values = buckets.get(rk)!.get(ck) ?? [];
      cells[rk][ck] = aggregate(values, agg);
      rowValues.push(...values);
      colValuesForTotal.set(ck, (colValuesForTotal.get(ck) ?? []).concat(values));
    }
    rowTotals[rk] = aggregate(rowValues, agg);
    allValues = allValues.concat(rowValues);
  }

  const colTotals: Record<string, number> = {};
  for (const ck of colOrder) colTotals[ck] = aggregate(colValuesForTotal.get(ck) ?? [], agg);

  return { rowKeys: rowOrder, colKeys: colOrder, cells, rowTotals, colTotals, grandTotal: aggregate(allValues, agg) };
}

export type ChartDatum = { category: string; value: number };

/** One-dimensional grouping (category -> aggregated value) for bar/line/pie charts. */
export function computeChartData(
  rows: Record<string, unknown>[],
  opts: { categoryField: string; valueField?: string | null; agg: AggregationFn }
): ChartDatum[] {
  const pivot = computePivot(rows, { rowField: opts.categoryField, colField: null, valueField: opts.valueField, agg: opts.agg });
  return pivot.rowKeys.map((category) => ({ category, value: pivot.cells[category]?.value ?? 0 }));
}

export function formatPivotNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
