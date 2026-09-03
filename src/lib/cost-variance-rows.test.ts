/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  DERIVED_BUDGET_NOTE,
  budgetBars,
  buildCostVarianceRows,
  costVarianceCsv,
  filterToLine,
  hasAnyVariance,
  overBudgetRootCount,
  quotedLineCount,
  varianceBars,
  type CostVarianceLine,
} from "./cost-variance-rows";

function line(over: Partial<CostVarianceLine> = {}): CostVarianceLine {
  return {
    lineItemId: "root",
    code: "1",
    description: "Blockwork",
    amount: 6500,
    budget: 1625,
    vendorId: null,
    vendorName: null,
    vendorAmount: null,
    variance: null,
    parentLineItemId: null,
    budgetIsDerived: false,
    percentOfParent: null,
    ...over,
  };
}

const root = line({ lineItemId: "root", code: "1", budget: 1625 });
const child = line({
  lineItemId: "child",
  code: "1.1",
  description: "Blockwork -- labour",
  amount: 2275,
  budget: 568.75,
  parentLineItemId: "root",
  budgetIsDerived: true,
  percentOfParent: 35,
});

describe("buildCostVarianceRows", () => {
  test("a sub-task follows its root, indented, flagged derived, with its share of the parent", () => {
    const rows = buildCostVarianceRows([child, root]); // deliberately out of order on the wire
    expect(rows.map((r) => r.lineItemId)).toEqual(["root", "child"]);
    expect(rows[0].depth).toBe(0);
    expect(rows[0].isDerived).toBe(false);
    expect(rows[1].depth).toBe(1);
    expect(rows[1].isDerived).toBe(true);
    expect(rows[1].parentShareLabel).toBe("35% of parent");
    expect(rows[1].rootId).toBe("root");
  });

  test("percentOfParent is derived locally when the backend did not send it", () => {
    const rows = buildCostVarianceRows([root, { ...child, percentOfParent: undefined }]);
    expect(rows[1].parentShareLabel).toBe("35% of parent");
  });

  test("a child whose parent is absent is kept as a row, never dropped -- a missing money row is worse than an unindented one", () => {
    const rows = buildCostVarianceRows([{ ...child, parentLineItemId: "not-in-payload" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].depth).toBe(0);
    expect(rows[0].isDerived).toBe(true);
  });
});

describe("the chart falls back to budget per line", () => {
  test("hasAnyVariance is false until somebody enters a vendor amount", () => {
    expect(hasAnyVariance([root, child])).toBe(false);
    expect(hasAnyVariance([{ ...root, vendorAmount: 2000, variance: 375 }])).toBe(true);
  });

  test("budgetBars plots ROOT lines only, sorted descending -- a root and its sub-task would be the same money twice", () => {
    const other = line({ lineItemId: "root2", code: "2", description: "Plaster", budget: 4000 });
    const bars = budgetBars(buildCostVarianceRows([root, child, other]));
    expect(bars.map((b) => b.label)).toEqual(["2", "1"]);
    expect(bars.map((b) => b.value)).toEqual([4000, 1625]);
  });

  test("varianceBars only shows lines that have been quoted", () => {
    const rows = buildCostVarianceRows([{ ...root, vendorAmount: 2000, variance: 375 }, child]);
    expect(varianceBars(rows)).toEqual([{ label: "1", value: 375, lineItemId: "root" }]);
  });
});

describe("a bar click filters the table to that line's children", () => {
  const rows = buildCostVarianceRows([root, child, line({ lineItemId: "root2", code: "2", budget: 4000 })]);

  test("clicking a root keeps the root and its sub-tasks", () => {
    expect(filterToLine(rows, "root").map((r) => r.lineItemId)).toEqual(["root", "child"]);
  });

  test("null clears the filter, and an unknown id never empties the table", () => {
    expect(filterToLine(rows, null)).toHaveLength(3);
    expect(filterToLine(rows, "nope")).toHaveLength(3);
  });
});

describe("the KPI tags count real things", () => {
  test("quoted lines and over-budget ROOTS", () => {
    const rows = buildCostVarianceRows([
      { ...root, vendorAmount: 2000, variance: 375 },
      { ...child, vendorAmount: 700, variance: 131.25 },
      line({ lineItemId: "root2", code: "2", budget: 4000 }),
    ]);
    expect(quotedLineCount(rows)).toBe(2);
    // The child is over its derived budget too, but it is not a line of the
    // BOQ's own money -- counting it would be the double-count again.
    expect(overBudgetRootCount(rows)).toBe(1);
  });
});

describe("costVarianceCsv", () => {
  const rows = buildCostVarianceRows([{ ...root, vendorName: "Al Noor", vendorAmount: 2000, variance: 375 }, child]);

  test("the item's column order, with the currency in the money headers", () => {
    const csv = costVarianceCsv(rows, "AED");
    expect(csv.split("\n")[0]).toBe("Code,Description,Vendor,Budget (AED),Vendor amount (AED),Variance (AED)");
  });

  test("no currency set means no currency claimed in the header", () => {
    expect(costVarianceCsv(rows, null).split("\n")[0]).toBe("Code,Description,Vendor,Budget,Vendor amount,Variance");
  });

  test("raw numbers, an empty cell where there is no figure, and the indent survives", () => {
    const body = costVarianceCsv(rows, "AED").split("\n");
    expect(body[1]).toBe("1,Blockwork,Al Noor,1625,2000,375");
    expect(body[2]).toBe("'-- 1.1,Blockwork -- labour,,568.75,,");
  });

  test("the rule the totals follow is carried on the export itself", () => {
    // Quoted, because the sentence contains a comma -- that is csvEscape doing
    // its job, not the note going missing.
    expect(costVarianceCsv(rows, "AED")).toContain(DERIVED_BUDGET_NOTE);
    expect(costVarianceCsv(rows, "AED").trimEnd().endsWith('"')).toBe(true);
  });

  test("a formula-looking description cannot execute when the file is opened", () => {
    const csv = costVarianceCsv(buildCostVarianceRows([line({ description: "=cmd|'/c calc'!A1" })]), "AED");
    expect(csv).toContain("'=cmd|'/c calc'!A1");
  });
});
