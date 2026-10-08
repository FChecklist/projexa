import { describe, expect, test } from "bun:test";
import { buildCategoryDistribution } from "@/lib/category-distribution";
import { dashboardKpis, BUDGET_NOT_ENTERED, EN_DASH, compareTo, portfolioContractValue } from "@/lib/dashboard-kpis";
import { needsYouSummary, progressBarState, projectRowStatus, sortProjectRows, STALLED_AFTER_DAYS, daysBetween as rowDays, type DashboardProject } from "@/lib/dashboard-rows";
import { budgetBaseline, formatBudgetValue, formatProjectValue, portfolioTotals, projectValueCaption, spendTone } from "@/lib/dashboard-kpi";
import { daysBetween, durationDays, formatDurationDays, formatSlip, plannedPercentComplete, slipDays, formatSlippageTile, summariseTaskSlippage } from "@/lib/schedule-progress";
import { formatMoney } from "@/lib/format-money";

// MATRIX category 5: dashboard / analysis / report figures against SEEDED data. Cases M05-01 ... M05-34.
// Seed: three projects with known figures; every expected number below is worked out by hand from this table.
const P = (o: Partial<DashboardProject> & { id: string; name: string }): DashboardProject =>
  ({ revenue: 0, expenses: 0, taskCount: 10, delayedTaskCount: 0, value: null, earnedValue: null, percentByValue: null, ...o } as DashboardProject);
const SEED = [
  P({ id: "a", name: "Cedar Villa", value: 1_000_000, earnedValue: 400_000, percentByValue: 40, revenue: 300_000, expenses: 250_000, budget: 800_000 } as never),
  P({ id: "b", name: "Harbour Fit-out", value: 500_000, earnedValue: 100_000, percentByValue: 20, revenue: 50_000, expenses: 90_000, delayedTaskCount: 2 }),
  P({ id: "c", name: "No BOQ Yet", value: null, earnedValue: null, percentByValue: null }),
];
const money = (n: number | null) => formatMoney(n, { currency: "AED" });

describe("M05 portfolio and KPI tiles", () => {
  test("M05-01 portfolio contract value sums only projects with a BOQ", () => {
    expect(portfolioContractValue(SEED)).toBe(1_500_000);
    expect(portfolioContractValue([SEED[2]!])).toBeNull();
    expect(portfolioContractValue([])).toBeNull();
  });
  test("M05-02 portfolio earned / contract / percent from the seed", () => {
    expect(portfolioTotals(SEED.map((p) => ({ contractValue: p.value, earnedValue: p.earnedValue })))).toEqual({ earned: 500_000, contract: 1_500_000, percent: 33 });
  });
  test("M05-03 no project has a BOQ: contract/earned/percent are all null, not zero", () => {
    expect(portfolioTotals([{ contractValue: null, earnedValue: null }])).toEqual({ earned: null, contract: null, percent: null });
  });
  test("M05-04 percent is null when contract is 0 (no divide by zero)", () => {
    expect(portfolioTotals([{ contractValue: 0, earnedValue: 0 }]).percent).toBeNull();
  });
  test("M05-05 four tiles in order: projects, budget, revenue, expenses", () => {
    const k = dashboardKpis({ totalProjects: 3, totalBudget: 800_000, totalRevenue: 350_000, totalExpenses: 340_000 }, SEED, money);
    expect(k.map((x) => x.key)).toEqual(["projects", "budget", "revenue", "expenses"]);
  });
  test("M05-06 projects tile value and baseline: 2 of 3 with a BOQ, 1 needs you", () => {
    const k = dashboardKpis({ totalProjects: 3, totalBudget: 800_000, totalRevenue: 0, totalExpenses: 0 }, SEED, money)[0]!;
    expect(k.value).toBe("3");
    expect(k.baseline).toBe("2 of 3 with a BOQ · 1 need you");
  });
  test("M05-07 no projects: honest empty words", () => {
    expect(dashboardKpis({ totalProjects: 0, totalBudget: null, totalRevenue: 0, totalExpenses: 0 }, [], money)[0]!.baseline).toBe("No projects yet");
  });
  test("M05-08 budget tile formats the seeded figure and compares to the contract (under)", () => {
    const b = dashboardKpis({ totalProjects: 3, totalBudget: 800_000, totalRevenue: 0, totalExpenses: 0 }, SEED, money)[1]!;
    expect(b.value).toBe("AED 800,000.00");
    expect(b.baseline).toContain("AED 1,500,000.00 contract value");
    expect(b.direction).toBe("under");
  });
  test("M05-09 no budget anywhere: says so in words, never AED 0", () => {
    const b = dashboardKpis({ totalProjects: 1, totalBudget: null, totalRevenue: 0, totalExpenses: 0 }, [SEED[2]!], money)[1]!;
    expect(b.value).toBe(EN_DASH);
    expect(b.baseline).toBe(`${BUDGET_NOT_ENTERED} — no BOQ imported yet`);
    expect(b.direction).toBeNull();
    expect(b.value).not.toContain("0");
  });
  test("M05-10 BOQ with zero budget percentages reads differently from no BOQ", () => {
    const b = dashboardKpis({ totalProjects: 1, totalBudget: 0, totalRevenue: 0, totalExpenses: 0 }, SEED, money)[1]!;
    expect(b.baseline).toContain("carries no budget percentages");
  });
  test("M05-11 revenue and expenses tiles: seeded figures and direction vs contract / budget", () => {
    const k = dashboardKpis({ totalProjects: 3, totalBudget: 800_000, totalRevenue: 350_000, totalExpenses: 900_000 }, SEED, money);
    expect(k[2]!.value).toBe("AED 350,000.00");
    expect(k[2]!.direction).toBe("under");
    expect(k[3]!.value).toBe("AED 900,000.00");
    expect(k[3]!.direction).toBe("over");
  });
  test("M05-12 CLIENT VIEWER (redacted): money tiles show a dash and 'needs manager role', never a figure or a direction", () => {
    const k = dashboardKpis({ totalProjects: 3, totalBudget: null, totalRevenue: 0, totalExpenses: 0, financialsRedacted: true }, SEED, money);
    for (const t of k.slice(1)) {
      expect(t.value).toBe(EN_DASH);
      expect(t.baseline).toBe("Needs manager role");
      expect(t.direction).toBeNull();
    }
    expect(k[0]!.value).toBe("3"); // counts are not money
  });
  test("M05-13 redacted wins even if figures leak into the payload", () => {
    const k = dashboardKpis({ totalProjects: 3, totalBudget: 800_000, totalRevenue: 350_000, totalExpenses: 900_000, financialsRedacted: true }, SEED, money);
    expect(JSON.stringify(k)).not.toContain("350,000");
    expect(JSON.stringify(k)).not.toContain("900,000");
  });
  test.each([[5, 3, "over"], [3, 5, "under"], [4, 4, "level"], [4, null, null], [4, undefined, null]])("M05-14 compareTo(%p, %p) = %p", (v, b, want) => {
    expect(compareTo(v as number, b as number | null)).toBe(want as never);
  });
  test("M05-15 ledger budget is reported under its own name, not as the BOQ budget", () => {
    const b = dashboardKpis({ totalProjects: 3, totalBudget: 800_000, totalLedgerBudget: 123_000, totalRevenue: 0, totalExpenses: 0 }, SEED, money)[1]!;
    expect(b.baseline).toContain("Annual ledger budget AED 123,000.00");
  });
  test("M05-16 unset budget / value render 'Not set', never zero", () => {
    expect(formatBudgetValue(null, money)).toBe("Not set");
    expect(formatProjectValue(null, money)).toBe("Not set");
    expect(budgetBaseline(null, money)).toBe("budget not set");
    expect(formatBudgetValue(0, money)).toBe("AED 0.00"); // an entered zero is a real fact
  });
  test("M05-17 value captions say where the figure came from", () => {
    expect(projectValueCaption("entered")).toBe("entered");
    expect(projectValueCaption("purchase_orders")).toBe("from purchase orders");
    expect(projectValueCaption(null)).toBe("no value set");
  });
  test("M05-18 spend tone: late only when a budget exists and is exceeded", () => {
    expect(spendTone(100, 101)).toBe("late");
    expect(spendTone(100, 100)).toBe("context");
    expect(spendTone(null, 1e9)).toBe("context");
  });
});

describe("M05 project rows", () => {
  const TODAY = "2026-10-08";
  test("M05-19 seeded statuses: Cedar on track, Harbour needs you (2 delayed + over budget n/a), No BOQ on track", () => {
    expect(projectRowStatus(SEED[0]!, TODAY).label).toBe("on track");
    expect(projectRowStatus(SEED[1]!, TODAY)).toMatchObject({ needsYou: true, reasons: ["2 delayed tasks"] });
    expect(projectRowStatus(SEED[2]!, TODAY).label).toBe("on track");
  });
  test("M05-20 reason order is money first, then stall, permits, delays", () => {
    const p = P({ id: "x", name: "X", spendOverValue: true, expenses: 10, delayedTaskCount: 1, permitsExpiring30d: 2, lastProgressAt: "2026-08-01", budget: 5 } as never);
    expect(projectRowStatus(p, TODAY).reasons).toEqual(["spend over contract value", "spend over budget", "no progress recorded for 68 days", "2 permits expiring in 30 days", "1 delayed task"]);
  });
  test("M05-21 stalled exactly at 30 days, not at 29", () => {
    expect(STALLED_AFTER_DAYS).toBe(30);
    expect(projectRowStatus(P({ id: "x", name: "X", lastProgressAt: "2026-09-08" } as never), TODAY).reasons[0]).toBe("no progress recorded for 30 days");
    expect(projectRowStatus(P({ id: "x", name: "X", lastProgressAt: "2026-09-09" } as never), TODAY).needsYou).toBe(false);
  });
  test("M05-22 never-recorded progress is not 'stalled'", () => {
    expect(projectRowStatus(P({ id: "x", name: "X", lastProgressAt: null } as never), TODAY).needsYou).toBe(false);
  });
  test("M05-23 redacted spend (null) neither flags nor clears: a redacted row stays on track", () => {
    const p = P({ id: "x", name: "X", spendOverValue: null, expenses: null, budget: null } as never);
    expect(projectRowStatus(p, TODAY).needsYou).toBe(false);
  });
  test("M05-24 sorting puts needs-you first and keeps the payload order inside each group; input not mutated", () => {
    const before = SEED.map((p) => p.id);
    expect(sortProjectRows(SEED, TODAY).map((p) => p.id)).toEqual(["b", "a", "c"]);
    expect(SEED.map((p) => p.id)).toEqual(before);
  });
  test("M05-25 summary sentence names the project and reason; plural for several", () => {
    expect(needsYouSummary(SEED, TODAY)).toBe("Harbour Fit-out needs you — 2 delayed tasks.");
    const two = [...SEED, P({ id: "d", name: "Dock", delayedTaskCount: 1 })];
    expect(needsYouSummary(two, TODAY)).toBe("Harbour Fit-out and 1 other project need you — 2 delayed tasks.");
    expect(needsYouSummary([SEED[0]!], TODAY)).toBeNull();
  });
  test("M05-26 progress bar: no BOQ is 'unknown' (not 0%), values clamp to 0..100", () => {
    expect(progressBarState(SEED[2]!)).toEqual({ kind: "unknown", label: "No BOQ yet" });
    expect(progressBarState(P({ id: "x", name: "x", percentByValue: 140 }))).toEqual({ kind: "value", percent: 100 });
    expect(progressBarState(P({ id: "x", name: "x", percentByValue: -5 }))).toEqual({ kind: "value", percent: 0 });
    expect(progressBarState(P({ id: "x", name: "x", percentByValue: 0 }))).toEqual({ kind: "value", percent: 0 });
  });
  test("M05-27 whole-day maths ignores month ends, leap years and bad input", () => {
    expect(rowDays("2026-02-28", "2026-03-01")).toBe(1);
    expect(rowDays("2028-02-28", "2028-03-01")).toBe(2);
    expect(rowDays("garbage", "2026-10-08")).toBeNull();
    expect(rowDays(null, "2026-10-08")).toBeNull();
  });
});

describe("M05 schedule and category figures", () => {
  test.each([["2026-10-01", "2026-10-11", 10], ["2026-10-01", "2026-10-01", 0], ["2026-10-11", "2026-10-01", -10], [null, "2026-10-01", null]])(
    "M05-28 duration %p -> %p = %p", (a, b, want) => { expect(durationDays(a as string | null, b)).toBe(want); });
  test("M05-29 duration text and slip words", () => {
    expect(formatDurationDays(0)).toBe("0 d");
    expect(formatDurationDays(null)).toBe("—");
    expect(slipDays("2026-10-13", "2026-10-10")).toBe(3);
    expect(formatSlip(3)).toMatchObject({ text: "+3 d late", tone: "late" });
    expect(formatSlip(-2)).toMatchObject({ text: "2 d early", tone: "early" });
    expect(formatSlip(0).text).toBe("0 d on time");
    expect(formatSlip(null).text).toBe("—");
  });
  test.each([["2026-10-01", "2026-10-11", "2026-09-30", 0], ["2026-10-01", "2026-10-11", "2026-10-06", 50], ["2026-10-01", "2026-10-11", "2026-10-20", 100], ["2026-10-05", "2026-10-05", "2026-10-05", 100], ["2026-10-05", "2026-10-05", "2026-10-04", 0], ["2026-10-11", "2026-10-01", "2026-10-12", 100]])(
    "M05-30 planned %% %p..%p on %p = %p", (s, d, today, want) => { expect(plannedPercentComplete(s, d, today)).toBe(want); });
  test("M05-31 slippage tile counts only comparable activities", () => {
    const sum = summariseTaskSlippage([{ days: 5, tone: "behind" }, { days: 12, tone: "behind" }, { days: -1, tone: "ahead" }, { days: null, tone: "unknown" }] as never);
    expect(sum).toEqual({ comparedCount: 3, behindCount: 2, worstDays: 12 });
    expect(formatSlippageTile(sum)).toBe("Schedule: 2 tasks behind, worst 12 days");
    expect(formatSlippageTile({ comparedCount: 3, behindCount: 1, worstDays: 4 })).toBe("Schedule: 1 task behind, worst 4 days");
    expect(formatSlippageTile({ comparedCount: 0, behindCount: 0, worstDays: null })).toContain("no activity");
  });
  test("M05-32 category distribution: shares sum to 100, uncategorized is shown, completed = total x %", () => {
    const d = buildCategoryDistribution(
      { categories: [{ categoryId: "c1", name: "Civil", totalAmount: 600 }, { categoryId: "c2", name: "MEP", totalAmount: 300 }], uncategorizedAmount: 100, totalAmount: 1000 },
      { categories: [{ categoryId: "c1", name: "Civil", percentComplete: 50 }] },
    );
    expect(d.totalAmount).toBe(1000);
    expect(d.categories.reduce((s, c) => s + c.sharePercent, 0)).toBeCloseTo(100, 6);
    expect(d.categories.find((c) => c.name === "Civil")).toMatchObject({ sharePercent: 60, percentComplete: 50, completedAmount: 300 });
    expect(d.categories.find((c) => c.name === "MEP")).toMatchObject({ percentComplete: 0, completedAmount: 0 });
    expect(d.categories.some((c) => c.name === "Uncategorized")).toBe(true);
  });
  test("M05-33 zero-amount categories are dropped; an empty BOQ gives no NaN", () => {
    const d = buildCategoryDistribution({ categories: [{ categoryId: "c1", name: "Empty", totalAmount: 0 }], uncategorizedAmount: 0, totalAmount: 0 }, { categories: [] });
    expect(d.categories).toEqual([]);
    expect(JSON.stringify(d)).not.toContain("null");
  });
  test("M05-34 whole-day schedule maths across a DST-free UTC boundary", () => {
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-25", "2026-10-26")).toBe(1);
  });
});
