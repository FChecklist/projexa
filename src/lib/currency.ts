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

/**
 * R67 G-05 fix. `[]` used to mean TWO different things and a caller had no way
 * to tell them apart: "the /api/currencies request has not answered yet" and
 * "this org genuinely has no currency row". currencyLabel() above did not care
 * -- it fell back to CURRENCY_FALLBACK_LABEL in both cases -- but useOrgMoney()
 * does: it must say "Currency not set -> Settings" in the second case and must
 * NOT say it in the first, because for an org that HAS a currency that sentence
 * is simply false, and it would flash on every page load.
 *
 * `loaded` is set on BOTH outcomes: a failed fetch is still a settled question
 * as far as the UI is concerned -- we asked, we have no currency, so the honest
 * render is the bare-number one, not a permanent loading state.
 */
export type CurrenciesState = { currencies: Currency[]; loaded: boolean };

// R67 F-04 (R-060), merged with G-05 above. The org's currency list is the
// definition of session-stable reference data -- it changes when somebody
// changes the org's currencies, which is approximately never -- and yet EVERY
// component calling useCurrencies() used to mount its own independent fetch, on
// every mount, on every navigation. /scope alone has two consumers; a page with
// three money tables made three identical requests.
//
// One in-flight promise is now shared across every caller in the tab, and the
// resolved list is remembered in sessionStorage so a navigation re-renders with
// the code ALREADY THERE rather than flashing an unlabelled number.
// sessionStorage (not localStorage) on purpose: it dies with the tab. It does
// NOT die on sign-out on its own, so M24Shell calls clearCurrenciesCache()
// there -- see that call site; without it a second sign-in in the same tab
// could read the previous org's codes until the refetch landed.
const CURRENCIES_SESSION_KEY = "px.currencies";

/**
 * `ok` distinguishes a real answer from a failed one. Both settle the question
 * (`loaded` becomes true either way, per G-05), but only a real answer may
 * replace a list we already have -- otherwise one flaky request would blank
 * every money label on the page.
 */
type CurrenciesLoadResult = { currencies: Currency[]; ok: boolean };

let currenciesPromise: Promise<CurrenciesLoadResult> | null = null;

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

function loadCurrenciesResult(): Promise<CurrenciesLoadResult> {
  if (!currenciesPromise) {
    currenciesPromise = fetch("/api/currencies")
      .then((r) => r.json())
      .then((d) => {
        const currencies: Currency[] = d.currencies ?? [];
        writeCachedCurrencies(currencies);
        return { currencies, ok: true };
      })
      .catch(() => {
        // A failed lookup must not be cached as "this org has no currencies"
        // -- that would render every amount unlabelled for the whole session.
        // Clear the memo so the next mount retries.
        currenciesPromise = null;
        return { currencies: [], ok: false };
      });
  }
  return currenciesPromise;
}

/** The shared list, for non-React callers. One request per tab. */
export function loadCurrencies(): Promise<Currency[]> {
  return loadCurrenciesResult().then((result) => result.currencies);
}

/**
 * Drops both halves of the cache. Called on sign-out (M24Shell): sessionStorage
 * outlives a sign-out inside one tab, and the currency list is org-scoped data.
 */
export function clearCurrenciesCache(): void {
  currenciesPromise = null;
  try {
    sessionStorage.removeItem(CURRENCIES_SESSION_KEY);
  } catch {
    // nothing to clear
  }
}

// Test seam: bun test runs every file in one process, so the module-level memo
// above would otherwise leak between test files. Same function, named for the
// job it does in a suite.
export const __resetCurrenciesCacheForTests = clearCurrenciesCache;

/**
 * Wraps the fetch-once pattern every fixed file used to duplicate by hand
 * (`useEffect(() => { fetch("/api/currencies")... }, [])`). Safe to call from
 * any number of components: they share one request, and after the first they
 * render with the list already in hand.
 */
export function useCurrenciesState(): CurrenciesState {
  // Deliberately starts empty even when a cached list exists: this hook runs
  // inside components that are server-rendered first, and seeding state from
  // sessionStorage (which the server does not have) would make the client's
  // first render disagree with the HTML it is hydrating. The cache is read in
  // the effect below instead -- synchronously, before the network call, so the
  // code still appears in the same commit rather than a round trip later.
  const [state, setState] = useState<CurrenciesState>({ currencies: [], loaded: false });
  useEffect(() => {
    let active = true;
    // A cached list was only ever written after a real answer, so it settles
    // the G-05 question too: `loaded` is true, and no screen flashes
    // "Currency not set" for an org that has one.
    const cached = readCachedCurrencies();
    if (cached) setState({ currencies: cached, loaded: true });
    loadCurrenciesResult().then((result) => {
      if (!active) return;
      // Never overwrite a good cached list with an empty failure result -- but
      // the question is settled either way.
      if (!result.ok && cached) setState({ currencies: cached, loaded: true });
      else setState({ currencies: result.currencies, loaded: true });
    });
    return () => {
      active = false;
    };
  }, []);
  return state;
}

/**
 * The list alone, for the ~30 call sites that pair it with currencyLabel() and
 * have no use for the settled flag. A thin wrapper, deliberately: the two must
 * share ONE fetch shape, or the "loading" window would differ between the
 * screens that check it and the screens that do not.
 */
export function useCurrencies(): Currency[] {
  return useCurrenciesState().currencies;
}
