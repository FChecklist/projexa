/// <reference types="bun-types" />
// R67 E-29 (R-255). The per-category BOQ split, now shared by the company
// route and the project route. These are the rules that must hold identically
// on both screens -- which is the whole reason the arithmetic left the route.

import { describe, expect, test } from "bun:test";
import {
  UNCATEGORIZED_LABEL,
  buildCategoryDistribution,
  isAllUncategorized,
  type CategoryBoqAmounts,
  type CategoryProgress,
} from "./category-distribution";

const amounts: CategoryBoqAmounts = {
  categories: [
    { categoryId: "civil", name: "Civil", totalAmount: 400_000 },
    { categoryId: "joinery", name: "Joinery", totalAmount: 300_000 },
    { categoryId: "paint", name: "Paint", totalAmount: 0 },
  ],
  uncategorizedAmount: 300_000,
  totalAmount: 1_000_000,
};

const progress: CategoryProgress = {
  categories: [
    { categoryId: "civil", name: "Civil", percentComplete: 50 },
    { categoryId: "joinery", name: "Joinery", percentComplete: 0 },
  ],
};

describe("buildCategoryDistribution", () => {
  test("share is the category's amount over the WHOLE BOQ, so the shares sum to 100", () => {
    const { categories } = buildCategoryDistribution(amounts, progress);
    const total = categories.reduce((sum, c) => sum + c.sharePercent, 0);
    expect(Math.round(total)).toBe(100);
    expect(categories.find((c) => c.categoryId === "civil")?.sharePercent).toBe(40);
  });

  test("completedAmount is the real progress percentage applied to the real BOQ amount", () => {
    const { categories } = buildCategoryDistribution(amounts, progress);
    expect(categories.find((c) => c.categoryId === "civil")?.completedAmount).toBe(200_000);
    // Zero progress is a real figure -- nothing has been completed in Joinery.
    expect(categories.find((c) => c.categoryId === "joinery")?.completedAmount).toBe(0);
  });

  test("uncategorised BOQ money keeps its own row instead of vanishing from the chart", () => {
    const { categories } = buildCategoryDistribution(amounts, progress);
    const other = categories.find((c) => c.name === UNCATEGORIZED_LABEL);
    expect(other?.totalAmount).toBe(300_000);
    expect(other?.sharePercent).toBe(30);
    // Progress is reported per category, so these lines have no completion
    // figure to report. Drawing none is the honest answer; a completed bar
    // here would be invented.
    expect(other?.completedAmount).toBe(0);
  });

  test("a zero-amount category is dropped -- it has no bar to draw and no share to state", () => {
    const { categories } = buildCategoryDistribution(amounts, progress);
    expect(categories.some((c) => c.categoryId === "paint")).toBe(false);
  });

  test("a category with no progress row at all reads 0% complete, never undefined", () => {
    const { categories } = buildCategoryDistribution(amounts, { categories: [] });
    expect(categories.every((c) => c.percentComplete === 0)).toBe(true);
    expect(categories.every((c) => c.completedAmount === 0)).toBe(true);
  });

  test("an empty BOQ divides by nothing and returns no rows rather than NaN shares", () => {
    const { categories, totalAmount } = buildCategoryDistribution(
      { categories: [], uncategorizedAmount: 0, totalAmount: 0 },
      { categories: [] }
    );
    expect(categories).toEqual([]);
    expect(totalAmount).toBe(0);
  });
});
describe("isAllUncategorized (R67 E-40: one bar is not a distribution)", () => {
  test("true only when the single bucket is THE uncategorised one", () => {
    expect(isAllUncategorized([{ categoryId: "uncategorized" }])).toBe(true);
  });

  test("a project with one real trade is not 'nobody assigned categories'", () => {
    // These look identical on the chart -- one bar -- and only one of them has
    // a fix, which is the whole reason this helper exists.
    expect(isAllUncategorized([{ categoryId: "c1" }])).toBe(false);
  });

  test("an uncategorised bucket ALONGSIDE real categories is not the case either", () => {
    expect(isAllUncategorized([{ categoryId: "c1" }, { categoryId: "uncategorized" }])).toBe(false);
  });

  test("no categories at all is the empty state, not this one", () => {
    expect(isAllUncategorized([])).toBe(false);
  });

  test("it matches the id buildCategoryDistribution really creates", () => {
    // The detection and the construction share one id by construction, not by
    // a string typed twice.
    const built = buildCategoryDistribution(
      { categories: [], uncategorizedAmount: 4000, totalAmount: 4000 },
      { categories: [] }
    );
    expect(isAllUncategorized(built.categories)).toBe(true);
  });
});
