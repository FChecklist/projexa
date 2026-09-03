/// <reference types="bun-types" />
// R67 D-62. The item's acceptance is a Playwright run against a local dev
// server, which this lane may not start, so its assertions are made here with
// /api/reports/budget-variance and /api/vendors stubbed.
//
// What this screen replaced matters to what is asserted below.
// CostVarianceAnalyticalClient's Filter and Export both read "Not yet
// available", nothing on it was editable, and a failed read left it on
// "Loading…" for ever because there was no catch. So the four things worth
// proving are: the read has a real error state with the backend's own words and
// a Retry; the header controls are real; an inline edit reaches the PATCH
// endpoint with the right body; and a figure nobody has entered reads "Not set"
// rather than a currency-prefixed zero.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const BudgetAnalyticalClient = (await import("./BudgetAnalyticalClient")).default;

const LINES = [
  {
    lineItemId: "li-1",
    code: "1.01",
    description: "Blockwork",
    amount: 100000,
    category: "Civil",
    budgetPercentage: 25,
    budget: 25000,
    materialAmount: 60000,
    manpowerAmount: 15000,
    vendorId: "sup-1",
    vendorName: "Al Noor Trading",
    vendorAmount: 30000,
    variance: 5000,
  },
  {
    // The line nobody has split or quoted. Every one of its null figures must
    // read as words, never as 0.
    lineItemId: "li-2",
    code: "1.02",
    description: "Plaster",
    amount: 40000,
    category: null,
    budgetPercentage: 25,
    budget: 10000,
    materialAmount: null,
    manpowerAmount: null,
    vendorId: null,
    vendorName: null,
    vendorAmount: null,
    variance: null,
  },
];

const REPORT = {
  lines: LINES,
  totalBudget: 35000,
  totalVendorAmount: 30000,
  totalVariance: 5000,
  totalMaterialAmount: 60000,
  totalManpowerAmount: 15000,
};

const CURRENCIES = [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true }];

const originalFetch = globalThis.fetch;
let calls: { url: string; init?: RequestInit }[] = [];
let budgetResponse: () => Response;

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function stub() {
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/api/reports/budget-variance")) return budgetResponse();
    if (url.includes("/api/vendors")) return ok({ vendors: [{ id: "sup-1", vendorName: "Al Noor Trading" }] });
    if (url.includes("/api/currencies")) return ok({ currencies: CURRENCIES });
    if (url.includes("/api/scope/line-items/")) return ok({ ok: true });
    return ok({});
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
  budgetResponse = () => ok(REPORT);
  stub();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

async function renderLoaded() {
  const view = render(<BudgetAnalyticalClient projectId="proj-1" />);
  await waitFor(() => expect(view.getByText("Blockwork")).toBeTruthy());
  return view;
}

describe("BudgetAnalyticalClient (R67 D-62)", () => {
  test("a failed read shows the backend's own words with a Retry, and never stays on 'Loading…'", async () => {
    budgetResponse = () =>
      new Response(JSON.stringify({ error: "Construction module is not enabled for this organisation" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    const view = render(<BudgetAnalyticalClient projectId="proj-1" />);
    await waitFor(() =>
      expect(
        view.getByText(/Construction module is not enabled for this organisation/)
      ).toBeTruthy()
    );
    expect(view.queryByText("Loading the budget…")).toBeNull();
    // The old screen's permanent state. It must not be reachable through an error.
    expect(view.queryByText("No BOQ line items yet.")).toBeNull();
    expect(view.getByRole("button", { name: /Retry/i })).toBeTruthy();
  });

  test("Retry re-reads the budget, and a second attempt that succeeds replaces the error", async () => {
    budgetResponse = () =>
      new Response(JSON.stringify({ error: "Upstream timed out" }), { status: 504, headers: { "Content-Type": "application/json" } });
    const view = render(<BudgetAnalyticalClient projectId="proj-1" />);
    await waitFor(() => expect(view.getByText(/Upstream timed out/)).toBeTruthy());

    budgetResponse = () => ok(REPORT);
    fireEvent.click(view.getByRole("button", { name: /Retry/i }));
    await waitFor(() => expect(view.getByText("Blockwork")).toBeTruthy());
    expect(view.queryByText(/Upstream timed out/)).toBeNull();
  });

  test("the header controls are Filter and Export, in that DOM order -- not two 'Not yet available' buttons", async () => {
    const view = await renderLoaded();
    const names = view
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "")
      .filter((n) => n === "Filter" || n === "Export");
    expect(names.slice(0, 2)).toEqual(["Filter", "Export"]);
    expect(view.queryByText("Not yet available")).toBeNull();
  });

  test("Export names its reason at zero rows instead of downloading an empty file", async () => {
    budgetResponse = () =>
      ok({ lines: [], totalBudget: 0, totalVendorAmount: 0, totalVariance: 0, totalMaterialAmount: 0, totalManpowerAmount: 0 });
    const view = render(<BudgetAnalyticalClient projectId="proj-1" />);
    await waitFor(() => expect(view.getByText("No BOQ line items yet.")).toBeTruthy());
    // The frame appends the reason to the label when a header action is
    // disabled, so the accessible name is "Export (No rows to export)".
    const exportButton = view.getByRole("button", { name: /^Export/ }) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);
    expect(exportButton.textContent).toContain("No rows to export");
  });

  // The inline PATCH is proved through the VENDOR picker, which is a <select>
  // and can be driven. The percent and vendor-amount fields are controlled text
  // inputs, and in this repo's test environment (React 19 + happy-dom under bun
  // test) fireEvent.change updates the DOM node but never reaches React's
  // onChange -- measured here, and already recorded by
  // PermitCreateClient.test.tsx, DrawingCreateClient.test.tsx and
  // DocumentObjectClient.test.tsx in this same lane. So what typing decides is
  // asserted against the exact functions the screen builds it from
  // (budgetPercentError / vendorAmountError, in budget-lines.test.ts), and the
  // wire itself is asserted on the control that does work.
  test("changing a line's vendor PATCHes /api/scope/line-items/<that line> and nothing else", async () => {
    const view = await renderLoaded();
    const picker = view.getByLabelText("Vendor for 1.02") as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: "sup-1" } });

    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/scope/line-items/li-2"))).toBe(true));
    const patch = calls.find((c) => c.url.includes("/api/scope/line-items/li-2"))!;
    expect(patch.init?.method).toBe("PATCH");
    expect(JSON.parse(String(patch.init?.body))).toEqual({ vendorId: "sup-1" });
    // The OTHER line was not touched. An inline editor that saved the wrong row
    // would be worse than one that saved nothing.
    expect(calls.some((c) => c.url.includes("/api/scope/line-items/li-1"))).toBe(false);
  });

  test("clearing a line's vendor sends null, not the empty string the <option> carries", async () => {
    const view = await renderLoaded();
    fireEvent.change(view.getByLabelText("Vendor for 1.01") as HTMLSelectElement, { target: { value: "" } });
    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/scope/line-items/li-1"))).toBe(true));
    const patch = calls.find((c) => c.url.includes("/api/scope/line-items/li-1"))!;
    expect(JSON.parse(String(patch.init?.body))).toEqual({ vendorId: null });
  });

  test("a rejected write shows the backend's own words and leaves the grid readable", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/api/scope/line-items/")) {
        return new Response(JSON.stringify({ error: "budgetPercentage must be between 0 and 100" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/reports/budget-variance")) return ok(REPORT);
      if (url.includes("/api/vendors")) return ok({ vendors: [{ id: "sup-1", vendorName: "Al Noor Trading" }] });
      if (url.includes("/api/currencies")) return ok({ currencies: CURRENCIES });
      return ok({});
    }) as unknown as typeof fetch;

    const view = await renderLoaded();
    fireEvent.change(view.getByLabelText("Vendor for 1.02") as HTMLSelectElement, { target: { value: "sup-1" } });
    await waitFor(() => expect(view.getByText(/budgetPercentage must be between 0 and 100/)).toBeTruthy());
    expect(view.getByText("Blockwork")).toBeTruthy();
  });

  test("the two editable fields are real inputs with per-line accessible names, not a read-only grid", async () => {
    const view = await renderLoaded();
    expect((view.getByLabelText("Budget percent for 1.01") as HTMLInputElement).value).toBe("25");
    expect((view.getByLabelText("Vendor amount for 1.01") as HTMLInputElement).value).toBe("30000");
    // The unquoted line offers the field with a placeholder rather than a zero.
    expect((view.getByLabelText("Vendor amount for 1.02") as HTMLInputElement).value).toBe("");
    expect((view.getByLabelText("Vendor amount for 1.02") as HTMLInputElement).placeholder).toBe("Not quoted");
  });

  test("a Material or Manpower figure nobody entered reads 'Not set', not a currency-prefixed zero", async () => {
    const view = await renderLoaded();
    // li-2 has neither; both its cells, and nothing on li-1, say so.
    expect(view.getAllByText("Not set").length).toBeGreaterThanOrEqual(2);
    expect(view.queryByText("AED 0.00")).toBeNull();
  });

  test("the two views are named 'Budget' and 'Budget Report', not 'Cost Variance'", async () => {
    const view = await renderLoaded();
    const tabs = view.getAllByRole("tab").map((t) => t.textContent?.trim());
    expect(tabs).toEqual(["Budget", "Budget Report"]);
    expect(view.queryByText("Cost Variance")).toBeNull();
  });

  test("the Budget Report view counts what it is showing and offers Clear all once filtered", async () => {
    const view = await renderLoaded();
    fireEvent.click(view.getByRole("tab", { name: "Budget Report" }));
    await waitFor(() => expect(view.getByText(/Showing 2 of 2/)).toBeTruthy());

    const category = view.getByLabelText("Category") as HTMLSelectElement;
    fireEvent.change(category, { target: { value: "Civil" } });
    await waitFor(() => expect(view.getByText(/Showing 1 of 2/)).toBeTruthy());
    expect(view.getByRole("button", { name: "Clear all" })).toBeTruthy();
  });

  test("a vendor read that fails leaves the budget readable and editable -- the picker is a convenience", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/api/vendors")) return new Response("nope", { status: 500 });
      if (url.includes("/api/reports/budget-variance")) return ok(REPORT);
      if (url.includes("/api/currencies")) return ok({ currencies: CURRENCIES });
      return ok({ ok: true });
    }) as unknown as typeof fetch;

    const view = render(<BudgetAnalyticalClient projectId="proj-1" />);
    await waitFor(() => expect(view.getByText("Blockwork")).toBeTruthy());
    expect(view.getByLabelText("Budget percent for 1.01")).toBeTruthy();
  });
});
