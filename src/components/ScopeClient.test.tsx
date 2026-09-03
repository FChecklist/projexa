/// <reference types="bun-types" />
// R67 F-29 (audit recommendation R-273). The /scope list renders the compare
// summary that now arrives ON the list payload, and makes NO per-row request
// to do it -- the fan-out this item removes.

import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

// This is a "use client" screen that calls useRouter() for its row navigation.
// Outside the App Router there is no router context, so it is stubbed here --
// the navigation targets are not what this suite is about.
await mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/scope",
}));

const { default: ScopeClient, formatDeltaPct } = await import("./ScopeClient");
type Boq = import("./ScopeClient").Boq;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

const BASELINE: Boq = {
  id: "boq-1",
  version: 1,
  title: "Baseline",
  status: "superseded",
  parentBoqId: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  compare: { lineCount: 2, total: 5020, deltaAmount: null, deltaPct: null },
};

const REVISION: Boq = {
  id: "boq-2",
  version: 2,
  title: "Rev 1",
  status: "draft",
  parentBoqId: "boq-1",
  createdAt: "2026-09-02T00:00:00.000Z",
  compare: { lineCount: 3, total: 6025, deltaAmount: 1005, deltaPct: 20.019920318725098 },
};

describe("formatDeltaPct", () => {
  test("signs the change in both directions and keeps one decimal", () => {
    expect(formatDeltaPct(20.0199)).toBe("+20.0%");
    expect(formatDeltaPct(-4.56)).toBe("-4.6%");
    expect(formatDeltaPct(0)).toBe("0.0%");
  });

  test("an unknowable percentage is absent, NEVER rendered as 0%", () => {
    // A parent that totalled nothing has no percentage change. Printing "0%"
    // would state that nothing changed, when in fact nothing is KNOWN to have
    // changed -- and the amount beside it may be a large real increase.
    expect(formatDeltaPct(null)).toBeNull();
    expect(formatDeltaPct(undefined)).toBeNull();
    expect(formatDeltaPct(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("ScopeClient rows", () => {
  test("renders line count, total and the signed variation with its percentage, all from the list payload", async () => {
    const fetched: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      // A real base-currency row: R67 G-05 formats money from the org's own
      // currency, and with `currencies: []` these rows would render through the
      // "no currency set" path (a warning glyph and no code) -- a degraded
      // state, not the one a user normally sees.
      return new Response(
        JSON.stringify({ boqs: [], currencies: [{ id: "c-1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] }),
        { status: 200 }
      );
    }) as typeof fetch;

    const { getByText, container } = render(
      <ScopeClient projectId="p-1" initial={{ rows: [REVISION, BASELINE], errorMessage: null }} />
    );

    await waitFor(() => expect(getByText("Rev 1")).toBeDefined());

    // The compare summary is on screen...
    // Two decimals, because G-05 aligns a money column on the point; the code
    // is carried by the column header (unitSuffix), not repeated in the cell.
    expect(getByText("AED 6,025.00")).toBeDefined();
    expect(getByText("AED 5,020.00")).toBeDefined();
    expect(getByText(/\+1,005\.00/)).toBeDefined();
    expect(getByText("(+20.0%)")).toBeDefined();

    // ...and NOT ONE request was made to get it. The server passed the rows
    // down (D-04/F-18) and the compare figures rode with them (F-29), so the
    // per-row /api/scope/{id}/compare loop is gone in the strongest sense:
    // no /compare URL is fetched at all, for either row.
    expect(fetched.filter((url) => url.includes("/compare"))).toEqual([]);
    // And the list itself is not re-read either -- the props already answer it.
    expect(fetched.filter((url) => url.includes("/api/scope"))).toEqual([]);
    // The only call this screen still makes is the org currency lookup, which
    // is a session-scoped label, not per-row data.
    expect(fetched.every((url) => url.includes("/api/currencies"))).toBe(true);
    expect(container.innerHTML).not.toContain("/compare");
  });

  test("the baseline shows its own size but no variation -- 'Baseline (Rev0)', never a zero", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ boqs: [], currencies: [{ id: "c-1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] }),
        { status: 200 }
      )) as typeof fetch;

    const { getByText, queryByText } = render(
      <ScopeClient projectId="p-1" initial={{ rows: [BASELINE], errorMessage: null }} />
    );

    await waitFor(() => expect(getByText("Baseline")).toBeDefined());
    expect(getByText("Baseline (Rev0)")).toBeDefined();
    expect(getByText("AED 5,020.00")).toBeDefined();
    expect(queryByText("(0.0%)")).toBeNull();
  });

  test("a row from an older backend with no compare object renders en-dashes, not zeroes", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ boqs: [] }), { status: 200 })) as typeof fetch;

    const older: Boq = { ...REVISION, compare: undefined, variationVsPrior: 1005 };
    const { getByText, queryByText } = render(
      <ScopeClient projectId="p-1" initial={{ rows: [older], errorMessage: null }} />
    );

    await waitFor(() => expect(getByText("Rev 1")).toBeDefined());
    // The variation still renders from the older flat field...
    expect(getByText(/\+1,005/)).toBeDefined();
    // ...but "we were not told the line count" is an en-dash, never "0".
    expect(queryByText("(+20.0%)")).toBeNull();
  });

  test("the list region reports its state, so a latency measurement can see when it is usable (F-31)", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ boqs: [] }), { status: 200 })) as typeof fetch;

    const { container } = render(
      <ScopeClient projectId="p-1" initial={{ rows: [REVISION], errorMessage: null }} />
    );

    await waitFor(() => expect(container.querySelector("[data-state='ready']")).not.toBeNull());
  });
});
