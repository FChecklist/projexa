/// <reference types="bun-types" />
// R67 E-07 (R-114). The item's own acceptance, as far as a mount test can
// carry it: filter to a vendor and the row count drops AND the URL gains
// vendorId=; the CSV built for Export is the rows on screen; an empty filter
// says which filter emptied it and offers a way out; and Export is never a
// bare "(Not yet available)" again -- when it is off, it says why.
//
// The Playwright half of the acceptance (a real download compared against the
// screen) is not run here: this worktree shares node_modules through a
// junction and starts no dev server, per the programme's own rules.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- guarded, like every other happy-dom suite here.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const replaced: string[] = [];
let searchParams = new URLSearchParams();
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: (url: string) => { replaced.push(url); }, prefetch: () => {}, refresh: () => {} }),
  useSearchParams: () => searchParams,
}));

const CostVarianceAnalyticalClient = (await import("./CostVarianceAnalyticalClient")).default;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function report(overrides: Record<string, unknown> = {}) {
  const line = {
    lineItemId: "l1", boqId: "boq-1", sNo: 1, isRootLine: true, parentLineItemId: null,
    code: "C-01", description: "Blockwork", category: "Civil", quantity: 120, rate: 45, unit: "m2",
    amount: 5400, budgetPercentage: 25, budget: 1350,
    materialAmount: null, manpowerAmount: null,
    vendorId: "v1", vendorName: "Alpha Contracting LLC", vendorAmount: 1500, variance: 150,
  };
  return {
    boqId: "boq-1", boqTitle: "Main BOQ v2",
    lines: [line, { ...line, lineItemId: "l2", sNo: 2, code: "C-02", description: "Site clearance", category: null, amount: 3375, budget: 843.75, vendorId: null, vendorName: null, vendorAmount: null, variance: null }],
    subTaskLineCount: 0,
    totalBudget: 2193.75, totalVendorAmount: 1500, totalVariance: 150, totalMaterialAmount: 0, totalManpowerAmount: 0,
    availableCategories: ["Civil"],
    availableVendors: [{ id: "v1", name: "Alpha Contracting LLC" }],
    filters: { categories: [], vendorId: null, groupBy: "scope" },
    revenueBudgetActual: { groupBy: "scope", rows: [], totals: { revenue: 8775, budget: 2193.75, actual: 1500, variance: -693.75, percentUsed: 68.4 } },
    categorySubtotals: [],
    ...overrides,
  };
}

/** Records every fetched URL, so "the filters reached the API" is a fact and not an inference. */
function stubFetch(calls: string[], payload: unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/api/currencies")) return jsonRes({ currencies: [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true }] });
    if (url.includes("/api/vendors")) return jsonRes({ vendors: [{ id: "v1", supplierName: "Alpha Contracting LLC" }] });
    if (url.includes("/api/reports/budget-variance")) return jsonRes(payload);
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
  replaced.length = 0;
  searchParams = new URLSearchParams();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("CostVarianceAnalyticalClient: real filters, in the URL (R67 E-07)", () => {
  test("renders Sumeet's columns and a Grand Total that states the report's own total", async () => {
    const calls: string[] = [];
    stubFetch(calls, report());
    const { findByTestId, getByText } = render(<CostVarianceAnalyticalClient projectId="p-1" />);

    const total = await findByTestId("variance-grand-total");
    expect(total.textContent).toContain("2,193.75");
    for (const header of ["S.No", "Category", "Code", "Description", "Qty", "Vendor"]) {
      expect(getByText(header)).toBeDefined();
    }
  });

  test("ACCEPTANCE: choosing a category writes it into the URL, so Back restores the filtered screen", async () => {
    const calls: string[] = [];
    stubFetch(calls, report());
    const { findByTestId } = render(<CostVarianceAnalyticalClient projectId="p-1" />);

    fireEvent.click(await findByTestId("variance-filter-toggle"));
    fireEvent.click(await findByTestId("variance-category-Civil"));
    await waitFor(() => expect(replaced.length).toBe(1));
    expect(replaced[0]).toContain("category=Civil");
  });

  test("the filters are sent to the API, so the totals under a filtered table are the totals OF that table", async () => {
    const calls: string[] = [];
    stubFetch(calls, report());
    searchParams = new URLSearchParams({ category: "Civil", vendorId: "v1" });
    render(<CostVarianceAnalyticalClient projectId="p-1" />);

    await waitFor(() => expect(calls.some((u) => u.includes("/api/reports/budget-variance"))).toBe(true));
    const call = calls.find((u) => u.includes("/api/reports/budget-variance"))!;
    expect(call).toContain("category=Civil");
    expect(call).toContain("vendorId=v1");
  });

  test("an empty filter result says WHICH filter emptied it, and offers a way out", async () => {
    const calls: string[] = [];
    stubFetch(calls, report({ lines: [], totalBudget: null }));
    searchParams = new URLSearchParams({ category: "Joinery" });
    const { findByTestId, getByText } = render(<CostVarianceAnalyticalClient projectId="p-1" />);

    const empty = await findByTestId("variance-empty");
    expect(empty.textContent).toContain("No lines for Joinery");
    expect(getByText("Clear filters")).toBeDefined();
  });

  // R67 E-18 (R-178) rewired these three: the four separate header buttons are
  // now the ONE shared ExportShareActions control, so the formats live inside
  // its menu. The FACTS being asserted are unchanged -- the reason is readable,
  // all three formats are reachable, and a tie failure blocks the lot.
  test("Export is never a bare '(Not yet available)': with no rows it is disabled WITH its reason in words", async () => {
    const calls: string[] = [];
    stubFetch(calls, report({ lines: [], totalBudget: null }));
    const { findByTestId, queryByText } = render(<CostVarianceAnalyticalClient projectId="p-1" />);

    const reason = await findByTestId("variance-export-reason");
    expect(reason.textContent).toBe("No lines to export");
    expect((await findByTestId("export-menu-button")).hasAttribute("disabled")).toBe(true);
    expect(queryByText(/Not yet available/i)).toBeNull();
  });

  test("with rows on screen, all three exports are live", async () => {
    const calls: string[] = [];
    stubFetch(calls, report());
    const { findByTestId } = render(<CostVarianceAnalyticalClient projectId="p-1" />);

    const exportButton = await findByTestId("export-menu-button");
    expect(exportButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(exportButton);

    // PDF and XLSX are real links into the relay -- projexa builds neither
    // format itself -- and the CSV is built here from the rows on screen.
    expect((await findByTestId("export-pdf")).getAttribute("href")).toContain("/api/reports/budget-variance/export");
    expect((await findByTestId("export-pdf")).getAttribute("href")).toContain("format=pdf");
    expect((await findByTestId("export-xlsx")).getAttribute("href")).toContain("format=xlsx");
    expect((await findByTestId("export-csv")).tagName).toBe("BUTTON");
  });

  test("a totals mismatch blocks Export with the discrepancy named, because a wrong file outlives a wrong screen", async () => {
    const calls: string[] = [];
    stubFetch(calls, report({ totalBudget: 9999 }));
    const { findByTestId, queryByTestId } = render(<CostVarianceAnalyticalClient projectId="p-1" />);

    const reason = await findByTestId("variance-export-reason");
    expect(reason.textContent).toContain("Totals do not tie");
    const exportButton = await findByTestId("export-menu-button");
    expect(exportButton.hasAttribute("disabled")).toBe(true);
    // And the menu cannot be opened past it: a disabled control that still
    // hands over the link is not disabled.
    fireEvent.click(exportButton);
    expect(queryByTestId("export-menu-button-menu")).toBeNull();
  });

  test("a project with no BOQ says so, rather than showing an empty filter message about filters nobody set", async () => {
    const calls: string[] = [];
    stubFetch(calls, report({ boqId: null, lines: [], totalBudget: null }));
    const { findByTestId } = render(<CostVarianceAnalyticalClient projectId="p-1" />);
    expect((await findByTestId("variance-empty")).textContent).toContain("No BOQ approved for this project yet");
  });
});
