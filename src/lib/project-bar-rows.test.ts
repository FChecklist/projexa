import { describe, expect, test } from "bun:test";
import { BAR_COLOR_VARS, BUDGET_NOT_DATE_FILTERED_NOTE, buildProjectBarRows, type ProjectBarSource } from "./project-bar-rows";

function project(over: Partial<ProjectBarSource> = {}): ProjectBarSource {
  return { id: "p1", name: "Cedar", revenue: 0, boqBudget: null, budget: null, earnedValue: null, ...over };
}

describe("buildProjectBarRows", () => {
  test("rows are ordered by revenue descending", () => {
    const { rows } = buildProjectBarRows([
      project({ id: "a", name: "A", revenue: 100 }),
      project({ id: "c", name: "C", revenue: 900 }),
      project({ id: "b", name: "B", revenue: 400 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  test("a project with NO revenue figure sorts last rather than being read as zero revenue", () => {
    const { rows } = buildProjectBarRows([
      project({ id: "unknown", revenue: null }),
      project({ id: "zero", revenue: 0 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["zero", "unknown"]);
  });

  test("ONE axis across every row -- a 4,000,000 bar and a 40,000 bar are not both full width", () => {
    const { rows, axisMax } = buildProjectBarRows([
      project({ id: "big", revenue: 4_000_000 }),
      project({ id: "small", revenue: 40_000 }),
    ]);
    expect(axisMax).toBe(4_000_000);
    const big = rows[0].bars.find((b) => b.key === "revenue")!;
    const small = rows[1].bars.find((b) => b.key === "revenue")!;
    expect(big.widthPercent).toBe(100);
    expect(small.widthPercent).toBeCloseTo(1, 5);
  });

  test("three bars per row, in Sumeet's order, painted from WS-G's tokens", () => {
    const { rows } = buildProjectBarRows([project({ revenue: 10, boqBudget: 5, earnedValue: 2 })]);
    expect(rows[0].bars.map((b) => b.key)).toEqual(["revenue", "budget", "earnedValue"]);
    expect(rows[0].bars.map((b) => b.colorVar)).toEqual([
      BAR_COLOR_VARS.revenue,
      BAR_COLOR_VARS.budget,
      BAR_COLOR_VARS.earnedValue,
    ]);
    // Never a raw hex and never a recharts default.
    for (const bar of rows[0].bars) expect(bar.colorVar.startsWith("var(--")).toBe(true);
  });

  test("a missing figure is null with a zero-width bar -- the row says the words, it does not draw a fake zero", () => {
    const { rows } = buildProjectBarRows([project({ revenue: 100, boqBudget: null, budget: null, earnedValue: null })]);
    const budget = rows[0].bars.find((b) => b.key === "budget")!;
    expect(budget.value).toBeNull();
    expect(budget.widthPercent).toBe(0);
    expect(rows[0].budgetSource).toBe("none");
  });

  test("the BOQ budget wins, and the row says which budget it is showing", () => {
    const boq = buildProjectBarRows([project({ revenue: 100, boqBudget: 40, budget: 999 })]);
    expect(boq.rows[0].bars.find((b) => b.key === "budget")!.value).toBe(40);
    expect(boq.rows[0].budgetSource).toBe("boq");

    const erp = buildProjectBarRows([project({ revenue: 100, boqBudget: 0, budget: 60 })]);
    expect(erp.rows[0].bars.find((b) => b.key === "budget")!.value).toBe(60);
    expect(erp.rows[0].budgetSource).toBe("erp");
  });

  test("a real non-zero value never renders as an invisible bar", () => {
    const { rows } = buildProjectBarRows([
      project({ id: "huge", revenue: 10_000_000 }),
      project({ id: "tiny", revenue: 1 }),
    ]);
    expect(rows[1].bars[0].widthPercent).toBeGreaterThan(0);
  });

  test("every row is a door to its own project dashboard", () => {
    const { rows } = buildProjectBarRows([project({ id: "prj 1" })]);
    expect(rows[0].href).toBe("/dashboard/project?projectId=prj%201");
  });

  test("no projects gives no rows and a zero axis, not a divide by zero", () => {
    const { rows, axisMax } = buildProjectBarRows([]);
    expect(rows).toEqual([]);
    expect(axisMax).toBe(0);
  });

  test("the date-range caveat is one fixed sentence, so two screens cannot word it differently", () => {
    expect(BUDGET_NOT_DATE_FILTERED_NOTE).toBe("Budget is BOQ x budget %, not date-filtered");
  });
});
