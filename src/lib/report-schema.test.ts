/// <reference types="bun-types" />
// R67 E-12 (R-136). The document's rules, without a browser: what a column's
// type does to a cell, how bands and totals are built, when the arithmetic is
// declared untrue, and what happens to a key nobody described.
import { describe, expect, test } from "bun:test";
import {
  REPORT_SCHEMAS,
  chartBars,
  columnTotal,
  formatCell,
  groupRows,
  lineHref,
  noRowsMessage,
  reportSchema,
  schemaRows,
  totalsTieMessage,
  unmappedKeys,
} from "./report-schema";

const AED = { currency: "AED", pending: false };

const LINES = [
  { lineItemId: "l-1", boqId: "b-1", sNo: 1, category: "Civil", code: "1.1", description: "Excavation", quantity: 120, rate: 45, amount: 5400, budget: 4320, vendorName: "Alpha Contracting", vendorAmount: 4500, variance: 180 },
  { lineItemId: "l-2", boqId: "b-1", sNo: 2, category: "Civil", code: "1.2", description: "Backfill", quantity: 80, rate: 30, amount: 2400, budget: 1920, vendorName: "Alpha Contracting", vendorAmount: 2000, variance: 80 },
  { lineItemId: "l-3", boqId: "b-1", sNo: 3, category: "Paint", code: "2.1", description: "Emulsion", quantity: 300, rate: 12, amount: 3600, budget: 2880, vendorName: null, vendorAmount: null, variance: null },
];

describe("the schema registry (R67 E-12)", () => {
  test("the project-status document is the six columns compliance-tracker exports, in that order", () => {
    expect(reportSchema("project-status")!.columns.map((c) => c.label)).toEqual([
      "Category", "Code", "Description", "Budget", "Vendor", "Vendor amount",
    ]);
  });

  test("no column label is a camelCase key -- that defect is what the schema exists to close", () => {
    for (const schema of Object.values(REPORT_SCHEMAS)) {
      for (const column of schema.columns) expect(column.label).not.toMatch(/^[a-z]+[A-Z]/);
      for (const key of schema.totals ?? []) expect(schema.columns.some((c) => c.key === key)).toBe(true);
    }
  });

  test("an unknown slug has NO schema, so the screen falls back to the generic grid rather than inventing a document", () => {
    expect(reportSchema("not-a-report")).toBeNull();
  });

  test("the rows come out of the payload the report really returned, and a payload with none yields none", () => {
    const schema = reportSchema("project-status")!;
    expect(schemaRows(schema, { lines: LINES, totalBudget: 9120 })).toHaveLength(3);
    expect(schemaRows(schema, { rows: LINES })).toEqual([]);
    expect(schemaRows(schema, LINES)).toHaveLength(3);
    expect(schemaRows(schema, null)).toEqual([]);
  });
});

describe("one cell, formatted by its column's TYPE (R67 E-12)", () => {
  test("money carries the org's code and two decimals, every row, down the column", () => {
    expect(formatCell(475000, "money", AED)).toBe("AED 475,000.00");
    expect(formatCell(6500.5, "money", AED)).toBe("AED 6,500.50");
  });

  test("a quantity is NOT money -- it takes no currency token and no forced decimals", () => {
    expect(formatCell(120, "number", AED)).toBe("120");
    expect(formatCell(20833.2, "number", AED)).toBe("20,833.2");
  });

  test("a percentage takes one decimal so 6% and 6.25% line up down the column", () => {
    expect(formatCell(6, "percent", AED)).toBe("6.0%");
    expect(formatCell(6.25, "percent", AED)).toBe("6.3%");
  });

  test("absent is the en dash in EVERY type, and is never coerced to zero", () => {
    for (const type of ["money", "number", "percent", "text", "code"] as const) {
      expect(formatCell(null, type, AED)).toBe("–");
      expect(formatCell(undefined, type, AED)).toBe("–");
    }
    // ...and a real zero is still a real zero, in both directions.
    expect(formatCell(0, "money", AED)).toBe("AED 0.00");
  });
});

describe("bands, totals and the tie (R67 E-12)", () => {
  test("rows band by their group column in first-appearance order, never re-sorted under the reader", () => {
    const groups = groupRows(LINES, "category");
    expect(groups.map((g) => g.name)).toEqual(["Civil", "Paint"]);
    expect(groups[0].rows).toHaveLength(2);
  });

  test("a row with no group value gets a named band rather than an empty one", () => {
    expect(groupRows([{ category: null, budget: 1 }], "category")[0].name).toBe("Uncategorised");
  });

  test("a column with no figure anywhere totals to null, not to zero", () => {
    expect(columnTotal(LINES, "budget")).toBe(9120);
    expect(columnTotal([{ vendorAmount: null }], "vendorAmount")).toBeNull();
  });

  test("ACCEPTANCE: when the rows do not add up to the stated total, the document says so in the reader's units", () => {
    const schema = reportSchema("project-status")!;
    // The rows sum to 9,120; the report claims 9,000.
    expect(totalsTieMessage(schema, LINES, { totalBudget: 9000 }, AED)).toBe("Totals do not tie (difference AED 120.00)");
  });

  test("...and when they DO tie, it says nothing at all", () => {
    const schema = reportSchema("project-status")!;
    expect(totalsTieMessage(schema, LINES, { totalBudget: 9120 }, AED)).toBeNull();
    // Under a hundredth of a unit is rounding, not a disagreement.
    expect(totalsTieMessage(schema, LINES, { totalBudget: 9120.001 }, AED)).toBeNull();
  });

  test("a report that states no total cannot fail to tie to one", () => {
    const schema = reportSchema("project-status")!;
    expect(totalsTieMessage(schema, LINES, { totalBudget: null }, AED)).toBeNull();
  });
});

describe("what the document does with what it was not told (R67 E-12)", () => {
  test("a key no column claims is REPORTED, so a report that grew a column cannot drift silently", () => {
    const schema = reportSchema("project-status")!;
    expect(unmappedKeys(schema, [{ ...LINES[0], materialAmount: 10, manpowerAmount: 5 }])).toEqual([
      "amount", "manpowerAmount", "materialAmount", "quantity", "rate", "sNo", "variance",
    ]);
  });

  test("the link's own keys are used, not unmapped -- they address a line rather than printing one", () => {
    const schema = reportSchema("project-status")!;
    expect(unmappedKeys(schema, [{ category: "Civil", code: "1.1", description: "x", budget: 1, vendorName: null, vendorAmount: null, boqId: "b-1", lineItemId: "l-1" }])).toEqual([]);
  });

  test("every code links to the BOQ line it names, anchored on that line", () => {
    const schema = reportSchema("project-status")!;
    expect(lineHref(schema, LINES[0])).toBe("/scope/b-1#line-l-1");
    // A row with no BOQ behind it gets no link rather than a broken one.
    expect(lineHref(schema, { code: "1.1" })).toBeNull();
  });
});

describe("the chart, where one is allowed at all (R67 E-12)", () => {
  test("one bar per band, biggest first -- a sorted horizontal bar, never a pie", () => {
    expect(chartBars(reportSchema("project-status")!, LINES)).toEqual([
      { label: "Civil", value: 6240 },
      { label: "Paint", value: 2880 },
    ]);
  });

  test("a band with no figure is OMITTED rather than drawn at zero", () => {
    expect(chartBars(reportSchema("project-status")!, [{ category: "Paint", budget: null }])).toEqual([]);
  });

  test("a schema with no chart offers none -- a chart is opt-in per report, not a default", () => {
    expect(reportSchema("budget-variance")!.chart).toBeUndefined();
    expect(chartBars(reportSchema("budget-variance")!, LINES)).toEqual([]);
  });
});

describe("the empty state names the period and the project (R67 E-12)", () => {
  test("it is an answer, not a blank card", () => {
    expect(noRowsMessage("01 Sep 2026", "03 Sep 2026", "Cedar Heights Villa - Phase 1")).toBe(
      "No rows recorded between 01 Sep 2026 and 03 Sep 2026 for Cedar Heights Villa - Phase 1"
    );
  });
});
