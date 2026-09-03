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
    // R67 D-26 contract: committed is vendor + material + manpower (105,000)
    // against a 25,000 budget, so 80,000 OVER -- i.e. -80,000 remaining.
    committed: 105000,
    variance: -80000,
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
    committed: null,
    variance: null,
  },
];

const REPORT = {
  lines: LINES,
  boqId: "boq-1",
  totalBudget: 35000,
  totalVendorAmount: 30000,
  totalCommitted: 105000,
  totalVariance: -80000,
  totalMaterialAmount: 60000,
  totalManpowerAmount: 15000,
  linesOverBudget: 1,
  lineCount: 2,
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
      ok({ lines: [], boqId: null, totalBudget: 0, totalVendorAmount: 0, totalCommitted: null, totalVariance: null, linesOverBudget: 0, lineCount: 0, totalMaterialAmount: 0, totalManpowerAmount: 0 });
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

// ---------------------------------------------------------------------------
// R67 MERGE (D-11, lane D1 x lane D21, 2026-09-03) -- RESTATED, NOT DELETED.
//
// Lane D21 shipped these five assertions against CostVarianceAnalyticalClient,
// the screen D-62 replaces with this one. That component and its test file are
// deleted (their subject is gone), so the assertions move here and are restated
// against BudgetAnalyticalClient. The BEHAVIOUR each one pins down is
// unchanged; only the mounting component and, where D-62 renamed a control, the
// wording differ. Deleting them because they no longer compiled would have
// silently dropped every check on D-26's cost tiles and variance chart.
// ---------------------------------------------------------------------------
describe("D-26 cost tiles and variance chart (restated from CostVarianceAnalyticalClient)", () => {
  const UNCOSTED = {
    boqId: "boq-1",
    lines: LINES.map((l) => ({ ...l, vendorAmount: null, materialAmount: null, manpowerAmount: null, committed: null, variance: null })),
    totalBudget: 35000,
    totalVendorAmount: 0,
    totalCommitted: null,
    totalVariance: null,
    totalMaterialAmount: 0,
    totalManpowerAmount: 0,
    linesOverBudget: 0,
    lineCount: 2,
  };

  test("with nothing costed, Committed reads as an en dash rather than a fabricated zero", async () => {
    budgetResponse = () => ok(UNCOSTED);
    const view = await renderLoaded();
    const tile = view.getByText("Committed (vendor + material + manpower)").parentElement;
    expect(tile?.textContent).toContain("–");
    expect(tile?.textContent).not.toContain("AED 0");
  });

  test("'Lines over budget' is counted OF the visible lines, not left as a bare number", async () => {
    budgetResponse = () => ok(UNCOSTED);
    const view = await renderLoaded();
    expect(view.getByText("0 of 2")).toBeTruthy();
  });

  test("with no committed cost the chart slot says so and links to the current BOQ", async () => {
    budgetResponse = () => ok(UNCOSTED);
    const view = await renderLoaded();
    expect(
      view.getByText(/No committed cost yet - enter vendor, material or manpower amounts on a BOQ line to see variance\./)
    ).toBeTruthy();
    expect(view.getByRole("link", { name: "Open the current BOQ" }).getAttribute("href")).toBe("/scope/boq-1");
  });

  test("Filter and Export are REAL header actions -- neither carries 'Not yet available'", async () => {
    const view = await renderLoaded();
    expect(view.queryByText(/Not yet available/)).toBeNull();
  });

  test("a costed, over-budget line makes the tiles real and counts itself", async () => {
    const view = await renderLoaded();
    // The default REPORT has li-1 committed at 105,000 against a 25,000 budget
    // and li-2 uncosted, so exactly one of the two lines is over budget.
    await waitFor(() => expect(view.getByText("1 of 2")).toBeTruthy());
    const tile = view.getByText("Committed (vendor + material + manpower)").parentElement;
    expect(tile?.textContent).toContain("105,000");
  });

  // The defect the auto-merge hid: D-26 flipped `variance` to mean budget
  // REMAINING, so a NEGATIVE figure is the overrun. Before this merge the cell
  // painted `variance > 0` red, which coloured every healthy line as a problem
  // and every real overrun as fine.
  test("an over-budget line is coloured as late, and an under-budget line is not", async () => {
    budgetResponse = () =>
      ok({
        ...UNCOSTED,
        lines: [
          { ...LINES[0], vendorAmount: 30000, materialAmount: null, manpowerAmount: null, committed: 30000, variance: -5000 },
          { ...LINES[1], vendorAmount: 2000, materialAmount: null, manpowerAmount: null, committed: 2000, variance: 8000 },
        ],
        totalCommitted: 32000,
        totalVariance: 3000,
        linesOverBudget: 1,
        lineCount: 2,
      });
    const view = await renderLoaded();
    // Found by the status class rather than by a formatted string: the money
    // helper prefixes the code and then the sign ("AED -5,000"), and pinning
    // that exact spelling here would make this a test of the formatter.
    const varianceCells = [...view.container.querySelectorAll("span")].filter((s) =>
      s.className.includes("--color-veri-status")
    );
    expect(varianceCells).toHaveLength(2);
    const over = varianceCells.find((s) => s.textContent!.includes("5,000"))!;
    const under = varianceCells.find((s) => s.textContent!.includes("8,000"))!;
    expect(over).toBeDefined();
    expect(under).toBeDefined();
    expect(over.className).toContain("late");
    expect(under.className).toContain("done");
  });
});
