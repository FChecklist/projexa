// R67 E-05 (R-103): the Material Cost Report's client-side rules.
//
// The arithmetic itself is compliance-tracker's (aggregateMaterialCostReport)
// -- this file never re-adds a column, because a second summation path is
// exactly how a screen and its export come to disagree. What lives here is
// what the SCREEN owes the reader: the tie check that decides whether Export
// may be offered at all, the CSV built from the rows actually on screen, and
// the empty-range sentence.

export type MaterialCostReportGroupBy = "material" | "vendor";

export type MaterialCostRow = {
  key: string;
  materialId: string | null;
  name: string;
  spec: string | null;
  vendorId: string | null;
  vendorName: string | null;
  unit: string | null;
  totalQuantityReceived: number;
  totalCost: number;
  averageUnitCost: number;
  masterUnitCost: number | null;
  variance: number | null;
};

export type MaterialCostReport = {
  rows: MaterialCostRow[];
  totals: { quantity: number; cost: number };
  params: { projectId: string; from: string | null; to: string | null; groupBy: MaterialCostReportGroupBy };
};

/** DD-MM-YYYY, the shape the empty-range sentence uses. A slice, so no timezone can move the day. */
export function dmy(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

/**
 * "No receipts between 01-01-2026 and 02-09-2026 - widen the range", never a
 * blank card. A reader who sees nothing cannot tell an empty range from a
 * broken screen; this sentence tells them which, and what to do.
 */
export function emptyRangeMessage(from: string | null, to: string | null): string {
  const f = dmy(from);
  const t = dmy(to);
  if (f && t) return `No receipts between ${f} and ${t} — widen the range`;
  if (f) return `No receipts on or after ${f} — widen the range`;
  if (t) return `No receipts on or before ${t} — widen the range`;
  return "No receipts recorded for this project yet";
}

/**
 * R67 E-18 (R-178): what this document is CALLED in a WhatsApp message, in a
 * copied-link toast and in the "PDF ready" line -- so the recipient can tell
 * one exported cost report from another without opening it. The period is part
 * of the name because two files with the same name and different windows is
 * exactly how a wrong figure gets quoted in a meeting.
 */
export function costReportTitle(from: string | null, to: string | null): string {
  const f = dmy(from);
  const t = dmy(to);
  if (f && t) return `Material Cost Report ${f} to ${t}`;
  if (f) return `Material Cost Report from ${f}`;
  if (t) return `Material Cost Report to ${t}`;
  return "Material Cost Report — every receipt on record";
}

/**
 * The arithmetic identity a QS checks by hand: the rows on screen must sum to
 * the Grand Total under them. If they do not, the report is wrong and must say
 * so LOUDLY rather than render quietly -- and Export is disabled with that as
 * the stated reason, because a wrong file outlives a wrong screen.
 *
 * Returns null when the totals tie, or the sentence to show when they do not.
 * The one-cent tolerance is for float noise, not for a real discrepancy.
 */
export function checkMaterialCostTies(report: MaterialCostReport, money: (n: number) => string): string | null {
  const rowSum = report.rows.reduce((s, r) => s + r.totalCost, 0);
  if (Math.abs(rowSum - report.totals.cost) <= 0.01) return null;
  return `The rows on screen add up to ${money(rowSum)} but the Grand Total reads ${money(report.totals.cost)}. Export is disabled until this is fixed.`;
}

const CSV_HEADERS = [
  "Material", "Spec", "Vendor", "Unit", "Qty Received", "Total Cost", "Avg Unit Cost", "Master Unit Cost", "Variance",
] as const;

/**
 * OWASP CSV/formula injection: a cell starting with =, +, - or @ is executed
 * as a formula when the file is opened. Material and vendor names are
 * user-typed free text, so every cell gets the standard leading-apostrophe
 * mitigation -- the same guard compliance-tracker's report-export-shared.ts
 * applies to the server-rendered exports, restated here because this CSV is
 * built in the browser from the rows on screen and never passes through it.
 */
export function csvEscape(value: string | number | null): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The en dash. "We do not have this figure" is not "this figure is zero". */
const EMPTY = "–";

/**
 * CSV from the rows ON SCREEN, per the item -- so what a reader exports is
 * what they were looking at, filters and grouping included. The caption line
 * comes first, so the file states its own period and grouping and cannot be
 * mistaken for a different run.
 */
export function buildMaterialCostCsv(report: MaterialCostReport): string {
  const caption = `Material Cost Report · ${dmy(report.params.from) ?? "all time"} to ${dmy(report.params.to) ?? "today"} · grouped by ${report.params.groupBy}`;
  const lines = [
    csvEscape(caption),
    CSV_HEADERS.join(","),
    ...report.rows.map((r) =>
      [
        csvEscape(r.name),
        csvEscape(r.spec ?? EMPTY),
        csvEscape(r.vendorName ?? EMPTY),
        csvEscape(r.unit ?? EMPTY),
        r.totalQuantityReceived,
        r.totalCost,
        r.averageUnitCost,
        r.masterUnitCost === null ? EMPTY : r.masterUnitCost,
        r.variance === null ? EMPTY : r.variance,
      ].join(",")
    ),
    // The Grand Total travels WITH the rows it totals -- a file whose reader
    // has to re-add the column is the defect this report exists to fix.
    ["Grand Total", "", "", "", report.totals.quantity, report.totals.cost, "", "", ""].join(","),
  ];
  return lines.join("\n");
}

/**
 * The period the report opens on, so it runs by pressing nothing.
 *
 * The item words this as "project start -> today". PROJEXA does not have the
 * project's start date: the org dashboard payload it resolves projects from
 * carries id and name only (src/lib/project-selection.ts), and inventing a
 * start date would be worse than not having one. An OPEN lower bound is what
 * "from the project's start" actually means for a project whose start we were
 * never told -- every receipt this project has, up to today -- rather than a
 * month-to-date window that would show an empty report for a project whose
 * deliveries were last month and make a real ledger look empty.
 *
 * The From field is therefore blank on arrival and says so in words; typing
 * one narrows the range.
 */
export function defaultCostReportRange(today: Date = new Date()): { from: string; to: string } {
  return { from: "", to: today.toISOString().slice(0, 10) };
}
