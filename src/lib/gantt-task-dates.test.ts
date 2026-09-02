/// <reference types="bun-types" />
// R52 -- re-runnable oracle for fault F_018 ("Timeline view shows fabricated
// Start/Due dates that do not match the real scheduling data").
//
// The fault's own recorded ground truth is the fixture here: all three tasks
// on Cedar Heights Villa - Phase 1 have startDate = null and
// dueDate = 2026-10-15, verified by the auditor against both
// GET /api/schedule/gantt and a direct SQL read of compliance.pms_issues.
// The Timeline rendered Start = 25-08-2026 (that day) and Due = 26-08-2026
// (the next day) for every one of them.
//
// These assertions fail if either lie is ever reintroduced.
import { describe, expect, test } from "bun:test";
import { displayScheduleDate, EMPTY_DATE_CELL, toGanttDateFields } from "./gantt-task-dates";

// The exact values F_018 recorded.
const REAL_DUE = "2026-10-15";
const NO_START = null;

describe("F_018 -- the Timeline never invents a date", () => {
  test("a null startDate does not become today", () => {
    const fields = toGanttDateFields(NO_START, REAL_DUE);
    expect(fields.start).toBeUndefined();
    expect(fields.unscheduled).toBe(true);
  });

  test("a real dueDate survives -- it is not recomputed into start+1 day", () => {
    // This is the specific SVAR behaviour the old code tripped: given `start`
    // AND `duration`, gantt-store's normaliser (function Oe) overwrites `end`
    // with start + duration. Sending a duration alongside a real end date is
    // therefore never correct.
    const fields = toGanttDateFields(NO_START, REAL_DUE);
    expect(fields.duration).toBeUndefined();
    expect(fields.end?.toISOString()).toBe(new Date(REAL_DUE).toISOString());
  });

  test("the Start cell renders an em-dash for an unset start, not a plausible date", () => {
    expect(displayScheduleDate(NO_START)).toBe(EMPTY_DATE_CELL);
  });

  test("the Due cell renders the REAL due date, ~7 weeks out -- not tomorrow", () => {
    // R67 D-74: this read "10/15/2026" while it went through format-date.ts's
    // en-US formatter. The DAY is what F_018 is about and it is unchanged;
    // the FORM is now the org's, the same one /moms, /scope, /materials,
    // /labour and the timesheet render.
    expect(displayScheduleDate(REAL_DUE)).toBe("15-10-2026");
  });

  test("both dates real: both are handed over verbatim, with no duration to override them", () => {
    const fields = toGanttDateFields("2026-09-01", REAL_DUE);
    expect(fields.start?.toISOString()).toBe(new Date("2026-09-01").toISOString());
    expect(fields.end?.toISOString()).toBe(new Date(REAL_DUE).toISOString());
    expect(fields.duration).toBeUndefined();
    expect(fields.unscheduled).toBeUndefined();
  });

  test("a real start with no end is the ONE case that may carry a duration", () => {
    const fields = toGanttDateFields("2026-09-01", null);
    expect(fields.start?.toISOString()).toBe(new Date("2026-09-01").toISOString());
    expect(fields.end).toBeUndefined();
    expect(fields.duration).toBe(1);
  });

  test("neither date known: nothing is asserted about either", () => {
    const fields = toGanttDateFields(null, null);
    expect(fields.start).toBeUndefined();
    expect(fields.end).toBeUndefined();
    expect(fields.duration).toBeUndefined();
    expect(fields.unscheduled).toBe(true);
    expect(displayScheduleDate(null)).toBe(EMPTY_DATE_CELL);
  });

  test("no mapping ever returns a date derived from the current clock", () => {
    // The blunt version of the whole fault: run every input shape and assert
    // that nothing that came back is "now". A `new Date()` placeholder
    // reintroduced anywhere in toGanttDateFields fails this.
    const before = Date.now();
    const shapes = [
      toGanttDateFields(null, null),
      toGanttDateFields(null, REAL_DUE),
      toGanttDateFields("2026-09-01", null),
      toGanttDateFields("2026-09-01", REAL_DUE),
    ];
    const after = Date.now();
    for (const f of shapes) {
      for (const d of [f.start, f.end]) {
        if (!d) continue;
        const t = d.getTime();
        expect(t >= before && t <= after).toBe(false);
      }
    }
  });
});
