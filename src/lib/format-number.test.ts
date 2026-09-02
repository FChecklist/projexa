import { describe, expect, test } from "bun:test";
import { EMPTY_VALUE, formatCompactNumber, formatNumber, formatSignedNumber } from "./format-number";

describe("formatNumber", () => {
  test("groups and pins the locale", () => {
    expect(formatNumber(2025)).toBe("2,025");
    expect(formatNumber(1250000)).toBe("1,250,000");
  });

  test("fractionDigits is both the minimum and the maximum, so columns line up", () => {
    expect(formatNumber(435, { fractionDigits: 2 })).toBe("435.00");
    expect(formatNumber(435.456, { fractionDigits: 2 })).toBe("435.46");
    expect(formatNumber(0, { fractionDigits: 2 })).toBe("0.00");
  });

  test("an explicit locale is honoured", () => {
    // The Indian numbering system groups differently -- this is the exact
    // difference that makes an unpinned toLocaleString() a hydration bug.
    expect(formatNumber(1250000, { locale: "en-IN" })).toBe("12,50,000");
  });
});

describe("formatCompactNumber", () => {
  test("shortens so a bar-end label cannot overlap its neighbour", () => {
    expect(formatCompactNumber(2025)).toBe("2K");
    expect(formatCompactNumber(1250000)).toBe("1.3M");
    expect(formatCompactNumber(12)).toBe("12");
  });

  test("a non-finite value renders the en-dash, never 'NaN' or 'Infinity'", () => {
    expect(formatCompactNumber(Number.NaN)).toBe(EMPTY_VALUE);
    expect(formatCompactNumber(Number.POSITIVE_INFINITY)).toBe(EMPTY_VALUE);
  });
});

describe("formatSignedNumber (R-260: sign and glyph, not colour)", () => {
  test("positive gets the up glyph and an explicit +", () => {
    expect(formatSignedNumber(2025)).toBe("▲ +2,025");
  });

  test("negative gets the down glyph and the minus", () => {
    expect(formatSignedNumber(-2025)).toBe("▼ -2,025");
  });

  test("zero has no direction, so it gets no glyph", () => {
    expect(formatSignedNumber(0)).toBe("0");
  });

  test("the direction is readable with no colour at all", () => {
    // The whole point: strip every style and the two values still differ.
    expect(formatSignedNumber(10)).not.toBe(formatSignedNumber(-10));
    expect(formatSignedNumber(10).startsWith("▲")).toBe(true);
    expect(formatSignedNumber(-10).startsWith("▼")).toBe(true);
  });

  test("carries decimals through when asked", () => {
    expect(formatSignedNumber(-2025.5, { fractionDigits: 2 })).toBe("▼ -2,025.50");
  });
});
