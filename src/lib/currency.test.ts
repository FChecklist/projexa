/// <reference types="bun-types" />
// R67 G-05, review fix. useCurrencies() was rewritten to delegate to the new
// useCurrenciesState(), which adds the `loaded` flag useOrgMoney() needs to
// tell "not answered yet" from "this org has no currency". About thirty call
// sites pair useCurrencies() with currencyLabel() and know nothing about that
// flag, so this suite pins the contract they depend on: the same array, from
// the same single fetch, with the same [] before the answer arrives.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { CURRENCY_FALLBACK_LABEL, currencyLabel, useCurrencies, useCurrenciesState, type Currency } from "./currency";

afterEach(cleanup);

const AED: Currency = { id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true };
const USD: Currency = { id: "c2", code: "USD", name: "US Dollar", symbol: "$", isBaseCurrency: false };

function stubFetch() {
  let settle: (value: unknown) => void = () => {};
  let fail: (reason?: unknown) => void = () => {};
  let calls = 0;
  const pending = new Promise<unknown>((res, rej) => {
    settle = res;
    fail = rej;
  });
  (globalThis as { fetch: unknown }).fetch = (url: string) => {
    calls += 1;
    expect(url).toBe("/api/currencies");
    return pending;
  };
  return {
    calls: () => calls,
    resolve: (currencies: Currency[]) => settle({ json: async () => ({ currencies }) }),
    reject: () => fail(new Error("network down")),
  };
}

describe("useCurrencies keeps its old contract", () => {
  test("starts empty and then holds exactly what the route returned", async () => {
    const stub = stubFetch();
    const { result } = renderHook(() => useCurrencies());
    expect(result.current).toEqual([]);
    await act(async () => {
      stub.resolve([AED, USD]);
    });
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current.map((c) => c.code)).toEqual(["AED", "USD"]);
  });

  test("one mount, one fetch -- the delegation did not double it", async () => {
    const stub = stubFetch();
    renderHook(() => useCurrencies());
    await waitFor(() => expect(stub.calls()).toBe(1));
    await act(async () => {
      stub.resolve([AED]);
    });
    expect(stub.calls()).toBe(1);
  });

  test("a failed fetch leaves the array empty rather than throwing", async () => {
    const stub = stubFetch();
    const { result } = renderHook(() => useCurrencies());
    await act(async () => {
      stub.reject();
    });
    await waitFor(() => expect(result.current).toEqual([]));
  });
});

describe("useCurrenciesState adds the settled flag, and nothing else", () => {
  test("loaded is false before the answer and true after it", async () => {
    const stub = stubFetch();
    const { result } = renderHook(() => useCurrenciesState());
    expect(result.current).toEqual({ currencies: [], loaded: false });
    await act(async () => {
      stub.resolve([AED]);
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.currencies).toEqual([AED]);
  });

  test("a FAILED fetch settles too -- an unanswerable question is still answered", async () => {
    // Otherwise every money figure would stay in the bare, unexplained render
    // for the life of the page.
    const stub = stubFetch();
    const { result } = renderHook(() => useCurrenciesState());
    await act(async () => {
      stub.reject();
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.currencies).toEqual([]);
  });
});

describe("currencyLabel is untouched by the refactor", () => {
  test("names the base currency when given no id", () => {
    expect(currencyLabel(undefined, [AED, USD])).toBe("AED ");
    expect(currencyLabel(null, [AED, USD])).toBe("AED ");
  });

  test("names a specific currency by id", () => {
    expect(currencyLabel("c2", [AED, USD])).toBe("USD ");
  });

  test("falls back rather than inventing a symbol", () => {
    // R-62/R-63: never render a currency token we cannot source. The fallback
    // is a deployment-wide CODE or nothing -- never "₹".
    expect(currencyLabel(undefined, [])).toBe(CURRENCY_FALLBACK_LABEL);
    expect(CURRENCY_FALLBACK_LABEL).not.toContain("₹");
    expect(CURRENCY_FALLBACK_LABEL).not.toContain("$");
  });
});
