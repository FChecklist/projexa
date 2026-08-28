/// <reference types="bun-types" />
// R62 B7 regression test for A4S14_10 (High), fixed in PR #178.
//
// RECORDED: the Credit Notes tab never switches; "Create Invoice" is a dead
// no-op. The tab half is R48_LAYOUT_REFLOW_01's, not this file's -- its Tabs
// usage is the plain shared primitive with static labels; nothing here can
// move a tab. NOT re-tested here for that reason.
//
// WHAT THIS FILE ACTUALLY FIXED:
//  1. The dialog TRIGGER is not dead. createInvoice() opened with TWO
//     silent guards -- `if (!description.trim() || !rate) return;` and
//     `if (!customerId || ...) return;` -- while the button was only
//     `disabled={submitting}`. Any of Customer/Description/Rate empty
//     swallowed the click with no message.
//  2. The invoice list read `.json()` with res.ok never checked, so a
//     failing upstream rendered "No invoices found." instead of the failure.
//
// This test fails without the fix: reverting the invoice list load() to a
// bare `res.json()` makes "No invoices found." render on a real 500 instead
// of DataLoadError with the backend's message; reverting Create Invoice's
// disabled wiring to `disabled={submitting}` makes it enabled with every
// required field still empty.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const InvoicesClient = (await import("./InvoicesClient")).default;

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

describe("InvoicesClient (A4S14_10)", () => {
  test("a failing invoice-list load shows the backend's own error, never the confident 'No invoices found.' empty state", async () => {
    globalThis.fetch = router({
      "/api/sales-invoices": () => jsonRes({ error: "VERIDIAN request timed out after 20000ms" }, 504),
    });

    const { getByRole, queryByText } = render(<InvoicesClient />);

    const alert = await waitFor(() => getByRole("alert"));
    expect(alert.textContent).toContain("VERIDIAN request timed out after 20000ms");
    expect(queryByText("No invoices found.")).toBeNull();
  });

  test("Create Invoice is disabled while Customer/Description/Rate are empty and names all three", async () => {
    globalThis.fetch = router({
      "/api/sales-invoices": () => jsonRes({ salesInvoices: [], totalPages: 1 }),
    });

    const { getByRole } = render(<InvoicesClient />);

    await waitFor(() => getByRole("button", { name: /Create Invoice/i }));
    fireEvent.click(getByRole("button", { name: /Create Invoice/i }));

    const dialog = within(await waitFor(() => getByRole("dialog")));
    const submitButton = dialog.getByRole("button", { name: "Create Invoice" });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.getByText(/3 required fields left: Customer, Description, Rate/)).toBeDefined();
  });
});
