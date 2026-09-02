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
import {
  DEFAULT_ORG_LOCALE,
  DEFAULT_ORG_TIME_ZONE,
  formatDate,
  formatDateOrg,
  formatDateTime,
  formatDateTimeOrg,
  formatTime,
} from "./format-date";

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

// R67 D-16. The org-facing formatter. These assertions pin the exact string
// the MoM list is specified to show; the en-US/UTC assertions above are
// deliberately left untouched, because the two rules coexist -- the pinned
// pair is what makes BOTH hydration-safe.
describe("formatDateTimeOrg", () => {
  test("renders the org's own form -- '28 Aug 2026, 10:00', no seconds, 24-hour", () => {
    // 06:00Z is 10:00 in Asia/Dubai (+04:00).
    expect(formatDateTimeOrg("2026-08-28T06:00:00.000Z")).toBe("28 Aug 2026, 10:00");
  });

  test("the defaults are the org's, not the runtime's", () => {
    expect(DEFAULT_ORG_LOCALE).toBe("en-GB");
    expect(DEFAULT_ORG_TIME_ZONE).toBe("Asia/Dubai");
    expect(formatDateTimeOrg("2026-08-28T06:00:00.000Z", DEFAULT_ORG_LOCALE, DEFAULT_ORG_TIME_ZONE)).toBe(
      formatDateTimeOrg("2026-08-28T06:00:00.000Z")
    );
  });

  test("the time zone is honoured, not ignored -- the same instant reads differently in a different org zone", () => {
    expect(formatDateTimeOrg("2026-08-28T06:00:00.000Z", "en-GB", "UTC")).toBe("28 Aug 2026, 06:00");
    expect(formatDateTimeOrg("2026-08-28T06:00:00.000Z", "en-GB", "Asia/Kolkata")).toBe("28 Aug 2026, 11:30");
  });

  test("never prints a 12-hour clock or a seconds field, whatever the value", () => {
    const rendered = formatDateTimeOrg("2026-08-28T19:05:09.000Z");
    expect(rendered).toBe("28 Aug 2026, 23:05");
    expect(rendered).not.toContain("PM");
    expect(rendered).not.toContain(":09");
  });

  test("an absent or unparseable value renders an en-dash, never the string 'Invalid Date'", () => {
    expect(formatDateTimeOrg(null)).toBe("—");
    expect(formatDateTimeOrg(undefined)).toBe("—");
    expect(formatDateTimeOrg("")).toBe("—");
    expect(formatDateTimeOrg("not a date")).toBe("—");
  });

  test("is deterministic for a fixed (locale, timeZone) pair -- the property that keeps it hydration-safe", () => {
    const iso = "2026-01-01T12:00:00.000Z";
    expect(formatDateTimeOrg(new Date(iso))).toBe(formatDateTimeOrg(iso));
    expect(formatDateTimeOrg(new Date(iso).getTime())).toBe(formatDateTimeOrg(iso));
  });
});

describe("formatDateOrg", () => {
  test("is the date half of the same form", () => {
    expect(formatDateOrg("2026-08-28T06:00:00.000Z")).toBe("28 Aug 2026");
  });

  test("shares the en-dash rule", () => {
    expect(formatDateOrg(null)).toBe("—");
  });
});
