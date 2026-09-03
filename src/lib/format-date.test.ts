/// <reference types="bun-types" />
// R46 hydration-mismatch root-cause fix: these helpers exist specifically so
// a date renders as the SAME STRING regardless of which runtime (Vercel's
// server, any visitor's browser) produces it. The regression this guards
// against isn't "does toLocaleDateString work" (it always does) -- it's
// "does someone accidentally drop the explicit locale/timeZone args later
// and reintroduce the hydration mismatch". These assertions pin the actual
// output so that regression is a visible, failing test, not a silent
// runtime-dependent flake.
import { formatDateTimeMedium } from "./format-date";
import { describe, expect, test } from "bun:test";
import { formatDate, formatDateDMY, formatDateTime, formatDateTimeDMY, formatDayMonth, formatHourMinute, formatTime } from "./format-date";

describe("formatDate", () => {
  test("pins en-US/UTC output regardless of process locale/time zone", () => {
    expect(formatDate("2026-08-25T00:00:00.000Z")).toBe("8/25/2026");
  });

  test("does not shift across a UTC day boundary -- the exact bug an unpinned timeZone reintroduces", () => {
    // Midnight UTC: a runtime whose default time zone is behind UTC (e.g.
    // US Pacific, -07:00/-08:00) would render this as the PREVIOUS calendar
    // day if timeZone weren't pinned to "UTC" -- while a runtime ahead of
    // UTC (e.g. IST, +05:30) would still show the 25th. That asymmetry --
    // "some visitors see a different date than the server rendered, some
    // don't" -- is exactly the route/mount-condition-dependent shape this
    // bug class produces in production.
    expect(formatDate("2026-08-25T00:00:00.000Z")).toBe("8/25/2026");
  });

  test("accepts a Date instance and a numeric timestamp, not just an ISO string", () => {
    const iso = "2026-01-01T12:00:00.000Z";
    expect(formatDate(new Date(iso))).toBe(formatDate(iso));
    expect(formatDate(new Date(iso).getTime())).toBe(formatDate(iso));
  });
});

describe("formatDateTime", () => {
  test("pins en-US/UTC output for date+time", () => {
    expect(formatDateTime("2026-08-25T14:30:00.000Z")).toBe("8/25/2026, 2:30:00 PM");
  });
});

describe("formatTime", () => {
  test("pins en-US/UTC output for time-only", () => {
    expect(formatTime("2026-08-25T14:30:00.000Z")).toBe("2:30:00 PM");
  });
});

describe("formatDateTimeMedium (the meeting / MoM shape)", () => {
  test("pins BOTH the locale and the time zone", () => {
    expect(formatDateTimeMedium("2026-08-25T14:30:00.000Z")).toBe("Aug 25, 2026, 2:30 PM");
  });

  test("a timestamp near midnight UTC keeps ONE calendar day, whatever the runtime's zone", () => {
    // This is the half of the bug that pinning the locale alone left behind:
    // 23:30 UTC is the next day in Asia/Dubai, so an unpinned formatter would
    // render a different DATE on the server pass than in the browser.
    expect(formatDateTimeMedium("2026-08-25T23:30:00.000Z")).toBe("Aug 25, 2026, 11:30 PM");
  });

  test("accepts a Date and a numeric timestamp, like its siblings", () => {
    const iso = "2026-08-25T14:30:00.000Z";
    expect(formatDateTimeMedium(new Date(iso))).toBe(formatDateTimeMedium(iso));
    expect(formatDateTimeMedium(new Date(iso).getTime())).toBe(formatDateTimeMedium(iso));
  });
});

describe("formatDayMonth (R67 E-25)", () => {
  test("reads day-then-month, which is what the chart caption says", () => {
    expect(formatDayMonth("2026-08-25")).toBe("25 Aug");
  });

  test("is pinned to UTC, so a late-evening timestamp does not slide to the next day", () => {
    expect(formatDayMonth("2026-08-25T23:30:00.000Z")).toBe("25 Aug");
  });

  test("accepts the same inputs as the other helpers here", () => {
    expect(formatDayMonth(new Date("2026-01-02T00:00:00.000Z"))).toBe("2 Jan");
    expect(formatDayMonth(Date.parse("2026-12-31T12:00:00.000Z"))).toBe("31 Dec");
  });
});

describe("formatHourMinute (R67 E-30)", () => {
  test("is the clock alone, 24-hour and zero-padded -- 'Ran in 2.7 s at 14:02'", () => {
    expect(formatHourMinute("2026-09-03T14:02:37.000Z")).toBe("14:02");
    expect(formatHourMinute("2026-09-03T09:05:00.000Z")).toBe("09:05");
  });

  test("midnight reads 00:00, not 24:00 -- en-US's own h23/h24 trap", () => {
    expect(formatHourMinute("2026-09-03T00:00:00.000Z")).toBe("00:00");
  });

  test("is pinned to UTC like its siblings, so the stamp cannot differ per visitor", () => {
    expect(formatHourMinute(new Date("2026-09-03T23:59:00.000Z"))).toBe("23:59");
    expect(formatHourMinute(Date.parse("2026-09-03T23:59:00.000Z"))).toBe("23:59");
  });
});

describe("formatDateDMY (R67 E-34 / E-31)", () => {
  test("is day-first, zero-padded and hyphenated -- the form the range sentences quote", () => {
    expect(formatDateDMY("2026-09-01")).toBe("01-09-2026");
    expect(formatDateDMY("2026-09-02")).toBe("02-09-2026");
  });

  test("a two-digit day and month are not re-padded into three digits", () => {
    expect(formatDateDMY("2026-12-25")).toBe("25-12-2026");
  });

  test("is pinned to UTC like its siblings, so a late-evening value keeps its own day", () => {
    expect(formatDateDMY("2026-09-01T23:30:00.000Z")).toBe("01-09-2026");
  });

  test("accepts a Date and an epoch, like every other helper here", () => {
    expect(formatDateDMY(new Date("2026-01-02T00:00:00.000Z"))).toBe("02-01-2026");
    expect(formatDateDMY(Date.parse("2026-01-02T00:00:00.000Z"))).toBe("02-01-2026");
  });
});
describe("formatDateTimeDMY (R67 E-39: the tiles' 'as of' stamp)", () => {
  test("day-first date and a 24-hour clock, in that order", () => {
    expect(formatDateTimeDMY("2026-09-03T14:02:00.000Z")).toBe("03-09-2026 14:02");
  });

  test("it is exactly its two parts, so the screen cannot show two date conventions", () => {
    const iso = "2026-01-05T09:07:00.000Z";
    expect(formatDateTimeDMY(iso)).toBe(`${formatDateDMY(iso)} ${formatHourMinute(iso)}`);
  });

  test("midnight is 00:00, never 12:00 AM and never 24:00", () => {
    expect(formatDateTimeDMY("2026-09-03T00:00:00.000Z")).toBe("03-09-2026 00:00");
  });
});
