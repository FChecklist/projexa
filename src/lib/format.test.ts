/// <reference types="bun-types" />
// R67 D-74 -- the one date/time/money form, asserted.
//
// The three things that made R-284 a finding rather than a preference:
// a UAE org reading American dates, money written three ways on one module,
// and a meeting typed at 10:30 stored as 10:30 UTC and shown back as 14:30.
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ORG_TIME_ZONE,
  EMPTY_CELL,
  formatClock,
  formatDate,
  formatDateTime,
  formatMoney,
  toLocalInputValue,
  toOrgInstant,
  zoneOffsetMinutes,
} from "./format";

describe("formatDate", () => {
  test("the org's own order -- D-74's acceptance case exactly", () => {
    expect(formatDate("2026-09-02T00:00:00Z", { tz: "Asia/Dubai" })).toBe("02-09-2026");
  });

  test("the calendar day is resolved in the org's zone, not the runtime's", () => {
    // 21:30 UTC on the 2nd is already 01:30 on the 3rd in Dubai. A cell that
    // resolved this in UTC would name the wrong day for every evening entry.
    expect(formatDate("2026-09-02T21:30:00Z", { tz: "Asia/Dubai" })).toBe("03-09-2026");
    expect(formatDate("2026-09-02T21:30:00Z", { tz: "UTC" })).toBe("02-09-2026");
  });

  test("the default zone is the org's, so a caller with no settings still gets its form", () => {
    expect(formatDate("2026-09-02T00:00:00Z")).toBe("02-09-2026");
  });

  test("an unset or unparseable value is an en-dash, never 'Invalid Date'", () => {
    expect(formatDate(null)).toBe(EMPTY_CELL);
    expect(formatDate("")).toBe(EMPTY_CELL);
    expect(formatDate("not a date")).toBe(EMPTY_CELL);
  });

  test("an org on another pattern gets that pattern, not a second implementation", () => {
    expect(formatDate("2026-09-02T00:00:00Z", { dateFormat: "yyyy-MM-dd" })).toBe("2026-09-02");
  });
});

describe("formatDateTime", () => {
  test("dd-MM-yyyy HH:mm, 24-hour, no seconds", () => {
    expect(formatDateTime("2026-09-02T06:30:00Z", { tz: "Asia/Dubai" })).toBe("02-09-2026 10:30");
  });

  test("midnight is 00:00 and never the 24:00 some ICU builds produce", () => {
    expect(formatDateTime("2026-09-01T20:00:00Z", { tz: "Asia/Dubai" })).toBe("02-09-2026 00:00");
  });

  test("seconds are never shown, however precise the stored value", () => {
    expect(formatDateTime("2026-09-02T06:30:59.999Z", { tz: "Asia/Dubai" })).toBe("02-09-2026 10:30");
  });

  test("an unset value is an en-dash on its own, not a date beside a blank time", () => {
    expect(formatDateTime(null)).toBe(EMPTY_CELL);
  });

  test("a Date, an ISO string and a millisecond count all read the same", () => {
    const iso = "2026-09-02T06:30:00.000Z";
    expect(formatDateTime(new Date(iso))).toBe(formatDateTime(iso));
    expect(formatDateTime(new Date(iso).getTime())).toBe(formatDateTime(iso));
  });
});

describe("formatClock", () => {
  test("the wall clock in the org's zone", () => {
    expect(formatClock("2026-09-02T06:30:00Z", "Asia/Dubai")).toBe("10:30");
    expect(formatClock("2026-09-02T06:30:00Z", "UTC")).toBe("06:30");
  });
});

describe("formatMoney", () => {
  test("D-74's acceptance case exactly", () => {
    expect(formatMoney(7500, "AED")).toBe("AED 7,500");
  });

  test("groups thousands and keeps two places when the amount has any", () => {
    expect(formatMoney(21750, "AED")).toBe("AED 21,750");
    // Never one decimal place: 28.5 is 28.50 in every ledger ever written.
    expect(formatMoney(28.5, "AED")).toBe("AED 28.50");
    expect(formatMoney("21750.00", "AED")).toBe("AED 21,750");
  });

  test("an unresolved currency renders the bare number, never a guessed token", () => {
    // src/lib/currency.ts's rule: "An unlabelled '1,000' is recoverable...
    // A confidently wrong '₹1,000' is not: it reads as fact."
    expect(formatMoney(7500)).toBe("7,500");
    expect(formatMoney(7500, "")).toBe("7,500");
    expect(formatMoney(7500, null)).toBe("7,500");
  });

  test("the string amounts the API actually returns are formatted, not printed raw", () => {
    // Every money field on these endpoints is a numeric STRING.
    expect(formatMoney("180", "AED")).toBe("AED 180");
    expect(formatMoney("21750.50", "AED")).toBe("AED 21,750.50");
  });

  test("a missing or non-numeric amount is an en-dash, never NaN or a zero", () => {
    expect(formatMoney(null, "AED")).toBe(EMPTY_CELL);
    expect(formatMoney(undefined, "AED")).toBe(EMPTY_CELL);
    expect(formatMoney("", "AED")).toBe(EMPTY_CELL);
    expect(formatMoney("n/a", "AED")).toBe(EMPTY_CELL);
    // Zero is a real figure and must survive.
    expect(formatMoney(0, "AED")).toBe("AED 0");
  });

  test("a caller that needs fixed decimals asks for them rather than writing its own", () => {
    expect(formatMoney(21750, "AED", { decimals: 2 })).toBe("AED 21,750.00");
  });

  test("negative amounts keep their sign", () => {
    expect(formatMoney(-1200, "AED")).toBe("AED -1,200");
  });
});

describe("zoneOffsetMinutes", () => {
  test("Asia/Dubai is four hours ahead of UTC", () => {
    expect(zoneOffsetMinutes(new Date("2026-09-02T06:30:00Z"), "Asia/Dubai")).toBe(240);
  });

  test("UTC is zero, and India's half-hour offset is not rounded away", () => {
    expect(zoneOffsetMinutes(new Date("2026-09-02T06:30:00Z"), "UTC")).toBe(0);
    expect(zoneOffsetMinutes(new Date("2026-09-02T06:30:00Z"), "Asia/Kolkata")).toBe(330);
  });

  test("a zone WITH daylight saving reports each side of it correctly", () => {
    expect(zoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "Europe/London")).toBe(0);
    expect(zoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "Europe/London")).toBe(60);
  });
});

describe("toOrgInstant -- the 10:30 round trip", () => {
  test("a wall clock typed in the org's zone becomes the instant the user meant", () => {
    // THE BUG: this value was posted as-is, read by a UTC server as 10:30 UTC,
    // and rendered back in Dubai as 14:30 for a meeting scheduled at 10:30.
    expect(toOrgInstant("2026-09-02T10:30", "Asia/Dubai")).toBe("2026-09-02T06:30:00.000Z");
  });

  test("and renders back as the very same wall clock", () => {
    const stored = toOrgInstant("2026-09-02T10:30", "Asia/Dubai");
    expect(formatDateTime(stored, { tz: "Asia/Dubai" })).toBe("02-09-2026 10:30");
    // The failure mode this replaces, stated out loud.
    expect(formatDateTime(stored, { tz: "Asia/Dubai" })).not.toContain("14:30");
  });

  test("the naive value, sent as it used to be, is the four-hour lie", () => {
    // Proof that the fix is not decorative: the OLD payload really does read
    // back four hours late in the org's own zone.
    expect(formatDateTime("2026-09-02T10:30", { tz: "Asia/Dubai" })).toBe("02-09-2026 14:30");
  });

  test("a value that already carries a zone is not shifted a second time", () => {
    expect(toOrgInstant("2026-09-02T06:30:00.000Z", "Asia/Dubai")).toBe("2026-09-02T06:30:00.000Z");
    expect(toOrgInstant("2026-09-02T10:30:00+04:00", "Asia/Dubai")).toBe("2026-09-02T06:30:00.000Z");
  });

  test("a zone with DST resolves the offset that applies at that local time", () => {
    // 10:30 on a July morning in London is BST (+1), not GMT.
    expect(toOrgInstant("2026-07-15T10:30", "Europe/London")).toBe("2026-07-15T09:30:00.000Z");
    expect(toOrgInstant("2026-01-15T10:30", "Europe/London")).toBe("2026-01-15T10:30:00.000Z");
  });

  test("an empty or unparseable value produces nothing to send, not an invalid date", () => {
    expect(toOrgInstant("")).toBeUndefined();
    expect(toOrgInstant(null)).toBeUndefined();
    expect(toOrgInstant("not a date")).toBeUndefined();
  });

  test("the org default is used when no zone is passed", () => {
    expect(toOrgInstant("2026-09-02T10:30")).toBe(toOrgInstant("2026-09-02T10:30", DEFAULT_ORG_TIME_ZONE));
  });
});

describe("toLocalInputValue", () => {
  test("an edit form opens on the same wall clock the list shows", () => {
    expect(toLocalInputValue("2026-09-02T06:30:00Z", "Asia/Dubai")).toBe("2026-09-02T10:30");
  });

  test("round-trips through toOrgInstant unchanged", () => {
    const typed = "2026-09-02T10:30";
    expect(toLocalInputValue(toOrgInstant(typed, "Asia/Dubai"), "Asia/Dubai")).toBe(typed);
  });

  test("an unset value leaves the input empty rather than filling it with a guess", () => {
    expect(toLocalInputValue(null)).toBe("");
  });
});
