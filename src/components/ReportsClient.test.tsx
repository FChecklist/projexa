/// <reference types="bun-types" />
// R62 B7 regression test for R55_REPORTS_RUN_REPORT_RAW_DUMP_01 (fixed in
// projexa#187, squash SHA 4be56b602f; r43_faults.wf_test was false).
//
// ORIGINAL DEFECT (found live at /reports, project-status report, R55
// 17-screen demo-path walk, farid@meridian-demo.ae): the API call succeeded
// with real values (budget:0, revenue:0, expenses:0, delayedTaskCount:0,
// photoCount:1, taskCount:0, projectValue:null, earnedValue:0,
// contractValue:2750), but ReportOutput rendered raw API field NAMES
// ("projectId", "budget", "revenue", ...) as user-facing labels instead of
// human text, and most of the numeric values did not visibly render. Only
// projectId, projectName and contractValue showed anything -- and
// contractValue itself was a bare, currency-less number
// (R55_REPORTS_CONTRACTVALUE_NO_AED_01, fixed in the same PR).
//
// THE FIX (PR #187, two parts):
//   1. ReportOutput.tsx grew an optional `fieldFormatters` prop, applied to
//      the rendered VALUE the same way `fieldLabels` already applied to the
//      label -- see ReportOutput.test.tsx for that half's own direct test.
//   2. ReportsClient.tsx's REPORT_FIELD_LABELS["project-status"] gained real
//      labels for every field the raw dump exposed (contractValue, budget,
//      revenue, expenses, projectValue, earnedValue, delayedTaskCount,
//      photoCount, taskCount, projectId, projectName -- previously only the
//      two percent fields had entries), and wired a contractValue
//      value-formatter that prefixes the org's live base-currency code.
//
// This suite renders the real, full ReportsClient (not a stub) against the
// exact payload shape the fault was found with, runs the report the same
// way a user would (Select a report, click Run Report), and asserts the
// rendered DOM shows human labels + a currency-prefixed contractValue --
// the actual end-to-end behaviour a real user sees, not just that the two
// source files changed.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// bun test runs every *.test.ts(x) file in ONE process; registering twice
// throws. Register only if nothing has installed a DOM yet -- same guard as
// every other React suite in this repo (e.g. PayrollClient.test.tsx).
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// Dynamic import: ReportsClient (and its Radix Select/Tabs chain) must not
// be evaluated before GlobalRegistrator.register() has run above -- same
// reasoning documented in PayrollClient.test.tsx.
const ReportsClient = (await import("./ReportsClient")).default;

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

// The exact field/value shape recorded live in the fault row (r43_faults,
// R55_REPORTS_RUN_REPORT_RAW_DUMP_01).
const PROJECT_STATUS_PAYLOAD = {
  projectId: "proj-1",
  projectName: "Marina Tower",
  budget: 0,
  revenue: 0,
  expenses: 0,
  delayedTaskCount: 0,
  photoCount: 1,
  taskCount: 0,
  projectValue: null,
  earnedValue: 0,
  contractValue: 2750,
};

const DEFAULTS: Record<string, () => Response> = {
  "/api/reports/project-status": () => jsonRes(PROJECT_STATUS_PAYLOAD),
  "/api/currencies": () =>
    jsonRes({ currencies: [{ id: "cur-aed", code: "AED", name: "UAE Dirham", symbol: "AED", isBaseCurrency: true }] }),
};

describe("R55_REPORTS_RUN_REPORT_RAW_DUMP_01 regression (project-status report)", () => {
  test("running the project-status report shows human labels, not raw camelCase field names", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, queryByText } = render(<ReportsClient projectId="proj-1" />);

    fireEvent.click(getByText("Run Report"));

    // The original defect: the label shown was the literal API key
    // ("budget", "revenue", ...). It must now be the human label.
    await waitFor(() => expect(getByText("Budget")).toBeDefined());
    expect(getByText("Revenue")).toBeDefined();
    expect(getByText("Expenses")).toBeDefined();
    expect(getByText("Delayed Tasks")).toBeDefined();
    expect(getByText("Site Photos")).toBeDefined();
    expect(getByText("Tasks")).toBeDefined();
    expect(getByText("Project Value")).toBeDefined();
    expect(getByText("Earned Value")).toBeDefined();
    expect(getByText("Contract Value")).toBeDefined();

    // The raw keys themselves must not appear anywhere as a label.
    expect(queryByText("budget")).toBeNull();
    expect(queryByText("revenue")).toBeNull();
    expect(queryByText("delayedTaskCount")).toBeNull();
    expect(queryByText("contractValue")).toBeNull();
  });

  test("zero-valued fields (budget/revenue/expenses/taskCount) actually render their value, not a blank", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, getAllByText } = render(<ReportsClient projectId="proj-1" />);

    fireEvent.click(getByText("Run Report"));

    await waitFor(() => expect(getByText("Budget")).toBeDefined());
    // Four distinct fields share the value 0 in this payload (budget,
    // revenue, expenses, taskCount) -- the original defect was these VALUES
    // going missing from the DOM even though the API returned them.
    expect(getAllByText("0").length).toBeGreaterThanOrEqual(4);
  });

  test("contractValue renders currency-prefixed (AED), not a bare number (R55_REPORTS_CONTRACTVALUE_NO_AED_01, same PR)", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, queryByText } = render(<ReportsClient projectId="proj-1" />);

    fireEvent.click(getByText("Run Report"));

    await waitFor(() => expect(getByText("AED 2750")).toBeDefined());
    // A bare, unlabelled contractValue is the pre-fix rendering.
    expect(queryByText("2750")).toBeNull();
  });
});
