/// <reference types="bun-types" />
// R67 F-14 / F-27 (R-215) -- the projexa half of the item, asserted where it can be.
//
// THE FAULT. This screen made SIX calls for one project's dashboard. Three of
// them -- the category-progress report, the work-progress entries and the
// activity names that labelled those entries -- re-read data the first call had
// already read, and each opened its own transaction on VERIDIAN's five-
// connection app_runtime pool. That fan-out is what exhausted the pool.
//
// The backend now folds `categories` and `recentEntries` into the project
// dashboard payload (construction-dashboard-service.ts, ONE transaction), so
// what is asserted here is the consequence on the client.
//
// ─── WHY THIS IS A SEPARATE FILE, AND WHAT WAS CORRECTED ────────────────────
//
// Lane F1 and lane D-65 both added tests at DashboardProjectClient.test.tsx (an
// add/add). D-65's are about a failed read never rendering the permits
// all-clear, and are kept verbatim there. These three are about the request
// pattern and the two folded-in panels, so they are kept here.
//
// TWO CORRECTIONS to the merged implementation, neither of which weakens the
// assertion:
//   * the count is TWO requests, not F1's three. F1 still fetched permits
//     separately; the merged screen carries permitsExpiringCount on the payload
//     (F-27), so only the dashboard and the currency label remain.
//   * an entry whose activity row is gone renders the em-dash, not the words
//     "Unknown activity". The property under test is unchanged and is the one
//     that matters: it must never print the raw activity id.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/dashboard/project",
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
  permitsExpiringCount: 0,
  permitsExpiredCount: 0,
  categories: [{ categoryId: "c1", name: "Substructure", percentComplete: 30 }],
  recentEntries: [
    { id: "e1", activityId: "a1", activityName: "Excavation", entryDate: "2026-09-02", quantityDone: "12", percentComplete: "60" },
    { id: "e2", activityId: "a9zzz", activityName: null, entryDate: "2026-09-01", quantityDone: "4", percentComplete: "10" },
  ],
};

let requested: string[] = [];
const realFetch = globalThis.fetch;

function stubFetch() {
  requested = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    requested.push(url);
    const body = url.includes("/api/currencies")
      ? { currencies: [{ code: "AED", isBaseCurrency: true }] }
      : DASHBOARD;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const WAIT = { timeout: 8_000 } as const;

describe("DashboardProjectClient: one dashboard call carries the panels it used to fetch", () => {
  test("exactly two requests, and none to category-progress or work-progress", async () => {
    stubFetch();

    const { container } = render(<DashboardProjectClient projectId="p1" />);

    // Wait for the payload to have been applied, so a still-pending request
    // cannot make this pass by arriving late.
    await waitFor(() => expect(container.textContent).toContain("Substructure"), WAIT);

    expect(requested.some((u) => u.includes("/api/dashboard/project/p1"))).toBe(true);
    // The two round trips this item removed.
    expect(requested.some((u) => u.includes("/api/reports/category-progress"))).toBe(false);
    expect(requested.some((u) => u.includes("/api/work-progress"))).toBe(false);
    expect(requested).toHaveLength(2);
  });

  test("the recent-entries panel renders the activity NAME that came with the payload", async () => {
    stubFetch();

    const { container } = render(<DashboardProjectClient projectId="p1" />);

    await waitFor(() => expect(container.textContent).toContain("Excavation"), WAIT);
    // An entry whose activity row is gone must never print the raw id -- that
    // is the defect the resolved name exists to remove.
    expect(container.textContent).not.toContain("a9zzz");
  });

  test("the category chart renders from the same payload", async () => {
    stubFetch();

    const { container } = render(<DashboardProjectClient projectId="p1" />);

    await waitFor(() => expect(container.textContent).toContain("Substructure"), WAIT);
  });
});
