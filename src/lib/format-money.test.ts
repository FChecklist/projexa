/// <reference types="bun-types" />
// R67: the shared money/quantity formatter. These assertions are the exact
// strings the Materials, Manpower and Budget screens are required to show, so
// a change to grouping, decimals or the empty-value rendering fails here
// rather than being noticed on a screenshot.
import { describe, expect, test } from "bun:test";
import { formatMoney, formatQty, resolveCurrencyCode, EMPTY_MONEY_DISPLAY } from "./format-money";

describe("formatMoney", () => {
  test("the acceptance string: formatMoney(21750, 'AED') is 'AED 21,750.00'", () => {
    expect(formatMoney(21750, "AED")).toBe("AED 21,750.00");
  });

  test("always two decimals, both directions", () => {
    expect(formatMoney(455, "AED")).toBe("AED 455.00");
    expect(formatMoney(435.5, "AED")).toBe("AED 435.50");
    expect(formatMoney(0, "AED")).toBe("AED 0.00");
  });

  test("accepts the string form a numeric DB column arrives as", () => {
    expect(formatMoney("21750", "AED")).toBe("AED 21,750.00");
    expect(formatMoney("435.50", "AED")).toBe("AED 435.50");
  });

  test("resolves the org's base currency when handed the currency list instead of a code", () => {
    const currencies = [
      { code: "USD", isBaseCurrency: false },
      { code: "AED", isBaseCurrency: true },
    ];
    expect(formatMoney(21750, currencies)).toBe("AED 21,750.00");
  });

  test("zero and absent are different facts: 0 prints 0.00, null/undefined/NaN print the en-dash", () => {
    expect(formatMoney(0, "AED")).toBe("AED 0.00");
    expect(formatMoney(null, "AED")).toBe(EMPTY_MONEY_DISPLAY);
    expect(formatMoney(undefined, "AED")).toBe(EMPTY_MONEY_DISPLAY);
    expect(formatMoney("", "AED")).toBe(EMPTY_MONEY_DISPLAY);
    expect(formatMoney("not-a-number", "AED")).toBe(EMPTY_MONEY_DISPLAY);
  });

  test("with no resolvable currency it prints the bare number rather than inventing a token", () => {
    // Neither a code nor a base-currency row, and no NEXT_PUBLIC_DEFAULT_
    // CURRENCY_CODE in the test environment.
    expect(formatMoney(1000, [])).toBe("1,000.00");
    expect(formatMoney(1000, null)).toBe("1,000.00");
  });

  test("the decimals option is honoured for the rare whole-currency case", () => {
    expect(formatMoney(21750, "AED", { decimals: 0 })).toBe("AED 21,750");
  });

  test("negative amounts keep their sign", () => {
    expect(formatMoney(-1500.5, "AED")).toBe("AED -1,500.50");
  });
});

describe("formatQty", () => {
  test("no currency token and no forced decimals -- '50 bag' is 50, not 50.00", () => {
    expect(formatQty(50)).toBe("50");
    expect(formatQty("50")).toBe("50");
  });

  test("keeps up to three real decimals and groups thousands", () => {
    expect(formatQty(1234.5)).toBe("1,234.5");
    expect(formatQty(0.125)).toBe("0.125");
  });

  test("null and unparseable render as the en-dash, zero renders as 0", () => {
    expect(formatQty(0)).toBe("0");
    expect(formatQty(null)).toBe(EMPTY_MONEY_DISPLAY);
    expect(formatQty("abc")).toBe(EMPTY_MONEY_DISPLAY);
  });
});

describe("resolveCurrencyCode", () => {
  test("a code is used as given, trimmed", () => {
    expect(resolveCurrencyCode(" AED ")).toBe("AED");
  });

  test("a list resolves to its base-currency row, never to the first row", () => {
    expect(resolveCurrencyCode([{ code: "USD" }, { code: "INR", isBaseCurrency: true }])).toBe("INR");
  });

  test("a list with no base-currency row resolves to the deployment default (empty in tests)", () => {
    expect(resolveCurrencyCode([{ code: "USD" }])).toBe("");
  });
});
