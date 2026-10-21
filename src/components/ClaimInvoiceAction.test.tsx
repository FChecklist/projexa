/// <reference types="bun-types" />
// R-94/R-95: "Invoice" on an approved billing claim. Drives the real component against a fake network: the PATCH carries
// {action:"invoice", billDate, taxTemplateId}; success shows the invoice number with a link to /invoices/<id>; the server's refusal
// ("No new progress to bill") is shown as worded and no success/link appears.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// the guided-error panel navigates with the app router
mock.module("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }), usePathname: () => "/billing-milestones", useSearchParams: () => new URLSearchParams() }));
import ClaimInvoiceAction from "./ClaimInvoiceAction";

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body: unknown }>;
let patch: { status: number; body: unknown };
let templates: Array<{ id: string; name: string; isDefault?: boolean }>;
let hang = false;

beforeEach(() => {
  calls = [];
  hang = false;
  templates = [{ id: "t1", name: "GST 18%" }];
  patch = { status: 200, body: { claim: {}, bill: { id: "b1" }, invoice: { id: "inv9", invoiceNumber: 41 } } };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (hang && init?.method === "PATCH") return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    return url.includes("tax-templates") ? json(200, { taxTemplates: templates }) : json(patch.status, patch.body);
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
    // GUIDED: the server's words are shown whole inside the guide panel (title, what happened, why, steps)
    expect(view.getByTestId("guided-error-what").textContent).toContain("No new progress to bill since the last interim bill");
    expect(view.getByTestId("guided-error-steps").children.length).toBeGreaterThan(0);
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

  test("without a tax template chosen nothing is sent (several templates, none marked default)", async () => {
    templates = [{ id: "t1", name: "GST 18%" }, { id: "t2", name: "GST 12%" }];
    const view = render(<ClaimInvoiceAction claimId="c1" />);
    fireEvent.click(view.getByTestId("claim-invoice-open"));
    await waitFor(() => expect(view.getByLabelText("Tax template").querySelectorAll("option").length).toBe(3));
    fireEvent.click(view.getByTestId("claim-invoice-confirm"));
    expect(view.getByTestId("fault-panel").getAttribute("data-fault-code")).toBe("BILL_TAX_TEMPLATE_MISSING");
    expect(view.getByTestId("guided-error-what").textContent).toContain("Choose the tax template");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  test("R-94/95 live: the only tax template and today's date are prefilled, so Confirm goes straight to the server and its refusal is shown word for word", async () => {
    patch = { status: 400, body: { error: "No new progress to bill" } };
    const view = render(<ClaimInvoiceAction claimId="c1" />);
    fireEvent.click(view.getByTestId("claim-invoice-open"));
    await waitFor(() => expect((view.getByLabelText("Tax template") as HTMLSelectElement).value).toBe("t1"));
    expect((view.getByLabelText("Bill date") as HTMLInputElement).value).toBe(new Date().toISOString().slice(0, 10));
    expect((view.getByTestId("claim-invoice-confirm") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(view.getByTestId("claim-invoice-confirm"));
    await waitFor(() => view.getByTestId("claim-invoice-error"));
    expect(view.getByTestId("guided-error-what").textContent).toContain("No new progress to bill");
  });

  test("R-94/95 live: of several templates the one the organisation marked default is chosen", async () => {
    templates = [{ id: "t1", name: "GST 18%" }, { id: "t2", name: "GST 12%", isDefault: true }];
    const view = render(<ClaimInvoiceAction claimId="c1" />);
    fireEvent.click(view.getByTestId("claim-invoice-open"));
    await waitFor(() => expect((view.getByLabelText("Tax template") as HTMLSelectElement).value).toBe("t2"));
  });

  test("R-94/95 live: a server that never answers does not leave the button disabled for ever; the person is told and can try again", async () => {
    hang = true;
    const view = render(<ClaimInvoiceAction claimId="c1" requestTimeoutMs={50} />);
    fireEvent.click(view.getByTestId("claim-invoice-open"));
    await waitFor(() => expect((view.getByLabelText("Tax template") as HTMLSelectElement).value).toBe("t1"));
    fireEvent.click(view.getByTestId("claim-invoice-confirm"));
    expect((view.getByTestId("claim-invoice-confirm") as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => view.getByTestId("claim-invoice-error"));
    expect(view.getByTestId("guided-error-what").textContent).toContain("may already have been raised");
    expect((view.getByTestId("claim-invoice-confirm") as HTMLButtonElement).disabled).toBe(false);
  });
});
