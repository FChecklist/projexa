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
// R67 D-74/G-05 reconciliation: the org helpers used to return their own
// em-dash literal while format-number.ts/format-money.ts returned an EN-dash,
// so one screen could show two different "no value" marks depending on which
// helper wrote the cell. There is one mark now, and it is asserted through the
// constant rather than re-typed, so the two cannot drift apart again.
import { EMPTY_VALUE } from "./format-number";
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ORG_DATE_FORMAT,
  DEFAULT_ORG_LOCALE,
  DEFAULT_ORG_TIME_ZONE,
  formatDate,
  formatDateNumeric,
  formatDateOrg,
  formatDateTime,
  formatDateTimeOrg,
  // R67 D-23 / D-28: the BOQ list's "28 Aug 2026" and the work-progress
  // row's numeric "25-08-2026" are two named helpers, not two inline
  // toLocaleDateString() calls, so both stay pinned here.
  formatDayMonthYear,
  formatDayMonthYearNumeric,
  formatOrgDate,
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

describe("formatDayMonthYear (R67 D-23)", () => {
  test("renders the BOQ list's unambiguous day-month-year form", () => {
    expect(formatDayMonthYear("2026-08-28T00:00:00.000Z")).toBe("28 Aug 2026");
  });

  test("is zero-padded, so a column of dates stays aligned", () => {
    expect(formatDayMonthYear("2026-01-05T00:00:00.000Z")).toBe("05 Jan 2026");
  });

  test("does not shift across a UTC day boundary", () => {
    expect(formatDayMonthYear(new Date("2026-08-28T00:00:00.000Z"))).toBe("28 Aug 2026");
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
    expect(formatDateTimeOrg(null)).toBe(EMPTY_VALUE);
    expect(formatDateTimeOrg(undefined)).toBe(EMPTY_VALUE);
    expect(formatDateTimeOrg("")).toBe(EMPTY_VALUE);
    expect(formatDateTimeOrg("not a date")).toBe(EMPTY_VALUE);
  });

  test("is deterministic for a fixed (locale, timeZone) pair -- the property that keeps it hydration-safe", () => {
    const iso = "2026-01-01T12:00:00.000Z";
    expect(formatDateTimeOrg(new Date(iso))).toBe(formatDateTimeOrg(iso));
    expect(formatDateTimeOrg(new Date(iso).getTime())).toBe(formatDateTimeOrg(iso));
  });
});

// R67 D-46's own acceptance criterion, plus the guarantee it attaches to it:
// "the existing en-US assertions still hold" -- which they do, above,
// untouched. Two rules coexist here: the pinned pair keeps every render
// hydration-safe, and the org pattern is what a UAE or Indian org actually
// reads.
describe("formatOrgDate", () => {
  test("formatOrgDate('2026-10-15', 'dd-MM-yyyy') === '15-10-2026'", () => {
    expect(formatOrgDate("2026-10-15", "dd-MM-yyyy")).toBe("15-10-2026");
  });

  test("the default pattern is the org's, so a caller with no setting yet still gets the right form", () => {
    expect(DEFAULT_ORG_DATE_FORMAT).toBe("dd-MM-yyyy");
    expect(formatOrgDate("2026-10-15")).toBe("15-10-2026");
  });

  test("the other supported patterns render the same day", () => {
    expect(formatOrgDate("2026-10-15", "dd/MM/yyyy")).toBe("15/10/2026");
    expect(formatOrgDate("2026-10-15", "yyyy-MM-dd")).toBe("2026-10-15");
    expect(formatOrgDate("2026-10-15", "MM/dd/yyyy")).toBe("10/15/2026");
  });

  test("an unrecognised pattern falls back to the default -- it never prints the pattern itself", () => {
    expect(formatOrgDate("2026-10-15", "the fifteenth")).toBe("15-10-2026");
  });

  test("a timestamp resolves to the calendar day in the ORG's zone, so a date-only value and a stored instant agree", () => {
    expect(formatOrgDate("2026-10-15T21:00:00.000Z", "dd-MM-yyyy")).toBe("16-10-2026");
    expect(formatOrgDate("2026-10-15T21:00:00.000Z", "dd-MM-yyyy", "UTC")).toBe("15-10-2026");
  });

  test("an absent or unparseable value renders an en-dash", () => {
    expect(formatOrgDate(null)).toBe(EMPTY_VALUE);
    expect(formatOrgDate("not a date")).toBe(EMPTY_VALUE);
  });
});

describe("formatDateOrg", () => {
  test("is the date half of the same form", () => {
    expect(formatDateOrg("2026-08-28T06:00:00.000Z")).toBe("28 Aug 2026");
  });

  test("shares the en-dash rule", () => {
    expect(formatDateOrg(null)).toBe(EMPTY_VALUE);
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

// R67: the two day-first forms the product's own copy uses. Pinned here for
// the same reason as the three above -- an accidental switch to Intl's short
// month would silently turn "02 Sep 2026" into "02 Sept 2026" in every
// sentence that quotes it.
//
// That is not hypothetical: the D3 x D21 merge left TWO implementations of
// formatDayMonthYear in format-date.ts, and the Intl-based one really did
// return "02 Sept 2026" and the literal "Invalid Date". These assertions are
// what identified which implementation had to survive. Do not relax them.
describe("formatDayMonthYear", () => {
  test("renders the three-letter month form the product's sentences use", () => {
    expect(formatDayMonthYear("2026-09-02")).toBe("02 Sep 2026");
    expect(formatDayMonthYear("2026-01-31")).toBe("31 Jan 2026");
  });

  test("is UTC-pinned, so a date-only value never slips a day for a non-UTC visitor", () => {
    expect(formatDayMonthYear("2026-08-25T00:00:00.000Z")).toBe("25 Aug 2026");
  });

  test("an unparseable value is the en-dash, never the string 'Invalid Date'", () => {
    expect(formatDayMonthYear("not-a-date")).toBe(EMPTY_VALUE);
  });
});

describe("formatDateNumeric", () => {
  test("is day-first and zero-padded, unlike formatDate's en-US month-first output", () => {
    expect(formatDateNumeric("2026-08-28")).toBe("28-08-2026");
    expect(formatDate("2026-08-28")).toBe("8/28/2026");
    expect(formatDateNumeric("2026-01-02")).toBe("02-01-2026");
  });

  test("an unparseable value is the en-dash", () => {
    expect(formatDateNumeric("nope")).toBe(EMPTY_VALUE);
  });
});

// Lane D21's equivalent numeric helper. It and formatDateNumeric above render
// the same string by different means and both keep their own call sites -- see
// the "KNOWN DUPLICATION" note in format-date.ts. Both suites are kept.
describe("formatDayMonthYearNumeric (R67 D-28)", () => {
  test("renders Work Progress's numeric day-first form", () => {
    expect(formatDayMonthYearNumeric("2026-08-25T00:00:00.000Z")).toBe("25-08-2026");
  });

  test("zero-pads both day and month, so a column of dates stays aligned", () => {
    expect(formatDayMonthYearNumeric("2026-01-05T00:00:00.000Z")).toBe("05-01-2026");
  });

  test("accepts a plain date-only string, which is what entryDate actually is", () => {
    expect(formatDayMonthYearNumeric("2026-12-31")).toBe("31-12-2026");
  });

  test("uses hyphens, never a locale's own separator -- the string is fixed, not formatted by the runtime", () => {
    expect(formatDayMonthYearNumeric("2026-08-25")).not.toContain("/");
  });
});
