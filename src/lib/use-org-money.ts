"use client";

// R67 G-05 (R-260). The client-side half of the money formatter: it resolves
// the org's currency once and hands back a bound formatter, so a screen never
// has to remember to pass the currency (and so cannot forget).
//
// src/lib/format-money.ts stays free of React and free of "use client" -- it
// is imported by Server Components too (the dashboard tiles render on the
// server). This module is the only place the two meet.

import { useMemo } from "react";
import { useCurrenciesState } from "./currency";
import {
  CURRENCY_NOT_SET_NOTICE,
  currencyUnitSuffix,
  formatMoney,
  formatSignedMoney,
  hasCurrency,
  type MoneyFormat,
} from "./format-money";

export type OrgMoney = {
  /** The org's base-currency code, or null when it has not set one -- or not known yet. */
  currency: string | null;
  /**
   * True once /api/currencies has answered (or failed). THREE states, not two:
   * `!loaded` is "we have not been told", `loaded && !currencySet` is "we asked
   * and there is none", `loaded && currencySet` is "AED". Collapsing the first
   * two is what made five screens flash "Currency not set → Settings" on every
   * page load for orgs that do have a currency.
   */
  loaded: boolean;
  /** False when the org has no currency row -- the screen owes the reader CURRENCY_NOT_SET_NOTICE. */
  currencySet: boolean;
  /**
   * `loaded && !currencySet`. The one flag a screen should gate the footer
   * notice on, so the three-state rule is decided here and not re-derived at
   * five call sites.
   */
  showNotice: boolean;
  format: MoneyFormat;
  /** Bound formatters, so a call site is `money(row.total)` and cannot pass the wrong currency. */
  money: (value: number | string | null | undefined, override?: Partial<MoneyFormat>) => string;
  signedMoney: (value: number | string | null | undefined, override?: Partial<MoneyFormat>) => string;
  /** " (AED)" for a column header, or "" when there is nothing honest to say. */
  unitSuffix: string;
  notice: string;
};

/**
 * The org's currency comes from /api/currencies (VERIDIAN's erp_currencies
 * base row) via the existing useCurrencies() hook -- see format-money.ts's
 * header for why that and not /api/organization.
 *
 * NEXT_PUBLIC_DEFAULT_CURRENCY_CODE is deliberately NOT read here. It is a
 * deployment-wide guess, and R-260's rule is that a screen with no per-org
 * currency renders bare numbers behind a warning glyph and says so once,
 * rather than labelling an amount with a code nobody confirmed.
 */
export function useOrgMoney(): OrgMoney {
  const { currencies, loaded } = useCurrenciesState();
  const currency = currencies.find((c) => c.isBaseCurrency)?.code ?? null;

  return useMemo(() => {
    // `pending` is what keeps the first paint honest: no code, and no warning
    // glyph either. The unitSuffix falls out of the same fact -- a column
    // header must not gain " (AED)" mid-read, so it stays empty until the
    // answer arrives and then appears once.
    const format: MoneyFormat = { currency, pending: !loaded };
    const currencySet = hasCurrency(format);
    return {
      currency,
      loaded,
      currencySet,
      showNotice: loaded && !currencySet,
      format,
      money: (value, override) => formatMoney(value, { ...format, ...override }),
      signedMoney: (value, override) => formatSignedMoney(value, { ...format, ...override }),
      unitSuffix: currencyUnitSuffix(format) ?? "",
      notice: CURRENCY_NOT_SET_NOTICE,
    };
  }, [currency, loaded]);
}
