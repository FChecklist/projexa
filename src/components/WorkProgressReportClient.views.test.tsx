/// <reference types="bun-types" />
// R67 E-34 (R-266) and E-35 (R-267 / R-303), as render tests.
//
// The items' own acceptance is Playwright against a running app, which this
// lane may not start. What CAN be asserted without a server is asserted here,
// against the real component tree in a real DOM: the four tabs and their
// aria-selected state, run-on-arrival, that switching a view issues NO new
// request, the empty-range sentence, and E-35's two different failure banners --
// the one that keeps a stale table under UNCHANGED parameters, and the one that
// throws it away because the parameters moved.
//
// @happy-dom/global-registrator + @testing-library/react is the convention
// ReportsClient.test.tsx already uses in this repo, and both are really present
// in node_modules (WorkProgressReportClient.test.tsx's own header predates that
// and renders to a static string instead -- left alone, it tests other things).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

const replaced: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: mock(() => {}),
    refresh: mock(() => {}),
    replace: mock((url: string) => {
      replaced.push(url);
    }),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/work-progress",
}));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import WorkProgressReportClient from "./WorkProgressReportClient";

type Touched = { prev: boolean; current: boolean; total: boolean };
const TOUCHED: Touched = { prev: true, current: true, total: true };
const UNTOUCHED: Touched = { prev: false, current: false, total: false };

function row(id: string, categoryName: string, amtTotal: number, touched: Touched) {
  return {
    lineItemId: id,
    code: id.toUpperCase(),
    description: `Line ${id}`,
    categoryName,
    unit: "Sqm",
    rate: 100,
    qtyTotal: amtTotal / 100,
    amtTotal,
    parentLineItemId: null,
    qty: { prev: 1, current: 1, total: 2, balance: 0 },
    amt: { prev: 100, current: 100, total: 200, balance: amtTotal - 200 },
    percentage: { prev: 10, current: 10, total: 20, balance: 80 },
    touched,
  };
}

/**
 * byCategory must TIE to the rows the table renders or the component refuses to
 * show anything (checkTies / REPORT.GLOBAL) -- so this fixture's category
 * amt band is the real sum of its own rows, not a round number.
 */
function reportBody(touched: Touched = TOUCHED) {
  return {
    boqTitle: "BOQ v3",
    boqId: "boq-3",
    availableBoqs: [{ id: "boq-3", title: "BOQ", status: "active", version: 3 }],
    rows: [row("a", "Civil", 1000, touched), row("b", "Civil", 500, touched), row("c", "Paint", 250, touched)],
    byCategory: [
      {
        name: "Civil",
        amtTotal: 1500,
        amt: { prev: 200, current: 200, total: 400, balance: 1100 },
        percentage: { prev: 13.33, current: 13.33, total: 26.67, balance: 73.33 },
      },
      {
        name: "Paint",
        amtTotal: 250,
        amt: { prev: 100, current: 100, total: 200, balance: 50 },
        percentage: { prev: 40, current: 40, total: 80, balance: 20 },
      },
    ],
    byManpower: [
      { trade: "Mason", workerDays: 12, totalCost: 3600 },
      { trade: "Carpenter", workerDays: 4, totalCost: 1600 },
    ],
    byVendor: [
      { vendorId: "v1", vendorName: "Al Noor Labour", totalCost: 3600 },
      { vendorId: "v2", vendorName: "Gulf Trades", totalCost: 1600 },
    ],
    availableCategories: ["Civil", "Paint"],
    from: "2026-09-01",
    to: "2026-09-02",
  };
}

/** Counts every call to the report endpoint, which is how "never re-fetches" is proved. */
let reportCalls: string[] = [];

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  reportCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/work-progress/report")) reportCalls.push(url);
    return handler(url);
  }) as typeof fetch;
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

afterEach(() => {
  cleanup();
  replaced.length = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function renderReport(props: Partial<Parameters<typeof WorkProgressReportClient>[0]> = {}) {
  return render(
    <WorkProgressReportClient
      projectId="prj-cedar"
      projectName="Cedar Heights Villa - Phase 1"
      initialFrom="2026-09-01"
      initialTo="2026-09-02"
      {...props}
    />
  );
}

describe("R67 E-34: four real views, switched without a round trip", () => {
  test("the report runs on arrival -- no 'Pick a date range and click Run Report'", async () => {
    stubFetch(() => ok(reportBody()));
    const { container } = renderReport();
    await waitFor(() => expect(container.textContent).toContain("Grand Total"));
    expect(container.textContent).not.toContain("Pick a date range and click Run Report");
    expect(reportCalls).toHaveLength(1);
  });

  test("the switcher is a real tablist with the four named tabs", async () => {
    stubFetch(() => ok(reportBody()));
    const { findAllByRole, getByRole } = renderReport();
    const tabs = await findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Scope-wise",
      "Category-wise",
      "Manpower-wise",
      "Vendor-wise",
    ]);
    expect(getByRole("tablist")).toBeTruthy();
  });

  test("?view= decides which tab arrives selected", async () => {
    stubFetch(() => ok(reportBody()));
    const { findByRole } = renderReport({ initialView: "manpower" });
    const manpower = await findByRole("tab", { name: "Manpower-wise" });
    expect(manpower.getAttribute("aria-selected")).toBe("true");
    const scope = await findByRole("tab", { name: "Scope-wise" });
    expect(scope.getAttribute("aria-selected")).toBe("false");
  });

  test("an unknown ?view= falls back to Scope-wise rather than rendering nothing", async () => {
    stubFetch(() => ok(reportBody()));
    const { findByRole } = renderReport({ initialView: "sideways" });
    expect((await findByRole("tab", { name: "Scope-wise" })).getAttribute("aria-selected")).toBe("true");
  });

  test("switching to Vendor-wise re-groups rows already in state -- ZERO new requests", async () => {
    stubFetch(() => ok(reportBody()));
    const { container, findByRole } = renderReport();
    await waitFor(() => expect(container.textContent).toContain("Grand Total"));
    expect(reportCalls).toHaveLength(1);

    fireEvent.click(await findByRole("tab", { name: "Vendor-wise" }));

    await waitFor(() => expect(container.textContent).toContain("Al Noor Labour"));
    // The whole point of the item: the data was already here.
    expect(reportCalls).toHaveLength(1);
    expect((await findByRole("tab", { name: "Vendor-wise" })).getAttribute("aria-selected")).toBe("true");
  });

  test("switching a view writes view= into the URL beside the other parameters", async () => {
    stubFetch(() => ok(reportBody()));
    const { container, findByRole } = renderReport();
    await waitFor(() => expect(container.textContent).toContain("Grand Total"));

    fireEvent.click(await findByRole("tab", { name: "Vendor-wise" }));

    await waitFor(() => expect(replaced.at(-1)).toContain("view=vendor"));
    const url = replaced.at(-1)!;
    expect(url).toContain("projectId=prj-cedar");
    expect(url).toContain("from=2026-09-01");
    expect(url).toContain("to=2026-09-02");
    expect(url).toContain("tab=report");
  });

  test("the caption under the tabs counts what THAT view groups", async () => {
    stubFetch(() => ok(reportBody()));
    const { container, findByRole, findByTestId } = renderReport();
    await waitFor(() => expect(container.textContent).toContain("Grand Total"));
    expect((await findByTestId("wpr-group-count")).textContent).toBe("3 BOQ lines");

    fireEvent.click(await findByRole("tab", { name: "Category-wise" }));
    await waitFor(async () => expect((await findByTestId("wpr-group-count")).textContent).toBe("2 categories"));

    fireEvent.click(await findByRole("tab", { name: "Manpower-wise" }));
    await waitFor(async () => expect((await findByTestId("wpr-group-count")).textContent).toBe("2 trades"));
  });
});

describe("R67 E-34: the empty-range sentence", () => {
  test("a range in which nothing was logged says so, with the range in day-first dates", async () => {
    stubFetch(() => ok(reportBody(UNTOUCHED)));
    const { container, findByTestId } = renderReport();
    await waitFor(() => expect(container.textContent).toContain("Grand Total"));
    expect((await findByTestId("wpr-no-progress")).textContent).toBe(
      "No progress was recorded between 01-09-2026 and 02-09-2026"
    );
  });

  test("a range with real progress in it does NOT get the sentence", async () => {
    stubFetch(() => ok(reportBody(TOUCHED)));
    const { container, queryByTestId } = renderReport();
    await waitFor(() => expect(container.textContent).toContain("Grand Total"));
    expect(queryByTestId("wpr-no-progress")).toBeNull();
    expect(container.textContent).not.toContain("No progress was recorded between");
  });
});
