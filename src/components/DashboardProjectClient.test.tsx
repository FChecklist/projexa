/// <reference types="bun-types" />
// R67 E-25 (R-211). The item's own acceptance clause -- with /api/permits
// failing, the Permits Expiring card reads "couldn't load" and never "0" --
// plus the other two defects it names: no bullet bar against a zero budget,
// and a one-day series that says so instead of drawing an empty frame.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), refresh: mock(() => {}), replace: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/project",
}));

import { cleanup, render, waitFor } from "@testing-library/react";
import DashboardProjectClient from "./DashboardProjectClient";

const DASHBOARD = {
  projectId: "p1",
  projectName: "Cedar Heights Villa - Phase 1",
  budget: 0,
  revenue: 0,
  expenses: 185_000,
  progressPercent: 60,
  delayedTaskCount: 0,
  taskCount: 4,
  projectValue: null,
  earnedValue: 0,
  percentByValue: 0,
  contractValue: 475_000,
};

type Options = { permitsStatus?: number; entries?: unknown[]; variance?: unknown };

function stubFetch({ permitsStatus = 200, entries = [{ id: "e1", activityId: "a1", entryDate: "2026-08-25", quantityDone: "10", percentComplete: "60" }], variance = { totalBudget: 0 } }: Options = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/permits")) {
      if (permitsStatus !== 200) return new Response(JSON.stringify({ error: "boom" }), { status: permitsStatus });
      return new Response(JSON.stringify({ permits: [] }), { status: 200 });
    }
    if (url.includes("/api/dashboard/project")) return new Response(JSON.stringify(DASHBOARD), { status: 200 });
    if (url.includes("/api/currencies")) return new Response(JSON.stringify({ currencies: [{ code: "AED", isBaseCurrency: true }] }), { status: 200 });
    if (url.includes("/api/work-progress/activities")) return new Response(JSON.stringify({ activities: [{ id: "a1", name: "Blockwork" }] }), { status: 200 });
    if (url.includes("/api/work-progress")) return new Response(JSON.stringify({ entries }), { status: 200 });
    if (url.includes("/api/reports/budget-variance")) return new Response(JSON.stringify(variance), { status: 200 });
    if (url.includes("/api/reports/category-progress")) return new Response(JSON.stringify({ categories: [] }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;
}

/**
 * R67 E-38: a tile is a <a> when it navigates and a <button> only when its job
 * is to retry its own failed read. This finds it either way, by the label it
 * shows -- which is also what a reader looks for.
 */
function tile(container: HTMLElement, label: string): HTMLElement {
  const match = Array.from(container.querySelectorAll("a, button")).find((el) =>
    (el.textContent ?? "").includes(label)
  );
  if (!match) throw new Error(`no KPI tile labelled "${label}"`);
  return match as HTMLElement;
}

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("DashboardProjectClient", () => {
  test("a failed permits read reads 'couldn't load' with a dash, never 0", async () => {
    stubFetch({ permitsStatus: 500 });
    const { container } = render(<DashboardProjectClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("couldn't load"));
    const card = tile(container, "Permits Expiring");
    expect(card.textContent).toContain("—");
    expect(card.textContent).not.toContain("none due soon");
    expect(card.textContent).toContain("Retry");
    // The reassurance a failed read must never print.
    expect(card.textContent).not.toMatch(/(^|[^\d])0([^\d]|$)/);
  });

  test("a successful permits read still reports the real, reassuring zero", async () => {
    stubFetch();
    const { container } = render(<DashboardProjectClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("none due soon"));
    expect(container.textContent).not.toContain("couldn't load");
  });

  test("no budget anywhere: 'no budget set', the words that set one, and NO bar", async () => {
    stubFetch();
    const { container } = render(<DashboardProjectClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("no budget set"));
    expect(container.textContent).toContain("Set budget % on the BOQ");
    expect(container.textContent).not.toContain("over budget");
    const card = tile(container, "Budget vs Actual");
    // The kit's BulletChart always prints "target ..." beside its bar; no bar
    // means that text is absent from this card.
    expect(card.textContent).not.toContain("target");
  });

  test("with no cost-centre budget, the BOQ-derived one becomes the target and the baseline says so", async () => {
    stubFetch({ variance: { totalBudget: 200_000 } });
    const { container } = render(<DashboardProjectClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("BOQ x budget %"));
    expect(container.textContent).toContain("no cost-centre budget set");
    expect(container.textContent).toContain("within budget");
  });

  test("one logged day says so instead of drawing an empty chart frame", async () => {
    stubFetch();
    const { container } = render(<DashboardProjectClient projectId="p1" />);
    await waitFor(() =>
      expect(container.textContent).toContain("Only one day logged (25 Aug) - a trend needs two or more days")
    );
  });

  test("two logged days draw the line", async () => {
    stubFetch({
      entries: [
        { id: "e1", activityId: "a1", entryDate: "2026-08-25", quantityDone: "10", percentComplete: "60" },
        { id: "e2", activityId: "a1", entryDate: "2026-08-26", quantityDone: "5", percentComplete: "70" },
      ],
    });
    const { container } = render(<DashboardProjectClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).not.toContain("Only one day logged"));
    expect(container.querySelector("svg")).not.toBeNull();
  });

  test("0% by value with real logged progress explains the gap on the primary KPI", async () => {
    stubFetch();
    const { container } = render(<DashboardProjectClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("60% logged, not yet linked to BOQ lines"));
  });
});
// R67 E-38 (R-270 / R-296). EVERY TILE IS A REAL LINK WITH ONE DESTINATION.
//
// The finding was that these tiles were <button>s calling router.push(), and
// that one of them resolved to a NEIGHBOUR's destination -- which an href
// cannot do. The item's own acceptance clicks each tile in a browser; what is
// provable here is the thing the click depends on: each tile is a single
// anchor, with the right href, carrying the project.
describe("R67 E-38: the five tiles are links, each with its own asserted destination", () => {
  test("every KPI tile is an <a> with an href carrying projectId", async () => {
    stubFetch();
    const { container } = render(<DashboardProjectClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("Contract Value"));

    for (const label of ["% Complete by BOQ Value", "Contract Value", "Project Value", "Budget vs Actual", "Permits Expiring"]) {
      const el = tile(container, label);
      expect(el.tagName).toBe("A");
      expect(el.getAttribute("href")).toContain("p1");
    }
  });

  test("the destinations are the ones the item names", async () => {
    stubFetch();
    const { container } = render(<DashboardProjectClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("Contract Value"));

    // The number's own breakdown: earned value over contract value IS the
    // scope view's Grand Total. It used to go to Analytics, which shows a
    // DIFFERENT percentage.
    expect(tile(container, "% Complete by BOQ Value").getAttribute("href")).toBe(
      "/work-progress?projectId=p1&tab=report&view=scope"
    );
    expect(tile(container, "Contract Value").getAttribute("href")).toBe("/scope?projectId=p1");
    expect(tile(container, "Permits Expiring").getAttribute("href")).toBe("/permits?projectId=p1&withinDays=30");
    // No budget on this fixture, so the budget tile's door is the place that
    // SETS one.
    expect(tile(container, "Budget vs Actual").getAttribute("href")).toBe("/budgets/new?projectId=p1");
  });

  test("with a real budget the tile points at the budget itself", async () => {
    stubFetch({ variance: { totalBudget: 200_000 } });
    const { container } = render(<DashboardProjectClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("BOQ x budget %"));
    expect(tile(container, "Budget vs Actual").getAttribute("href")).toBe("/budgets?projectId=p1");
  });

  test("no anchor wraps two tiles -- a click can never resolve to a neighbour's href", async () => {
    stubFetch();
    const { container } = render(<DashboardProjectClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("Contract Value"));

    // This is the structural property behind the observed
    // "Budget vs Actual -> Permits" bug: an anchor containing another tile's
    // label, or an anchor inside an anchor.
    for (const anchor of Array.from(container.querySelectorAll("a"))) {
      expect(anchor.querySelector("a")).toBeNull();
      const labelsInside = ["Contract Value", "Project Value", "Budget vs Actual", "Permits Expiring"].filter((l) =>
        (anchor.textContent ?? "").includes(l)
      );
      expect(labelsInside.length).toBeLessThanOrEqual(1);
    }
  });

  test("the failed Permits tile is a BUTTON, because retrying is not navigating", async () => {
    stubFetch({ permitsStatus: 500 });
    const { container } = render(<DashboardProjectClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("couldn't load"));

    const el = tile(container, "Permits Expiring");
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("href")).toBeNull();
  });
});
