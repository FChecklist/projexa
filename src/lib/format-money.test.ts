import { describe, expect, test } from "bun:test";
import {
  CURRENCY_NOT_SET_NOTICE,
  EMPTY_VALUE,
  MONEY_CELL_CLASS,
  UNKNOWN_CURRENCY_GLYPH,
  currencyUnitSuffix,
  formatMoney,
  formatQty,
  formatSignedMoney,
  hasCurrency,
} from "./format-money";
import { AA_TEXT, TOKENS, contrastRatio } from "./theme/contrast";

// The org shape a screen actually holds: the base-currency code resolved from
// /api/currencies, plus the locale this codebase pins everywhere.
const org = { currency: "AED", locale: "en-AE" };
const orgWithNoCurrency = { currency: null };

describe("G-05 acceptance", () => {
  test("formatMoney(435, { currency: 'AED', locale: 'en-AE' }) === 'AED 435.00'", () => {
    expect(formatMoney(435, { currency: "AED", locale: "en-AE" })).toBe("AED 435.00");
  });

  test("formatMoney(null, org) === '–'", () => {
    expect(formatMoney(null, org)).toBe("–");
    expect(formatMoney(null, org)).toBe(EMPTY_VALUE);
  });

  test("formatMoney(0, org) === 'AED 0.00'", () => {
    expect(formatMoney(0, org)).toBe("AED 0.00");
  });

  test("the primary button's own foreground/background token pair scores at least 4.5:1", () => {
    // G-05 asks for this assertion in THIS file, because the money change and
    // the button change are one recommendation: the screens this formatter
    // feeds are the screens whose primary button was failing.
    expect(contrastRatio(TOKENS.primaryText, TOKENS.saffron)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(TOKENS.primaryText, TOKENS.saffron)).toBeCloseTo(5.55, 2);
  });
});

describe("'no figure' and 'zero' are different facts", () => {
  test("null, undefined and empty string all render the en-dash, never blank and never 0", () => {
    for (const value of [null, undefined, ""]) {
      expect(formatMoney(value, org)).toBe(EMPTY_VALUE);
    }
  });

  test("a value that is not a number renders the en-dash rather than 'NaN'", () => {
    expect(formatMoney("not a number", org)).toBe(EMPTY_VALUE);
    expect(formatMoney(Number.NaN, org)).toBe(EMPTY_VALUE);
    expect(formatMoney(Number.POSITIVE_INFINITY, org)).toBe(EMPTY_VALUE);
  });

  test("zero is a figure and says so", () => {
    expect(formatMoney(0, org)).toBe("AED 0.00");
    expect(formatMoney("0", org)).toBe("AED 0.00");
    expect(formatMoney(0, org)).not.toBe(formatMoney(null, org));
  });
});

describe("the shapes the APIs really return", () => {
  test("drizzle numeric columns arrive as strings and format the same as numbers", () => {
    expect(formatMoney("1200.5", org)).toBe(formatMoney(1200.5, org));
    expect(formatMoney("1200.5", org)).toBe("AED 1,200.50");
  });

  test("always two decimals, so a column lines up on the point", () => {
    expect(formatMoney(1200, org)).toBe("AED 1,200.00");
    expect(formatMoney(1200.456, org)).toBe("AED 1,200.46");
    expect(formatMoney(0.5, org)).toBe("AED 0.50");
  });

  test("a headline KPI may override the precision, and nothing else may", () => {
    expect(formatMoney(1200.5, { ...org, fractionDigits: 0 })).toBe("AED 1,201");
  });

  test("negatives keep their sign", () => {
    expect(formatMoney(-1200, org)).toBe("AED -1,200.00");
  });
});

describe("never guess a currency (R-62 / R-63)", () => {
  test("with no currency set, the number is bare behind a warning glyph", () => {
    expect(formatMoney(1200, orgWithNoCurrency)).toBe(`${UNKNOWN_CURRENCY_GLYPH} 1,200.00`);
    expect(formatMoney(1200, {})).toBe(`${UNKNOWN_CURRENCY_GLYPH} 1,200.00`);
    expect(formatMoney(1200, { currency: "   " })).toBe(`${UNKNOWN_CURRENCY_GLYPH} 1,200.00`);
  });

  test("no currency token is ever invented", () => {
    // The specific historical bug: a hardcoded fallback rendering rupees to a
    // UAE buyer. Nothing in the unset path may contain a code or a symbol.
    const rendered = formatMoney(1200, orgWithNoCurrency);
    expect(rendered).not.toMatch(/[A-Z]{3}/);
    expect(rendered).not.toContain("₹");
    expect(rendered).not.toContain("$");
    expect(rendered).not.toContain("AED");
  });

  test("hasCurrency is what a screen gates its footer notice on", () => {
    expect(hasCurrency(org)).toBe(true);
    expect(hasCurrency(orgWithNoCurrency)).toBe(false);
    expect(hasCurrency(null)).toBe(false);
    expect(hasCurrency({ currency: "" })).toBe(false);
  });

  test("the footer notice is one sentence with a destination", () => {
    expect(CURRENCY_NOT_SET_NOTICE).toBe("Currency not set → Settings");
  });
});

describe("'not answered yet' is not the same fact as 'there is no currency'", () => {
  // Review fix. The warning glyph is a CLAIM -- "this org has no currency" --
  // and on a client screen it was being made during the whole window between
  // first paint and the /api/currencies response, i.e. on every page load, for
  // every org, including the ones that do have a currency.
  test("pending renders the number bare: no code, and no glyph either", () => {
    expect(formatMoney(1200, { pending: true })).toBe("1,200.00");
    expect(formatMoney(0, { currency: null, pending: true })).toBe("0.00");
    expect(formatSignedMoney(2025, { pending: true })).toBe("▲ +2,025.00");
  });

  test("pending and unset are different strings -- that is the whole point", () => {
    expect(formatMoney(1200, { pending: true })).not.toBe(formatMoney(1200, orgWithNoCurrency));
    expect(formatMoney(1200, { pending: true })).not.toContain(UNKNOWN_CURRENCY_GLYPH);
  });

  test("a real currency beats pending -- the answer arrived mid-render", () => {
    expect(formatMoney(1200, { currency: "AED", pending: true })).toBe("AED 1,200.00");
  });

  test("pending does not change what 'no figure' means", () => {
    // An absent VALUE and an absent CURRENCY are unrelated questions.
    expect(formatMoney(null, { pending: true })).toBe(EMPTY_VALUE);
    expect(formatSignedMoney(undefined, { pending: true })).toBe(EMPTY_VALUE);
  });

  test("a column header stays unlabelled while pending, so it cannot reflow twice", () => {
    expect(currencyUnitSuffix({ pending: true })).toBeNull();
    expect(currencyUnitSuffix({ currency: "AED", pending: true })).toBe(" (AED)");
  });
});

describe("signed money reads without colour (R-260)", () => {
  test("renders R-260's own example", () => {
    expect(formatSignedMoney(2025, { ...org, fractionDigits: 0 })).toBe("▲ AED +2,025");
  });

  test("down is a different glyph AND a different sign", () => {
    expect(formatSignedMoney(-2025, { ...org, fractionDigits: 0 })).toBe("▼ AED -2,025");
  });

  test("zero has no direction, so it gets no glyph", () => {
    expect(formatSignedMoney(0, org)).toBe("AED 0.00");
  });

  test("strip every style and a rise still differs from a fall", () => {
    expect(formatSignedMoney(10, org)).not.toBe(formatSignedMoney(-10, org));
  });

  test("no figure is still the en-dash, not '▲ –'", () => {
    expect(formatSignedMoney(null, org)).toBe(EMPTY_VALUE);
  });

  test("with no currency it keeps the warning glyph as well as the direction", () => {
    expect(formatSignedMoney(2025, { fractionDigits: 0 })).toBe(`▲ ${UNKNOWN_CURRENCY_GLYPH} +2,025`);
  });
});

describe("units live in the column header, not in every row", () => {
  test("gives the header its suffix", () => {
    expect(currencyUnitSuffix(org)).toBe(" (AED)");
    expect(`Daily Rate${currencyUnitSuffix(org)}`).toBe("Daily Rate (AED)");
  });

  test("says nothing when there is nothing honest to say", () => {
    expect(currencyUnitSuffix(orgWithNoCurrency)).toBeNull();
    expect(currencyUnitSuffix(null)).toBeNull();
  });
});

describe("one alignment rule for every money cell", () => {
  test("right-aligned with tabular figures", () => {
    expect(MONEY_CELL_CLASS).toContain("text-right");
    expect(MONEY_CELL_CLASS).toContain("tabular-nums");
  });
});

// ─── R67 D-57: one money format across Materials ─────────────────────────
//
// D-57's own acceptance quotes this exact string, and it is asserted here as
// well as on the two screens that must agree about it (the Inbound ledger and
// the Cost Report), so a change to grouping or decimals fails in this file
// rather than being noticed on a screenshot of one tab.
describe("D-57 acceptance: one money format", () => {
  test("formatMoney(21750, { currency: 'AED' }) === 'AED 21,750.00'", () => {
    expect(formatMoney(21750, { currency: "AED" })).toBe("AED 21,750.00");
  });

  test("the same figure from a numeric DB column formats identically", () => {
    expect(formatMoney("21750", { currency: "AED" })).toBe("AED 21,750.00");
  });
});

// ─── R67 D-39/D-40: quantities are not money ─────────────────────────────
//
// A quantity shares money's grouping so the two columns line up, and shares
// its "no figure is not zero" rule -- but must NOT carry a currency token or
// forced decimals: a bag count reading "50.00 bag" is noise, and a batching
// quantity of 0.125 cum would be rounded away at two decimals.
describe("formatQty", () => {
  test("no currency token and no forced decimals -- '50 bag' is 50, not 50.00", () => {
    expect(formatQty(50)).toBe("50");
    expect(formatQty("50")).toBe("50");
  });

  test("keeps up to three real decimals and groups thousands like money", () => {
    expect(formatQty(1234.5)).toBe("1,234.5");
    expect(formatQty(0.125)).toBe("0.125");
  });

  test("zero is a quantity; null and unparseable are the en-dash", () => {
    expect(formatQty(0)).toBe("0");
    expect(formatQty(null)).toBe(EMPTY_VALUE);
    expect(formatQty(undefined)).toBe(EMPTY_VALUE);
    expect(formatQty("abc")).toBe(EMPTY_VALUE);
  });

  test("never carries a currency token, even when the org has one", () => {
    expect(formatQty(50)).not.toContain("AED");
    expect(formatQty(50)).not.toContain(UNKNOWN_CURRENCY_GLYPH);
  });
});
