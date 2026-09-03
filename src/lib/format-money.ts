// R67 G-05 (R-260). THE money formatter. One module, so a figure reads the
// same on every screen.
//
// WHAT IT REPLACES. Sixty-odd inline `n.toLocaleString(...)` call sites, each
// with its own idea of the rules. The audit found all four disagreements
// live: some rendered 0 decimals and some 2, so the same amount appeared as
// "AED 1,200" on one screen and "AED 1,200.00" on the next; an empty value
// rendered blank on some screens, "0" on others and "—" on a third; the
// currency token was sometimes a symbol and sometimes a code; and one call
// site (ScopeClient's formatVariation) passed `undefined` as the locale,
// which is the hydration bug src/lib/format-date.ts exists to prevent --
// the server formats in its own locale and the browser in the visitor's, and
// the two strings differ for any non-en-US visitor.
//
// THE RULES, all in one place:
//   * two decimals, always, so a column lines up on the point;
//   * null / undefined / non-numeric render the en-dash, never blank and
//     never "0" -- "we do not have this figure" and "this figure is zero"
//     are different facts;
//   * zero renders "AED 0.00" -- it IS a figure;
//   * the currency is a CODE and a prefix, never a symbol;
//   * a signed figure carries its direction as a glyph, not as a colour.
//
// WHERE THE CURRENCY COMES FROM. R-260 words this as "read from
// /api/organization". That route does not carry a currency, a locale or a
// time zone -- it returns the PROJEXA-side organizations row (id, name, slug,
// created_at, country) and nothing else, and adding columns to it would be a
// projexa migration this workstream is explicitly not scoped for. The org's
// real currency in this product is VERIDIAN's erp_currencies base row, which
// /api/currencies already serves and which src/lib/currency.ts's
// useCurrencies() already fetches on every screen that shows money. So
// useOrgMoney() below reads THAT, and locale/time zone stay pinned exactly as
// src/lib/format-date.ts pins them, for the same hydration reason. Same
// facts, existing route, no new schema.
//
// NEVER GUESS A CURRENCY. Measured 2026-08-26: 4 of 5 real orgs have no
// erp_currencies base row at all. R-62/R-63 already established the rule --
// an unlabelled "1,000" is recoverable because the reader knows something is
// missing, a confidently wrong "₹1,000" is not. So with no currency this
// formatter renders the bare number behind a warning glyph, and the screen
// says CURRENCY_NOT_SET_NOTICE once in its footer.

import { EMPTY_VALUE, formatDecimal, formatNumber } from "./format-number";

export { EMPTY_VALUE };

/** Same pinned locale as src/lib/format-date.ts, and for the same reason. */
export const DEFAULT_MONEY_LOCALE = "en-US";

/** Money is always two decimals, so a column aligns on the point. */
export const MONEY_FRACTION_DIGITS = 2;

/**
 * Shown ONCE, in the screen's footer, when the org has no currency. Not per
 * cell: repeating it on forty rows is noise, and the reader only needs to be
 * told once why the numbers are bare.
 */
export const CURRENCY_NOT_SET_NOTICE = "Currency not set → Settings";

/** Prefixes an amount whose currency is unknown, so it cannot be misread as a plain count. */
export const UNKNOWN_CURRENCY_GLYPH = "⚠";

export type MoneyFormat = {
  /** ISO code, e.g. "AED". Null/empty means the org has not set one. */
  currency?: string | null;
  locale?: string;
  /** Override only where a screen genuinely shows whole units (a headline KPI). */
  fractionDigits?: number;
  /**
   * "We have not been told yet." Distinct from `currency: null`, which means
   * "we asked and there is none". While a client screen's /api/currencies
   * request is still in flight, an amount renders bare -- no code, and no
   * warning glyph either, because there is nothing to warn about yet. Claiming
   * "this org has no currency" during the first 200 ms of every page load is a
   * statement that is false for every org that does have one.
   */
  pending?: boolean;
};

/** True when `format` carries a real currency code. */
export function hasCurrency(format: MoneyFormat | null | undefined): boolean {
  return Boolean(format?.currency && format.currency.trim().length > 0);
}

/**
 * Accepts the shapes the APIs really return: a number, a numeric string
 * (drizzle numeric columns come back as strings), null, or undefined.
 * Anything that is not a finite number is "no figure", not zero.
 */
function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The token that goes in front of an amount: the code, the warning glyph, or
 * nothing at all while the answer is still in flight.
 */
function currencyToken(format: MoneyFormat): string {
  if (hasCurrency(format)) return `${format.currency!.trim()} `;
  if (format.pending) return "";
  return `${UNKNOWN_CURRENCY_GLYPH} `;
}

/**
 * The one money formatter.
 *
 *   formatMoney(435, { currency: "AED", locale: "en-AE" })  -> "AED 435.00"
 *   formatMoney(0, org)                                     -> "AED 0.00"
 *   formatMoney(null, org)                                  -> "–"
 *   formatMoney(1200, { currency: null })                   -> "⚠ 1,200.00"
 *   formatMoney(1200, { pending: true })                    -> "1,200.00"
 */
export function formatMoney(value: number | string | null | undefined, format: MoneyFormat = {}): string {
  const n = toFiniteNumber(value);
  if (n === null) return EMPTY_VALUE;

  const amount = formatNumber(n, {
    locale: format.locale ?? DEFAULT_MONEY_LOCALE,
    fractionDigits: format.fractionDigits ?? MONEY_FRACTION_DIGITS,
  });

  return `${currencyToken(format)}${amount}`;
}

/**
 * A money figure whose DIRECTION is readable without colour, per R-260's own
 * example: "▲ AED +2,025". The glyph and the explicit sign both carry it, so
 * a printout, a colour-blind reader and a greyscale screenshot all agree.
 * Zero gets no glyph -- "no change" has no direction.
 */
export function formatSignedMoney(value: number | string | null | undefined, format: MoneyFormat = {}): string {
  const n = toFiniteNumber(value);
  if (n === null) return EMPTY_VALUE;

  const magnitude = formatNumber(Math.abs(n), {
    locale: format.locale ?? DEFAULT_MONEY_LOCALE,
    fractionDigits: format.fractionDigits ?? MONEY_FRACTION_DIGITS,
  });
  const token = currencyToken(format);

  if (n > 0) return `▲ ${token}+${magnitude}`;
  if (n < 0) return `▼ ${token}-${magnitude}`;
  return `${token}${magnitude}`;
}

/**
 * The currency code alone, for a column HEADER -- R-260: "units move into the
 * column header". "Daily Rate (AED)" beats repeating "AED" down forty rows.
 * Returns null when there is nothing honest to put there.
 */
export function currencyUnitSuffix(format: MoneyFormat | null | undefined): string | null {
  return hasCurrency(format) ? ` (${format!.currency!.trim()})` : null;
}

/** Tailwind classes every money CELL uses, so alignment cannot drift screen to screen. */
export const MONEY_CELL_CLASS = "text-right tabular-nums whitespace-nowrap";

/**
 * R67 D-39: the QUANTITY shape, beside the money shape so the two rules that
 * a Materials grid needs are read together and cannot be confused.
 *
 *   formatQty(50)        -> "50"
 *   formatQty("1250.5")  -> "1,250.5"
 *   formatQty(0.125)     -> "0.125"
 *   formatQty(null)      -> "–"
 *
 * Up to THREE decimals and no trailing zeros. Money always shows both
 * decimals so a column aligns on the point; a quantity must not -- "50 m3"
 * reading "50.00 m3" is noise, and a batching quantity like 0.125 cum would
 * be rounded away at two. Null / non-numeric renders the en-dash, never 0:
 * "we have no quantity" and "the quantity is zero" are different facts.
 *
 * Accepts a numeric string because drizzle numeric columns arrive as strings.
 */
export function formatQty(value: number | string | null | undefined, locale?: string): string {
  const n = toFiniteNumber(value);
  if (n === null) return EMPTY_VALUE;
  return formatDecimal(n, { locale: locale ?? DEFAULT_MONEY_LOCALE, maxFractionDigits: 3 });
}
