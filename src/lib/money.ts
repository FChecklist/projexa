// R67 lane D22 (item D-41): ONE money formatter for the budget/cost screens.
//
// WHY THIS EXISTS: repo_map.md's own survey of this codebase found "NO shared
// money formatter (each screen does toLocaleString)" -- and the two shapes in
// use disagree. boq-helpers.ts's formatAmount() uses
// `maximumFractionDigits: 2` with no minimum, so 1625 prints as "AED 1,625"
// while 1625.5 prints as "AED 1,625.5": three different decimal widths down
// one column of the same table, and a budget figure that reads as a rounded
// approximation of itself. A currency column has a fixed number of decimal
// places or it is not a currency column.
//
// Deliberately NOT replacing formatAmount(): that one is used for quantities
// and percentages too, where trailing ".00" would be wrong. This module is for
// MONEY only, and every caller passes the org's own currency code (resolved
// from useCurrencies()), never a hardcoded symbol -- the same rule
// boq-helpers.ts's withCurrency() already documents: "no label is survivable,
// the wrong label is not."

/** Money with a FIXED 2 decimal places and grouped thousands: 1625 -> "1,625.00". */
export function formatMoney(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Money prefixed with the org's currency code: ("AED", 1625) -> "AED 1,625.00".
 * An unresolved currency code degrades to the bare number rather than guessing
 * a symbol -- a UAE contractor's BOQ must never be labelled in rupees.
 */
export function withMoney(code: string, value: string | number | null | undefined): string {
  const n = formatMoney(value);
  return code ? `${code} ${n}` : n;
}

/**
 * An amount that has not been entered yet is a real, different state from
 * zero: "no vendor has quoted this line" vs "this line costs nothing". Renders
 * an en-dash for null/undefined and never a fabricated 0.00.
 */
export function withMoneyOrDash(code: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "–";
  return withMoney(code, value);
}
