/// <reference types="bun-types" />
// R67 F-25 -- the attendance query's date arithmetic.
//
// Every assertion here is about a mistake that is invisible on screen: a day
// off by one, a month or year boundary walked wrongly, or a UTC conversion that
// shows a foreman yesterday's roster at 01:00 local.
import { describe, expect, test } from "bun:test";
import { EARLIER_DAYS, attendanceQuery, localDay, shiftDay } from "./attendance-query";

describe("localDay", () => {
  test("is the reader's own calendar day, not the UTC one", () => {
    // 2026-09-02T22:30 local. toISOString() would push this into 2026-09-03 for
    // anyone west of UTC and back into 2026-09-02 for anyone east -- the whole
    // reason this helper exists instead of a .toISOString().slice(0, 10).
    const late = new Date(2026, 8, 2, 22, 30, 0);
    expect(localDay(late)).toBe("2026-09-02");
    const early = new Date(2026, 8, 2, 1, 0, 0);
    expect(localDay(early)).toBe("2026-09-02");
  });

  test("pads month and day to two digits", () => {
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("shiftDay", () => {
  test("walks backwards across a month boundary", () => {
    expect(shiftDay("2026-09-02", -6)).toBe("2026-08-27");
  });

  test("walks backwards across a year boundary", () => {
    expect(shiftDay("2026-01-02", -3)).toBe("2025-12-30");
  });

  test("handles a leap day rather than skipping it", () => {
    expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29");
  });

  test("an unparseable day is returned unchanged instead of becoming NaN-NaN-NaN", () => {
    expect(shiftDay("not-a-day", -1)).toBe("not-a-day");
  });
});

describe("attendanceQuery", () => {
  test("one day is an equality, so the upstream index on (project_id, attendance_date) applies directly", () => {
    expect(attendanceQuery("p1", "2026-09-02", false)).toBe("/api/attendance?projectId=p1&date=2026-09-02");
  });

  test("'Show earlier days' is an inclusive window ENDING on the chosen day", () => {
    expect(attendanceQuery("p1", "2026-09-02", true)).toBe(
      "/api/attendance?projectId=p1&from=2026-08-27&to=2026-09-02"
    );
  });

  test("the window is EARLIER_DAYS long counting the chosen day itself, never one more", () => {
    const url = new URL(attendanceQuery("p1", "2026-09-10", true), "https://example.test");
    const from = new Date(`${url.searchParams.get("from")}T00:00:00`);
    const to = new Date(`${url.searchParams.get("to")}T00:00:00`);
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    expect(days).toBe(EARLIER_DAYS);
  });

  test("the project id is encoded, never concatenated raw into the URL", () => {
    expect(attendanceQuery("a&b=c", "2026-09-02", false)).toContain("projectId=a%26b%3Dc");
  });
});
