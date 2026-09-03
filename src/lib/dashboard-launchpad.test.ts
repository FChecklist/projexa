import { describe, expect, test } from "bun:test";
import {
  budgetVerdict,
  needsYouProjects,
  onTrackProjects,
  portfolioProgress,
  projectVerdict,
  rowContractValue,
  rowDataArrived,
  rowPercentByValue,
  sanitizeScreenLabel,
  type LaunchpadProject,
} from "./dashboard-launchpad";

function project(over: Partial<LaunchpadProject> = {}): LaunchpadProject {
  return {
    id: "p1",
    name: "Cedar Heights Villa - Phase 1",
    revenue: 0,
    expenses: 0,
    taskCount: 0,
    delayedTaskCount: 0,
    value: null,
    earnedValue: null,
    percentByValue: null,
    spent: 0,
    contractValue: null,
    earnedValuePrevWeek: null,
    progressPercent: null,
    budget: null,
    tasksDue: 0,
    tasksLate: 0,
    hasSchedule: false,
    ...over,
  };
}

describe("sanitizeScreenLabel (R-222: no test marker reaches a customer)", () => {
  test("strips the live registry row's '(HARD-STOP TEST)' suffix", () => {
    expect(sanitizeScreenLabel("ACTIVE PROJECTS (HARD-STOP TEST)", "Active Projects")).toBe("ACTIVE PROJECTS");
  });

  test("strips a test marker anywhere in the label, not just at the end", () => {
    expect(sanitizeScreenLabel("Active (HARD-STOP TEST) Projects", "fallback")).toBe("Active Projects");
  });

  test("a label that still shouts TEST after stripping falls back to the code's own words", () => {
    expect(sanitizeScreenLabel("TEST ROW", "Active Projects")).toBe("Active Projects");
    expect(sanitizeScreenLabel("(HARD-STOP TEST)", "Active Projects")).toBe("Active Projects");
  });

  test("an ordinary label is passed through untouched", () => {
    expect(sanitizeScreenLabel("Total Revenue", "Revenue")).toBe("Total Revenue");
    // "Latest" contains "test" as a substring -- a word-boundary match must not eat it.
    expect(sanitizeScreenLabel("Latest revision", "Revision")).toBe("Latest revision");
  });

  test("an empty or missing label falls back", () => {
    expect(sanitizeScreenLabel(null, "Active Projects")).toBe("Active Projects");
    expect(sanitizeScreenLabel("", "Active Projects")).toBe("Active Projects");
    expect(sanitizeScreenLabel(undefined, "Active Projects")).toBe("Active Projects");
  });
});

describe("the three-state rule: number / null / missing", () => {
  test("a row whose figures never arrived is not treated as a row with no BOQ", () => {
    const missing = { id: "p", name: "P", revenue: 0, expenses: 0, taskCount: 0, delayedTaskCount: 0, value: null, earnedValue: undefined, percentByValue: null } as unknown as LaunchpadProject;
    expect(rowDataArrived(missing)).toBe(false);
    expect(rowDataArrived(project())).toBe(true);
  });

  test("an explicit null contract value stays null -- never coerced to 0", () => {
    expect(rowContractValue(project({ contractValue: null, value: null }))).toBeNull();
    expect(rowPercentByValue(project({ contractValue: null, earnedValue: null, percentByValue: null }))).toBeNull();
  });

  test("a real zero is kept as a figure", () => {
    expect(rowContractValue(project({ contractValue: 0 }))).toBe(0);
  });

  test("contractValue falls back to the roots-only `value` the same query produced", () => {
    expect(rowContractValue(project({ contractValue: undefined, value: 475000 }))).toBe(475000);
  });

  test("percent by value is derived when the backend did not send it", () => {
    expect(rowPercentByValue(project({ percentByValue: null, contractValue: 200000, earnedValue: 50000 }))).toBe(25);
  });
});

describe("portfolioProgress (the one dominant number)", () => {
  test("sums earned against contract and reports the percentage", () => {
    const p = portfolioProgress([
      project({ id: "a", contractValue: 1_000_000, earnedValue: 250_000, earnedValuePrevWeek: 200_000 }),
      project({ id: "b", contractValue: 1_000_000, earnedValue: 250_000, earnedValuePrevWeek: 250_000 }),
    ]);
    expect(p.contract).toBe(2_000_000);
    expect(p.earned).toBe(500_000);
    expect(p.percent).toBe(25);
    expect(p.percentPrevWeek).toBe(22.5);
    expect(p.deltaPercentagePoints).toBe(2.5);
    expect(p.projectsCounted).toBe(2);
  });

  test("a project with no BOQ is left out of BOTH sides, not counted as 0 of 0", () => {
    const p = portfolioProgress([
      project({ id: "a", contractValue: 1_000_000, earnedValue: 500_000, earnedValuePrevWeek: 500_000 }),
      project({ id: "b", contractValue: null, value: null, earnedValue: null }),
    ]);
    expect(p.projectsCounted).toBe(1);
    expect(p.percent).toBe(50);
  });

  test("no contract value anywhere gives null, never 0% complete", () => {
    const p = portfolioProgress([project({ contractValue: null, value: null, earnedValue: null })]);
    expect(p.percent).toBeNull();
    expect(p.deltaPercentagePoints).toBeNull();
  });

  test("a row with no baseline figure contributes its CURRENT earned value to the baseline, so the delta reads 0 rather than a fabricated gain", () => {
    const p = portfolioProgress([project({ contractValue: 100, earnedValue: 40, earnedValuePrevWeek: undefined })]);
    expect(p.earnedPrevWeek).toBe(40);
    expect(p.deltaPercentagePoints).toBe(0);
  });
});

describe("projectVerdict (R-222: 'on track' has to be true)", () => {
  test("a project with no schedule is never called on track", () => {
    const v = projectVerdict(project({ hasSchedule: false, tasksLate: 0 }));
    expect(v.word).toBe("no schedule set");
    expect(v.needsYou).toBe(false);
  });

  test("a scheduled project with no late tasks is on track", () => {
    expect(projectVerdict(project({ hasSchedule: true, tasksLate: 0 })).word).toBe("on track");
  });

  test("a late task means needs you, schedule or not", () => {
    expect(projectVerdict(project({ hasSchedule: true, tasksLate: 3 })).needsYou).toBe(true);
    expect(projectVerdict(project({ hasSchedule: false, tasksLate: 3 })).needsYou).toBe(true);
  });

  test("spend past the contract value means needs you", () => {
    const v = projectVerdict(project({ hasSchedule: true, contractValue: 100_000, spent: 120_000 }));
    expect(v.needsYou).toBe(true);
    expect(v.word).toBe("needs you");
  });

  test("a row whose data did not arrive makes no claim at all", () => {
    const missing = { id: "p", name: "P", revenue: 0, expenses: 0, taskCount: 0, delayedTaskCount: 0, value: null, percentByValue: null } as unknown as LaunchpadProject;
    expect(projectVerdict(missing).word).toBe("not loaded");
  });

  test("the greeting's two counts only ever cover projects that earned them", () => {
    const rows = [
      project({ id: "a", hasSchedule: true, tasksLate: 0 }),
      project({ id: "b", hasSchedule: true, tasksLate: 2 }),
      project({ id: "c", hasSchedule: false }),
    ];
    expect(onTrackProjects(rows).map((p) => p.id)).toEqual(["a"]);
    expect(needsYouProjects(rows).map((p) => p.id)).toEqual(["b"]);
  });
});

describe("budgetVerdict (a zero target is not an alarm)", () => {
  test("no budget row anywhere reads 'no budget set' and never 'over budget'", () => {
    const v = budgetVerdict([project({ budget: null, spent: 185_000 })]);
    expect(v.budget).toBeNull();
    expect(v.word).toBe("no budget set");
    expect(v.direction).toBe("flat");
    expect(v.spent).toBe(185_000);
  });

  test("spend past a real budget reads over budget", () => {
    const v = budgetVerdict([project({ budget: 100_000, spent: 120_000 })]);
    expect(v.word).toBe("over budget");
    expect(v.tone).toBe("needs-you");
  });

  test("budgets add up across projects and only the projects that have one", () => {
    const v = budgetVerdict([
      project({ id: "a", budget: 100_000, spent: 10_000 }),
      project({ id: "b", budget: null, spent: 5_000 }),
    ]);
    expect(v.budget).toBe(100_000);
    expect(v.spent).toBe(15_000);
    expect(v.word).toBe("within budget");
  });
});
