/// <reference types="bun-types" />
// R67 F-22 -- the "as of HH:MM" stamp on speculatively-prefetched rows.
//
// The stamp is what makes the speed honest: rows served from a prefetch can be
// up to a minute old, and a screen that shows them without saying so is
// claiming a currency it does not have.

import { describe, expect, test } from "bun:test";
import { asOfLabel, formatAsOf } from "./as-of";

// Built from local components on purpose: the stamp is the READER's wall
// clock, so a test that hard-coded a UTC epoch would pass or fail depending on
// the machine's time zone rather than on the code.
function localTime(hours: number, minutes: number): Date {
  const d = new Date(2026, 8, 2, hours, minutes, 30);
  return d;
}

describe("formatAsOf", () => {
  test("24-hour, zero-padded, in the reader's own time", () => {
    expect(formatAsOf(localTime(9, 5))).toBe("09:05");
    expect(formatAsOf(localTime(14, 30))).toBe("14:30");
    expect(formatAsOf(localTime(0, 0))).toBe("00:00");
    expect(formatAsOf(localTime(23, 59))).toBe("23:59");
  });

  test("accepts a timestamp as well as a Date", () => {
    expect(formatAsOf(localTime(7, 8).getTime())).toBe("07:08");
  });

  test("an unusable value renders nothing rather than 'NaN:NaN'", () => {
    expect(formatAsOf(Number.NaN)).toBe("");
    expect(formatAsOf(new Date("not a date"))).toBe("");
  });
});

describe("asOfLabel", () => {
  test("one sentence, said the same way on every screen", () => {
    expect(asOfLabel(localTime(16, 4))).toBe("as of 16:04");
  });

  test("no label at all when there is no usable time", () => {
    expect(asOfLabel(Number.NaN)).toBe("");
  });
});
