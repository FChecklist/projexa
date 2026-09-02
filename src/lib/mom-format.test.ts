/// <reference types="bun-types" />
// R67 lane D22 (item D-63). The three pure strings the MoM screens depend on:
// the default title, the default date, and the WhatsApp summary line the item
// quotes literally.
import { describe, expect, test } from "bun:test";
import {
  defaultMeetingTitle, meetingShareSummary, nextHalfHourLocalInput,
  canPublishMeeting, publishLockLabel, PUBLISH_LOCK_CONFIRM, PUBLISH_LOCK_LABEL, PUBLISH_LOCK_NO_MINUTES_LABEL,
} from "./mom-format";
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

// R67 lane D22 (item D-75, rec R-287). The item quotes both strings literally,
// so both are asserted character for character.
describe("Publish & Lock", () => {
  test("the disabled control names its own reason, exactly as the item specifies", () => {
    expect(publishLockLabel("")).toBe("Publish & Lock (no minutes yet)");
    expect(publishLockLabel(null)).toBe(PUBLISH_LOCK_NO_MINUTES_LABEL);
    expect(publishLockLabel(undefined)).toBe(PUBLISH_LOCK_NO_MINUTES_LABEL);
  });

  test("whitespace is not minutes -- a stray newline must not unlock an irreversible action", () => {
    expect(canPublishMeeting("   \n  ")).toBe(false);
    expect(publishLockLabel("   \n  ")).toBe(PUBLISH_LOCK_NO_MINUTES_LABEL);
  });

  test("once there are minutes the control is plain and enabled", () => {
    expect(canPublishMeeting("Slab pour agreed for Thursday.")).toBe(true);
    expect(publishLockLabel("Slab pour agreed for Thursday.")).toBe("Publish & Lock");
    expect(PUBLISH_LOCK_LABEL).toBe("Publish & Lock");
  });

  test("the confirm sentence reads exactly as the item specifies", () => {
    expect(PUBLISH_LOCK_CONFIRM).toBe("Locks the minutes and share link; cannot be undone");
  });
});
