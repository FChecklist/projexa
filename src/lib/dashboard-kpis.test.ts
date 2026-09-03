/// <reference types="bun-types" />
// R67 E-19 (R-180). The item's acceptance, as far as pure rules can carry it:
// every tile has a baseline line and a destination, and an org with no budget
// reads "Budget — not entered" and NEVER "AED 0". The rendered half (the rows
// really being links) is asserted in ProjectRow.test.tsx.
import { describe, expect, test } from "bun:test";
import { BUDGET_NOT_ENTERED, EN_DASH, compareTo, dashboardKpis, portfolioContractValue } from "./dashboard-kpis";
import type { DashboardProject } from "./dashboard-rows";

const money = (v: number | null) => (v === null ? EN_DASH : `AED ${v.toLocaleString("en-US")}`);

function project(overrides: Partial<DashboardProject> = {}): DashboardProject {
  return {
    id: "p1",
    name: "Cedar Heights Villa - Phase 1",
    revenue: 0,
    expenses: 0,
    taskCount: 0,
    delayedTaskCount: 0,
    value: 2_120_500,
    earnedValue: 0,
    percentByValue: 0,
    ...overrides,
  };
}

const TOTALS = {
  totalProjects: 2,
  totalBudget: 1_800_000,
  totalLedgerBudget: 500_000,
  totalRevenue: 900_000,
  totalExpenses: 2_000_000,
};

describe("every tile carries a baseline and a destination (R67 E-19 acceptance)", () => {
  test("all four, with no exceptions and no empty strings", () => {
    const tiles = dashboardKpis(TOTALS, [project(), project({ id: "p2", value: 1_000_000 })], money);
    expect(tiles.map((t) => t.key)).toEqual(["projects", "budget", "revenue", "expenses"]);
    for (const tile of tiles) {
      expect(tile.baseline.length).toBeGreaterThan(0);
      expect(tile.href.startsWith("/")).toBe(true);
      expect(tile.hrefLabel.length).toBeGreaterThan(0);
    }
  });

  test("the destinations are the ones the item names", () => {
    const [projects, budget, revenue, expenses] = dashboardKpis(TOTALS, [project()], money);
    expect(projects.href).toBe("/projects");
    expect(budget.href).toBe("/budgets");
    expect(revenue.href).toBe("/invoices");
    expect(expenses.href).toBe("/expenses");
  });
});

describe("an org with no budget: 'Budget — not entered', never 'AED 0' (R67 E-19 acceptance)", () => {
  test("no BOQ anywhere -- the figure is an en dash and the baseline says which null this is", () => {
    const tiles = dashboardKpis(
      { ...TOTALS, totalBudget: null, totalLedgerBudget: null },
      [project({ value: null })],
      money
    );
    const budget = tiles.find((t) => t.key === "budget")!;
    expect(budget.value).toBe(EN_DASH);
    expect(budget.value).not.toContain("0");
    expect(budget.baseline).toBe(`${BUDGET_NOT_ENTERED} — no BOQ imported yet`);
    // ...and it points at the screen where a budget is actually entered.
    expect(budget.href).toBe("/scope");
    expect(budget.hrefLabel).toBe("Set budget");
  });

  test("a BOQ with no budget percentages sums to 0 -- and that is still 'not entered', said differently", () => {
    // This is the case that produced the literal "TOTAL BUDGET AED 0" R-180 is
    // named after: the sum is a real 0 because every budgetPercentage is 0.
    const tiles = dashboardKpis({ ...TOTALS, totalBudget: 0, totalLedgerBudget: null }, [project()], money);
    const budget = tiles.find((t) => t.key === "budget")!;
    expect(budget.value).toBe(EN_DASH);
    expect(budget.baseline).toBe(`${BUDGET_NOT_ENTERED} — the BOQ carries no budget percentages`);
    expect(budget.direction).toBeNull();
  });

  test("and the Expenses tile refuses to compare against a budget nobody set", () => {
    const tiles = dashboardKpis({ ...TOTALS, totalBudget: null }, [project()], money);
    const expenses = tiles.find((t) => t.key === "expenses")!;
    expect(expenses.direction).toBeNull();
    expect(expenses.baseline).toBe(`${BUDGET_NOT_ENTERED} — nothing to measure spend against`);
  });
});

describe("the direction is a real comparison or it is absent", () => {
  test("spend past the budget reads 'over'", () => {
    const tiles = dashboardKpis(TOTALS, [project()], money);
    const expenses = tiles.find((t) => t.key === "expenses")!;
    expect(expenses.direction).toBe("over");
    expect(expenses.baseline).toBe("vs AED 1,800,000 budget");
  });

  test("invoiced under the contract value reads 'under'", () => {
    const tiles = dashboardKpis(TOTALS, [project()], money);
    const revenue = tiles.find((t) => t.key === "revenue")!;
    expect(revenue.direction).toBe("under");
    expect(revenue.baseline).toBe("vs AED 2,120,500 contract value");
  });

  test("a count of projects has no up or down, so it carries no direction at all", () => {
    const tiles = dashboardKpis(TOTALS, [project()], money);
    expect(tiles.find((t) => t.key === "projects")!.direction).toBeNull();
  });

  test("compareTo has no opinion about a baseline that does not exist", () => {
    expect(compareTo(10, null)).toBeNull();
    expect(compareTo(10, undefined)).toBeNull();
    expect(compareTo(10, 10)).toBe("level");
  });
});

describe("a redacted reader is told WHY the tile is empty, and is never shown a direction", () => {
  test("every money tile says 'Needs manager role' and carries no comparison", () => {
    const tiles = dashboardKpis(
      { ...TOTALS, totalBudget: null, financialsRedacted: true },
      [project({ value: null, expenses: null, revenue: null })],
      money
    );
    for (const key of ["budget", "revenue", "expenses"] as const) {
      const tile = tiles.find((t) => t.key === key)!;
      expect(tile.value).toBe(EN_DASH);
      expect(tile.baseline).toBe("Needs manager role");
      expect(tile.direction).toBeNull();
    }
    // The project COUNT is not financial and is not redacted, so it still says
    // something useful rather than going blank alongside them.
    expect(tiles.find((t) => t.key === "projects")!.value).toBe("2");
  });
});

describe("portfolioContractValue", () => {
  test("sums only the projects that HAVE a BOQ", () => {
    expect(portfolioContractValue([project({ value: 100 }), project({ id: "b", value: null }), project({ id: "c", value: 250 })])).toBe(350);
  });

  test("null -- never 0 -- when not one project has a BOQ", () => {
    expect(portfolioContractValue([project({ value: null })])).toBeNull();
    expect(portfolioContractValue([])).toBeNull();
  });
});

describe("the ERP annual ledger budget keeps its own name", () => {
  test("it rides the budget baseline, named, rather than standing in for the BOQ budget", () => {
    const budget = dashboardKpis(TOTALS, [project()], money).find((t) => t.key === "budget")!;
    expect(budget.baseline).toBe("AED 1,800,000 of AED 2,120,500 contract value · Annual ledger budget AED 500,000");
  });

  test("no ledger figure at all: the baseline simply does not mention one", () => {
    const budget = dashboardKpis({ ...TOTALS, totalLedgerBudget: null }, [project()], money).find((t) => t.key === "budget")!;
    expect(budget.baseline).toBe("AED 1,800,000 of AED 2,120,500 contract value");
  });
});
