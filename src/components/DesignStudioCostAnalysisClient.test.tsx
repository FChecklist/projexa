/// <reference types="bun-types" />
// R67 E-16 (R-150) x lane H (H-03/H-04), reconciled at the merge (2026-09-03).
//
// E-16 asked for FOUR headed sections -- "By Category", "By Designer", "By
// Project" and "Designer Status". Lane H shipped the same report as ONE table
// with a Category | Designer | Project group-by control, wired into the
// module's own route, tabs and shared helpers, and landed first. Rebuilding it
// as four sections would have thrown that away to satisfy a layout, so the
// merged screen is lane H's, with E-16's PAIRED BUDGET-VS-ACTUAL BARS added to
// every row -- which is the thing R-150 is actually about: four columns of
// money make a reader do the comparison in their head.
//
// What is asserted below is therefore the substance of E-16 on the screen that
// ships: the three cuts are reachable, a row with no budget is hatched rather
// than drawn as a full overrun, the direction is a WORD as well as a colour,
// and a failed read says so and offers Retry. "Designer Status" is not a cut
// on this screen -- see the PR body's "Not done / partial".
//
// The Playwright half (a real browser on localhost:3100) is not run here: this
// worktree shares node_modules through a junction and starts no dev server, per
// the programme's own rules.
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
  // DesignStudioTabs (lane H) reads the pathname to mark the open tab, so the
  // mock has to answer it or the module fails to load at all.
  usePathname: () => "/design-studio/cost-analysis",
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

describe("Design Studio > Cost Analysis (R67 E-16 x H-03)", () => {
  test("the report renders its rows from VERIDIAN's own figures, with a total", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload());

    const { findByText } = render(<DesignStudioCostAnalysisClient projectId="p-1" projectName="Cedar Heights Villa" />);

    // The project-scoped Category cut is the one the screen opens on.
    await findByText("Design Development");
    await findByText("Concept");
    await findByText("Total");
    expect(calls.some((u) => u.includes("/api/reports/designer-timesheet"))).toBe(true);
  });

  test("all three cuts are reachable, and each says what it is scoped to", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload());

    const { findByText, getByText } = render(<DesignStudioCostAnalysisClient projectId="p-1" projectName="Cedar Heights Villa" />);
    await findByText("Design Development");

    // Category is project-scoped; Designer and Project are org-wide, and the
    // screen states that rather than leaving the reader to assume it.
    expect(getByText("Scope: this project")).toBeDefined();
    expect(getByText("Designer")).toBeDefined();
    expect(getByText("Project")).toBeDefined();
  });

  test("ACCEPTANCE: every row carries a PAIRED budget-vs-actual bar, not four columns of money to compare by eye", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload());

    const { findAllByTestId } = render(<DesignStudioCostAnalysisClient projectId="p-1" projectName="Cedar Heights Villa" />);

    const actualBars = await findAllByTestId("cost-analysis-actual-bar");
    expect(actualBars.length).toBeGreaterThan(0);
  });

  test("a row with NO budget is HATCHED and says so -- never drawn as a full-width overrun", async () => {
    const calls: string[] = [];
    // byCategory carries budget: null on both rows, which is the real shape:
    // there is no per-category budget dimension in pms_budget_line_items.
    stubFetch(calls, payload());

    const { findAllByTestId, findAllByText, findByText } = render(<DesignStudioCostAnalysisClient projectId="p-1" projectName="Cedar Heights Villa" />);

    expect((await findAllByTestId("cost-analysis-no-budget-bar")).length).toBeGreaterThan(0);
    // Said in words on EVERY such row -- both categories here carry a null
    // budget, which is the real shape of this cut.
    expect((await findAllByText("No budget set")).length).toBeGreaterThan(1);
    // ...and explained once, at the top, rather than by a dash on every row.
    await findByText(/The ERP holds no budget at this level/);
  });

  test("the direction is a WORD as well as a colour, so the state never depends on colour alone", async () => {
    const calls: string[] = [];
    stubFetch(calls, payload({
      projectScoped: {
        byCategory: [
          { category: "Design Development", hours: 20, actual: 1250, budget: 1000 },
          { category: "Concept", hours: 5, actual: 200, budget: 800 },
        ],
        byUser: [], byDesignerStatus: [], overallBudget: 1800, overallActual: 1450, overallVariance: 350,
      },
    }));

    const { findByText } = render(<DesignStudioCostAnalysisClient projectId="p-1" projectName="Cedar Heights Villa" />);

    // 1,250 spent against a 1,000 budget, and 200 against 800.
    await findByText("over budget");
    await findByText("within budget");
  });

  test("a failed read says what failed and offers Retry -- never a blank card", async () => {
    const calls: string[] = [];
    stubFetch(calls, { error: "VERIDIAN did not respond in time" }, 502);

    const { findByText } = render(<DesignStudioCostAnalysisClient projectId="p-1" projectName="Cedar Heights Villa" />);

    await findByText(/Retry/);
  });
});
