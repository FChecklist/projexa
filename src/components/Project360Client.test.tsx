/// <reference types="bun-types" />
// Sumeet requirement #7/#8: proves the combined analysis view against
// mocked reads of the five already-real endpoints it aggregates, same
// convention as BudgetsClient.test.tsx.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

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

/** Types into a CONTROLLED input (fireEvent.change cannot drive one in this environment): calls its React onChange inside act(). */
function typeInto(el: Element, value: string) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps"));
  const props = (el as unknown as Record<string, { onChange?: (e: unknown) => void }>)[key!];
  act(() => { props.onChange!({ target: { value }, currentTarget: { value } }); });
}

// Sumeet R-100: nothing could create a baseline, so profit and loss read "Not yet baselined" for ever. The one deliberate action on this screen.
describe("Project360Client: confirm the baseline", () => {
  const NO_BASELINE = { ...ANALYSIS_ROW, boqId: "boq-9", hasBaseline: false, contractAtFirstConfirmation: "NOT_SET", expectedProfitGross: "NOT_SET", profitVsExpectedDelta: "NOT_SET" };

  test("offered while no baseline exists; sends the evidence, then re-reads the analysis and the answer appears", async () => {
    let posted: { url: string; body: unknown } | null = null;
    let confirmed = false;
    const { getByLabelText, getByText, queryByText } = renderClient({
      "/api/reports/boq-analysis": () => jsonRes({ row: confirmed ? { ...ANALYSIS_ROW, boqId: "boq-9" } : NO_BASELINE }),
      "/api/scope/boq-9/revisions": async () => { confirmed = true; return jsonRes({ id: "b1", version: 1 }, 201); },
    });
    const base = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("action=baseline") && init?.method === "POST") posted = { url, body: JSON.parse(String(init.body)) };
      return base(input, init);
    }) as typeof fetch;

    await waitFor(() => expect(getByText("Confirm baseline")).toBeDefined());
    typeInto(getByLabelText("Evidence for the baseline"), "PO-2026-114");
    fireEvent.click(getByText("Confirm baseline"));

    await waitFor(() => expect(queryByText("Confirm baseline")).toBeNull());
    expect(posted).not.toBeNull();
    expect(posted!.url).toContain("/api/scope/boq-9/revisions");
    expect(posted!.body).toEqual({ evidenceArtefactRef: "PO-2026-114" });
    expect(getByText("25.9% margin")).toBeDefined();
  });

  test("a blank evidence field sends nothing and says why", async () => {
    let posts = 0;
    const { getByText, findByRole } = renderClient({
      "/api/reports/boq-analysis": () => jsonRes({ row: NO_BASELINE }),
      "/api/scope/boq-9/revisions": () => { posts += 1; return jsonRes({}, 201); },
    });
    await waitFor(() => expect(getByText("Confirm baseline")).toBeDefined());
    fireEvent.click(getByText("Confirm baseline"));
    expect((await findByRole("alert")).textContent).toContain("Name the evidence first");
    expect(posts).toBe(0);
  });

  test("a refusal from the backend is shown as it was said", async () => {
    const { getByLabelText, getByText, findByRole } = renderClient({
      "/api/reports/boq-analysis": () => jsonRes({ row: NO_BASELINE }),
      "/api/scope/boq-9/revisions": () => jsonRes({ error: "Forbidden: manager role required" }, 403),
    });
    await waitFor(() => expect(getByText("Confirm baseline")).toBeDefined());
    typeInto(getByLabelText("Evidence for the baseline"), "PO-1");
    fireEvent.click(getByText("Confirm baseline"));
    expect((await findByRole("alert")).textContent).toContain("Forbidden: manager role required");
  });

  test("not offered once a baseline exists", async () => {
    const { getByText, queryByText } = renderClient({ "/api/reports/boq-analysis": () => jsonRes({ row: { ...ANALYSIS_ROW, boqId: "boq-9" } }) });
    await waitFor(() => expect(getByText("Profit & Loss — the answer")).toBeDefined());
    expect(queryByText("Confirm baseline")).toBeNull();
  });
});

describe("Project360Client: download (Sumeet R-99 / R-100)", () => {
  test("Download CSV produces a file carrying the figures the screen shows", async () => {
    const blobs: Blob[] = [];
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = ((b: Blob) => { blobs.push(b); return "blob:test"; }) as typeof URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    try {
      const { findByTestId } = renderClient();
      fireEvent.click(await findByTestId("project360-download-csv"));
      expect(blobs).toHaveLength(1);
      const text = await blobs[0].text();
      const lines = text.split("\n");
      expect(lines[0]).toContain("Project 360 analysis - Villa 21 - Whitefield");
      expect(text).toContain("Expected profit (at first confirmation)");
      expect(text).toContain("Variation impact");
      expect(text).toContain("Billing milestones overdue,1");
      expect(text).toContain("Activities on the critical path,1");
    } finally {
      URL.createObjectURL = realCreate;
      HTMLAnchorElement.prototype.click = realClick;
    }
  });

  test("Print / save as PDF opens the browser's print dialog", async () => {
    let printed = 0;
    const realPrint = window.print;
    window.print = (() => { printed += 1; }) as typeof window.print;
    try {
      const { findByTestId } = renderClient();
      fireEvent.click(await findByTestId("project360-print"));
      expect(printed).toBe(1);
    } finally {
      window.print = realPrint;
    }
  });
});
