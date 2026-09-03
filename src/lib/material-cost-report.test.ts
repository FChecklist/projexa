/// <reference types="bun-types" />
// R67 E-05 (R-103). What the SCREEN owes the reader for this report, asserted
// directly: the tie check that gates Export, the CSV built from the rows on
// screen, and the sentence an empty range shows instead of a blank card.
//
// The arithmetic itself is compliance-tracker's
// (construction-materials-service.ts#aggregateMaterialCostReport, tested
// there); nothing here re-adds a column, because a second summation path is
// how a screen and its export come to disagree.
import { describe, expect, test } from "bun:test";
import {
  buildMaterialCostCsv,
  checkMaterialCostTies,
  csvEscape,
  defaultCostReportRange,
  dmy,
  emptyRangeMessage,
  type MaterialCostReport,
} from "./material-cost-report";

const money = (n: number) => `AED ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function report(overrides: Partial<MaterialCostReport> = {}): MaterialCostReport {
  return {
    rows: [
      {
        key: "m-cement", materialId: "m-cement", name: "OPC Cement 53 Grade", spec: "53 Grade",
        vendorId: "v-alpha", vendorName: "Alpha Trading LLC", unit: "bag",
        totalQuantityReceived: 200, totalCost: 5000, averageUnitCost: 25, masterUnitCost: 24, variance: 1,
      },
      {
        key: "m-steel", materialId: "m-steel", name: "TMT Steel 12mm", spec: null,
        vendorId: null, vendorName: "No vendor recorded", unit: "kg",
        totalQuantityReceived: 1000, totalCost: 3600, averageUnitCost: 3.6, masterUnitCost: null, variance: null,
      },
    ],
    totals: { quantity: 1200, cost: 8600 },
    params: { projectId: "p1", from: "2026-01-01", to: "2026-09-02", groupBy: "material" },
    ...overrides,
  };
}

describe("checkMaterialCostTies", () => {
  test("rows that sum to the Grand Total tie -- Export stays available", () => {
    expect(checkMaterialCostTies(report(), money)).toBeNull();
  });

  test("rows that do NOT sum to the Grand Total produce a sentence naming both figures", () => {
    const broken = report({ totals: { quantity: 1200, cost: 9000 } });
    const message = checkMaterialCostTies(broken, money)!;
    expect(message).toContain("AED 8,600.00");
    expect(message).toContain("AED 9,000.00");
    expect(message).toContain("Export is disabled");
  });

  test("a sub-cent difference is float noise, not a discrepancy", () => {
    expect(checkMaterialCostTies(report({ totals: { quantity: 1200, cost: 8600.004 } }), money)).toBeNull();
  });

  test("an empty report ties with itself rather than reading as broken", () => {
    expect(checkMaterialCostTies(report({ rows: [], totals: { quantity: 0, cost: 0 } }), money)).toBeNull();
  });
});

describe("emptyRangeMessage / dmy", () => {
  test("an empty range says which range, and what to do -- never a blank card", () => {
    expect(emptyRangeMessage("2026-01-01", "2026-09-02")).toBe("No receipts between 01-01-2026 and 02-09-2026 — widen the range");
  });

  test("one open bound says which bound is open", () => {
    expect(emptyRangeMessage(null, "2026-09-02")).toBe("No receipts on or before 02-09-2026 — widen the range");
    expect(emptyRangeMessage("2026-01-01", null)).toBe("No receipts on or after 01-01-2026 — widen the range");
  });

  test("no bounds at all is a statement about the project, not about a range", () => {
    expect(emptyRangeMessage(null, null)).toBe("No receipts recorded for this project yet");
  });

  test("dmy is a string slice, so no timezone can move the day", () => {
    expect(dmy("2026-01-01")).toBe("01-01-2026");
    expect(dmy("nonsense")).toBeNull();
    expect(dmy(null)).toBeNull();
  });
});

describe("buildMaterialCostCsv", () => {
  const csv = buildMaterialCostCsv(report());
  const lines = csv.split("\n");

  test("the first line states the period and the grouping, so a file cannot be mistaken for another run", () => {
    expect(lines[0]).toContain("Material Cost Report");
    expect(lines[0]).toContain("01-01-2026");
    expect(lines[0]).toContain("02-09-2026");
    expect(lines[0]).toContain("grouped by material");
  });

  test("the header names all nine columns the screen shows", () => {
    expect(lines[1]).toBe("Material,Spec,Vendor,Unit,Qty Received,Total Cost,Avg Unit Cost,Master Unit Cost,Variance");
  });

  test("one line per row on screen, with the vendor the table shows", () => {
    expect(lines[2]).toContain("OPC Cement 53 Grade");
    expect(lines[2]).toContain("Alpha Trading LLC");
    expect(lines[3]).toContain("TMT Steel 12mm");
  });

  test("the Grand Total travels WITH the rows it totals", () => {
    expect(lines[lines.length - 1]).toBe("Grand Total,,,,1200,8600,,,");
  });

  test("a figure that does not exist is the en dash in the file too, never a zero", () => {
    expect(lines[3]).toContain("–");
  });
});

describe("csvEscape (OWASP formula injection)", () => {
  test("a cell starting with =, +, - or @ is neutralised, and its characters survive", () => {
    for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      const escaped = csvEscape(dangerous);
      expect(escaped.startsWith("'")).toBe(true);
      expect(escaped).toContain(dangerous);
    }
  });

  test("a vendor name with a comma or a quote is quoted rather than splitting the row", () => {
    expect(csvEscape('Alpha Trading, LLC')).toBe('"Alpha Trading, LLC"');
    expect(csvEscape('He said "hi"')).toBe('"He said ""hi"""');
  });

  test("an ordinary value is untouched", () => {
    expect(csvEscape("OPC Cement 53 Grade")).toBe("OPC Cement 53 Grade");
    expect(csvEscape(1200)).toBe("1200");
    expect(csvEscape(null)).toBe("");
  });
});

describe("defaultCostReportRange", () => {
  test("the lower bound is OPEN, so a project whose deliveries were last month is not shown as empty", () => {
    // PROJEXA is not told the project's start date; an open bound is what
    // "from the project's start" means for a start we were never given, and a
    // month-to-date window would make a real ledger look empty.
    expect(defaultCostReportRange(new Date("2026-09-02T10:00:00Z"))).toEqual({ from: "", to: "2026-09-02" });
  });
});
