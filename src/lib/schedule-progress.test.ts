/// <reference types="bun-types" />
// R67 D-44 / D-45. The Timeline's arithmetic, tested directly.
//
// D-45's own acceptance is a Playwright walk ("expect that row's Slip cell text
// to be exactly '+3 d late' and the 'Schedule progress' tile to contain the
// text 'days behind'"). This session may not start a dev server, so the two
// strings it names are asserted here against the functions that produce them,
// and again in ScheduleGanttClient.test.tsx against the rendered DOM.
import { describe, expect, test } from "bun:test";
import {
  EMPTY_SCHEDULE_CELL,
  NO_BASELINE_NOTE,
  barGeometry,
  daysBetween,
  durationDays,
  formatDurationDays,
  formatScheduleProgress,
  formatSlip,
  plannedPercentComplete,
  scheduleWindow,
  slipDays,
  summariseScheduleProgress,
  toUtcMs,
  type BaselineWindow,
} from "./schedule-progress";

describe("date primitives", () => {
  test("toUtcMs parses a date-only string at UTC midnight", () => {
    expect(toUtcMs("2026-09-02")).toBe(Date.UTC(2026, 8, 2));
    expect(toUtcMs("2026-09-02T18:30:00Z")).toBe(Date.UTC(2026, 8, 2));
  });

  test("toUtcMs returns null for absent and unparseable values", () => {
    expect(toUtcMs(null)).toBeNull();
    expect(toUtcMs(undefined)).toBeNull();
    expect(toUtcMs("")).toBeNull();
    expect(toUtcMs("not-a-date")).toBeNull();
  });

  test("daysBetween counts whole days and is null when either side is missing", () => {
    expect(daysBetween("2026-09-02", "2026-09-05")).toBe(3);
    expect(daysBetween("2026-09-05", "2026-09-02")).toBe(-3);
    expect(daysBetween("2026-09-02", "2026-09-02")).toBe(0);
    expect(daysBetween(null, "2026-09-02")).toBeNull();
    expect(daysBetween("2026-09-02", null)).toBeNull();
  });

  test("daysBetween crosses a DST boundary without drifting a day", () => {
    // Europe/London springs forward on 2026-03-29. A local-time subtraction
    // would give 30.958… days here and round to 31.
    expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31);
  });
});

describe("durationDays / formatDurationDays (D-44)", () => {
  test("is due minus start", () => {
    expect(durationDays("2026-08-01", "2026-08-05")).toBe(4);
  });

  test("a same-day activity has duration 0, which is not the same as unknown", () => {
    expect(durationDays("2026-08-01", "2026-08-01")).toBe(0);
    expect(formatDurationDays(0)).toBe("0 d");
    expect(formatDurationDays(null)).toBe(EMPTY_SCHEDULE_CELL);
  });

  test("either date unset renders the en-dash", () => {
    expect(durationDays(null, "2026-08-05")).toBeNull();
    expect(durationDays("2026-08-01", null)).toBeNull();
  });
});

describe("slipDays / formatSlip (D-45)", () => {
  test("a due date three days after the planned one is '+3 d late'", () => {
    const slip = slipDays("2026-09-05", "2026-09-02");
    expect(slip).toBe(3);
    expect(formatSlip(slip).text).toBe("+3 d late");
    expect(formatSlip(slip).glyph).toBe("▲");
    expect(formatSlip(slip).tone).toBe("late");
  });

  test("finishing early reads as '2 d early'", () => {
    const slip = slipDays("2026-08-31", "2026-09-02");
    expect(slip).toBe(-2);
    expect(formatSlip(slip).text).toBe("2 d early");
    expect(formatSlip(slip).tone).toBe("early");
  });

  test("zero slip and no baseline are different facts", () => {
    expect(formatSlip(0).text).toBe("0 d on time");
    expect(formatSlip(null).text).toBe(EMPTY_SCHEDULE_CELL);
    expect(formatSlip(null).glyph).toBe("");
  });

  test("a missing planned due date yields null, never 0", () => {
    expect(slipDays("2026-09-05", null)).toBeNull();
    expect(slipDays(null, "2026-09-02")).toBeNull();
  });
});

describe("plannedPercentComplete", () => {
  test("is the elapsed fraction of the baseline window", () => {
    // 2026-08-01 -> 2026-09-30 is 60 days; 2026-09-02 is day 32.
    expect(plannedPercentComplete("2026-08-01", "2026-09-30", "2026-09-02")).toBe(53);
  });

  test("clamps outside the window and returns a real 0 before it starts", () => {
    expect(plannedPercentComplete("2026-08-01", "2026-09-30", "2026-07-01")).toBe(0);
    expect(plannedPercentComplete("2026-08-01", "2026-09-30", "2026-12-01")).toBe(100);
  });

  test("a zero-length window is all-or-nothing, never a division", () => {
    expect(plannedPercentComplete("2026-09-02", "2026-09-02", "2026-09-01")).toBe(0);
    expect(plannedPercentComplete("2026-09-02", "2026-09-02", "2026-09-02")).toBe(100);
  });

  test("a missing baseline date is null", () => {
    expect(plannedPercentComplete(null, "2026-09-30", "2026-09-02")).toBeNull();
    expect(plannedPercentComplete("2026-08-01", null, "2026-09-02")).toBeNull();
  });
});

describe("summariseScheduleProgress / formatScheduleProgress", () => {
  const activities = [
    { id: "a", startDate: "2026-08-01", dueDate: "2026-09-05", completionPercentage: 40 },
    { id: "b", startDate: "2026-08-01", dueDate: "2026-09-30", completionPercentage: 44 },
  ];
  const baseline = new Map<string, BaselineWindow>([
    ["a", { plannedStartDate: "2026-08-01", plannedDueDate: "2026-09-01" }],
    ["b", { plannedStartDate: "2026-08-01", plannedDueDate: "2026-09-30" }],
  ]);

  test("actual is the mean completion, planned the mean baseline elapse, slip the worst", () => {
    const progress = summariseScheduleProgress(activities, baseline, "2026-09-02");
    expect(progress.actualPercent).toBe(42);
    // a: 2026-08-01 -> 2026-09-01 on 2026-09-02 = 100; b = 53. Mean = 77 (rounded).
    expect(progress.plannedPercent).toBe(77);
    // a slipped 4 days, b slipped 0 -> the worst is 4, not the mean of 2.
    expect(progress.worstSlipDays).toBe(4);
    expect(progress.comparedCount).toBe(2);
  });

  test("the tile sentence carries all three numbers and the words 'days behind'", () => {
    const progress = summariseScheduleProgress(activities, baseline, "2026-09-02");
    const sentence = formatScheduleProgress(progress);
    expect(sentence).toBe("42 % complete — planned 77 % — 4 days behind");
    expect(sentence).toContain("days behind");
  });

  test("with no baseline, planned and slip are the en-dash but actual is still real", () => {
    const progress = summariseScheduleProgress(activities, new Map(), "2026-09-02");
    expect(progress.actualPercent).toBe(42);
    expect(progress.plannedPercent).toBeNull();
    expect(progress.worstSlipDays).toBeNull();
    expect(formatScheduleProgress(progress)).toBe(`42 % complete — planned ${EMPTY_SCHEDULE_CELL} — ${EMPTY_SCHEDULE_CELL}`);
    expect(NO_BASELINE_NOTE).toBe("No baseline recorded yet — record one to track slip");
  });

  test("0 % renders as '0 %', not as the en-dash", () => {
    const progress = summariseScheduleProgress(
      [{ id: "a", startDate: null, dueDate: null, completionPercentage: 0 }],
      new Map(),
      "2026-09-02"
    );
    expect(formatScheduleProgress(progress).startsWith("0 % complete")).toBe(true);
  });

  test("an early programme says 'ahead', an on-time one says 'on schedule'", () => {
    const early = summariseScheduleProgress(
      [{ id: "a", startDate: "2026-08-01", dueDate: "2026-08-29", completionPercentage: 50 }],
      new Map([["a", { plannedStartDate: "2026-08-01", plannedDueDate: "2026-09-01" }]]),
      "2026-09-02"
    );
    expect(formatScheduleProgress(early)).toContain("3 days ahead");

    const onTime = summariseScheduleProgress(
      [{ id: "a", startDate: "2026-09-01", dueDate: "2026-09-01", completionPercentage: 50 }],
      new Map([["a", { plannedStartDate: "2026-08-01", plannedDueDate: "2026-09-01" }]]),
      "2026-09-02"
    );
    expect(formatScheduleProgress(onTime)).toContain("on schedule");
  });

  test("no activities at all leaves every figure null", () => {
    const progress = summariseScheduleProgress([], new Map(), "2026-09-02");
    expect(progress.actualPercent).toBeNull();
    expect(progress.comparedCount).toBe(0);
  });
});

describe("barGeometry / scheduleWindow", () => {
  test("places a span inside the window as percentages", () => {
    const geo = barGeometry("2026-08-11", "2026-08-21", "2026-08-01", "2026-08-31");
    expect(geo).not.toBeNull();
    expect(Math.round(geo!.offsetPercent)).toBe(33);
    expect(Math.round(geo!.widthPercent)).toBe(33);
  });

  test("clamps a span that runs outside the window and never exceeds 100 %", () => {
    const geo = barGeometry("2026-07-01", "2026-12-01", "2026-08-01", "2026-08-31")!;
    expect(geo.offsetPercent).toBe(0);
    expect(geo.widthPercent).toBe(100);
  });

  test("a zero-length span is still visible rather than a 0-width invisible bar", () => {
    const geo = barGeometry("2026-08-16", "2026-08-16", "2026-08-01", "2026-08-31")!;
    expect(geo.widthPercent).toBeGreaterThan(0);
  });

  test("returns null when any date is missing", () => {
    expect(barGeometry(null, "2026-08-21", "2026-08-01", "2026-08-31")).toBeNull();
    expect(barGeometry("2026-08-11", "2026-08-21", null, "2026-08-31")).toBeNull();
  });

  test("scheduleWindow spans both the actual and the baseline dates", () => {
    const window = scheduleWindow(
      [{ id: "a", startDate: "2026-08-10", dueDate: "2026-08-20", completionPercentage: 0 }],
      new Map([["a", { plannedStartDate: "2026-08-01", plannedDueDate: "2026-09-30" }]])
    );
    expect(window.start).toBe("2026-08-01");
    expect(window.end).toBe("2026-09-30");
  });

  test("scheduleWindow is null/null when nothing has a date", () => {
    const window = scheduleWindow([{ id: "a", startDate: null, dueDate: null, completionPercentage: 0 }], new Map());
    expect(window.start).toBeNull();
    expect(window.end).toBeNull();
  });
});
