/// <reference types="bun-types" />
// R67 G-05, review fix. THE THREE STATES.
//
// The defect this suite exists to prevent: useCurrencies() returns [] both
// while /api/currencies is in flight AND when the org genuinely has no base
// currency, and useOrgMoney() collapsed the two into `currencySet === false`.
// Between first paint and the response, five screens (Scope, Labour,
// Materials, Reports, Material create) therefore rendered every figure as
// "⚠ 1,200.00", dropped the " (AED)" suffix from every money column header,
// and asserted "Currency not set → Settings" -- a sentence that is false for
// every org that does have a currency. It flashed on every page load.
//
// So: `!loaded` renders bare, `loaded && !currencySet` warns, and
// `loaded && currencySet` labels. Each is asserted below against a real hook
// render with a real (stubbed) fetch, not against the reducer in isolation.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useOrgMoney } from "./use-org-money";
import { clearCurrenciesCache } from "./currency";
import { CURRENCY_NOT_SET_NOTICE } from "./format-money";

afterEach(cleanup);
// R67 F-04 merge: useCurrenciesState() now shares ONE in-flight request (and
// one sessionStorage entry) across every caller in the tab. Without this the
// second test in this file would inherit the first one's settled answer, never
// call the stub, and pass or fail for reasons that have nothing to do with the
// three states it is asserting.
afterEach(clearCurrenciesCache);

type FetchStub = { resolve: (currencies: unknown[]) => void; reject: (reason?: unknown) => void };

/**
 * Replaces global fetch with one whose promise this test controls, so the
 * in-flight window -- the whole subject of this suite -- can actually be
 * observed instead of being raced against.
 */
function stubCurrenciesFetch(): FetchStub {
  let settle: (value: unknown) => void = () => {};
  let fail: (reason?: unknown) => void = () => {};
  const pending = new Promise<unknown>((res, rej) => {
    settle = res;
    fail = rej;
  });
  (globalThis as { fetch: unknown }).fetch = () => pending;
  return {
    resolve: (currencies) => {
      settle({ json: async () => ({ currencies }) });
    },
    reject: (reason) => {
      fail(reason ?? new Error("network down"));
    },
  };
}

const AED = [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true }];

describe("state 1 of 3: the answer has not arrived yet", () => {
  test("renders bare -- no currency code, and no warning glyph either", async () => {
    const stub = stubCurrenciesFetch();
    const { result } = renderHook(() => useOrgMoney());

    expect(result.current.loaded).toBe(false);
    expect(result.current.currency).toBeNull();
    expect(result.current.currencySet).toBe(false);
    // The three renders a screen actually makes during this window.
    expect(result.current.money(1200)).toBe("1,200.00");
    expect(result.current.unitSuffix).toBe("");
    expect(result.current.showNotice).toBe(false);

    // Tidy up so the pending promise does not outlive the test.
    await act(async () => {
      stub.resolve(AED);
    });
  });

  test("showNotice is false while pending, so the footer sentence cannot flash", async () => {
    const stub = stubCurrenciesFetch();
    const { result } = renderHook(() => useOrgMoney());
    expect(result.current.showNotice).toBe(false);
    await act(async () => {
      stub.resolve(AED);
    });
    // ...and it is STILL false afterwards, because this org has a currency.
    expect(result.current.showNotice).toBe(false);
  });
});

describe("state 2 of 3: we asked, and there is no currency", () => {
  test("an empty currency list warns -- glyph, no suffix, and the sentence", async () => {
    const stub = stubCurrenciesFetch();
    const { result } = renderHook(() => useOrgMoney());
    await act(async () => {
      stub.resolve([]);
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.currency).toBeNull();
    expect(result.current.currencySet).toBe(false);
    expect(result.current.showNotice).toBe(true);
    expect(result.current.money(1200)).toBe("⚠ 1,200.00");
    expect(result.current.unitSuffix).toBe("");
    expect(result.current.notice).toBe(CURRENCY_NOT_SET_NOTICE);
  });

  test("a list with no BASE row is the same fact as an empty list", async () => {
    const stub = stubCurrenciesFetch();
    const { result } = renderHook(() => useOrgMoney());
    await act(async () => {
      stub.resolve([{ id: "c9", code: "USD", name: "US Dollar", symbol: "$", isBaseCurrency: false }]);
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.currency).toBeNull();
    expect(result.current.showNotice).toBe(true);
  });

  test("a FAILED fetch settles too -- it does not hang in the bare state forever", async () => {
    // A permanent "we have not been told" would render every figure unlabelled
    // with no explanation at all, which is worse than the warning.
    const stub = stubCurrenciesFetch();
    const { result } = renderHook(() => useOrgMoney());
    await act(async () => {
      stub.reject();
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.showNotice).toBe(true);
    expect(result.current.money(1200)).toBe("⚠ 1,200.00");
  });
});

describe("state 3 of 3: the org has a currency", () => {
  test("labels the figure, fills the column-header suffix, and says nothing", async () => {
    const stub = stubCurrenciesFetch();
    const { result } = renderHook(() => useOrgMoney());
    await act(async () => {
      stub.resolve(AED);
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.currency).toBe("AED");
    expect(result.current.currencySet).toBe(true);
    expect(result.current.showNotice).toBe(false);
    expect(result.current.money(1200)).toBe("AED 1,200.00");
    expect(result.current.money(null)).toBe("–");
    expect(result.current.money(0)).toBe("AED 0.00");
    expect(result.current.signedMoney(2025)).toBe("▲ AED +2,025.00");
    expect(result.current.unitSuffix).toBe(" (AED)");
  });
});

describe("the regression itself, stated once", () => {
  test("the pending render and the no-currency render are DIFFERENT strings", async () => {
    const a = stubCurrenciesFetch();
    const { result } = renderHook(() => useOrgMoney());
    const whilePending = result.current.money(1200);
    await act(async () => {
      a.resolve([]);
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const whenAbsent = result.current.money(1200);

    expect(whilePending).not.toBe(whenAbsent);
    expect(whilePending).not.toContain("⚠");
    expect(whenAbsent).toContain("⚠");
  });
});
