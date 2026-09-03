/// <reference types="bun-types" />
// R67 E-01 (R-007). The two decisions behind the home dashboard's project
// rows -- who needs the reader's attention, and in what order the rows appear
// -- asserted directly rather than inferred from rendered markup.
import { describe, expect, test } from "bun:test";
import {
  daysBetween,
  needsYouSummary,
  progressBarState,
  projectRowStatus,
  sortProjectRows,
  type DashboardProject,
} from "./dashboard-rows";

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
    percentByActivity: null,
    spendOverValue: false,
    permitsExpiring30d: 0,
    ...overrides,
  };
}

describe("progressBarState", () => {
  test("a real percentage draws a real bar", () => {
    expect(progressBarState(project({ percentByValue: 46 }))).toEqual({ kind: "value", percent: 46 });
  });

  test("no BOQ is a hatched 'No BOQ yet' bar, NOT a 0 % bar", () => {
    // A 0 % bar says "this job has not started". No BOQ says "nobody has told
    // us what the job is". Those are different facts and only one of them is
    // true here.
    expect(progressBarState(project({ percentByValue: null }))).toEqual({ kind: "unknown", label: "No BOQ yet" });
  });

  test("a genuine 0 % still draws a real, empty bar -- distinguishable from no BOQ", () => {
    expect(progressBarState(project({ percentByValue: 0 }))).toEqual({ kind: "value", percent: 0 });
  });

  test("a percentage outside 0-100 is clamped so the bar cannot overrun its track", () => {
    expect(progressBarState(project({ percentByValue: 140 }))).toEqual({ kind: "value", percent: 100 });
    expect(progressBarState(project({ percentByValue: -5 }))).toEqual({ kind: "value", percent: 0 });
  });
});

describe("projectRowStatus", () => {
  test("nothing wrong reads 'on track'", () => {
    const status = projectRowStatus(project());
    expect(status.label).toBe("on track");
    expect(status.needsYou).toBe(false);
    expect(status.reasons).toEqual([]);
  });

  test("spend over the contract value reads 'needs you', and says why", () => {
    const status = projectRowStatus(project({ spendOverValue: true }));
    expect(status.label).toBe("needs you");
    expect(status.reasons).toEqual(["spend over contract value"]);
  });

  test("an expiring permit reads 'needs you', counted and pluralised", () => {
    expect(projectRowStatus(project({ permitsExpiring30d: 1 })).reasons).toEqual(["1 permit expiring in 30 days"]);
    expect(projectRowStatus(project({ permitsExpiring30d: 3 })).reasons).toEqual(["3 permits expiring in 30 days"]);
  });

  test("both reasons are listed, not just the first", () => {
    const status = projectRowStatus(project({ spendOverValue: true, permitsExpiring30d: 2 }));
    expect(status.reasons).toEqual(["spend over contract value", "2 permits expiring in 30 days"]);
  });

  test("a REDACTED spend figure contributes nothing in either direction", () => {
    // The org dashboard route nulls spendOverValue for a non-manager alongside
    // revenue/expenses. Reading that null as "spend is fine" would state a
    // conclusion drawn from a number the reader was not allowed to see.
    const status = projectRowStatus(project({ spendOverValue: null, permitsExpiring30d: 1 }));
    expect(status.reasons).toEqual(["1 permit expiring in 30 days"]);
  });

  test("a payload from an older backend, with neither field present, is 'on track' rather than a crash", () => {
    const status = projectRowStatus({
      id: "p9", name: "Legacy", revenue: 0, expenses: 0, taskCount: 0, delayedTaskCount: 0,
      value: null, earnedValue: null, percentByValue: null,
    });
    expect(status.label).toBe("on track");
  });
});

describe("sortProjectRows", () => {
  const onTrackA = project({ id: "a", name: "A" });
  const needsB = project({ id: "b", name: "B", spendOverValue: true });
  const onTrackC = project({ id: "c", name: "C" });
  const needsD = project({ id: "d", name: "D", permitsExpiring30d: 4 });

  test("needs-you rows come first", () => {
    expect(sortProjectRows([onTrackA, needsB, onTrackC, needsD]).map((p) => p.id)).toEqual(["b", "d", "a", "c"]);
  });

  test("within each group the payload's own order is preserved -- a row never moves because a number moved", () => {
    expect(sortProjectRows([onTrackC, onTrackA]).map((p) => p.id)).toEqual(["c", "a"]);
  });

  test("the caller's array is not mutated", () => {
    const input = [onTrackA, needsB];
    sortProjectRows(input);
    expect(input.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("needsYouSummary", () => {
  test("nothing to say returns null rather than an empty sentence", () => {
    expect(needsYouSummary([project()])).toBeNull();
  });

  // R67 E-19 (R-180): the sentence now carries the leading REASON as well as
  // the name. Being told WHICH project needs you still leaves you opening it to
  // find out why; being told why lets you decide whether it can wait.
  test("one flagged project is NAMED, and the sentence says why -- never 'a project needs attention'", () => {
    expect(needsYouSummary([project({ name: "Cedar Heights Villa - Phase 1", spendOverValue: true })]))
      .toBe("Cedar Heights Villa - Phase 1 needs you — spend over contract value.");
  });

  test("several flagged projects still name the first, and count the rest", () => {
    expect(
      needsYouSummary([
        project({ id: "a", name: "Cedar Heights Villa - Phase 1", spendOverValue: true }),
        project({ id: "b", name: "Marina Tower", permitsExpiring30d: 1 }),
        project({ id: "c", name: "Souk Retrofit", permitsExpiring30d: 2 }),
      ])
    ).toBe("Cedar Heights Villa - Phase 1 and 2 other projects need you — spend over contract value.");
  });

  test("exactly two flagged projects read as one 'other project', singular", () => {
    expect(
      needsYouSummary([
        project({ id: "a", name: "Cedar Heights Villa - Phase 1", spendOverValue: true }),
        project({ id: "b", name: "Marina Tower", permitsExpiring30d: 1 }),
      ])
    ).toBe("Cedar Heights Villa - Phase 1 and 1 other project need you — spend over contract value.");
  });

  test("the stall signal names the project and the number of days", () => {
    expect(
      needsYouSummary([project({ name: "Marina Tower", lastProgressAt: "2026-07-15" })], "2026-09-03")
    ).toBe("Marina Tower needs you — no progress recorded for 50 days.");
  });
});

// ---------------------------------------------------------------------------
// R67 E-19 (R-180): the THIRD signal -- "earned value stalled 30 days"
// ---------------------------------------------------------------------------
describe("the stall signal (R67 E-19)", () => {
  test("thirty days is the threshold, and it is inclusive", () => {
    // 29 days is not yet a month of silence; 30 is.
    expect(projectRowStatus(project({ lastProgressAt: "2026-08-05" }), "2026-09-03").reasons).toEqual([]);
    expect(projectRowStatus(project({ lastProgressAt: "2026-08-04" }), "2026-09-03").reasons).toEqual([
      "no progress recorded for 30 days",
    ]);
  });

  test("NOTHING ever recorded is not 'stalled' -- a project created last week has not stalled", () => {
    // null is a different fact from an old date, and with no start date on the
    // payload there is no honest number of days to put in the sentence.
    expect(projectRowStatus(project({ lastProgressAt: null }), "2026-09-03").reasons).toEqual([]);
    expect(projectRowStatus(project({ lastProgressAt: undefined }), "2026-09-03").reasons).toEqual([]);
  });

  test("with no `today` in hand the signal is simply not evaluated, never guessed", () => {
    expect(projectRowStatus(project({ lastProgressAt: "2020-01-01" })).reasons).toEqual([]);
  });

  test("daysBetween counts calendar days across a month and a year boundary", () => {
    expect(daysBetween("2026-08-04", "2026-09-03")).toBe(30);
    expect(daysBetween("2025-12-25", "2026-01-05")).toBe(11);
    // A leap February, because 2028 has one and an off-by-one here would be a
    // day's worth of wrong in every sentence this feeds.
    expect(daysBetween("2028-02-01", "2028-03-01")).toBe(29);
    expect(daysBetween(null, "2026-09-03")).toBeNull();
    expect(daysBetween("not a date", "2026-09-03")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R67 E-19 (R-180): spend past the BUDGET, beside spend past the contract value
// ---------------------------------------------------------------------------
describe("the budget signal (R67 E-19)", () => {
  test("spend past the BOQ budget reads 'needs you', and says so in those words", () => {
    expect(projectRowStatus(project({ expenses: 900, budget: 800 })).reasons).toEqual(["spend over budget"]);
  });

  test("spend equal to the budget is not over it", () => {
    expect(projectRowStatus(project({ expenses: 800, budget: 800 })).reasons).toEqual([]);
  });

  test("a project with no budget is not 'over' it -- absent is not zero", () => {
    expect(projectRowStatus(project({ expenses: 900, budget: null })).reasons).toEqual([]);
    expect(projectRowStatus(project({ expenses: 900 })).reasons).toEqual([]);
  });

  test("a REDACTED reader, whose spend and budget are both null, gets no conclusion either way", () => {
    expect(projectRowStatus(project({ expenses: null, budget: null, spendOverValue: null })).reasons).toEqual([]);
  });

  test("delayed tasks are counted and pluralised, and come last -- money first", () => {
    const status = projectRowStatus(project({ expenses: 900, budget: 800, delayedTaskCount: 2 }));
    expect(status.reasons).toEqual(["spend over budget", "2 delayed tasks"]);
    expect(projectRowStatus(project({ delayedTaskCount: 1 })).reasons).toEqual(["1 delayed task"]);
  });
});
