// R67 E-32 (R-265). THE SHAPE EVERY VERIDIAN REPORT NOW ANSWERS IN.
//
// WHAT WAS WRONG. Seventeen reports, seventeen payload shapes, and one generic
// renderer (ReportOutput) that printed whichever JSON keys it found against
// whatever values were behind them. Project Status read
// "projectId g555imnoq4wihavpwc7t64um / contractValue 475000 /
// percentByValue 25 / progressPercent 60": a database key a customer cannot
// use, money with no currency on it, and two differently-derived percentages
// side by side with nothing saying they measure different things. E-22 gave
// five of Sumeet's named reports a real column set of their own; the other
// twelve kept the dump.
//
// WHAT THIS IS. The client half of compliance-tracker's own
// `buildReportTable()` contract (src/lib/services/construction-reports-service.ts):
// columns that declare their unit and alignment, rows keyed by those columns,
// an optional totals row, and the ORG'S currency stated once for the whole
// table. The server decides what a column MEANS; this module decides how a cell
// READS, in one place, so money cannot be formatted three ways on three
// reports.
//
// WHY THE TYPES ARE RESTATED HERE AND NOT IMPORTED. projexa is a separate
// application that talks to VERIDIAN over HTTP; it cannot import from the
// compliance-tracker repo. This is the wire contract, written down on the
// receiving side, with a type guard that checks it at runtime -- because an
// older VERIDIAN deployment answering the legacy shape must degrade visibly
// rather than render a table of undefineds.

import { formatDate } from "./format-date";
import { formatMoney, type MoneyFormat } from "./format-money";
import { EMPTY_VALUE, formatDecimal } from "./format-number";

export type ReportColumnUnit = "currency" | "percent" | "number" | "date" | "text";

export type ReportColumn = {
  key: string;
  label: string;
  unit: ReportColumnUnit;
  align: "left" | "right";
};

export type ReportCell = string | number | null;

export type ReportTable = {
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals?: Record<string, number>;
  /** The org's base currency code, or null when the org has not set one. Never guessed. */
  currency: string | null;
  note?: string;
};

const UNITS: ReportColumnUnit[] = ["currency", "percent", "number", "date", "text"];

/**
 * Is this payload the table contract, or something older?
 *
 * Deliberately strict about the COLUMNS and lenient about the rows: a report
 * with no rows is a perfectly ordinary empty result, but a "column" with no
 * unit is a different contract wearing the same field names, and formatting its
 * cells as if the unit were text would print money bare.
 */
export function isReportTable(payload: unknown): payload is ReportTable {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Partial<ReportTable>;
  if (!Array.isArray(candidate.columns) || !Array.isArray(candidate.rows)) return false;
  if (!("currency" in candidate)) return false;
  return candidate.columns.every(
    (c) =>
      typeof c === "object" &&
      c !== null &&
      typeof c.key === "string" &&
      typeof c.label === "string" &&
      UNITS.includes(c.unit) &&
      (c.align === "left" || c.align === "right")
  );
}

/**
 * The en-dash a cell with no value renders as. Never "0", never "null", never
 * blank. Re-exported from format-number rather than declared again here: the
 * money formatter already uses that exact character for the same fact, and two
 * near-identical dashes on one screen is the kind of drift WS-G's one-formatter
 * rule exists to prevent.
 */
export const EMPTY_CELL = EMPTY_VALUE;

/**
 * One cell, formatted for reading.
 *
 * THE RULES, and why each one is here rather than at a call site:
 *  * null / undefined / "" -> an en-dash. A missing figure and a zero are
 *    different facts and a report that renders both as "0" is lying about one
 *    of them.
 *  * currency -> the shared formatMoney, so "AED 6,500" is produced by the same
 *    code that produces it on the dashboard, and an org with no currency set
 *    gets the bare number rather than a guessed code.
 *  * percent -> the number with a "%" after it, and no currency anywhere near it.
 *  * date -> the shared formatDate, pinned to one locale and UTC, so a
 *    date-only value cannot shift a day between the server pass and the client.
 *  * number -> grouped, so a six-figure quantity is readable, but with no unit
 *    invented for it.
 */
export function formatReportCell(value: ReportCell, unit: ReportColumnUnit, money: MoneyFormat): string {
  if (value === null || value === undefined || value === "") return EMPTY_CELL;
  switch (unit) {
    case "currency":
      return formatMoney(value, money);
    case "percent":
      return `${value}%`;
    case "date":
      return formatDate(value as string);
    case "number":
      // formatDecimal, not toLocaleString(undefined): passing no locale is the
      // hydration bug format-date.ts exists to prevent -- the server pass
      // formats in the server's locale and the first client pass in the
      // visitor's, and for any non-en-US visitor the two strings differ.
      return typeof value === "number" ? formatDecimal(value) : String(value);
    default:
      return String(value);
  }
}

/**
 * Does this table have a totals row worth printing?
 *
 * An empty totals object is not one. The server omits `totals` wherever adding
 * a column up is not a real statement (Project Status's revenue/budget/expense,
 * a column of percentages), and this keeps that decision intact rather than
 * printing an empty bold row that reads as a total of zero.
 */
export function hasTotals(table: ReportTable): boolean {
  return !!table.totals && Object.keys(table.totals).length > 0;
}

/** RFC-4180 quoting: a description with a comma in it must not become two columns. */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The table, as a CSV a QS can open and check the arithmetic in.
 *
 * RAW NUMBERS, NOT FORMATTED ONES. A money cell is written as 6500, not
 * "AED 6,500.00": the thousands separator is a column break in a CSV and the
 * currency code makes the cell text rather than a number, so the spreadsheet
 * cannot add the column up -- which is the only reason to export a report as a
 * spreadsheet at all. The currency is named ONCE in the header of the column it
 * applies to, where it does no arithmetic damage.
 */
export function reportTableToCsv(table: ReportTable): string {
  const header = table.columns
    .map((c) => csvCell(c.unit === "currency" && table.currency ? `${c.label} (${table.currency})` : c.label))
    .join(",");
  const body = table.rows.map((row) =>
    table.columns
      .map((c) => {
        const value = row[c.key];
        // Empty, not the en-dash: a dash in a numeric column makes the whole
        // column text in every spreadsheet application.
        return value === null || value === undefined ? "" : csvCell(String(value));
      })
      .join(",")
  );
  const lines = [header, ...body];
  if (hasTotals(table)) {
    lines.push(
      table.columns
        .map((c, index) => {
          const total = table.totals?.[c.key];
          if (total !== undefined) return csvCell(String(total));
          return index === 0 ? "Total" : "";
        })
        .join(",")
    );
  }
  return lines.join("\n");
}

/**
 * The pivot/chart tabs take `columns: string[]` and rows keyed by LABEL, which
 * is what a reader picking a column in a dropdown expects to see. The table
 * itself renders from the typed columns, so the two never disagree about which
 * column is which -- they are both projections of the one server response.
 */
export function toLabelledRows(table: ReportTable): { columns: string[]; rows: Record<string, string | number>[] } {
  return {
    columns: table.columns.map((c) => c.label),
    rows: table.rows.map((row) => {
      const out: Record<string, string | number> = {};
      for (const col of table.columns) {
        const value = row[col.key];
        // A null becomes "" and not the en-dash: this feeds arithmetic (the
        // pivot sums, the chart plots), and an en-dash parsed as a category
        // would draw a bar labelled "—".
        out[col.label] = value === null || value === undefined ? "" : value;
      }
      return out;
    }),
  };
}
