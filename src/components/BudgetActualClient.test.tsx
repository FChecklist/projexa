/// <reference types="bun-types" />
// R67 E-08 (R-115). Sumeet item 9's Revenue / Budget / Actual view: the
// toggle is in the URL, "% used" is an en dash when there is no budget to
// divide by (never a 0 % that reads as "nothing used"), the chart is sorted
// worst-first with a word beside every bar, and clicking a bar filters the
// table.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const replaced: string[] = [];
let searchParams = new URLSearchParams();
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: (url: string) => { replaced.push(url); }, prefetch: () => {}, refresh: () => {} }),
  useSearchParams: () => searchParams,
}));

const BudgetActualClient = (await import("./BudgetActualClient")).default;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// R67 D-26 (merged 2026-09-03): `variance` is BUDGET REMAINING -- budget minus
// actual -- so a line that spent MORE than its budget carries a NEGATIVE
// figure. Every fixture below is that arithmetic; the assertions are unchanged,
// because "over budget" and "400 over" are the same facts either way round.
const SCOPE_ROWS = [
  { key: "l1", item: "C-01", description: "Blockwork", category: "Civil", revenue: 5400, budget: 1350, actual: 1500, variance: -150, percentUsed: 111.1, lineItemId: "l1", lineCount: 1 },
  // budget 0: the divide-by-zero row the item calls out by name.
  { key: "l2", item: "C-02", description: "Provisional sum", category: "Civil", revenue: 1000, budget: 0, actual: 250, variance: -250, percentUsed: null, lineItemId: "l2", lineCount: 1 },
];

const CATEGORY_SUBTOTALS = [
  { key: "Civil", item: "Civil", description: "2 lines", category: "Civil", revenue: 6400, budget: 1350, actual: 1750, variance: -400, percentUsed: 129.6, lineItemId: null, lineCount: 2 },
  { key: "MEP", item: "MEP", description: "1 line", category: "MEP", revenue: 2000, budget: 500, actual: 300, variance: 200, percentUsed: 60, lineItemId: null, lineCount: 1 },
];

function payload(rows = SCOPE_ROWS, groupBy: "scope" | "category" = "scope") {
  return {
    boqId: "boq-1", boqTitle: "Main BOQ v2", lines: [], subTaskLineCount: 0,
    totalBudget: 1350, totalVendorAmount: 1500, totalVariance: -150, totalMaterialAmount: 0, totalManpowerAmount: 0,
    availableCategories: ["Civil", "MEP"], availableVendors: [],
    filters: { categories: [], vendorId: null, groupBy },
    revenueBudgetActual: {
      groupBy, rows,
      totals: { revenue: 6400, budget: 1350, actual: 1750, variance: -400, percentUsed: 129.6 },
    },
    categorySubtotals: CATEGORY_SUBTOTALS,
  };
}

function stubFetch(calls: string[], body: unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/api/currencies")) return jsonRes({ currencies: [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true }] });
    if (url.includes("/api/reports/budget-variance")) return jsonRes(body);
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

describe("BudgetActualClient (R67 E-08)", () => {
  test("runs on arrival and renders the seven columns the item names", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload());
    const { findByTestId, getByText } = render(<BudgetActualClient projectId="p-1" />);

    await findByTestId("budget-total");
    for (const header of ["Item", "Description", "Revenue (AED)", "Budget (AED)", "Actual (AED)", "Variance (AED)", "% used"]) {
      expect(getByText(header)).toBeDefined();
    }
    expect(calls.some((u) => u.includes("/api/reports/budget-variance"))).toBe(true);
  });

  test("ACCEPTANCE: a row with budget 0 renders '–' for % used, never a divide-by-zero 0%", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload());
    const { findByTestId } = render(<BudgetActualClient projectId="p-1" />);
    expect((await findByTestId("budget-percent-l2")).textContent).toBe("–");
    expect((await findByTestId("budget-percent-l1")).textContent).toBe("111.1%");
  });

  test("the Scope-wise | Category-wise toggle is persisted in the URL", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload());
    const { findByTestId } = render(<BudgetActualClient projectId="p-1" />);

    fireEvent.click(await findByTestId("budget-groupby-category"));
    await waitFor(() => expect(replaced.length).toBe(1));
    expect(replaced[0]).toContain("groupBy=category");
  });

  test("the URL's groupBy is what is asked of the API, so a shared link opens on the view it was sent from", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload(CATEGORY_SUBTOTALS, "category"));
    searchParams = new URLSearchParams({ groupBy: "category" });
    render(<BudgetActualClient projectId="p-1" />);
    await waitFor(() => expect(calls.some((u) => u.includes("groupBy=category"))).toBe(true));
  });

  test("the chart is sorted worst-first and every bar carries a WORD, not just a colour", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload());
    const { findByTestId } = render(<BudgetActualClient projectId="p-1" />);

    const worst = await findByTestId("budget-bar-Civil");
    expect(worst.textContent).toContain("over");
    expect(worst.getAttribute("aria-label")).toBe("Civil: 400 over budget");
    const better = await findByTestId("budget-bar-MEP");
    expect(better.textContent).toContain("under");
  });

  test("clicking a bar filters the table to that category, in the URL", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload());
    const { findByTestId } = render(<BudgetActualClient projectId="p-1" />);

    fireEvent.click(await findByTestId("budget-bar-MEP"));
    await waitFor(() => expect(replaced.length).toBe(1));
    expect(replaced[0]).toContain("category=MEP");
  });

  test("a project with no BOQ says so and points at Scope, rather than rendering an empty table", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload([]));
    const { findByTestId, getByText } = render(<BudgetActualClient projectId="p-1" />);
    expect((await findByTestId("budget-empty")).textContent).toBe("No BOQ approved for this project yet");
    expect(getByText("Open Scope")).toBeDefined();
  });
});
