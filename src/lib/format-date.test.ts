/// <reference types="bun-types" />
// R46 hydration-mismatch root-cause fix: these helpers exist specifically so
// a date renders as the SAME STRING regardless of which runtime (Vercel's
// server, any visitor's browser) produces it. The regression this guards
// against isn't "does toLocaleDateString work" (it always does) -- it's
// "does someone accidentally drop the explicit locale/timeZone args later
// and reintroduce the hydration mismatch". These assertions pin the actual
// output so that regression is a visible, failing test, not a silent
// runtime-dependent flake.
import { describe, expect, test } from "bun:test";
import { formatDate, formatDateNumeric, formatDateTime, formatDayMonthYear, formatTime } from "./format-date";

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

// R67: the two day-first forms the product's own copy uses. Pinned here for
// the same reason as the three above -- an accidental switch to Intl's short
// month would silently turn "02 Sep 2026" into "02 Sept 2026" in every
// sentence that quotes it.
describe("formatDayMonthYear", () => {
  test("renders the three-letter month form the product's sentences use", () => {
    expect(formatDayMonthYear("2026-09-02")).toBe("02 Sep 2026");
    expect(formatDayMonthYear("2026-01-31")).toBe("31 Jan 2026");
  });

  test("is UTC-pinned, so a date-only value never slips a day for a non-UTC visitor", () => {
    expect(formatDayMonthYear("2026-08-25T00:00:00.000Z")).toBe("25 Aug 2026");
  });

  test("an unparseable value is the en-dash, never the string 'Invalid Date'", () => {
    expect(formatDayMonthYear("not-a-date")).toBe("—");
  });
});

describe("formatDateNumeric", () => {
  test("is day-first and zero-padded, unlike formatDate's en-US month-first output", () => {
    expect(formatDateNumeric("2026-08-28")).toBe("28-08-2026");
    expect(formatDate("2026-08-28")).toBe("8/28/2026");
    expect(formatDateNumeric("2026-01-02")).toBe("02-01-2026");
  });

  test("an unparseable value is the en-dash", () => {
    expect(formatDateNumeric("nope")).toBe("—");
  });
});
