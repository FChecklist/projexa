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
    const card = Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("Permits Expiring"))!;
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
    const card = Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("Budget vs Actual"))!;
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
