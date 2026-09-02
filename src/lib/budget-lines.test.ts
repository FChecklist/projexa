/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  UNCATEGORIZED_LABEL,
  budgetCategoryOptions,
  groupBudgetLinesByCategory,
  isOverBudget,
  lineActual,
  type BudgetLine,
} from "./budget-lines";

function line(over: Partial<BudgetLine> & Pick<BudgetLine, "lineItemId">): BudgetLine {
  return {
    code: null, description: "line", category: null, quantity: 1, unit: "no", rate: 0,
    parentLineItemId: null, amount: 0, budgetPercentage: 25, budget: 0,
    materialAmount: null, manpowerAmount: null, vendorId: null, vendorName: null,
    vendorAmount: null, variance: null,
    ...over,
  };
}

// Two categories, one vendor amount, one material tag and one manpower tag --
// the exact fixture shape item D-54's acceptance describes.
const LINES: BudgetLine[] = [
  line({ lineItemId: "l1", code: "R60SK", description: "R60 skiphop sub", category: "Civil", quantity: 10, unit: "m2", rate: 650, amount: 6500, budget: 1625, vendorId: "v1", vendorName: "Skiphop", vendorAmount: 1700, materialAmount: 300, manpowerAmount: 200 }),
  line({ lineItemId: "l2", code: "CIV-2", description: "Plaster", category: "Civil", amount: 500, budget: 125 }),
  line({ lineItemId: "l3", code: "GYP-1", description: "Ceiling grid", category: "Gypsum", amount: 400, budget: 100, vendorId: "v2", vendorName: "Gyproc", vendorAmount: 90 }),
  line({ lineItemId: "l4", code: "MISC", description: "Odd job", category: null, amount: 100, budget: 25 }),
  // A weighted sub-task of l1: 40% of l1's amount, listed but never added on top.
  line({ lineItemId: "l1a", code: "R60SK.1", description: "Frame", category: "Civil", amount: 2600, budget: 650, parentLineItemId: "l1" }),
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
    expect(isOverBudget(line({ lineItemId: "x", budget: 1625, vendorAmount: 1700, materialAmount: 300, manpowerAmount: 200 }))).toBe(true);
  });
  test("an uncosted line is never counted as over budget", () => {
    expect(isOverBudget(line({ lineItemId: "x", budget: 1625 }))).toBe(false);
  });
  test("exactly on budget is not over", () => {
    expect(isOverBudget(line({ lineItemId: "x", budget: 100, vendorAmount: 100 }))).toBe(false);
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
    expect(grandTotal).toEqual({ amount: 0, budget: 0, vendorAmount: 0, materialAmount: 0, manpowerAmount: 0, actual: 0 });
  });
});

describe("budgetCategoryOptions", () => {
  test("offers every category present, Uncategorized last", () => {
    expect(budgetCategoryOptions(LINES)).toEqual(["Civil", "Gypsum", UNCATEGORIZED_LABEL]);
  });
});
