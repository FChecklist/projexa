/// <reference types="bun-types" />
// R67 lane D22 (item D-63). The three pure strings the MoM screens depend on:
// the default title, the default date, and the WhatsApp summary line the item
// quotes literally.
import { describe, expect, test } from "bun:test";
import { defaultMeetingTitle, meetingShareSummary, nextHalfHourLocalInput } from "./mom-format";
import { formatDayMonthYear } from "./format-date";

describe("defaultMeetingTitle", () => {
  test("names the project, so one typed word is enough to make it specific", () => {
    expect(defaultMeetingTitle("Skyline Tower A")).toBe("Skyline Tower A - site coordination");
  });

  test("degrades to a usable title rather than a dangling dash when there is no project", () => {
    expect(defaultMeetingTitle(null)).toBe("Site coordination");
    expect(defaultMeetingTitle("   ")).toBe("Site coordination");
  });
});

describe("nextHalfHourLocalInput", () => {
  test("rounds up to the next half hour", () => {
    expect(nextHalfHourLocalInput(new Date(2026, 7, 28, 10, 1, 12))).toBe("2026-08-28T10:30");
    expect(nextHalfHourLocalInput(new Date(2026, 7, 28, 10, 29, 59))).toBe("2026-08-28T10:30");
    expect(nextHalfHourLocalInput(new Date(2026, 7, 28, 10, 31, 0))).toBe("2026-08-28T11:00");
  });

  test("leaves a time already on a half hour alone", () => {
    expect(nextHalfHourLocalInput(new Date(2026, 7, 28, 10, 0, 0))).toBe("2026-08-28T10:00");
    expect(nextHalfHourLocalInput(new Date(2026, 7, 28, 10, 30, 0))).toBe("2026-08-28T10:30");
  });

  test("rolls the hour, the day, the month and the year over correctly", () => {
    expect(nextHalfHourLocalInput(new Date(2026, 11, 31, 23, 45, 0))).toBe("2027-01-01T00:00");
  });

  test("is always a value an <input type=datetime-local> accepts", () => {
    expect(nextHalfHourLocalInput(new Date(2026, 0, 5, 9, 5, 0))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("meetingShareSummary", () => {
  test("reads exactly as the item specifies", () => {
    expect(meetingShareSummary("Weekly Site Coordination", "28 Aug 2026", 4)).toBe(
      "MoM - Weekly Site Coordination - 28 Aug 2026 - 4 actions"
    );
  });

  test("says 'action' for one and 'actions' for none or many", () => {
    expect(meetingShareSummary("Kickoff", "01 Sep 2026", 1)).toContain("1 action");
    expect(meetingShareSummary("Kickoff", "01 Sep 2026", 1).endsWith("1 action")).toBe(true);
    expect(meetingShareSummary("Kickoff", "01 Sep 2026", 0)).toContain("0 actions");
  });

  test("pairs with the shared day-month-year formatter", () => {
    const summary = meetingShareSummary("Design Review", formatDayMonthYear("2026-08-28T10:00:00.000Z"), 2);
    expect(summary).toBe("MoM - Design Review - 28 Aug 2026 - 2 actions");
  });
});
