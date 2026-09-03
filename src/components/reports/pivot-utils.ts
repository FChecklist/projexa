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

// ---------------------------------------------------------------------------
// R67 E-27 (R-213). WHAT A COLUMN ACTUALLY IS.
//
// THE BUG THIS EXISTS FOR. ReportChart's initial state was
// `categoryField = columns[0]` and `valueField = columns[1]`. On every report
// this app runs, columns[0] is the row's id and columns[1] is its name -- so
// the chart opened as "a database id on the axis, a project name as the
// height", which aggregates to zero for every bar. The reader saw a frame of
// zero-height bars and had to change two dropdowns before the chart said
// anything. A chart that needs to be repaired before it can be read is not a
// default, it is a puzzle.
//
// The fix is to know what the columns ARE, which nothing in this file did.

export type ColumnKind = "id" | "text" | "number" | "date";
export type ColumnType = { name: string; kind: ColumnKind };

/**
 * An id-shaped VALUE: 20+ characters of unbroken letters/digits. cuid and uuid
 * -without-dashes both match; a real word, a code like "1.2.3", a date and a
 * money figure all do not. Deliberately not "any long string" -- a
 * 25-character description must stay text.
 */
const ID_LIKE_VALUE = /^[a-z0-9]{20,}$/i;

/** A key that NAMES an id: "id", "projectId", "project_id", "lineItemID". */
export function isIdColumnName(name: string): boolean {
  return /(^|[a-z0-9_])id$/i.test(name) && /id$/i.test(name);
}

/** ISO-ish dates, which is what every report in this app emits. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/;

function nonBlank(rows: Record<string, unknown>[], name: string): unknown[] {
  return rows.map((r) => r[name]).filter((v) => v !== null && v !== undefined && v !== "");
}

/**
 * The kind of one column, from its name and its own values. Values win over
 * the name for number/date (a column called "count" holding "n/a" is text),
 * and the name wins for ids (a "projectId" column whose ids happen to be short
 * is still an id, and must still never become an axis).
 */
export function inferColumnKind(rows: Record<string, unknown>[], name: string): ColumnKind {
  if (isIdColumnName(name)) return "id";
  const values = nonBlank(rows, name);
  if (values.length === 0) return "text";
  if (values.every((v) => typeof v === "string" && ID_LIKE_VALUE.test(v))) return "id";
  if (values.every((v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))))) {
    return "number";
  }
  if (values.every((v) => typeof v === "string" && ISO_DATE.test(v))) return "date";
  return "text";
}

export function inferColumnTypes(rows: Record<string, unknown>[], columns?: string[]): ColumnType[] {
  const names = columns ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
  return names.map((name) => ({ name, kind: inferColumnKind(rows, name) }));
}

export type ChartDefaults = {
  categoryField: string;
  valueField: string;
  agg: AggregationFn;
  /** A Line option is only offered when there is a real date column to put on the axis. */
  hasDateColumn: boolean;
};

/**
 * The chart's opening state, chosen so the FIRST render says something true:
 * the first text column is the category, the first numeric column is the
 * value, and the aggregation is a sum -- except for a percentage, where summing
 * is meaningless and the average is the figure a reader wants.
 *
 * An id is never picked for either role. When a report genuinely has no text
 * column, the date column stands in as the category (a per-day chart is a real
 * answer); when it has neither, the chart falls back to counting rows, which is
 * the only honest thing left to plot.
 */
export function chartDefaults(rows: Record<string, unknown>[], columns?: string[]): ChartDefaults {
  const types = inferColumnTypes(rows, columns);
  const firstOfKind = (kind: ColumnKind) => types.find((t) => t.kind === kind)?.name;

  const category = firstOfKind("text") ?? firstOfKind("date") ?? types.find((t) => t.kind !== "number")?.name ?? types[0]?.name ?? "";
  const value = firstOfKind("number") ?? "";
  const agg: AggregationFn = value === "" ? "count" : /percent|percentage|pct|%/i.test(value) ? "avg" : "sum";

  return { categoryField: category, valueField: value, agg, hasDateColumn: types.some((t) => t.kind === "date") };
}

/**
 * The Table tab's drill filter. `bucketKey` is the SAME normalisation
 * computeChartData groups by, so clicking the bar labelled "(blank)" really
 * does select the rows whose category is empty, rather than selecting nothing
 * and looking broken.
 */
export function filterRowsByCategory<T extends Record<string, unknown>>(
  rows: T[],
  categoryField: string,
  category: string | null
): T[] {
  if (category === null || !categoryField) return rows;
  return rows.filter((row) => bucketKey(row[categoryField]) === category);
}
