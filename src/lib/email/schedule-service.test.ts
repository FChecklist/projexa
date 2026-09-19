/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { getOrgLocalDateTime, localTimeToMinutes, isDue } from "./schedule-service";

describe("getOrgLocalDateTime", () => {
  test("computes the org-local date/time in a timezone ahead of UTC, crossing midnight", () => {
    // 2026-01-01 20:00 UTC is 2026-01-02 01:30 in Asia/Kolkata (UTC+5:30)
    const now = new Date("2026-01-01T20:00:00Z");
    const { localDate, minutesSinceMidnight } = getOrgLocalDateTime(now, "Asia/Kolkata");
    expect(localDate).toBe("2026-01-02");
    expect(minutesSinceMidnight).toBe(1 * 60 + 30);
  });

  test("UTC timezone is a no-op", () => {
    const now = new Date("2026-06-15T09:05:00Z");
    const { localDate, minutesSinceMidnight } = getOrgLocalDateTime(now, "UTC");
    expect(localDate).toBe("2026-06-15");
    expect(minutesSinceMidnight).toBe(9 * 60 + 5);
  });
});

describe("localTimeToMinutes", () => {
  test("parses HH:MM", () => {
    expect(localTimeToMinutes("09:00")).toBe(540);
    expect(localTimeToMinutes("00:00")).toBe(0);
    expect(localTimeToMinutes("23:45")).toBe(1425);
  });
});

describe("isDue", () => {
  test("due at the exact target minute", () => {
    const now = new Date("2026-01-01T03:30:00Z"); // 09:00 IST
    expect(isDue("09:00", now, "Asia/Kolkata", 15)).toBe(true);
  });

  test("due a few minutes after the target, still inside the bucket", () => {
    const now = new Date("2026-01-01T03:40:00Z"); // 09:10 IST
    expect(isDue("09:00", now, "Asia/Kolkata", 15)).toBe(true);
  });

  test("not due once the bucket has passed", () => {
    const now = new Date("2026-01-01T03:46:00Z"); // 09:16 IST
    expect(isDue("09:00", now, "Asia/Kolkata", 15)).toBe(false);
  });

  test("not due before the target minute", () => {
    const now = new Date("2026-01-01T03:29:00Z"); // 08:59 IST
    expect(isDue("09:00", now, "Asia/Kolkata", 15)).toBe(false);
  });

  test("not due at all the rest of the day, well past the bucket", () => {
    const now = new Date("2026-01-01T12:00:00Z"); // 17:30 IST
    expect(isDue("09:00", now, "Asia/Kolkata", 15)).toBe(false);
  });
});
