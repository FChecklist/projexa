// R67 WS-G (R-227 / R-260). Number formatting that is safe to render during
// SSR and safe to print inside a chart.
//
// LOCALE PINNING, same reason as src/lib/format-date.ts: a bare
// `n.toLocaleString()` resolves to the RUNTIME's default locale, which is the
// server's on the SSR pass and the visitor's in the browser. This app ships a
// real "hi" locale, whose digit grouping is the Indian numbering system, so
// the two passes produce different strings and React reports a hydration
// mismatch. Every helper here takes an explicit locale and defaults to the
// same "en-US" the rest of this codebase already pins.

export const DEFAULT_NUMBER_LOCALE = "en-US";

/** The en-dash this app renders for "no value", never a blank cell. */
export const EMPTY_VALUE = "–";

/**
 * A full-precision grouped number: 2025 -> "2,025".
 * `fractionDigits` is applied as both the minimum and the maximum, so a money
 * column lines up on the decimal point instead of ragging.
 */
export function formatNumber(
  value: number,
  { locale = DEFAULT_NUMBER_LOCALE, fractionDigits = 0 }: { locale?: string; fractionDigits?: number } = {}
): string {
  return value.toLocaleString(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * A grouped number with UP TO `maxFractionDigits` decimals and no trailing
 * zeros: 5400 -> "5,400", 20833.2 -> "20,833.2".
 *
 * This is the quantity/measurement shape, not the money shape. Money always
 * shows both decimals so a column aligns on the point (see
 * src/lib/format-money.ts); a quantity does not -- "50 m3" should not read
 * "50.00 m3". Kept here, and locale-pinned, so a grid that formats
 * quantities AND amounts with one helper still cannot produce a hydration
 * mismatch.
 */
export function formatDecimal(
  value: number,
  { locale = DEFAULT_NUMBER_LOCALE, maxFractionDigits = 2 }: { locale?: string; maxFractionDigits?: number } = {}
): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  return value.toLocaleString(locale, { maximumFractionDigits: maxFractionDigits });
}

/**
 * A short number for printing INSIDE a chart, where a full grouped figure
 * would collide with its neighbour: 2025 -> "2k", 1_250_000 -> "1.3M".
 *
 * This exists because R-227 requires the value to be printed at the bar end.
 * The printed value is what lets a reader read a chart without relying on the
 * mark's colour or on a hover, so it has to fit -- a label that overlaps the
 * next bar is not a label.
 */
export function formatCompactNumber(value: number, { locale = DEFAULT_NUMBER_LOCALE }: { locale?: string } = {}): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  return value.toLocaleString(locale, { notation: "compact", maximumFractionDigits: 1 });
}

/**
 * A signed value with its DIRECTION shown as a glyph, so a variance is
 * readable without colour: 2025 -> "▲ +2,025", -2025 -> "▼ -2,025", 0 -> "0".
 *
 * R-260's example is "▲ AED +2,025 in ink with the sign rather than colour
 * alone" -- the caller supplies the currency prefix; this owns the glyph and
 * the sign. Zero deliberately gets no glyph: "no change" has no direction.
 */
export function formatSignedNumber(
  value: number,
  { locale = DEFAULT_NUMBER_LOCALE, fractionDigits = 0 }: { locale?: string; fractionDigits?: number } = {}
): string {
  const magnitude = formatNumber(Math.abs(value), { locale, fractionDigits });
  if (value > 0) return `▲ +${magnitude}`;
  if (value < 0) return `▼ -${magnitude}`;
  return magnitude;
}
