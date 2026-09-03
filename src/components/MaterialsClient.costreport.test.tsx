/// <reference types="bun-types" />
// R67 E-05 (R-103). The item's own acceptance, run for real: open the Cost
// Report tab and, WITHOUT CLICKING, expect a row containing "Grand Total" and
// a value matching /^AED [\d,]+\.\d{2}$/.
//
// R-103's finding was that this tab was "a summary card wearing the word
// report": no parameters, no total, no export. The assertions below are the
// three halves of that -- it runs by pressing nothing, it ties, and Export
// carries its reason when it cannot be offered.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- guarded, like every other happy-dom suite here.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
// NOT `screen`: @testing-library/dom binds its queries to document.body at
// module-evaluation time, above GlobalRegistrator.register().

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  // The merged MaterialsClient reads the pathname to keep the open tab in the
  // URL, so the mock has to answer it or the module fails to load at all.
  usePathname: () => "/materials",
}));

// Dynamically imported so the @radix-ui/react-tabs chain is evaluated AFTER
// register() has created `document` -- see ProcurementClient.test.tsx.
const MaterialsClient = (await import("./MaterialsClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const REPORT = {
  rows: [
    {
      key: "m-cement", materialId: "m-cement", name: "OPC Cement 53 Grade", spec: "53 Grade",
      vendorId: "v-alpha", vendorName: "Alpha Trading LLC", unit: "bag",
      totalQuantityReceived: 200, totalCost: 5000, averageUnitCost: 25, masterUnitCost: 24, variance: 1,
    },
    {
      key: "m-steel", materialId: "m-steel", name: "TMT Steel 12mm", spec: null,
      vendorId: null, vendorName: "No vendor recorded", unit: "kg",
      totalQuantityReceived: 1000, totalCost: 3600, averageUnitCost: 3.6, masterUnitCost: null, variance: null,
    },
  ],
  totals: { quantity: 1200, cost: 8600 },
  params: { projectId: "p-1", from: null, to: "2026-09-02", groupBy: "material" },
};

function stubFetch(calls: string[], report: unknown = REPORT) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/api/currencies")) return jsonRes({ currencies: [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true }] });
    if (url.includes("/api/construction-materials/cost-report")) return jsonRes({ report });
    if (url.includes("/api/materials/master")) return jsonRes({ materials: [] });
    if (url.includes("/api/materials")) return jsonRes({ receipts: [] });
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

describe("Materials > Cost Report (R67 E-05 / R-103)", () => {
  test("it runs by pressing NOTHING, and the Grand Total is a real money figure", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { findByTestId, getByTestId } = render(<MaterialsClient projectId="p-1" initialTab="cost-report" />);

    const total = await findByTestId("cost-report-grand-total");
    expect(total.textContent).toContain("Grand Total");
    const cost = getByTestId("cost-report-grand-total-cost").textContent ?? "";
    expect(cost).toMatch(/^AED [\d,]+\.\d{2}$/);
    expect(cost).toBe("AED 8,600.00");
  });

  test("the vendor and variance columns the data always had are on screen", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { findByTestId, getByText, getAllByText } = render(<MaterialsClient projectId="p-1" initialTab="cost-report" />);
    await findByTestId("cost-report-grand-total");

    expect(getByText("Alpha Trading LLC")).toBeDefined();
    // "Vendor" is on screen twice now, and both are wanted: the COLUMN, and
    // E-05's Material|Vendor group-by control beside the period.
    expect(getAllByText("Vendor").length).toBeGreaterThan(0);
    expect(getAllByText("Material").length).toBeGreaterThan(0);
    // MERGE (2026-09-03): the shipped header is D-57's "Variance vs master",
    // which names WHAT the variance is against -- the column E-05 asked for,
    // under the wording already on screen.
    expect(getByText("Variance vs master")).toBeDefined();
  });

  test("a figure that does not exist renders the en dash, never a fabricated zero", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { findByTestId, getAllByText } = render(<MaterialsClient projectId="p-1" initialTab="cost-report" />);
    await findByTestId("cost-report-grand-total");
    // TMT Steel has no master unit cost, so no variance can be computed. The
    // merged table renders an absent figure as the em dash this screen already
    // used for every other one, rather than introducing a second dash.
    expect(getAllByText("—").length).toBeGreaterThan(0);
  });

  test("the period and the grouping really reach the request", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    render(<MaterialsClient projectId="p-1" initialTab="cost-report" initialFrom="2026-01-01" initialTo="2026-09-02" />);

    await waitFor(() => expect(calls.some((u) => u.includes("/api/construction-materials/cost-report"))).toBe(true));
    const call = calls.find((u) => u.includes("/api/construction-materials/cost-report"))!;
    expect(call).toContain("from=2026-01-01");
    expect(call).toContain("to=2026-09-02");
    expect(call).toContain("groupBy=material");
  });

  test("an empty range says which range and what to do -- never a blank card", async () => {
    const calls: string[] = [];
    stubFetch(calls, { rows: [], totals: { quantity: 0, cost: 0 }, params: { projectId: "p-1", from: "2026-01-01", to: "2026-09-02", groupBy: "material" } });

    const { findByTestId } = render(<MaterialsClient projectId="p-1" initialTab="cost-report" initialFrom="2026-01-01" initialTo="2026-09-02" />);
    const empty = await findByTestId("cost-report-empty");
    expect(empty.textContent).toBe("No receipts between 01-01-2026 and 02-09-2026 — widen the range");
  });

  test("rows that do not sum to the total say so LOUDLY, and Export carries that as its reason", async () => {
    const calls: string[] = [];
    stubFetch(calls, { ...REPORT, totals: { quantity: 1200, cost: 9000 } });

    const { findByTestId, getByTestId } = render(<MaterialsClient projectId="p-1" initialTab="cost-report" />);

    const banner = await findByTestId("cost-report-tie-error");
    expect(banner.textContent).toContain("Export is disabled");
    // R67 E-18 (R-178): the four separate export buttons are now the ONE
    // shared control, so "every format is blocked" is one assertion rather
    // than three -- and the reason is still readable beside it.
    expect((getByTestId("export-menu-button") as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId("export-share-reason").textContent).toContain("Export is disabled until this is fixed.");
    // The table is STILL rendered -- a reader needs the rows to find the
    // discrepancy the banner is about.
    expect(getByTestId("cost-report-grand-total")).toBeDefined();
  });
});
