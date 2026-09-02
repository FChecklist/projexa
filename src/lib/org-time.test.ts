/// <reference types="bun-types" />
// R67 D-18. Every case here is a real way the MoM create form could stamp the
// wrong instant on a meeting, which then prints on the client's minutes PDF.
// Fixed instants only -- nothing here reads the wall clock.
import { describe, expect, test } from "bun:test";
import {
  FALLBACK_TIME_ZONE,
  resolveOrgTimeZone,
  nextQuarterHourLocalInput,
  zonedInputToIso,
  timeZoneHint,
} from "./org-time";

describe("resolveOrgTimeZone", () => {
  test("the organisation's own zone wins over the browser's", () => {
    expect(resolveOrgTimeZone("Asia/Dubai", "Europe/London")).toBe("Asia/Dubai");
  });

  test("falls back to the browser zone while the org has none configured", () => {
    // This is today's real state: PROJEXA's organizations table carries no
    // timezone column, so /api/organization returns nothing for it.
    expect(resolveOrgTimeZone(null, "Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(resolveOrgTimeZone(undefined, "Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(resolveOrgTimeZone("   ", "Asia/Kolkata")).toBe("Asia/Kolkata");
  });

  test("a junk zone name is skipped rather than thrown on, in either position", () => {
    expect(resolveOrgTimeZone("Mars/Olympus", "Asia/Dubai")).toBe("Asia/Dubai");
    expect(resolveOrgTimeZone("Mars/Olympus", "Also/Nonsense")).toBe(FALLBACK_TIME_ZONE);
  });

  test("with nothing resolvable at all it is UTC, never a guessed offset", () => {
    expect(resolveOrgTimeZone(null, null)).toBe("UTC");
  });
});

describe("nextQuarterHourLocalInput", () => {
  // 2026-09-02T09:07:31Z is 13:07:31 in Dubai (UTC+4, no DST).
  const at = new Date("2026-09-02T09:07:31.000Z");

  test("rounds up to the next quarter hour in the ORG's zone, not the machine's", () => {
    expect(nextQuarterHourLocalInput("Asia/Dubai", at)).toBe("2026-09-02T13:15");
    expect(nextQuarterHourLocalInput("UTC", at)).toBe("2026-09-02T09:15");
    expect(nextQuarterHourLocalInput("Asia/Kolkata", at)).toBe("2026-09-02T14:45"); // UTC+5:30
  });

  test("a time already exactly on a quarter hour stays there", () => {
    expect(nextQuarterHourLocalInput("UTC", new Date("2026-09-02T09:30:00.000Z"))).toBe("2026-09-02T09:30");
  });

  test("rolls the hour", () => {
    expect(nextQuarterHourLocalInput("UTC", new Date("2026-09-02T09:52:00.000Z"))).toBe("2026-09-02T10:00");
  });

  test("rolls the day, month and year together rather than emitting 24:00 or day 32", () => {
    expect(nextQuarterHourLocalInput("UTC", new Date("2026-12-31T23:51:00.000Z"))).toBe("2027-01-01T00:00");
    expect(nextQuarterHourLocalInput("UTC", new Date("2026-09-30T23:47:00.000Z"))).toBe("2026-10-01T00:00");
  });

  test("emits exactly the 16-character shape <input type=datetime-local> accepts", () => {
    expect(nextQuarterHourLocalInput("Asia/Dubai", at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("zonedInputToIso", () => {
  test("reads the typed wall clock in the ORG's zone -- the whole point of the field hint", () => {
    // 13:15 in Dubai is 09:15Z. Parsed as UTC (the old behaviour of posting
    // the bare string to a UTC serverless function) it would have been 13:15Z,
    // four hours wrong on the PDF.
    expect(zonedInputToIso("2026-09-02T13:15", "Asia/Dubai")).toBe("2026-09-02T09:15:00.000Z");
    expect(zonedInputToIso("2026-09-02T14:45", "Asia/Kolkata")).toBe("2026-09-02T09:15:00.000Z");
  });

  test("a zone at UTC round-trips unchanged", () => {
    expect(zonedInputToIso("2026-09-02T09:15", "UTC")).toBe("2026-09-02T09:15:00.000Z");
  });

  test("resolves a summer-time wall clock against the offset actually in force then", () => {
    // London is UTC+1 on 2026-07-01 and UTC+0 on 2026-01-01.
    expect(zonedInputToIso("2026-07-01T12:00", "Europe/London")).toBe("2026-07-01T11:00:00.000Z");
    expect(zonedInputToIso("2026-01-01T12:00", "Europe/London")).toBe("2026-01-01T12:00:00.000Z");
  });

  test("accepts a value that carries seconds as well as the bare 16-character form", () => {
    expect(zonedInputToIso("2026-09-02T13:15:30", "Asia/Dubai")).toBe("2026-09-02T09:15:30.000Z");
  });

  test("an empty or unparseable value returns '' so the caller treats it as not filled in", () => {
    expect(zonedInputToIso("", "UTC")).toBe("");
    expect(zonedInputToIso("not a date", "UTC")).toBe("");
  });
});

describe("timeZoneHint", () => {
  test("always names the zone, with its offset, so a pre-filled time is attributable", () => {
    expect(timeZoneHint("Asia/Dubai", new Date("2026-09-02T09:00:00.000Z"))).toBe("Asia/Dubai (GMT+4)");
  });

  test("degrades to the bare zone name rather than throwing on an unknown zone", () => {
    expect(timeZoneHint("Mars/Olympus")).toBe("Mars/Olympus");
  });
});
