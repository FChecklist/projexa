/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { formatMoney, withMoney, withMoneyOrDash } from "./money";

describe("formatMoney", () => {
  test("a whole amount keeps both decimal places, so one column never mixes three widths", () => {
    expect(formatMoney(1625)).toBe("1,625.00");
    expect(formatMoney(1625.5)).toBe("1,625.50");
    expect(formatMoney(1625.499)).toBe("1,625.50");
  });

  test("accepts the numeric-as-string shape Drizzle/JSON hands back", () => {
    expect(formatMoney("1950")).toBe("1,950.00");
  });

  test("zero is a real amount and prints as one", () => {
    expect(formatMoney(0)).toBe("0.00");
  });

  test("garbage degrades to 0.00 rather than printing NaN into a currency column", () => {
    expect(formatMoney("not-a-number")).toBe("0.00");
    expect(formatMoney(undefined)).toBe("0.00");
  });

  test("grouping is pinned to en-US, so a test (and a screenshot) reads the same on every machine", () => {
    expect(formatMoney(1234567.891)).toBe("1,234,567.89");
  });
});

describe("withMoney", () => {
  test("prefixes the org's own currency code", () => {
    expect(withMoney("AED", 1625)).toBe("AED 1,625.00");
    expect(withMoney("AED", 1950)).toBe("AED 1,950.00");
  });

  test("an unresolved currency degrades to the bare number, never a guessed symbol", () => {
    expect(withMoney("", 1625)).toBe("1,625.00");
  });
});

describe("withMoneyOrDash", () => {
  test("not-yet-entered is an en-dash, not a fabricated zero", () => {
    expect(withMoneyOrDash("AED", null)).toBe("–");
    expect(withMoneyOrDash("AED", undefined)).toBe("–");
    expect(withMoneyOrDash("AED", "")).toBe("–");
  });

  test("a real zero still prints as zero", () => {
    expect(withMoneyOrDash("AED", 0)).toBe("AED 0.00");
  });
});
