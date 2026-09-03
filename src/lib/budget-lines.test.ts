import { describe, expect, test } from "bun:test";
import {
  BUDGET_EXPORT_HEADERS,
  NO_CATEGORY_LABEL,
  NO_VENDOR_LABEL,
  budgetExportRows,
  budgetPercentError,
  budgetTotals,
  categoryOptions,
  filterBudgetLines,
  showingCount,
  vendorAmountError,
  vendorOptions,
  type BudgetLine,
} from "./budget-lines";

function line(over: Partial<BudgetLine> = {}): BudgetLine {
  return {
    lineItemId: "li_1",
    code: "1.1",
    description: "Excavation",
    amount: 100_000,
    category: "Civil",
    budgetPercentage: 25,
    budget: 25_000,
    materialAmount: null,
    manpowerAmount: null,
    vendorId: null,
    vendorName: null,
    vendorAmount: null,
    variance: null,
    ...over,
  };
}

describe("R67 D-62 category and vendor labels", () => {
  test("an unclassified line reads as words, never as an empty cell", () => {
    expect(categoryOptions([line({ category: null })])).toEqual([NO_CATEGORY_LABEL]);
    expect(vendorOptions([line()])).toEqual([NO_VENDOR_LABEL]);
  });

  test("the catch-all option sorts last, so real categories are read first", () => {
    const lines = [line({ category: null }), line({ category: "MEP" }), line({ category: "Civil" })];
    expect(categoryOptions(lines)).toEqual(["Civil", "MEP", NO_CATEGORY_LABEL]);
  });

  test("options are de-duplicated across lines", () => {
    const lines = [line({ vendorName: "Al Noor" }), line({ vendorName: "Al Noor" })];
    expect(vendorOptions(lines)).toEqual(["Al Noor"]);
  });
});

describe("R67 D-62 filtering", () => {
  const lines = [
    line({ lineItemId: "a", category: "Civil", vendorName: "Al Noor" }),
    line({ lineItemId: "b", category: "MEP", vendorName: "Al Noor" }),
    line({ lineItemId: "c", category: "Civil", vendorName: null }),
  ];

  test("an empty filter means all, not none", () => {
    expect(filterBudgetLines(lines, { category: "", vendor: "" })).toHaveLength(3);
  });

  test("Category and Vendor combine", () => {
    expect(filterBudgetLines(lines, { category: "Civil", vendor: "Al Noor" }).map((l) => l.lineItemId)).toEqual(["a"]);
  });

  test("the catch-all vendor option selects the lines that have none", () => {
    expect(filterBudgetLines(lines, { category: "", vendor: NO_VENDOR_LABEL }).map((l) => l.lineItemId)).toEqual(["c"]);
  });

  test("showingCount states both numbers", () => {
    expect(showingCount(1, 3)).toBe("Showing 1 of 3");
  });
});

describe("R67 D-62 totals", () => {
  test("nulls are skipped, not counted as zero", () => {
    const totals = budgetTotals([
      line({ budget: 25_000, vendorAmount: 30_000, variance: 5_000, materialAmount: 10_000, manpowerAmount: null }),
      line({ budget: 10_000, vendorAmount: null, variance: null, materialAmount: null, manpowerAmount: null }),
    ]);
    expect(totals.budget).toBe(35_000);
    expect(totals.vendorAmount).toBe(30_000);
    expect(totals.variance).toBe(5_000);
    expect(totals.material).toBe(10_000);
    expect(totals.quotedLines).toBe(1);
  });

  test("a column where NOTHING is set totals null, so the screen can say so in words", () => {
    const totals = budgetTotals([line(), line()]);
    expect(totals.labour).toBeNull();
    expect(totals.material).toBeNull();
    expect(totals.vendorAmount).toBeNull();
    expect(totals.variance).toBeNull();
    // Budget always exists -- every line has a percent, defaulting to 25.
    expect(totals.budget).toBe(50_000);
  });

  test("an empty filtered view totals a real 0 budget and no quotes", () => {
    expect(budgetTotals([]).budget).toBe(0);
    expect(budgetTotals([]).quotedLines).toBe(0);
  });
});

describe("R67 D-62 inline edit validation", () => {
  test("the percent range matches the backend's own 0-100 guard", () => {
    expect(budgetPercentError("25")).toBeUndefined();
    expect(budgetPercentError("0")).toBeUndefined();
    expect(budgetPercentError("100")).toBeUndefined();
    expect(budgetPercentError("101")).toBe("Budget percent must be between 0 and 100");
    expect(budgetPercentError("-1")).toBe("Budget percent must be between 0 and 100");
    expect(budgetPercentError("abc")).toBe("Budget percent must be a number");
    expect(budgetPercentError("  ")).toBe("Enter a budget percent between 0 and 100");
  });

  test("an empty vendor amount is legitimate -- it clears the quote", () => {
    expect(vendorAmountError("")).toBeUndefined();
    expect(vendorAmountError("1200")).toBeUndefined();
    expect(vendorAmountError("-5")).toBe("Vendor amount cannot be negative");
    expect(vendorAmountError("x")).toBe("Vendor amount must be a number");
  });
});

describe("R67 D-62 export", () => {
  test("every column the table shows is exported, in the same order", () => {
    expect(BUDGET_EXPORT_HEADERS).toEqual([
      "Code",
      "Description",
      "Category",
      "Budget %",
      "Budget",
      "Material",
      "Manpower",
      "Vendor",
      "Vendor amount",
      "Variance",
    ]);
    const [row] = budgetExportRows([line({ materialAmount: 1, manpowerAmount: 2, vendorName: "Al Noor", vendorAmount: 3, variance: 4 })]);
    expect(row).toHaveLength(BUDGET_EXPORT_HEADERS.length);
    expect(row).toEqual(["1.1", "Excavation", "Civil", 25, 25_000, 1, 2, "Al Noor", 3, 4]);
  });

  test("a null exports as an empty cell, never as the number 0", () => {
    const [row] = budgetExportRows([line()]);
    expect(row[5]).toBe("");
    expect(row[8]).toBe("");
    expect(row[9]).toBe("");
  });
});
