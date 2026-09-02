"use client";

// R67 G-05 (R-260). The client-side half of the money formatter: it resolves
// the org's currency once and hands back a bound formatter, so a screen never
// has to remember to pass the currency (and so cannot forget).
//
// src/lib/format-money.ts stays free of React and free of "use client" -- it
// is imported by Server Components too (the dashboard tiles render on the
// server). This module is the only place the two meet.

import { useMemo } from "react";
import { useCurrencies } from "./currency";
import {
  CURRENCY_NOT_SET_NOTICE,
  currencyUnitSuffix,
  formatMoney,
  formatSignedMoney,
  hasCurrency,
  type MoneyFormat,
} from "./format-money";

export type OrgMoney = {
  /** The org's base-currency code, or null when it has not set one. */
  currency: string | null;
  /** False when the org has no currency row -- the screen owes the reader CURRENCY_NOT_SET_NOTICE. */
  currencySet: boolean;
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
  const currencies = useCurrencies();
  const currency = currencies.find((c) => c.isBaseCurrency)?.code ?? null;

  return useMemo(() => {
    const format: MoneyFormat = { currency };
    return {
      currency,
      currencySet: hasCurrency(format),
      format,
      money: (value, override) => formatMoney(value, { ...format, ...override }),
      signedMoney: (value, override) => formatSignedMoney(value, { ...format, ...override }),
      unitSuffix: currencyUnitSuffix(format) ?? "",
      notice: CURRENCY_NOT_SET_NOTICE,
    };
  }, [currency]);
}
