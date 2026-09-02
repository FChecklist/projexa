/// <reference types="bun-types" />
// R67 F-14 (R-215) -- the projexa half of the item, asserted where it can be.
//
// THE FAULT. This screen made SIX calls for one project's dashboard. Three of
// them -- the category-progress report, the work-progress entries and the
// activity names that labelled those entries -- re-read data the first call had
// already read, and each opened its own transaction on VERIDIAN's five-
// connection app_runtime pool. That fan-out is what exhausted the pool.
//
// The backend now folds categories and recentEntries into the project dashboard
// payload (construction-dashboard-service.ts, one transaction), so what is
// asserted here is the consequence: three requests, and NONE of them to the two
// endpoints this item removed.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), prefetch: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
}));

const DashboardProjectClient = (await import("./DashboardProjectClient")).default;

const DASHBOARD = {
  projectId: "p1",
  projectName: "Skyline Tower",
  budget: 100,
  revenue: 50,
  expenses: 40,
  progressPercent: 45,
  delayedTaskCount: 0,
  taskCount: 3,
  projectValue: 1000,
  earnedValue: null,
  percentByValue: null,
  contractValue: null,
  categories: [{ categoryId: "c1", name: "Substructure", percentComplete: 30 }],
  recentEntries: [
    { id: "e1", activityId: "a1", activityName: "Excavation", entryDate: "2026-09-02", quantityDone: "12", percentComplete: "60" },
    { id: "e2", activityId: "a9", activityName: null, entryDate: "2026-09-01", quantityDone: "4", percentComplete: "10" },
  ],
};

let requested: string[] = [];

function stubFetch() {
  requested = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    requested.push(url);
    const body = url.includes("/api/currencies")
      ? { currencies: [{ code: "AED", isBaseCurrency: true }] }
      : url.includes("/api/permits")
        ? { permits: [] }
        : DASHBOARD;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("DashboardProjectClient: one dashboard call carries the panels it used to fetch", () => {
  test("exactly three requests, and none to category-progress or work-progress", async () => {
    stubFetch();

    render(<DashboardProjectClient projectId="p1" />);

    await waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(3));
    expect(requested).toHaveLength(3);
    expect(requested.some((u) => u.includes("/api/reports/category-progress"))).toBe(false);
    expect(requested.some((u) => u.includes("/api/work-progress"))).toBe(false);
    expect(requested.some((u) => u.includes("/api/dashboard/project/p1"))).toBe(true);
  });

  test("the recent-entries panel renders the activity NAME that came with the payload", async () => {
    stubFetch();

    const { container } = render(<DashboardProjectClient projectId="p1" />);

    await waitFor(() => expect(container.textContent).toContain("Excavation"));
    // An entry whose activity row is gone says so, rather than printing the id.
    expect(container.textContent).toContain("Unknown activity");
    expect(container.textContent).not.toContain("a9");
  });

  test("the category chart renders from the same payload", async () => {
    stubFetch();

    const { container } = render(<DashboardProjectClient projectId="p1" />);

    await waitFor(() => expect(container.textContent).toContain("Substructure"));
  });
});
