/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-33 (E-10). The project line search panel: it draws only the window of rows the worker sent back, says which
// engine answered, narrows on typing, widens to every BOQ and revision on request, and lets only the newest question write to the page.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import BoqLineExplorer from "./BoqLineExplorer";
import { createBoqFilterClient, type BoqFilterClient } from "@/lib/boq-filter-client";
import type { BoqFilterResult } from "@/lib/boq-filter-engine";
import type { GatewayBoqLine } from "@/lib/boq-gateway-client";

const { __resetCurrenciesCacheForTests } = await import("@/lib/currency");

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  __resetCurrenciesCacheForTests();
  globalThis.fetch = realFetch;
});

function stubCurrencies() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ currencies: [{ code: "AED", isBaseCurrency: true }] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
}

function line(n: number, over: Partial<GatewayBoqLine> = {}): GatewayBoqLine {
  return {
    id: `line-${String(n).padStart(4, "0")}`, boqId: "boq-a", boqTitle: "Villa 21", boqVersion: 1, boqStatus: "approved", parentLineItemId: null,
    activityId: null, itemCode: `IC-${n}`, category: "Civil", description: `Excavation ${n}`, unit: "m3", quantity: "12", rate: "5", amount: "60", ...over,
  };
}

async function filled(lines: GatewayBoqLine[]) {
  const client = createBoqFilterClient({ createWorker: () => null });
  await client.append(lines);
  return client;
}


describe("BoqLineExplorer", () => {
  test("250 matching lines put 100 rows on the page, say so, and Show more adds 100", async () => {
    stubCurrencies();
    const client = await filled(Array.from({ length: 250 }, (_, i) => line(i + 1)));
    const { getAllByTestId, getByTestId, getByRole } = render(<BoqLineExplorer client={client} boqId="boq-a" indexedLines={250} />);
    await waitFor(() => expect(getAllByTestId("boq-explorer-row").length).toBe(100));
    expect(getByTestId("boq-explorer-count").textContent).toContain("Showing 100 of 250 matching lines (250 in this BOQ)");

    fireEvent.click(getByRole("button", { name: /Show 100 more/ }));
    await waitFor(() => expect(getAllByTestId("boq-explorer-row").length).toBe(200));
    fireEvent.click(getByRole("button", { name: /Show 50 more/ }));
    await waitFor(() => expect(getAllByTestId("boq-explorer-row").length).toBe(250));
  });

  test("asks the client for a 100-row window of this BOQ on mount, and widens the scope and the window on request", async () => {
    stubCurrencies();
    const asked: Array<{ query: string; boqId: string | null; limit: number }> = [];
    const client: BoqFilterClient = {
      kind: "worker", reset: async () => {}, append: async () => 0, dispose: () => {},
      filter: async (q) => {
        asked.push(q);
        return { total: 250, matched: 250, indexed: 250, rows: Array.from({ length: Math.min(q.limit, 250) }, (_, i) => line(i + 1)) };
      },
    };
    const { getAllByTestId, getByRole } = render(<BoqLineExplorer client={client} boqId="boq-a" indexedLines={250} />);
    await waitFor(() => expect(getAllByTestId("boq-explorer-row").length).toBe(100));
    expect(asked[0]).toEqual({ query: "", boqId: "boq-a", limit: 100 });

    fireEvent.click(getByRole("button", { name: "All BOQs in project" }));
    await waitFor(() => expect(asked.at(-1)).toEqual({ query: "", boqId: null, limit: 100 }));
    fireEvent.click(getByRole("button", { name: /Show 100 more/ }));
    await waitFor(() => expect(asked.at(-1)).toEqual({ query: "", boqId: null, limit: 200 }));
    // going back to one BOQ starts the window over
    fireEvent.click(getByRole("button", { name: "This BOQ" }));
    await waitFor(() => expect(asked.at(-1)).toEqual({ query: "", boqId: "boq-a", limit: 100 }));
  });

  test("'This BOQ' shows only this BOQ's lines; 'All BOQs in project' adds the others with their revision label and status", async () => {
    stubCurrencies();
    const client = await filled([
      line(1, { boqId: "boq-a", description: "Slab" }),
      line(2, { boqId: "boq-b", boqTitle: "Villa 21", boqVersion: 1, boqStatus: "superseded", description: "Slab (old)" }),
    ]);
    const { getAllByTestId, getByRole, queryAllByText } = render(<BoqLineExplorer client={client} boqId="boq-a" indexedLines={2} />);
    await waitFor(() => expect(getAllByTestId("boq-explorer-row").length).toBe(1));
    // A count, not queryByText().toBeNull(): a failed toBeNull() makes bun print the whole DOM element, which takes minutes.
    expect(queryAllByText(/superseded/).length).toBe(0);

    fireEvent.click(getByRole("button", { name: "All BOQs in project" }));
    await waitFor(() => expect(getAllByTestId("boq-explorer-row").length).toBe(2));
    expect(getAllByTestId("boq-explorer-row")[1].textContent).toContain("Villa 21 · Rev0 (superseded)");
  });

  test("names the engine: a worker client says background worker, a main-thread client says main thread", async () => {
    stubCurrencies();
    const worker = await filled([line(1)]);
    const asWorker: BoqFilterClient = { ...worker, kind: "worker" };
    const first = render(<BoqLineExplorer client={asWorker} boqId="boq-a" indexedLines={1} />);
    await waitFor(() => expect(first.getByTestId("boq-explorer-count").textContent).toContain("in a background worker"));
    expect(first.getByTestId("boq-line-explorer").getAttribute("data-filter-engine")).toBe("worker");
    cleanup();

    const main = await filled([line(1)]);
    const second = render(<BoqLineExplorer client={main} boqId="boq-a" indexedLines={1} />);
    await waitFor(() => expect(second.getByTestId("boq-explorer-count").textContent).toContain("on the main thread"));
    expect(second.getByTestId("boq-line-explorer").getAttribute("data-filter-engine")).toBe("main");
  });

  test("a failed search shows its reason instead of an empty table", async () => {
    stubCurrencies();
    const broken: BoqFilterClient = {
      kind: "worker", reset: async () => {}, append: async () => 0, dispose: () => {},
      filter: async () => { throw new Error("The line search worker failed"); },
    };
    const { findByRole } = render(<BoqLineExplorer client={broken} boqId="boq-a" indexedLines={5} />);
    expect((await findByRole("alert")).textContent).toContain("The line search worker failed");
  });

  test("only the newest question writes to the page when answers come back out of order", async () => {
    stubCurrencies();
    const pending: Array<{ query: string; resolve: (r: BoqFilterResult & { indexed: number }) => void }> = [];
    const client: BoqFilterClient = {
      kind: "worker", reset: async () => {}, append: async () => 0, dispose: () => {},
      filter: (q) => new Promise((resolve) => pending.push({ query: q.query, resolve })),
    };
    const answer = (description: string) => ({ total: 1, matched: 1, indexed: 1, rows: [line(1, { description })] });
    const { getByRole, getAllByTestId } = render(<BoqLineExplorer client={client} boqId="boq-a" indexedLines={1} />);
    await waitFor(() => expect(pending.length).toBe(1)); // the first question, asked on mount
    fireEvent.click(getByRole("button", { name: "All BOQs in project" }));
    await waitFor(() => expect(pending.length).toBe(2)); // a newer question while the first is still unanswered
    pending[1].resolve(answer("Newest answer"));
    await waitFor(() => expect(getAllByTestId("boq-explorer-row")[0].textContent).toContain("Newest answer"));
    pending[0].resolve(answer("Stale answer"));
    await new Promise((r) => setTimeout(r, 20));
    expect(getAllByTestId("boq-explorer-row")[0].textContent).toContain("Newest answer");
  });
});
