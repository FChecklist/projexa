/// <reference types="bun-types" />
// R67 F-07 (R-100/R-106) acceptance test — the runnable half.
//
// The item's acceptance is a Playwright run with request interception against
// a live server pair, which this lane may not start. Its one non-timing
// assertion is the one that catches the regression, and it is asserted here
// against the real component:
//
//   "exactly one materials data request (…/materials/master…) fires before
//    the first tab click"
//
// The fault: /materials fired THREE requests on mount -- the master, the
// receipts ledger and the server cost report -- behind a single loading flag,
// for a two-row table, on a page measured at TTFB 2006 ms / LCP 3244 ms. Only
// the master is on screen when the page opens.
//
// The third of those three is gone for good: the Cost Report is now derived
// from the receipts the browser already holds (src/lib/material-cost-report.ts,
// arithmetic identical to the server's so the two cannot disagree).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// `screen` is intentionally not imported: @testing-library/dom binds it to
// document.body at module-evaluation time, before GlobalRegistrator.register()
// has created `document`.
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), prefetch: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
}));

const MaterialsClient = (await import("./MaterialsClient")).default;
const { __resetCurrenciesCacheForTests } = await import("@/lib/currency");

afterEach(() => {
  cleanup();
  __resetCurrenciesCacheForTests();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Radix's TabsTrigger switches on mousedown, not on the click that follows it.
function activateTab(trigger: HTMLElement) {
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.click(trigger);
}

const MATERIALS = [
  { id: "m1", name: "OPC 53 Cement", spec: "53 grade", unit: "bag", unitCost: "24.5", isActive: true },
];
const RECEIPTS = [
  { id: "rc1", materialId: "m1", receivedDate: "2026-08-20", quantity: "100", unitCost: "24.5", vendorId: null },
  { id: "rc2", materialId: "m1", receivedDate: "2026-08-25", quantity: "50", unitCost: "25.5", vendorId: null },
];

function stubFetch() {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/api/materials/master")) return jsonRes({ materials: MATERIALS });
    if (url.includes("/api/construction-materials/cost-report")) return jsonRes({ report: [] });
    if (url.includes("/api/materials")) return jsonRes({ receipts: RECEIPTS });
    if (url.includes("/api/currencies")) return jsonRes({ currencies: [] });
    return jsonRes({});
  }) as typeof fetch;
  return calls;
}

const materialsDataCalls = (calls: string[]) =>
  calls.filter((u) => u.includes("/api/materials") || u.includes("/api/construction-materials"));

describe("MaterialsClient — one data call on landing", () => {
  test("exactly one materials data request fires before any tab click, and it is the master", async () => {
    const calls = stubFetch();

    const { getByText } = render(<MaterialsClient projectId="p1" />);
    await waitFor(() => expect(getByText("OPC 53 Cement")).toBeDefined());

    const data = materialsDataCalls(calls);
    expect(data).toHaveLength(1);
    expect(data[0]).toContain("/api/materials/master");
  });

  test("the server cost-report endpoint is never called by the screen -- the tab derives it", async () => {
    const calls = stubFetch();

    const { getByText, getByRole } = render(<MaterialsClient projectId="p1" />);
    await waitFor(() => expect(getByText("OPC 53 Cement")).toBeDefined());

    activateTab(getByRole("tab", { name: "Cost Report" }));

    // 3725 = 100 x 24.5 + 50 x 25.5, the same figure getMaterialCostReport()
    // produces server-side.
    await waitFor(() => expect(getByText("3725.00")).toBeDefined());
    expect(calls.filter((u) => u.includes("cost-report"))).toHaveLength(0);
  });

  test("the receipts ledger is fetched once and shared by the Inbound and Cost Report tabs", async () => {
    const calls = stubFetch();

    const { getByText, getByRole } = render(<MaterialsClient projectId="p1" />);
    await waitFor(() => expect(getByText("OPC 53 Cement")).toBeDefined());

    activateTab(getByRole("tab", { name: "Inbound Receipts" }));
    await waitFor(() =>
      expect(calls.filter((u) => u.includes("/api/materials") && !u.includes("master"))).toHaveLength(1)
    );

    activateTab(getByRole("tab", { name: "Cost Report" }));
    await waitFor(() => expect(getByText("3725.00")).toBeDefined());

    expect(calls.filter((u) => u.includes("/api/materials") && !u.includes("master"))).toHaveLength(1);
  });

  test("a failing receipts ledger shows its own error and leaves the master table intact", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/materials/master")) return jsonRes({ materials: MATERIALS });
      if (url.includes("/api/materials")) return jsonRes({ error: "Receipts ledger unavailable" }, 502);
      if (url.includes("/api/currencies")) return jsonRes({ currencies: [] });
      return jsonRes({});
    }) as typeof fetch;

    const { getByText, getByRole } = render(<MaterialsClient projectId="p1" />);
    await waitFor(() => expect(getByText("OPC 53 Cement")).toBeDefined());

    activateTab(getByRole("tab", { name: "Inbound Receipts" }));

    // The backend's own words, not an invented generic message.
    await waitFor(() => expect(getByText(/Receipts ledger unavailable/)).toBeDefined());
  });
});
