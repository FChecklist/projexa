/// <reference types="bun-types" />
// R62 B7 regression test for A4S14_08 (High), fixed in PR #178.
//
// RECORDED: (1) the Stock Balance / Warehouses / Items tablist never
// switches; (2) "New Warehouse" is a dead no-op -- clicked twice, no
// [role="dialog"] appears. (1) is R48_LAYOUT_REFLOW_01's, not this file's --
// its Tabs usage is the plain shared primitive with static labels; nothing
// here can move a tab. NOT re-tested here for that reason.
//
// WHAT THIS FILE ACTUALLY FIXED:
//  1. The dialog TRIGGER is not dead -- Radix opens it fine. "Add Warehouse"
//     (and "Add Item") inside the dialog did nothing: createWarehouse()
//     opened with `if (!whName.trim()) return;` while the button was only
//     `disabled={whSubmitting}` -- click lands, nothing happens, no message.
//  2. load() fired 3 fetches and read `.json()` on each with res.ok never
//     checked -- a 500 parsed fine, `?? []` emptied all three, and the page
//     rendered "No stock on hand yet." / "No warehouses yet." with NO error
//     surfaced at all.
//
// This test fails without the fix: reverting load() to bare `res.json()`
// calls makes the plain empty-state copy render on a real 500 instead of
// DataLoadError with the backend's message; reverting Add Warehouse's
// disabled wiring to `disabled={whSubmitting}` makes it enabled while
// Warehouse Name is still empty.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const InventoryClient = (await import("./InventoryClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function router(handlers: Record<string, () => Response>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

const HEALTHY: Record<string, () => Response> = {
  "/api/inventory/warehouses": () => jsonRes({ warehouses: [] }),
  "/api/inventory/items": () => jsonRes({ items: [] }),
  "/api/inventory/stock-balance": () => jsonRes({ balances: [] }),
};

describe("InventoryClient (A4S14_08)", () => {
  test("all three data sources failing shows the backend's own errors, never the confident 'No warehouses yet.' / 'No stock on hand yet.' empty states", async () => {
    globalThis.fetch = router({
      "/api/inventory/warehouses": () => jsonRes({ error: "Warehouses down (A)" }, 500),
      "/api/inventory/items": () => jsonRes({ error: "Items down (B)" }, 500),
      "/api/inventory/stock-balance": () => jsonRes({ error: "Stock balance down (C)" }, 500),
    });

    const { getByText, queryByText } = render(<InventoryClient />);

    await waitFor(() => expect(getByText(/Warehouses: Warehouses down \(A\)/)).toBeDefined());
    expect(getByText(/Items: Items down \(B\)/)).toBeDefined();
    expect(getByText(/Stock balance: Stock balance down \(C\)/)).toBeDefined();
    expect(queryByText("No warehouses yet.")).toBeNull();
    expect(queryByText("No stock on hand yet. Record a receipt to get started.")).toBeNull();
  });

  test("Add Warehouse is disabled while Warehouse Name is empty and names what's missing", async () => {
    globalThis.fetch = router(HEALTHY);

    const { getByRole } = render(<InventoryClient />);

    await waitFor(() => getByRole("button", { name: /New Warehouse/i }));
    fireEvent.click(getByRole("button", { name: /New Warehouse/i }));

    const dialog = within(await waitFor(() => getByRole("dialog")));
    const submitButton = dialog.getByRole("button", { name: "Add Warehouse" });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.getByText(/1 required field left: Warehouse Name/)).toBeDefined();
  });
});
