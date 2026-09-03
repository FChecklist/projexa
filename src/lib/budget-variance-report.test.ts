/// <reference types="bun-types" />
// R67 E-07 (R-114) + E-08 (R-115). The URL contract, the CSV, the empty-state
// sentence and the chart ordering -- the rules both Cost Variance screens
// share, tested without a browser.
import { describe, expect, test } from "bun:test";
import {
  readVarianceFilters,
  varianceSearchParams,
  varianceApiQuery,
  emptyFilterMessage,
  scopeLineHref,
  contractLines,
  categorySubtotalOf,
  varianceBars,
  buildVarianceCsv,
  checkVarianceTies,
  csvEscape,
  type VarianceReport,
  type VarianceLine,
  type RevenueBudgetActualRow,
} from "./budget-variance-report";

function line(over: Partial<VarianceLine>): VarianceLine {
  return {
    lineItemId: "l1", boqId: "boq-1", sNo: 1, isRootLine: true, parentLineItemId: null,
    code: "C-01", description: "Blockwork", category: "Civil", quantity: 120, rate: 45, unit: "m2",
    amount: 5400, budgetPercentage: 25, budget: 1350,
    materialAmount: null, manpowerAmount: null,
    vendorId: "v1", vendorName: "Alpha Contracting LLC", vendorAmount: 1500, variance: 150,
    ...over,
  };
}

const REPORT: VarianceReport = {
  boqId: "boq-1",
  boqTitle: "Main BOQ v2",
  lines: [
    line({}),
    line({ lineItemId: "l2", sNo: 2, code: "C-02", description: "Site clearance", category: null, quantity: 1, rate: 3375, amount: 3375, budget: 843.75, vendorId: null, vendorName: null, vendorAmount: null, variance: null }),
    line({ lineItemId: "l3", sNo: null, isRootLine: false, parentLineItemId: "l1", code: "C-01.1", description: "first lift", amount: 2700, budget: 675, vendorAmount: null, variance: null }),
  ],
  subTaskLineCount: 1,
  totalBudget: 2193.75,
  totalVendorAmount: 1500,
  totalVariance: 150,
  totalMaterialAmount: 0,
  totalManpowerAmount: 0,
  availableCategories: ["Civil"],
  availableVendors: [{ id: "v1", name: "Alpha Contracting LLC" }],
  filters: { categories: [], vendorId: null, groupBy: "scope" },
  revenueBudgetActual: {
    groupBy: "scope",
    rows: [
      { key: "l1", item: "C-01", description: "Blockwork", category: "Civil", revenue: 5400, budget: 1350, actual: 1500, variance: 150, percentUsed: 111.1, lineItemId: "l1", lineCount: 1 },
      { key: "l2", item: "C-02", description: "Site clearance", category: "Uncategorized", revenue: 3375, budget: 843.75, actual: null, variance: null, percentUsed: null, lineItemId: "l2", lineCount: 1 },
    ],
    totals: { revenue: 8775, budget: 2193.75, actual: 1500, variance: -693.75, percentUsed: 68.4 },
  },
  categorySubtotals: [
    { key: "Civil", item: "Civil", description: "1 line", category: "Civil", revenue: 5400, budget: 1350, actual: 1500, variance: 150, percentUsed: 111.1, lineItemId: null, lineCount: 1 },
    { key: "Uncategorized", item: "Uncategorized", description: "1 line", category: "Uncategorized", revenue: 3375, budget: 843.75, actual: null, variance: null, percentUsed: null, lineItemId: null, lineCount: 1 },
  ],
};

describe("the filter state lives in the URL (R67 E-07)", () => {
  test("reads repeatable ?category= so a category containing a comma still works", () => {
    const filters = readVarianceFilters(new URLSearchParams("category=Civil&category=Joinery%2C%20fitted&vendorId=v1"));
    expect(filters.categories).toEqual(["Civil", "Joinery, fitted"]);
    expect(filters.vendorId).toBe("v1");
  });

  test("defaults to every category, every vendor and the scope-wise fold", () => {
    expect(readVarianceFilters(new URLSearchParams())).toEqual({ categories: [], vendorId: null, groupBy: "scope" });
  });

  test("an unknown groupBy is the scope-wise fold, never an empty view", () => {
    expect(readVarianceFilters(new URLSearchParams("groupBy=nonsense")).groupBy).toBe("scope");
  });

  test("round-trips: what is written back is what is read out, so Back restores the same screen", () => {
    const filters = { categories: ["Civil", "MEP"], vendorId: "v9", groupBy: "category" as const };
    expect(readVarianceFilters(varianceSearchParams(filters))).toEqual(filters);
  });

  test("writing filters keeps the rest of the URL -- switching a chip never drops the tab you are on", () => {
    const qs = varianceSearchParams({ categories: ["Civil"], vendorId: null, groupBy: "scope" }, { projectId: "p1", tab: "variance" });
    expect(qs.get("projectId")).toBe("p1");
    expect(qs.get("tab")).toBe("variance");
  });

  test("the API query carries exactly the filters on screen", () => {
    expect(varianceApiQuery("p1", { categories: ["Civil"], vendorId: "v1", groupBy: "category" }))
      .toBe("projectId=p1&category=Civil&vendorId=v1&groupBy=category");
  });
});

describe("emptyFilterMessage", () => {
  test("names BOTH dimensions, so the reader can see which filter emptied the table", () => {
    expect(emptyFilterMessage({ categories: ["Joinery"], vendorId: "v1", groupBy: "scope" }, "Beta Joinery"))
      .toBe("No lines for Joinery / Beta Joinery");
  });

  test("an unfiltered dimension says 'All', never an empty gap", () => {
    expect(emptyFilterMessage({ categories: [], vendorId: null, groupBy: "scope" }, null))
      .toBe("No lines for All categories / All vendors");
  });
});

describe("the table's rows", () => {
  test("only the contract lines are shown and totalled -- a weighted sub-task is already inside its parent", () => {
    expect(contractLines(REPORT).map((l) => l.lineItemId)).toEqual(["l1", "l2"]);
  });

  test("a null report is no rows, never a crash", () => {
    expect(contractLines(null)).toEqual([]);
  });

  test("a Code links to its own line inside its own BOQ", () => {
    expect(scopeLineHref({ boqId: "boq-1", lineItemId: "l1" })).toBe("/scope/boq-1#line-l1");
  });

  test("a per-category subtotal is looked up from the fold the backend already returned", () => {
    const rows: RevenueBudgetActualRow[] = [
      { key: "Civil", item: "Civil", description: "2 lines", category: "Civil", revenue: 100, budget: 25, actual: 30, variance: 5, percentUsed: 120, lineItemId: null, lineCount: 2 },
    ];
    expect(categorySubtotalOf(rows, "Civil")!.budget).toBe(25);
    expect(categorySubtotalOf(rows, "Joinery")).toBeNull();
  });
});

describe("varianceBars (R67 E-08)", () => {
  // R67 D-26 (merged 2026-09-03): `variance` is BUDGET REMAINING -- budget
  // minus actual -- so Civil, which spent 90 of 100, is +10 UNDER and MEP,
  // which spent 140 of 100, is -40 OVER. The figures below are that
  // arithmetic; the assertions are unchanged, because "worst overrun first"
  // and "40 over budget" are the same facts either way round.
  const rows: RevenueBudgetActualRow[] = [
    { key: "a", item: "Civil", description: "", category: "Civil", revenue: 0, budget: 100, actual: 90, variance: 10, percentUsed: 90, lineItemId: null, lineCount: 1 },
    { key: "b", item: "MEP", description: "", category: "MEP", revenue: 0, budget: 100, actual: 140, variance: -40, percentUsed: 140, lineItemId: null, lineCount: 1 },
    { key: "c", item: "Joinery", description: "", category: "Joinery", revenue: 0, budget: 100, actual: null, variance: null, percentUsed: null, lineItemId: null, lineCount: 1 },
  ];

  test("sorted worst-overrun-first -- the row a QS has to act on is at the top", () => {
    expect(varianceBars(rows).map((b) => b.label)).toEqual(["MEP", "Civil"]);
  });

  test("every bar carries a glyph AND a word, so the state never depends on colour alone", () => {
    const [worst, best] = varianceBars(rows);
    expect(worst.tone).toBe("late");
    expect(worst.glyph).toBe("▲");
    expect(worst.word).toBe("over");
    expect(best.tone).toBe("done");
    expect(best.word).toBe("under");
  });

  test("a row with nothing costed yet is LEFT OUT, not drawn at zero -- a bar at the origin would read 'on budget'", () => {
    expect(varianceBars(rows).some((b) => b.key === "c")).toBe(false);
  });

  test("each bar names itself for a screen reader, since a bar's length says nothing on its own", () => {
    expect(varianceBars(rows)[0].ariaLabel).toBe("MEP: 40 over budget");
  });
});

describe("the CSV is the rows on screen", () => {
  const csv = buildVarianceCsv(REPORT, null);

  test("states the filters on its first line, so a shared file cannot be mistaken for another run", () => {
    expect(csv.split("\n")[0]).toContain("Main BOQ v2");
    expect(csv.split("\n")[0]).toContain("All categories / All vendors");
  });

  test("carries Sumeet's column list, in his order", () => {
    expect(csv.split("\n")[1]).toBe("S.No,Category,Code,Description,Qty,Rate,Amt,Budget,Vendor,Vendor Amt,Variance");
  });

  test("has one row per CONTRACT line plus the Grand Total, never the sub-task rows", () => {
    const lines = csv.split("\n");
    expect(lines).toHaveLength(5); // caption + header + 2 rows + grand total
    expect(lines[4].startsWith("Grand Total")).toBe(true);
    expect(lines[4]).toContain("2193.75");
  });

  test("an absent vendor amount is an en dash, never a 0", () => {
    expect(csv.split("\n")[3]).toContain("–");
  });

  test("guards against formula injection, because BOQ descriptions are user-typed", () => {
    expect(csvEscape("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(csvEscape("Blockwork, 200mm")).toBe('"Blockwork, 200mm"');
  });
});

describe("checkVarianceTies", () => {
  const money = (n: number) => `AED ${n.toFixed(2)}`;

  test("says nothing when the rows sum to the total", () => {
    expect(checkVarianceTies(REPORT, money)).toBeNull();
  });

  test("names the discrepancy in both figures when they disagree, so Export can be disabled WITH a reason", () => {
    const broken = { ...REPORT, totalBudget: 9999 };
    expect(checkVarianceTies(broken, money)).toBe("Totals do not tie: the lines add up to AED 2193.75 but the total says AED 9999.00");
  });

  test("a project with no lines cannot fail the tie check", () => {
    expect(checkVarianceTies({ ...REPORT, lines: [], totalBudget: null }, money)).toBeNull();
  });
});
