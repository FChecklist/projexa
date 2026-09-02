/// <reference types="bun-types" />
// R67 D-02. The rule under test is the one the audit measured being broken on
// the live home screen: a figure nobody set was rendered as "AED 0", which a
// reader takes for a real, approved zero.
import { describe, expect, test } from "bun:test";
import { budgetBaseline, formatBudgetValue, portfolioTotals, spendTone } from "./dashboard-kpi";

const money = (n: number) => `AED ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

describe("formatBudgetValue", () => {
  test("a null budget renders as the words 'Not set'", () => {
    expect(formatBudgetValue(null, money)).toBe("Not set");
  });

  test("a null budget never renders a zero, in any form", () => {
    const rendered = formatBudgetValue(null, money);
    expect(rendered).not.toContain("0");
    expect(rendered).not.toMatch(/AED\s*0\b/);
  });

  test("a real zero budget still renders as a figure -- the two are different facts", () => {
    expect(formatBudgetValue(0, money)).toBe("AED 0");
  });

  test("a real budget renders with its currency and separators", () => {
    expect(formatBudgetValue(1250000, money)).toBe("AED 1,250,000");
  });
});

describe("budgetBaseline", () => {
  test("says so, in words, when no budget exists", () => {
    expect(budgetBaseline(null, money)).toBe("budget not set");
    expect(budgetBaseline(null, money)).not.toMatch(/AED\s*0\b/);
  });

  test("names the real budget when there is one", () => {
    expect(budgetBaseline(900000, money)).toBe("budget AED 900,000");
  });
});

describe("spendTone", () => {
  test("never claims 'over budget' when no budget was set", () => {
    expect(spendTone(null, 1250000)).toBe("context");
  });

  test("is late only when a real budget is exceeded", () => {
    expect(spendTone(900000, 1250000)).toBe("late");
    expect(spendTone(900000, 900000)).toBe("context");
    expect(spendTone(900000, 10)).toBe("context");
  });
});

describe("portfolioTotals", () => {
  test("skips nulls instead of counting them as zero", () => {
    expect(
      portfolioTotals([
        { value: 1000, earnedValue: 250 },
        { value: null, earnedValue: null },
        { value: 3000, earnedValue: 750 },
      ])
    ).toEqual({ earned: 1000, contract: 4000, percent: 25 });
  });

  test("returns null contract and null percent when no project has a BOQ", () => {
    expect(portfolioTotals([{ value: null, earnedValue: null }, { value: null, earnedValue: null }])).toEqual({
      earned: null,
      contract: null,
      percent: null,
    });
  });

  test("an empty portfolio is null, not zero", () => {
    expect(portfolioTotals([])).toEqual({ earned: null, contract: null, percent: null });
  });

  test("no percent is claimed when the contract total is zero (no division by zero, no 0%)", () => {
    expect(portfolioTotals([{ value: 0, earnedValue: 0 }]).percent).toBeNull();
  });

  test("a project with a BOQ but no progress logged yet reports contract without earned value", () => {
    expect(portfolioTotals([{ value: 5000, earnedValue: null }])).toEqual({
      earned: null,
      contract: 5000,
      percent: null,
    });
  });
});
