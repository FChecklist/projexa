/// <reference types="bun-types" />
// R67 E-16 (R-150). THE ITEM'S OWN ACCEPTANCE, run for real:
// "open /design-studio with the Cost Analysis tab selected for the demo project
// and expect the four section headings with the exact texts 'By Category',
// 'By Designer', 'By Project' and 'Designer Status' to be visible."
//
// The Playwright half (a real browser on localhost:3100) is not run here: this
// worktree shares node_modules through a junction and starts no dev server, per
// the programme's own rules. What IS asserted below is the same four strings,
// rendered by the same component the page mounts, from a payload shaped exactly
// as compliance-tracker's designerTimesheetReport returns it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- guarded, like every other happy-dom suite here.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const pushed: string[] = [];
const replaced: string[] = [];
let searchParams = new URLSearchParams();
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => { pushed.push(url); },
    replace: (url: string) => { replaced.push(url); },
    prefetch: () => {},
    refresh: () => {},
  }),
  useSearchParams: () => searchParams,
}));

const DesignStudioCostAnalysisClient = (await import("./DesignStudioCostAnalysisClient")).default;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Exactly the shape designerTimesheetReport returns, period and all. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    period: { from: "2026-09-01", to: "2026-09-03" },
    projectScoped: {
      byUser: [{ userId: "u1", userName: "Alice", totalHours: 12 }],
      byCategory: [
        { category: "Design Development", hours: 20, actual: 1000, budget: null },
        { category: "Concept", hours: 5, actual: 250, budget: null },
      ],
      byDesignerStatus: [
        { status: "active", budget: 1000, actual: 1250, variance: 250 },
        { status: "inactive", budget: 400, actual: 0, variance: -400 },
      ],
      overallBudget: 1000,
      overallActual: 1250,
      overallVariance: 250,
    },
    orgWide: {
      byDesigner: [
        { userId: "u1", userName: "Alice", hours: 25, budget: 1000, actual: 1250, variance: 250 },
        { userId: "u2", userName: "Bilal", hours: 4, budget: 800, actual: 200, variance: -600 },
      ],
      byProject: [{ projectId: "p-1", projectName: "Cedar Heights Villa", budget: 1000, actual: 1250, variance: 250 }],
    },
    ...overrides,
  };
}

function stubFetch(calls: string[], body: unknown, status = 200) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/api/currencies")) {
      return jsonRes({ currencies: [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true }] });
    }
    if (url.includes("/api/reports/designer-timesheet")) return jsonRes(body, status);
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
  pushed.length = 0;
  replaced.length = 0;
  searchParams = new URLSearchParams();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("Design Studio > Cost Analysis (R67 E-16)", () => {
  test("ACCEPTANCE: the four section headings render, with the item's exact texts", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload());
    const { findByText } = render(<DesignStudioCostAnalysisClient projectId="p-1" projectName="Cedar Heights Villa" />);

    expect(await findByText("By Category")).toBeTruthy();
    expect(await findByText("By Designer")).toBeTruthy();
    expect(await findByText("By Project")).toBeTruthy();
    expect(await findByText("Designer Status")).toBeTruthy();
  });

  test("it runs on arrival, with the current month, and writes the window back into the URL", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload());
    render(<DesignStudioCostAnalysisClient projectId="p-1" />);

    // No click anywhere in this test.
    await waitFor(() => {
      expect(calls.some((c) => c.includes("/api/reports/designer-timesheet?projectId=p-1&from=") && c.includes("&to="))).toBe(true);
    });
    expect(replaced.some((u) => u.startsWith("/design-studio?") && u.includes("tab=cost-analysis") && u.includes("from="))).toBe(true);
  });

  test("a row with NO budget is drawn hatched and says 'no budget set' -- never a bar at zero", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload());
    const { findAllByTestId, findAllByText } = render(<DesignStudioCostAnalysisClient projectId="p-1" />);

    // Both by-category rows have budget null in the source: the service returns
    // no per-category budget dimension at all.
    const hatched = await findAllByTestId("cost-analysis-bar-hatched");
    expect(hatched.length).toBe(2);
    expect((await findAllByText(/no budget set/)).length).toBeGreaterThan(0);
  });

  test("the direction is a WORD as well as a glyph, so colour is never the only carrier", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload());
    const { findByTestId } = render(<DesignStudioCostAnalysisClient projectId="p-1" />);
    await findByTestId("cost-analysis-heading-designer");

    const bars = document.querySelectorAll('[data-testid="cost-analysis-bars-designer"] [data-testid="cost-analysis-verdict"]');
    const texts = [...bars].map((b) => b.textContent ?? "");
    // Alice is AED 250 over, Bilal AED 600 under -- and worst-first puts Alice
    // at the top, which is the whole reason the section is sorted.
    expect(texts[0]).toContain("over");
    expect(texts[1]).toContain("under");
  });

  test("clicking a designer bar filters the Timesheet tab to that designer", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload());
    const { findByTestId } = render(<DesignStudioCostAnalysisClient projectId="p-1" />);
    await findByTestId("cost-analysis-heading-designer");

    const rows = document.querySelectorAll('[data-testid="cost-analysis-bars-designer"] [data-testid="cost-analysis-bar-row"]');
    (rows[0] as HTMLButtonElement).click();
    await waitFor(() => {
      expect(pushed.some((u) => u.includes("tab=timesheet") && u.includes("designerId=u1"))).toBe(true);
    });
  });

  test("a failed run says what failed and offers Retry -- never a blank card", async () => {
    const calls: string[] = [];
    stubFetch(calls, { error: "The construction data service didn't answer" }, 502);
    const { findByTestId } = render(<DesignStudioCostAnalysisClient projectId="p-1" />);

    const card = await findByTestId("cost-analysis-error");
    expect(card.textContent).toContain("Could not run Design cost analysis:");
    expect(card.textContent).toContain("Retry");
  });

  test("with no budget lines anywhere, the section says R-150's own sentence", async () => {
    const calls: string[] = [];
    stubFetch(
      calls,
      payload({
        projectScoped: {
          byUser: [], byCategory: [], byDesignerStatus: [],
          overallBudget: 0, overallActual: 0, overallVariance: 0,
        },
        orgWide: { byDesigner: [], byProject: [] },
      })
    );
    const { findByTestId } = render(<DesignStudioCostAnalysisClient projectId="p-1" />);

    const empty = await findByTestId("cost-analysis-empty-designer");
    expect(empty.textContent).toBe("No designer budget lines for this project — set them under Budgets");
  });
});
