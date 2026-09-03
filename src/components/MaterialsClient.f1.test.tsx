/// <reference types="bun-types" />
// R67 F-07 (R-100) -- what SURVIVED of this lane's Materials assertions.
//
// ─── THE DESIGN THAT WON, AND WHY THIS FILE IS ONE TEST INSTEAD OF FOUR ─────
//
// Lane F1 made the three Materials tabs LAZY: landing fetched only the Material
// Master, and a tab cost a request when it was opened. Lane D3's D-37 landed
// first and chose the opposite: all three panes are read in parallel on mount,
// each with its OWN pane state, so a slow receipts ledger can no longer hold up
// the master table. Its suite asserts exactly that ("the Material Master paints
// while the receipts ledger and the cost report are still in flight").
//
// Both were solving the same measured fault -- a single loading flag that made
// the whole screen wait for the slowest read -- and only one can be true at a
// time. D-37's is the merged behaviour, under D-11 (the version already on main
// is canonical) and because it is the one with an item, a reviewer and 26
// passing tests behind it. So F1's three lazy-loading assertions are NOT
// re-stated here: they describe a screen this merge does not ship, and a test
// that passes by describing something else is worse than no test.
//
// THE TRADE, RECORDED RATHER THAN BURIED: D-37 pays three upstream reads on
// every landing where F1 paid one. That is deliberate and it is not free --
// VERIDIAN's app_runtime pool has five connections, and unnecessary parallel
// reads across screens are what the R66 pool-deadlock fix was about. It does
// NOT block first paint (that is the point of the split panes), so it is a
// bandwidth-and-pool question, not a latency one. Flagged for the owner rather
// than reversed by a merge.
//
// What remains below is the one property both designs share and neither suite
// asserted: a pane that has already answered is not read again when the user
// comes back to its tab.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/materials",
}));

const MaterialsClient = (await import("./MaterialsClient")).default;
const { __resetCurrenciesCacheForTests } = await import("@/lib/currency");

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  __resetCurrenciesCacheForTests();
  globalThis.fetch = realFetch;
});

const WAIT = { timeout: 8_000 } as const;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const CEMENT = {
  id: "m1", name: "Cement OPC 53", spec: null, unit: "bag", currentStock: "0", reorderLevel: null,
};

// Radix's TabsTrigger switches on mousedown, not on the click that follows it.
function activateTab(trigger: HTMLElement) {
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.click(trigger);
}

describe("MaterialsClient -- a pane that has answered is not read twice", () => {
  test("returning to a tab does not re-fetch it", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      if (url.includes("/api/materials/master")) return jsonRes({ materials: [CEMENT] });
      // R67 E-05 (merged 2026-09-03): the Cost Report endpoint answers with an
      // object -- rows, the grand total from the same grouped read, and the
      // parameters echoed back.
      if (url.includes("/api/construction-materials/cost-report")) {
        return jsonRes({ report: { rows: [], totals: { quantity: 0, cost: 0 }, params: { projectId: "p1", from: null, to: null, groupBy: "material" } } });
      }
      if (url.includes("/api/materials")) return jsonRes({ receipts: [] });
      return jsonRes({});
    }) as typeof fetch;

    const { getByText, getByRole } = render(<MaterialsClient projectId="p1" />);
    await waitFor(() => expect(getByText("Cement OPC 53")).toBeDefined(), WAIT);

    const countOf = (needle: string) => calls.filter((u) => u.includes(needle)).length;
    const masterReads = countOf("/api/materials/master");

    activateTab(getByRole("tab", { name: /Inbound Receipts/ }));
    activateTab(getByRole("tab", { name: /Material Master/ }));

    // Back on the master: the rows are still the ones already read.
    await waitFor(() => expect(getByText("Cement OPC 53")).toBeDefined(), WAIT);
    expect(countOf("/api/materials/master")).toBe(masterReads);
  });
});
