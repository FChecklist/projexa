/// <reference types="bun-types" />
// MERGE NOTE (integration train, lane D22 x R67 D-62): both lanes wrote this
// file from scratch with a local `line()` fixture builder of their own, with
// DIFFERENT defaults (D-62's is a real 100,000 civil line; D22's is an empty
// one). Both sets of tests are kept in full, so lane D22's builder is renamed
// d41Line() rather than one lane's defaults being imposed on the other lane's
// assertions -- which would have changed what those assertions mean.
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

import { describe, expect, test } from "bun:test";
import {
  UNCATEGORIZED_LABEL,
  applyLineItemPatch,
  budgetCategoryOptions,
  budgetVariance,
  budgetVendorOptions,
  grandTotalTies,
  groupBudgetLinesByCategory,
  isOverBudget,
  lineActual,
  type BudgetLine,
} from "./budget-lines";

function d41Line(over: Partial<BudgetLine> & Pick<BudgetLine, "lineItemId">): BudgetLine {
  return {
    code: null, description: "line", category: null, quantity: 1, unit: "no", rate: 0,
    parentLineItemId: null, amount: 0, budgetPercentage: 25, budget: 0,
    materialAmount: null, manpowerAmount: null, vendorId: null, vendorName: null,
    vendorAmount: null, variance: null, actual: null, revenue: null,
    ...over,
  };
}
// Two categories, one vendor amount, one material tag and one manpower tag --
// the exact fixture shape item D-54's acceptance describes.
const LINES: BudgetLine[] = [
  d41Line({ lineItemId: "l1", code: "R60SK", description: "R60 skiphop sub", category: "Civil", quantity: 10, unit: "m2", rate: 650, amount: 6500, budget: 1625, vendorId: "v1", vendorName: "Skiphop", vendorAmount: 1700, materialAmount: 300, manpowerAmount: 200, revenue: 2000 }),
  d41Line({ lineItemId: "l2", code: "CIV-2", description: "Plaster", category: "Civil", amount: 500, budget: 125 }),
  d41Line({ lineItemId: "l3", code: "GYP-1", description: "Ceiling grid", category: "Gypsum", amount: 400, budget: 100, vendorId: "v2", vendorName: "Gyproc", vendorAmount: 90, revenue: 50 }),
  d41Line({ lineItemId: "l4", code: "MISC", description: "Odd job", category: null, amount: 100, budget: 25 }),
  // A weighted sub-task of l1: 40% of l1's amount, listed but never added on top.
  d41Line({ lineItemId: "l1a", code: "R60SK.1", description: "Frame", category: "Civil", amount: 2600, budget: 650, parentLineItemId: "l1" }),
];

describe("lineActual", () => {
  test("sums vendor + material + manpower", () => {
    expect(lineActual({ vendorAmount: 1700, materialAmount: 300, manpowerAmount: 200 })).toBe(2200);
  });

  test("a line nobody has costed reads null, never a fabricated 0", () => {
    expect(lineActual({ vendorAmount: null, materialAmount: null, manpowerAmount: null })).toBeNull();
  });

  test("one entered component is enough -- the other two count as 0, not as unknown", () => {
    expect(lineActual({ vendorAmount: null, materialAmount: 300, manpowerAmount: null })).toBe(300);
  });
});

describe("isOverBudget", () => {
  test("actual above budget is over", () => {
    expect(isOverBudget(d41Line({ lineItemId: "x", budget: 1625, vendorAmount: 1700, materialAmount: 300, manpowerAmount: 200 }))).toBe(true);
  });
  test("an uncosted line is never counted as over budget", () => {
    expect(isOverBudget(d41Line({ lineItemId: "x", budget: 1625 }))).toBe(false);
  });
  test("exactly on budget is not over", () => {
    expect(isOverBudget(d41Line({ lineItemId: "x", budget: 100, vendorAmount: 100 }))).toBe(false);
  });
});

describe("groupBudgetLinesByCategory", () => {
  test("the category subtotals sum to the Grand Total", () => {
    const { groups, grandTotal } = groupBudgetLinesByCategory(LINES);
    expect(groups.map((g) => g.category)).toEqual(["Civil", "Gypsum", UNCATEGORIZED_LABEL]);
    expect(groups.reduce((s, g) => s + g.subtotal.amount, 0)).toBe(grandTotal.amount);
    expect(groups.reduce((s, g) => s + g.subtotal.budget, 0)).toBe(grandTotal.budget);
    expect(groups.reduce((s, g) => s + g.subtotal.actual, 0)).toBe(grandTotal.actual);
  });

  test("a weighted sub-task is listed under its category but contributes no money -- never double-counted", () => {
    const civil = groupBudgetLinesByCategory(LINES).groups[0];
    expect(civil.lines.map((l) => l.lineItemId)).toEqual(["l1", "l2", "l1a"]);
    expect(civil.subtotal.amount).toBe(7000); // 6500 + 500 only; l1a's 2600 is a share of l1's 6500
  });

  test("the Grand Total ties to the BOQ's own root-line total", () => {
    const { grandTotal } = groupBudgetLinesByCategory(LINES);
    const rootTotal = LINES.filter((l) => !l.parentLineItemId).reduce((s, l) => s + l.amount, 0);
    expect(grandTotal.amount).toBe(rootTotal);
  });

  test("actual is vendor + material + manpower across the whole BOQ", () => {
    const { grandTotal } = groupBudgetLinesByCategory(LINES);
    expect(grandTotal.vendorAmount).toBe(1790);
    expect(grandTotal.materialAmount).toBe(300);
    expect(grandTotal.manpowerAmount).toBe(200);
    expect(grandTotal.actual).toBe(2290);
  });

  test("Uncategorized is always last, wherever it first appears in the data", () => {
    const reordered = [LINES[3], ...LINES.slice(0, 3)];
    expect(groupBudgetLinesByCategory(reordered).groups.map((g) => g.category)).toEqual(["Civil", "Gypsum", UNCATEGORIZED_LABEL].sort((a, b) => (a === UNCATEGORIZED_LABEL ? 1 : 0) - (b === UNCATEGORIZED_LABEL ? 1 : 0)));
  });

  test("selecting one category reduces the Grand Total to exactly that category's subtotal", () => {
    const all = groupBudgetLinesByCategory(LINES);
    const civilOnly = groupBudgetLinesByCategory(LINES, ["Civil"]);
    expect(civilOnly.groups).toHaveLength(1);
    expect(civilOnly.grandTotal.amount).toBe(civilOnly.groups[0].subtotal.amount);
    expect(civilOnly.grandTotal.amount).toBe(all.groups[0].subtotal.amount);
    expect(civilOnly.grandTotal.amount).not.toBe(all.grandTotal.amount);
  });

  test("the category filter is case-insensitive -- an imported 'civil' line is not silently dropped", () => {
    const lower = LINES.map((l) => (l.category ? { ...l, category: l.category.toLowerCase() } : l));
    expect(groupBudgetLinesByCategory(lower, ["Civil"]).grandTotal.amount).toBe(7000);
  });

  test("an empty or all-blank filter means every category, not none", () => {
    expect(groupBudgetLinesByCategory(LINES, []).grandTotal.amount).toBe(7500);
    expect(groupBudgetLinesByCategory(LINES, ["  "]).grandTotal.amount).toBe(7500);
  });

  test("the vendor filter narrows by vendor id and leaves the totals tying", () => {
    const { groups, grandTotal } = groupBudgetLinesByCategory(LINES, undefined, ["v1"]);
    expect(groups.map((g) => g.category)).toEqual(["Civil"]);
    expect(grandTotal.amount).toBe(6500);
    expect(grandTotal.vendorAmount).toBe(1700);
  });

  test("Uncategorized is selectable by name and matches only lines that truly have none", () => {
    const { groups, grandTotal } = groupBudgetLinesByCategory(LINES, [UNCATEGORIZED_LABEL]);
    expect(groups[0].lines.map((l) => l.lineItemId)).toEqual(["l4"]);
    expect(grandTotal.amount).toBe(100);
  });

  test("no lines at all is an empty grouping with zero totals, never NaN", () => {
    const { groups, grandTotal } = groupBudgetLinesByCategory([]);
    expect(groups).toEqual([]);
    expect(grandTotal).toEqual({ amount: 0, budget: 0, vendorAmount: 0, materialAmount: 0, manpowerAmount: 0, actual: 0, revenue: 0 });
  });

  // R67 lane D22 (item D-54): Revenue joins the same subtotal arithmetic.
  test("revenue subtotals per category and ties to the Grand Total", () => {
    const { groups, grandTotal } = groupBudgetLinesByCategory(LINES);
    expect(groups.map((g) => g.subtotal.revenue)).toEqual([2000, 50, 0]);
    expect(groups.reduce((s, g) => s + g.subtotal.revenue, 0)).toBe(grandTotal.revenue);
    expect(grandTotal.revenue).toBe(2050);
  });
});

// R67 lane D22 (item D-54).
describe("budgetVariance", () => {
  test("Budget minus Actual -- negative means the line is over", () => {
    expect(budgetVariance(d41Line({ lineItemId: "x", budget: 1625, vendorAmount: 1700, materialAmount: 300, manpowerAmount: 200 }))).toBe(-575);
  });

  test("under budget is positive", () => {
    expect(budgetVariance(d41Line({ lineItemId: "x", budget: 1625, vendorAmount: 1000 }))).toBe(625);
  });

  test("a line nobody has costed has no variance at all, not a whole-budget saving", () => {
    expect(budgetVariance(d41Line({ lineItemId: "x", budget: 1625 }))).toBeNull();
  });
});

describe("budgetVendorOptions", () => {
  test("offers only vendors actually named on a line of this BOQ, in first-appearance order", () => {
    expect(budgetVendorOptions(LINES)).toEqual([
      { id: "v1", name: "Skiphop" },
      { id: "v2", name: "Gyproc" },
    ]);
  });

  test("a BOQ with no vendors offers none, rather than an empty-labelled row", () => {
    expect(budgetVendorOptions([d41Line({ lineItemId: "x" })])).toEqual([]);
  });
});

describe("grandTotalTies", () => {
  test("a sub-cent difference between the two independent totals is arithmetic, not a disagreement", () => {
    expect(grandTotalTies(7500, 7500.004)).toBe(true);
  });
  test("a real disagreement does not tie", () => {
    expect(grandTotalTies(7500, 7600)).toBe(false);
  });
});

describe("applyLineItemPatch", () => {
  const vendorName = (id: string | null) => (id === "v9" ? "New Vendor" : null);

  test("a new Budget % recomputes Budget from Amount, not from the typed string", () => {
    const patched = applyLineItemPatch(d41Line({ lineItemId: "l1", amount: 6500, budgetPercentage: 25, budget: 1625 }), { budgetPercentage: "30" }, vendorName);
    expect(patched.budgetPercentage).toBe(30);
    expect(patched.budget).toBe(1950);
  });

  test("a new vendor id brings its name with it, so the cell never shows a raw id", () => {
    const patched = applyLineItemPatch(d41Line({ lineItemId: "l1" }), { vendorId: "v9" }, vendorName);
    expect(patched.vendorId).toBe("v9");
    expect(patched.vendorName).toBe("New Vendor");
  });

  test("editing Material moves Actual with it -- the two columns can never disagree", () => {
    const before = d41Line({ lineItemId: "l1", vendorAmount: 1700, materialAmount: 300, manpowerAmount: 200, actual: 2200 });
    expect(applyLineItemPatch(before, { materialAmount: "500" }, vendorName).actual).toBe(2400);
  });

  test("clearing the last costed field returns Actual to null, never to 0", () => {
    const before = d41Line({ lineItemId: "l1", materialAmount: 300, actual: 300 });
    expect(applyLineItemPatch(before, { materialAmount: null }, vendorName).actual).toBeNull();
  });

  test("fields the server did not answer with are left exactly as they were", () => {
    const before = d41Line({ lineItemId: "l1", amount: 6500, budget: 1625, vendorAmount: 1700, revenue: 2000 });
    const patched = applyLineItemPatch(before, { materialAmount: "100" }, vendorName);
    expect(patched.budget).toBe(1625);
    expect(patched.vendorAmount).toBe(1700);
    expect(patched.revenue).toBe(2000);
  });
});

describe("budgetCategoryOptions", () => {
  test("offers every category present, Uncategorized last", () => {
    expect(budgetCategoryOptions(LINES)).toEqual(["Civil", "Gypsum", UNCATEGORIZED_LABEL]);
  });
});

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
