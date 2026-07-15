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

// id null/undefined means "org base currency" (see erp-selling-service.ts's
// resolveDocumentCurrency() comment) -- looks up the base-currency row in
// that case. Falls back to "₹" only if the currencies list hasn't loaded
// yet or genuinely has no base-currency row (matches the original
// currencyLabel()'s degradation case from PR #24).
export function currencyLabel(id: string | null | undefined, currencies: Currency[]): string {
  const c = id ? currencies.find((cur) => cur.id === id) : currencies.find((cur) => cur.isBaseCurrency);
  return c ? `${c.code} ` : "₹";
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