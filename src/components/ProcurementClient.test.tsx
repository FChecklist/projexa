/// <reference types="bun-types" />
// R43 F_032: load() fanned out across all 8 concurrent data sources with a
// single Promise.all, caught only the first rejection into one generic
// `loadError` string, and rendered it via <DataLoadError> only inside the
// Requisitions tab. The other four tabs (RFQs/Quotations/Purchase Orders/
// Goods Receipts) gated purely on `array.length === 0`, with no awareness of
// `loadError` -- so whenever Promise.all rejected (which it does on ANY of
// the 8 calls failing), none of the 8 setters ran, and every tab except
// Requisitions fell back to its plain "No X yet." empty copy on a real
// outage. Same defect class as F_031/PayrollClient.tsx, same fix shape.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws ("Failed to register. Happy DOM
// has already been globally registered."), and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own comment on
// this. Register only if no DOM is installed yet, so this suite still passes
// standalone AND alongside every other happy-dom-based suite.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// Dynamically imported (not a static top-level import) so this module -- and
// therefore its transitive @radix-ui/react-tabs -> @radix-ui/react-presence
// -> @radix-ui/react-use-layout-effect chain -- is only evaluated AFTER
// GlobalRegistrator.register() has run. @radix-ui/react-use-layout-effect
// decides real-vs-noop useLayoutEffect with a module-scope
// `globalThis?.document ? ... : ...` check; with a static import that check
// runs at this file's hoisted-import time, BEFORE register() has created
// `document`, permanently wiring Radix's Presence (tab-content mount/unmount
// on switch) to a no-op for the rest of the process. A dynamic import here
// defers evaluation to this line, by which point `document` already exists.
const ProcurementClient = (await import("./ProcurementClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Routes the fake global fetch by which /api path the request targets. */
function router(handlers: Record<string, () => Response>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

// Every one of the 8 sources load() reads, defaulted to a healthy empty
// response so each test only has to override the one or two it cares about.
const DEFAULTS: Record<string, () => Response> = {
  "/api/procurement/requisitions": () => jsonRes({ requisitions: [] }),
  "/api/procurement/rfqs": () => jsonRes({ rfqs: [] }),
  "/api/procurement/quotations": () => jsonRes({ quotations: [] }),
  "/api/procurement/purchase-orders": () => jsonRes({ purchaseOrders: [] }),
  "/api/procurement/goods-receipts": () => jsonRes({ goodsReceipts: [] }),
  "/api/vendors": () => jsonRes({ vendors: [] }),
  "/api/inventory/warehouses": () => jsonRes({ warehouses: [] }),
  "/api/inventory/items": () => jsonRes({ items: [] }),
};

describe("ProcurementClient (R43 F_032: single Promise.all -> Promise.allSettled, all 5 tabs surfacing)", () => {
  test("a Purchase Orders failure surfaces on the Purchase Orders tab, not just silently on Requisitions", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/procurement/purchase-orders": () => jsonRes({ error: "Purchase orders down (504)" }, 500),
    });

    const { getAllByText, getByRole, getByText, queryByText } = render(<ProcurementClient />);

    // Requisitions (default tab): genuinely empty, not itself a failure --
    // must show real empty-state copy.
    await waitFor(() => expect(getByText("No purchase requisitions yet.")).toBeDefined());

    // Radix Tabs switches on mousedown (see @radix-ui/react-tabs), not
    // click -- a plain fireEvent.click never fires it.
    fireEvent.mouseDown(getByRole("tab", { name: /Purchase Orders/i }), { button: 0 });

    await waitFor(() => expect(getAllByText(/Purchase orders down \(504\)/).length).toBeGreaterThan(0));
    expect(queryByText(/No purchase orders yet\./)).toBeNull();
  });

  test("Requisitions + RFQs failing together names BOTH errors, independently, on their own tabs -- Promise.all only ever surfaced the first", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/procurement/requisitions": () => jsonRes({ error: "Requisitions down (X)" }, 500),
      "/api/procurement/rfqs": () => jsonRes({ error: "RFQs down (Y)" }, 500),
    });

    const { getByRole, getByText, queryByText } = render(<ProcurementClient />);

    // Requisitions (default tab): its OWN error, not a fake empty state.
    await waitFor(() => expect(getByText(/Requisitions down \(X\)/)).toBeDefined());
    expect(queryByText("No purchase requisitions yet.")).toBeNull();

    // Switching tabs proves the RFQs failure was named independently too --
    // the old single `Promise.all` + one generic `loadError` could only ever
    // have surfaced ONE of these two, and only on the Requisitions tab.
    fireEvent.mouseDown(getByRole("tab", { name: /RFQs/i }), { button: 0 });
    await waitFor(() => expect(getByText(/RFQs down \(Y\)/)).toBeDefined());
    expect(queryByText("No RFQs yet.")).toBeNull();
  });

  test("one source failing does not discard a sibling's successful data (old Promise.all discarded ALL 8)", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/procurement/requisitions": () => jsonRes({ requisitions: [{ id: "r1", requisitionNumber: 42, purpose: "Rebar", status: "draft", postingDate: "2026-08-01", items: [] }] }),
      "/api/procurement/rfqs": () => jsonRes({ error: "RFQs down" }, 500),
    });

    const { getAllByText, getByRole, getByText, queryByText } = render(<ProcurementClient />);

    // The requisition that succeeded must still render on its tab...
    await waitFor(() => expect(getByText("PR-42")).toBeDefined());

    // ...and switching to the RFQs tab shows that source's own real error,
    // not a fake empty state -- while Requisitions kept its real data.
    fireEvent.mouseDown(getByRole("tab", { name: /RFQs/i }), { button: 0 });
    await waitFor(() => expect(getAllByText(/RFQs down/).length).toBeGreaterThan(0));
    expect(queryByText("No RFQs yet.")).toBeNull();
  });
});
