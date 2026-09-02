"use client";

// Priority 17 re-sweep (2026-07-15): shared org-currency helper. The first
// fix (fix/currency-symbol-fallback, PR #24) added an identical
// `currencyLabel()` + local `Currency` type to 3 files independently
// (QuotationsClient.tsx / SalesOrdersClient.tsx / PurchaseOrdersClient.tsx).
// The re-sweep found further components with the same literal "₹"/"INR"
// hardcoding bug -- rather than copy-paste yet another local copy, this
// module is the one shared definition every one of those call sites (and
// the original 3) now imports. See CONTROLLER.yaml PRIORITY-17
// close_out_2026_07_15 for the gap history.
import { useEffect, useState } from "react";

export type Currency = { id: string; code: string; name: string; symbol: string | null; isBaseCurrency: boolean };

// R51 go-to-market (requirement R-62, "Dashboard and other screens show AED";
// R-63, "org has no currency row - would fall back to rupee").
//
// THE BUG. The fallback below used to be the literal "₹". That is not a
// rare degradation path -- it is the DEFAULT RENDER. useCurrencies() starts
// at [], so on EVERY page, for the whole window between first paint and the
// /api/currencies response, every money figure on screen was prefixed "₹".
// A UAE buyer opening the product sees rupees on the landing screen before
// anything loads. Measured 2026-08-26: 4 of 5 real orgs in compliance.
// erp_currencies have NO base-currency row at all, so for those orgs the
// "temporary" loading state is in fact permanent and every amount they will
// ever see is labelled in the wrong currency.
//
// WHY NOT JUST SWAP "₹" FOR "AED". Because that is the same bug with a
// different constant -- a library function asserting a currency it has not
// been told. The rule here is: NEVER render a currency token we cannot
// source. Two honest options remain, in order:
//   1. the deployment states its own market via NEXT_PUBLIC_DEFAULT_CURRENCY_CODE
//      (set to AED for projexa-ai.com), used only until the real per-org
//      value arrives;
//   2. if even that is unset, render the bare number with no currency token.
// An unlabelled "1,000" is recoverable -- the reader knows something is
// missing. A confidently wrong "₹1,000" is not: it reads as fact.
//
// This is deliberately a CODE ("AED ") and never a symbol, matching the
// resolved path below, so the fallback can never be mistaken for a
// confirmed per-org value at a glance.
// R67: this constant used to be defined here, but this module is "use client"
// so a server component could not reach it -- which is how the product ended
// up with several private money formatters. The single definition now lives in
// the server-safe src/lib/format-money.ts and is re-exported here so every
// existing client call site is unchanged.
export { DEFAULT_CURRENCY_CODE, CURRENCY_FALLBACK_LABEL } from "./format-money";
import { CURRENCY_FALLBACK_LABEL } from "./format-money";

// id null/undefined means "org base currency" (see erp-selling-service.ts's
// resolveDocumentCurrency() comment) -- looks up the base-currency row in
// that case.
export function currencyLabel(id: string | null | undefined, currencies: Currency[]): string {
  const c = id ? currencies.find((cur) => cur.id === id) : currencies.find((cur) => cur.isBaseCurrency);
  return c ? `${c.code} ` : CURRENCY_FALLBACK_LABEL;
}

// Wraps the fetch-once-on-mount pattern every fixed file used to duplicate
// by hand (`useEffect(() => { fetch("/api/currencies")... }, [])`). Safe to
// call from multiple components on the same page -- each mounts its own
// independent fetch, matching how these components already independently
// fetch their own report/list data.
export function useCurrencies(): Currency[] {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  useEffect(() => {
    fetch("/api/currencies").then((r) => r.json()).then((d) => setCurrencies(d.currencies ?? [])).catch(() => {});
  }, []);
  return currencies;
}
