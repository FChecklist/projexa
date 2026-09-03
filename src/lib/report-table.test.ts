/// <reference types="bun-types" />
// R67 E-32 (R-265). The client half of the {columns, rows} contract, tested
// where it can be: pure functions over a wire payload.
//
// What these guard is not cosmetic. A currency printed with the percent rule,
// a missing figure printed as 0, an old VERIDIAN payload rendered as a table of
// undefineds, or a CSV whose money column arrives in the spreadsheet as text --
// each of those is a wrong number in front of a customer, and none of them
// shows up in a typecheck.
import { describe, expect, test } from "bun:test";
import {
  EMPTY_CELL,
  formatReportCell,
  hasTotals,
  isReportTable,
  reportTableToCsv,
  toLabelledRows,
  type ReportTable,
} from "./report-table";

const AED = { currency: "AED" };

const TABLE: ReportTable = {
  columns: [
    { key: "head", label: "Expense head", unit: "text", align: "left" },
    { key: "budget", label: "Budget", unit: "currency", align: "right" },
    { key: "actual", label: "Actual", unit: "currency", align: "right" },
  ],
  rows: [
    { head: "Material", budget: null, actual: 120_000 },
    { head: "Labour, direct", budget: null, actual: 65_000 },
  ],
  totals: { budget: 200_000, actual: 185_000 },
  currency: "AED",
};

describe("isReportTable", () => {
  test("accepts the contract, including an empty result", () => {
    expect(isReportTable(TABLE)).toBe(true);
    expect(isReportTable({ columns: [], rows: [], currency: null })).toBe(true);
  });

  test("rejects the legacy payloads, so an older VERIDIAN degrades visibly", () => {
    // The exact shapes the handlers used to return.
    expect(isReportTable({ byHead: [{ expenseHead: "Material", total: 1 }], total: 1 })).toBe(false);
    expect(isReportTable({ projectId: "p1", contractValue: 475_000, percentByValue: 25 })).toBe(false);
    expect(isReportTable(null)).toBe(false);
    expect(isReportTable([])).toBe(false);
  });

  test("rejects a column with no unit -- a different contract wearing the same field names", () => {
    expect(isReportTable({ columns: [{ key: "a", label: "A" }], rows: [], currency: null })).toBe(false);
    expect(isReportTable({ columns: [{ key: "a", label: "A", unit: "money", align: "left" }], rows: [], currency: null })).toBe(false);
  });

  test("rejects a response with no currency field at all, which is how a partial shape gets caught", () => {
    expect(isReportTable({ columns: [], rows: [] })).toBe(false);
  });
});

describe("formatReportCell", () => {
  test("money goes through the ONE shared formatter, code first", () => {
    expect(formatReportCell(6500, "currency", AED)).toBe("AED 6,500.00");
    // Never the bare digits, and never a code jammed against the number.
    expect(formatReportCell(6500, "currency", AED)).not.toBe("6500");
    expect(formatReportCell(6500, "currency", AED)).not.toContain("AED6500");
  });

  test("an org with no currency set gets the number, never a guessed code", () => {
    const bare = formatReportCell(6500, "currency", { currency: null });
    expect(bare).toContain("6,500");
    expect(bare).not.toContain("AED");
  });

  test("a missing value is an en-dash on every unit -- never a zero", () => {
    for (const unit of ["currency", "percent", "number", "date", "text"] as const) {
      expect(formatReportCell(null, unit, AED)).toBe(EMPTY_CELL);
    }
    expect(formatReportCell("", "text", AED)).toBe(EMPTY_CELL);
    // A REAL zero is a figure and still prints.
    expect(formatReportCell(0, "currency", AED)).toBe("AED 0.00");
    expect(formatReportCell(0, "percent", AED)).toBe("0%");
  });

  test("a percentage carries no currency anywhere near it", () => {
    expect(formatReportCell(25, "percent", AED)).toBe("25%");
  });

  test("dates go through the pinned formatter, so they cannot shift a day", () => {
    expect(formatReportCell("2026-09-01", "date", AED)).toBe(formatReportCell("2026-09-01T23:30:00.000Z", "date", AED));
  });

  test("a plain number is grouped but gains no unit", () => {
    expect(formatReportCell(120_000, "number", AED)).toBe("120,000");
    expect(formatReportCell(120_000, "number", AED)).not.toContain("AED");
  });
});

describe("hasTotals", () => {
  test("true only when the server actually sent totals", () => {
    expect(hasTotals(TABLE)).toBe(true);
    expect(hasTotals({ ...TABLE, totals: undefined })).toBe(false);
    // An empty object is not a total; printing an empty bold row reads as zero.
    expect(hasTotals({ ...TABLE, totals: {} })).toBe(false);
  });
});

describe("toLabelledRows", () => {
  test("projects to the labels the pivot and chart dropdowns show", () => {
    const { columns, rows } = toLabelledRows(TABLE);
    expect(columns).toEqual(["Expense head", "Budget", "Actual"]);
    expect(rows[0]).toEqual({ "Expense head": "Material", Budget: "", Actual: 120_000 });
  });

  test("a null becomes empty, not the en-dash -- these rows feed arithmetic", () => {
    const { rows } = toLabelledRows(TABLE);
    expect(rows[0].Budget).toBe("");
    expect(rows[0].Budget).not.toBe(EMPTY_CELL);
  });
});

describe("reportTableToCsv", () => {
  const csv = reportTableToCsv(TABLE);
  const lines = csv.split("\n");

  test("the currency is named once in the header, not on every cell", () => {
    expect(lines[0]).toBe("Expense head,Budget (AED),Actual (AED)");
  });

  test("money is written RAW so the spreadsheet can add the column up", () => {
    expect(lines[1]).toContain("120000");
    expect(lines[1]).not.toContain("AED");
    expect(lines[1]).not.toContain("120,000");
  });

  test("a value with a comma in it is quoted, so it stays one column", () => {
    expect(lines[2]).toContain('"Labour, direct"');
  });

  test("a missing value is EMPTY, not a dash -- a dash makes the column text", () => {
    expect(lines[1]).toBe("Material,,120000");
  });

  test("the totals row is labelled and carries the server's own totals", () => {
    expect(lines[3]).toBe("Total,200000,185000");
  });

  test("a table with no totals gets no total line", () => {
    const noTotals = reportTableToCsv({ ...TABLE, totals: undefined });
    expect(noTotals.split("\n")).toHaveLength(3);
    expect(noTotals).not.toContain("Total");
  });
});
