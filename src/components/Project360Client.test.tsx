/// <reference types="bun-types" />
// Sumeet requirement #7/#8: proves the combined analysis view against
// mocked reads of the five already-real endpoints it aggregates, same
// convention as BudgetsClient.test.tsx.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const Project360Client = (await import("./Project360Client")).default;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Handler = () => Response | Promise<Response>;

function router(handlers: Record<string, Handler>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const path of Object.keys(handlers).sort((a, b) => b.length - a.length)) {
      if (url.includes(path)) return handlers[path]();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

const ANALYSIS_ROW = {
  hasBaseline: true,
  contractAtFirstConfirmation: 1000000,
  contractValueNow: 1080000,
  contractVariance: 80000,
  approvedVariationCount: 2,
  baselineEstimatedCost: 700000,
  committed: 720000,
  spent: 650000,
  commitmentDriftSign: "over_baseline" as const,
  costPerformanceSign: "under_baseline" as const,
  expectedProfitGross: 300000,
  actualProfit: { profitOnGross: 280000, profitOnGrossPercent: 25.9, profitOnNetReceivable: 250000, profitOnNetReceivablePercent: 23.1 },
  profitVsExpectedDelta: -20000,
};

function handlers(over: Partial<Record<string, Handler>> = {}): Record<string, Handler> {
  return {
    "/api/reports/boq-analysis": () => jsonRes({ row: ANALYSIS_ROW }),
    "/api/change-orders": () => jsonRes({ changeOrders: [{ id: "co1", status: "pending_approval", costImpact: "32000" }] }),
    "/api/milestones": () => jsonRes({ milestones: [{ id: "ms1", status: "completed", completionPercentage: 100 }] }),
    "/api/schedule/gantt": () => jsonRes({ tasks: [{ id: "t1", isCritical: true }, { id: "t2", isCritical: false }] }),
    "/api/billing-claims": () => jsonRes({ claims: [{ id: "c1", status: "submitted", isOverdue: true }] }),
    "/api/currencies": () => jsonRes({ currencies: [{ id: "c1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] }),
    ...over,
  };
}

function renderClient(over: Partial<Record<string, Handler>> = {}) {
  globalThis.fetch = router(handlers(over));
  return render(<Project360Client projectId="proj-1" projectName="Villa 21 - Whitefield" />);
}

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("Project360Client", () => {
  test("shows the profit answer, contract variance and the four combined summary tiles", async () => {
    const { getByText } = renderClient();
    await waitFor(() => expect(getByText("Profit & Loss — the answer")).toBeDefined());

    // THE ANSWER: actual vs expected, and the delta against the quoted margin.
    expect(getByText("25.9% margin")).toBeDefined();

    // Change of BOQ
    expect(getByText("2 approved revision(s)")).toBeDefined();
    expect(getByText("Committed: Over baseline")).toBeDefined();
    expect(getByText("Spent: Under baseline")).toBeDefined();

    // Combined summary tiles: scope changes, milestones, timeline, billing
    expect(getByText("1 pending decision")).toBeDefined();
    expect(getByText("100% average completion")).toBeDefined();
    expect(getByText("1 activities on the critical path")).toBeDefined();
    expect(getByText("1 overdue")).toBeDefined();
  });

  test("a project with no baseline confirmed yet says so honestly, not a blank chart", async () => {
    const { getByText, getAllByText } = renderClient({
      "/api/reports/boq-analysis": () => jsonRes({ row: { ...ANALYSIS_ROW, hasBaseline: false, contractAtFirstConfirmation: "NOT_SET", expectedProfitGross: "NOT_SET", profitVsExpectedDelta: "NOT_SET" } }),
    });
    await waitFor(() => expect(getByText(/No baseline has been confirmed/)).toBeDefined());
    expect(getAllByText("Not yet baselined").length).toBeGreaterThan(0);
  });

  test("a failed analysis read shows the real error, not a silent blank screen", async () => {
    const { getByText } = renderClient({
      "/api/reports/boq-analysis": () => jsonRes({ error: "No organisation on this account" }, 400),
    });
    await waitFor(() => expect(getByText(/No organisation on this account/)).toBeDefined());
  });
});
