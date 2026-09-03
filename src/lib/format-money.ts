// R67 (audit recommendation "one money format across the product"). There was
// no shared money formatter in this repo: src/lib/currency.ts is "use client",
// so a server component could not import it, and every screen wrote its own
// `toLocaleString` -- which is why DashboardHomeView.tsx carries a private
// copy of formatCurrency() and why one cement item could read "AED 420",
// "435" and "AED 21750.00" on three tabs of the SAME module.
//
// This module is deliberately NOT "use client": it is imported by server
// components, by client components and by tests alike.
//
// ─── SAME-PATH COLLISION WITH LANE G, AND HOW IT IS TO BE SETTLED ───────────
// Lane G shipped its own src/lib/format-money.ts for the same recommendation
// (G-05 / R-260) and it is ALREADY ON MAIN. Two modules, one path, no common
// ancestor: an add/add conflict on the next integration of this branch.
//
// THE RESOLUTION IS DECIDED, so nobody has to re-litigate it mid-merge:
// LANE G's VERSION WINS, by decision D-11's rule of thumb (the version already
// on main is canonical; the arriving lane folds its capability in and adapts
// its callers). G's is also the better module on the merits -- it distinguishes
// "not answered yet" from "this org has no currency", which this one does not,
// and it ships useOrgMoney() to bind the org's currency once per screen.
//
// WHAT THE INTEGRATION PASS MUST DO, concretely:
//   * delete this file and format-money.test.ts in favour of main's;
//   * repoint the 11 call sites listed by `grep -rl '@/lib/format-money' src/`
//     from formatMoney(value, currencies) to useOrgMoney()'s money(value);
//   * formatQty exists on BOTH sides with the same contract, so it needs no
//     change beyond the import;
//   * D-57's own acceptance -- formatMoney(21750, AED) === "AED 21,750.00" --
//     must survive as an assertion in whichever test file remains.
//
// This was NOT done in the fix pass that wrote this comment, deliberately: it
// cannot be done honestly without the merge, and that merge is a 22-file,
// ~85-hunk reconciliation of two independent rewrites of the same ten screens
// -- an integration task in its own right, not a footnote to a formatter.
// What WAS done is to remove the one hazard the review named: currency.ts no
// longer re-exports this module's two constants (it defines its own again,
// byte-identical to main's), so nothing outside this file breaks whichever
// version wins.
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
