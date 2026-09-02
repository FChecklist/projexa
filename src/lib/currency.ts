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
const DEFAULT_CURRENCY_CODE = (process.env.NEXT_PUBLIC_DEFAULT_CURRENCY_CODE ?? "").trim();

export const CURRENCY_FALLBACK_LABEL = DEFAULT_CURRENCY_CODE ? `${DEFAULT_CURRENCY_CODE} ` : "";

// id null/undefined means "org base currency" (see erp-selling-service.ts's
// resolveDocumentCurrency() comment) -- looks up the base-currency row in
// that case.
export function currencyLabel(id: string | null | undefined, currencies: Currency[]): string {
  const c = id ? currencies.find((cur) => cur.id === id) : currencies.find((cur) => cur.isBaseCurrency);
  return c ? `${c.code} ` : CURRENCY_FALLBACK_LABEL;
}

// R67 F-04 (R-060). The org's currency list is the definition of
// session-stable reference data -- it changes when somebody changes the org's
// currencies, which is approximately never -- and yet EVERY component calling
// useCurrencies() used to mount its own independent fetch, on every mount, on
// every navigation. /scope alone has two consumers; a page with three money
// tables made three identical requests.
//
// One in-flight promise is now shared across every caller in the tab, and the
// resolved list is remembered in sessionStorage so a navigation re-renders
// with the code ALREADY THERE rather than flashing an unlabelled number.
// sessionStorage (not localStorage) on purpose: it dies with the tab, so a
// user who switches org in a new session can never be shown the previous
// org's currency code.
const CURRENCIES_SESSION_KEY = "px.currencies";

let currenciesPromise: Promise<Currency[]> | null = null;

function readCachedCurrencies(): Currency[] | null {
  try {
    const raw = sessionStorage.getItem(CURRENCIES_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Currency[]) : null;
  } catch {
    // Private mode, disabled storage, corrupt entry -- all mean "no cache",
    // never a thrown error on a render path.
    return null;
  }
}

function writeCachedCurrencies(currencies: Currency[]): void {
  try {
    sessionStorage.setItem(CURRENCIES_SESSION_KEY, JSON.stringify(currencies));
  } catch {
    // Storage full or unavailable: the in-memory promise above still dedupes
    // for the life of this page, which is the larger half of the win.
  }
}

export function loadCurrencies(): Promise<Currency[]> {
  if (!currenciesPromise) {
    currenciesPromise = fetch("/api/currencies")
      .then((r) => r.json())
      .then((d) => {
        const currencies: Currency[] = d.currencies ?? [];
        writeCachedCurrencies(currencies);
        return currencies;
      })
      .catch(() => {
        // A failed lookup must not be cached as "this org has no currencies"
        // -- that would render every amount unlabelled for the whole session.
        // Clear the memo so the next mount retries.
        currenciesPromise = null;
        return [];
      });
  }
  return currenciesPromise;
}

// Test seam: bun test runs every file in one process, so the module-level
// memo above would otherwise leak between test files.
export function __resetCurrenciesCacheForTests(): void {
  currenciesPromise = null;
  try {
    sessionStorage.removeItem(CURRENCIES_SESSION_KEY);
  } catch {
    // nothing to clear
  }
}

// Wraps the fetch-once pattern every fixed file used to duplicate by hand
// (`useEffect(() => { fetch("/api/currencies")... }, [])`). Safe to call from
// any number of components: they share one request, and after the first they
// render with the list already in hand.
export function useCurrencies(): Currency[] {
  // Deliberately starts empty even when a cached list exists: this hook runs
  // inside components that are server-rendered first, and seeding state from
  // sessionStorage (which the server does not have) would make the client's
  // first render disagree with the HTML it is hydrating. The cache is read in
  // the effect below instead -- synchronously, before the network call, so the
  // code still appears in the same commit rather than a round trip later.
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  useEffect(() => {
    let active = true;
    const cached = readCachedCurrencies();
    if (cached && cached.length > 0) setCurrencies(cached);
    loadCurrencies().then((list) => {
      // Never overwrite a good cached list with an empty failure result.
      if (active && list.length > 0) setCurrencies(list);
    });
    return () => {
      active = false;
    };
  }, []);
  return currencies;
}
