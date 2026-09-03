// R67 E-12 (R-136). ONE report document, described once.
//
// Before this, every report on the Reports screen was rendered by
// ReportOutput's generic branches: an array became a table whose headers were
// raw JSON keys, an object became a key/value grid, and money, counts and
// percentages were all String(v). Two reports carrying the same figure showed
// it two ways, a column's decimals changed row to row, and an item code was
// text rather than a way to reach the line it names.
//
// A report's DOCUMENT is now data: a ReportSchema per slug naming its title,
// its columns (key, label, type, align, group), what it groups by, which
// columns carry a total and which column links where. compliance-tracker's
// src/lib/services/report-export.ts holds the mirror of this for the
// server-rendered PDF/XLSX/CSV -- two repos cannot share a module, so each pins
// its labels in its own test and the two lists are asserted identical by
// inspection at review time.
//
// An unknown slug has NO schema and falls back to the generic grid, deliberately:
// inventing a document for a payload nobody described would be a worse lie than
// the raw keys.

import { formatMoney, type MoneyFormat } from "./format-money";
import { EMPTY_VALUE, formatDecimal } from "./format-number";

export type ReportColumnType = "text" | "code" | "money" | "number" | "percent";

export type ReportColumn = {
  /** The key on the row. */
  key: string;
  /** What a reader sees. Never a camelCase key -- that IS the defect. */
  label: string;
  type: ReportColumnType;
  align: "left" | "right";
  /** The band this column belongs to, for a document that prints banded headers. */
  group?: string;
};

export type ReportSchema = {
  slug: string;
  /** The document's own title, above the table. */
  title: string;
  /** Where the rows live inside the payload this schema renders. */
  rowsKey: string;
  columns: ReportColumn[];
  /** The column whose value opens a subtotal band. */
  groupBy?: string;
  /** The columns a subtotal and a grand total are computed for. */
  totals?: string[];
  /** Which column carries the words "Grand Total" / the group name. */
  totalLabelColumn?: string;
  /**
   * The item code becomes a link to the BOQ line it names: /scope/{boqId}#line-{id}.
   * A code a reader cannot follow is a string pretending to be a reference.
   */
  link?: { column: string; boqIdKey: string; idKey: string };
  /**
   * The scalar on the payload the grand total MUST equal. When it does not, the
   * document says so and Export is refused -- arithmetic identities have to be
   * visibly true or the document is not evidence of anything.
   */
  tie?: { column: string; totalKey: string; label: string };
  /**
   * A chart is offered only where the dashboard rules allow one, and it is a
   * SORTED HORIZONTAL BAR, never a pie: a pie cannot be read for rank or for
   * difference, which is the only thing anyone asks of these figures.
   */
  chart?: { labelKey: string; valueKey: string; title: string };
  /** True when compliance-tracker can render this document as PDF/XLSX/CSV server-side. */
  serverExport: boolean;
};

/**
 * Keyed by the picker slug, so the picker, the catalog, the document and the
 * export all name one report the same way.
 */
export const REPORT_SCHEMAS: Record<string, ReportSchema> = {
  // R67 E-13: the Project Status card's Subcontractor / Budget breakup, Sumeet
  // 6.png II. The card itself is scalars; the TABLE under it is the BOQ's
  // budget line by line -- the same six columns compliance-tracker's
  // project-status export schema carries, in the same order.
  "project-status": {
    slug: "project-status",
    title: "Subcontractor / Budget breakup",
    rowsKey: "lines",
    columns: [
      { key: "category", label: "Category", type: "text", align: "left" },
      { key: "code", label: "Code", type: "code", align: "left" },
      { key: "description", label: "Description", type: "text", align: "left" },
      { key: "budget", label: "Budget", type: "money", align: "right" },
      { key: "vendorName", label: "Vendor", type: "text", align: "left" },
      { key: "vendorAmount", label: "Vendor amount", type: "money", align: "right" },
    ],
    groupBy: "category",
    totals: ["budget", "vendorAmount"],
    totalLabelColumn: "category",
    link: { column: "code", boqIdKey: "boqId", idKey: "lineItemId" },
    tie: { column: "budget", totalKey: "totalBudget", label: "Budget" },
    chart: { labelKey: "category", valueKey: "budget", title: "Budget by category" },
    serverExport: true,
  },
  // R67 E-07 (R-114): Sumeet 6.png II(iii)'s eleven columns, the same list
  // compliance-tracker's budget-variance export schema carries.
  "budget-variance": {
    slug: "budget-variance",
    title: "Budget Summary",
    rowsKey: "lines",
    columns: [
      { key: "sNo", label: "S.No", type: "number", align: "right" },
      { key: "category", label: "Category", type: "text", align: "left" },
      { key: "code", label: "Code", type: "code", align: "left" },
      { key: "description", label: "Description", type: "text", align: "left" },
      { key: "quantity", label: "Qty", type: "number", align: "right" },
      { key: "rate", label: "Rate", type: "money", align: "right" },
      { key: "amount", label: "Amt", type: "money", align: "right" },
      { key: "budget", label: "Budget", type: "money", align: "right" },
      { key: "vendorName", label: "Vendor", type: "text", align: "left" },
      { key: "vendorAmount", label: "Vendor Amt", type: "money", align: "right" },
      { key: "variance", label: "Variance", type: "money", align: "right" },
    ],
    groupBy: "category",
    totals: ["budget", "vendorAmount", "variance"],
    totalLabelColumn: "sNo",
    link: { column: "code", boqIdKey: "boqId", idKey: "lineItemId" },
    tie: { column: "budget", totalKey: "totalBudget", label: "Budget" },
    serverExport: true,
  },
};

export function reportSchema(slug: string): ReportSchema | null {
  return REPORT_SCHEMAS[slug] ?? null;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The rows this schema describes, out of whatever the report returned. */
export function schemaRows(schema: ReportSchema, payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isPlainObject);
  if (!isPlainObject(payload)) return [];
  const rows = payload[schema.rowsKey];
  return Array.isArray(rows) ? rows.filter(isPlainObject) : [];
}

/**
 * ONE cell, formatted by its column's declared TYPE. A quantity of 3 is three
 * of something and AED 3.00 is a price; a renderer that cannot tell them apart
 * puts a currency token on a count -- and null must never become 0, because
 * "not recorded" and "zero" are different facts in both directions.
 */
export function formatCell(value: unknown, type: ReportColumnType, format: MoneyFormat): string {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  // A money cell that is not a number or a numeric string is not money -- it is
  // the en dash, never String(someObject) dressed up with a currency code.
  if (type === "money") {
    return typeof value === "number" || typeof value === "string" ? formatMoney(value, format) : EMPTY_VALUE;
  }
  if (type === "number") {
    // A quantity, not money: grouped, up to two decimals, no trailing zeros --
    // "50 m3" must not read "50.00 m3" (see format-number.ts's own note).
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? formatDecimal(n) : EMPTY_VALUE;
  }
  if (type === "percent") {
    const n = typeof value === "number" ? value : Number(value);
    // One decimal, down the whole column, so 6% and 6.25% line up as 6.0% and 6.3%.
    return Number.isFinite(n) ? `${n.toFixed(1)}%` : EMPTY_VALUE;
  }
  return String(value);
}

export type ReportGroup = { name: string; rows: Record<string, unknown>[] };

/**
 * Rows in bands, in FIRST-APPEARANCE order -- the report already ordered them
 * (the BOQ prints an S.No), and re-sorting the bands here would renumber a
 * document a QS reads down.
 */
export function groupRows(rows: Record<string, unknown>[], groupBy: string | undefined): ReportGroup[] {
  if (!groupBy) return [{ name: "", rows }];
  const order: string[] = [];
  const byName = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const raw = row[groupBy];
    const name = typeof raw === "string" && raw.trim() !== "" ? raw : "Uncategorised";
    if (!byName.has(name)) {
      byName.set(name, []);
      order.push(name);
    }
    byName.get(name)!.push(row);
  }
  return order.map((name) => ({ name, rows: byName.get(name)! }));
}

/** Sums one column over the rows AS GIVEN. null when no row carried a figure at all. */
export function columnTotal(rows: Record<string, unknown>[], key: string): number | null {
  let seen = false;
  let sum = 0;
  for (const row of rows) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      seen = true;
      sum += v;
    }
  }
  return seen ? Math.round(sum * 100) / 100 : null;
}

export function columnTotals(rows: Record<string, unknown>[], keys: string[]): Record<string, number | null> {
  return Object.fromEntries(keys.map((k) => [k, columnTotal(rows, k)]));
}

/** Under a hundredth of a unit is rounding, not a disagreement. */
const TIE_TOLERANCE = 0.005;

/**
 * R-136: "arithmetic identities must be visibly true". When the rows on screen
 * do not add up to the figure the report states above them, the document SAYS
 * SO in the reader's units and Export is refused -- a file that carries a table
 * disagreeing with its own total is worse than no file.
 */
export function totalsTieMessage(
  schema: ReportSchema,
  rows: Record<string, unknown>[],
  payload: unknown,
  format: MoneyFormat
): string | null {
  if (!schema.tie) return null;
  const stated = isPlainObject(payload) ? payload[schema.tie.totalKey] : undefined;
  if (typeof stated !== "number" || !Number.isFinite(stated)) return null;
  const summed = columnTotal(rows, schema.tie.column);
  if (summed === null) return null;
  const difference = Math.round((summed - stated) * 100) / 100;
  if (Math.abs(difference) < TIE_TOLERANCE) return null;
  return `Totals do not tie (difference ${formatMoney(Math.abs(difference), format)})`;
}

/**
 * Keys the rows carry that no column claims. R-136: an unknown key is LOGGED,
 * never silently dropped -- a report that quietly grew a column is exactly how
 * a document and its data drift apart.
 */
export function unmappedKeys(schema: ReportSchema, rows: Record<string, unknown>[]): string[] {
  const known = new Set(schema.columns.map((c) => c.key));
  // The link's own two keys are used, just not printed as columns of their own.
  if (schema.link) {
    known.add(schema.link.boqIdKey);
    known.add(schema.link.idKey);
  }
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) if (!known.has(key)) seen.add(key);
  return [...seen].sort();
}

/** The link a code cell becomes: the BOQ line the code names, anchored on that line. */
export function lineHref(schema: ReportSchema, row: Record<string, unknown>): string | null {
  if (!schema.link) return null;
  const boqId = row[schema.link.boqIdKey];
  const lineId = row[schema.link.idKey];
  if (typeof boqId !== "string" || boqId === "") return null;
  const anchor = typeof lineId === "string" && lineId !== "" ? `#line-${lineId}` : "";
  return `/scope/${encodeURIComponent(boqId)}${anchor}`;
}

/** R-136's empty state: it names the period and the project, so it is an answer rather than a blank card. */
export function noRowsMessage(from: string, to: string, projectName: string | null): string {
  return `No rows recorded between ${from} and ${to}${projectName ? ` for ${projectName}` : ""}`;
}

export type ChartBar = { label: string; value: number };

/**
 * The chart's bars: one per group, SORTED biggest first. A pie is never offered
 * -- it cannot be read for rank or for difference, which is the only question
 * anyone asks of these figures. A group with no figure is omitted rather than
 * drawn at zero.
 */
export function chartBars(schema: ReportSchema, rows: Record<string, unknown>[]): ChartBar[] {
  if (!schema.chart) return [];
  const { labelKey, valueKey } = schema.chart;
  return groupRows(rows, labelKey)
    .map((g) => ({ label: g.name, value: columnTotal(g.rows, valueKey) }))
    .filter((b): b is ChartBar => b.value !== null)
    .sort((a, b) => b.value - a.value);
}
