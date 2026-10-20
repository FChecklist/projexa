/// <reference types="bun-types" />
// R-94/R-95: "Invoice" on an approved billing claim. Drives the real component against a fake network: the PATCH carries
// {action:"invoice", billDate, taxTemplateId}; success shows the invoice number with a link to /invoices/<id>; the server's refusal
// ("No new progress to bill") is shown as worded and no success/link appears.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import ClaimInvoiceAction from "./ClaimInvoiceAction";

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body: unknown }>;
let patch: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  patch = { status: 200, body: { claim: {}, bill: { id: "b1" }, invoice: { id: "inv9", invoiceNumber: 41 } } };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    return url.includes("tax-templates") ? json(200, { taxTemplates: [{ id: "t1", name: "GST 18%" }] }) : json(patch.status, patch.body);
  }) as typeof fetch;
});
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

async function openAndPick(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByTestId("claim-invoice-open"));
  await waitFor(() => expect(view.getByLabelText("Tax template").querySelectorAll("option").length).toBe(2));
  fireEvent.change(view.getByLabelText("Tax template"), { target: { value: "t1" } });
}

describe("ClaimInvoiceAction", () => {
  test("raises the invoice through the existing PATCH and shows its number with a link to /invoices/<id>", async () => {
    const view = render(<ClaimInvoiceAction claimId="c1" />);
    await openAndPick(view);
    fireEvent.click(view.getByTestId("claim-invoice-confirm"));
    await waitFor(() => view.getByTestId("claim-invoice-receipt"));
    expect(view.getByTestId("claim-invoice-receipt").textContent).toContain("Invoice #41 raised");
    expect(view.getByTestId("claim-invoice-link").getAttribute("href")).toBe("/invoices/inv9");
    const sent = calls.find((c) => c.method === "PATCH")!;
    expect(sent.url).toBe("/api/billing-claims/c1");
    expect(sent.body).toMatchObject({ action: "invoice", taxTemplateId: "t1" });
    expect((sent.body as { billDate: string }).billDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("the server's refusal is shown as worded; no receipt, no link", async () => {
    patch = { status: 400, body: { error: "No new progress to bill since the last interim bill" } };
    const view = render(<ClaimInvoiceAction claimId="c1" />);
    await openAndPick(view);
    fireEvent.click(view.getByTestId("claim-invoice-confirm"));
    await waitFor(() => view.getByTestId("claim-invoice-error"));
    expect(view.getByTestId("claim-invoice-error").textContent).toBe("No new progress to bill since the last interim bill");
    expect(view.queryByTestId("claim-invoice-receipt")).toBeNull();
    expect(view.queryByTestId("claim-invoice-link")).toBeNull();
  });

  test("a success answer with no invoice in it is not shown as raised", async () => {
    patch = { status: 200, body: { claim: {} } };
    const view = render(<ClaimInvoiceAction claimId="c1" />);
    await openAndPick(view);
    fireEvent.click(view.getByTestId("claim-invoice-confirm"));
    await waitFor(() => view.getByTestId("claim-invoice-error"));
    expect(view.queryByTestId("claim-invoice-receipt")).toBeNull();
  });

  test("without a tax template chosen nothing is sent", async () => {
    const view = render(<ClaimInvoiceAction claimId="c1" />);
    fireEvent.click(view.getByTestId("claim-invoice-open"));
    await waitFor(() => expect(view.getByLabelText("Tax template").querySelectorAll("option").length).toBe(2));
    fireEvent.click(view.getByTestId("claim-invoice-confirm"));
    expect(view.getByTestId("claim-invoice-error").textContent).toBe("Choose the tax template");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});
