// R67 (audit recommendation "one money format across the product"). There was
// no shared money formatter in this repo: src/lib/currency.ts is "use client",
// so a server component could not import it, and every screen wrote its own
// `toLocaleString` -- which is why DashboardHomeView.tsx carries a private
// copy of formatCurrency() and why one cement item could read "AED 420",
// "435" and "AED 21750.00" on three tabs of the SAME module.
//
// This module is deliberately NOT "use client": it is imported by server
// components, by client components and by tests alike. currency.ts now takes
// its fallback constant from here rather than defining a second one.
//
// The locale is pinned to "en-US" for the same reason src/lib/format-date.ts
// pins its own: a bare toLocaleString() resolves to the RUNTIME's locale, so
// the server's SSR pass and the visitor's hydration pass produce different
// digit grouping for any non-en-US visitor -- a real, deterministic hydration
// mismatch, not a cosmetic one. Pinning it makes the string byte-identical
// wherever it is produced.

// The currency shape this module needs. Structurally satisfied by
// src/lib/currency.ts's own Currency type, so a useCurrencies() result can be
// passed straight in with no mapping.
export type MoneyCurrency = { code: string; isBaseCurrency?: boolean };

// See currency.ts's own long comment for why this is a CODE and never a
// symbol, and why an unlabelled number beats a confidently wrong currency
// token: a bare "1,000" is recoverable, a wrong "₹1,000" reads as fact.
export const DEFAULT_CURRENCY_CODE = (process.env.NEXT_PUBLIC_DEFAULT_CURRENCY_CODE ?? "").trim();

/** Trailing space included so `${CURRENCY_FALLBACK_LABEL}${n}` keeps working. */
export const CURRENCY_FALLBACK_LABEL = DEFAULT_CURRENCY_CODE ? `${DEFAULT_CURRENCY_CODE} ` : "";

/** What an unknown/absent amount renders as. Never a blank cell, never "0". */
export const EMPTY_MONEY_DISPLAY = "—";

const FIXED_LOCALE = "en-US";

/**
 * Resolves the currency CODE to print.
 *
 * Accepts either a code ("AED") or the org's currency list, in which case the
 * base-currency row is used -- the same "id null means org base currency"
 * rule currencyLabel() documents.
 */
export function resolveCurrencyCode(currency?: string | readonly MoneyCurrency[] | null): string {
  if (typeof currency === "string") return currency.trim();
  if (Array.isArray(currency)) {
    const base = currency.find((c) => c.isBaseCurrency);
    if (base?.code) return base.code;
  }
  return DEFAULT_CURRENCY_CODE;
}

/**
 * The one money renderer. `formatMoney(21750, "AED") === "AED 21,750.00"`.
 *
 * `value` may be the string form a numeric DB column arrives as. A value that
 * is null/undefined/unparseable renders as the en-dash rather than "0.00" --
 * "we have no figure" and "the figure is zero" are different facts.
 */
export function formatMoney(
  value: number | string | null | undefined,
  currency?: string | readonly MoneyCurrency[] | null,
  options?: { decimals?: number }
): string {
  if (value === null || value === undefined || value === "") return EMPTY_MONEY_DISPLAY;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return EMPTY_MONEY_DISPLAY;

  const decimals = options?.decimals ?? 2;
  const formatted = new Intl.NumberFormat(FIXED_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);

  const code = resolveCurrencyCode(currency);
  return code ? `${code} ${formatted}` : formatted;
}

/**
 * Quantities are not money: no currency token, and trailing zeros are noise on
 * "50 bag". Up to `maxDecimals` (default 3) significant decimals, thousands
 * grouped the same way as money so the two columns line up.
 */
export function formatQty(
  value: number | string | null | undefined,
  options?: { maxDecimals?: number }
): string {
  if (value === null || value === undefined || value === "") return EMPTY_MONEY_DISPLAY;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return EMPTY_MONEY_DISPLAY;
  return new Intl.NumberFormat(FIXED_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: options?.maxDecimals ?? 3,
  }).format(amount);
}
