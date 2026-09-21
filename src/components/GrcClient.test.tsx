/// <reference types="bun-types" />
// PROJEXA-E2E-001 cold-load investigation, continuation (2026-09-21):
// GrcClient's DashboardPanel (the default "Dashboard" tab, the one every
// /grc navigation lands on) used to always start `loading=true` and fire
// its own fetch("/api/grc-dashboard") on mount, even though grc/page.tsx
// now resolves the same rollup server-side (module-list-source.ts's
// fetchGrcDashboard, SSR'd + cached 10s + streamed via <Suspense>). Mirrors
// MeetingsClient.test.tsx's shape: the real regression to prove is that
// `initialDashboard` answers the Dashboard tab with ZERO network requests
// on first paint. The other 7 tabs are untouched by this fix (see
// DashboardPanel's own comment) and are not asserted on here.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const mod = await import("./GrcClient");
const GrcClient = mod.default;

const DASHBOARD = {
  risks: { openCount: 3, totalCount: 5, byCategory: { operational: 3 }, bySeverity: { low: 1, medium: 1, high: 1 }, heatmap: [{ likelihood: 4, impact: 4, count: 1 }] },
  audit: { engagementCount: 1, openFindingsCount: 2, overdueFindingsCount: 1 },
  policies: { totalCount: 4, draftCount: 1, underReviewCount: 1, publishedCount: 2 },
  vendorRisk: { totalCount: 6, highTierCount: 2 },
};

const realFetch = globalThis.fetch;
let requested: string[] = [];

beforeEach(() => {
  requested = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response(JSON.stringify(DASHBOARD), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("GrcClient -- Dashboard tab cold-load fix: initialDashboard answers with zero requests", () => {
  test("server-seeded dashboard data renders immediately, with NO fetch on first paint", () => {
    const view = render(<GrcClient initialTab="dashboard" initialDashboard={{ data: DASHBOARD, errorMessage: null }} />);
    // "Open Risks" stat tile, real data from the server-seeded payload --
    // proves the panel actually rendered the passed-in dashboard, not just
    // that it avoided a fetch.
    expect(view.getByText("Open Risks")).toBeTruthy();
    expect(view.getByText("High-Risk Vendors")).toBeTruthy();
    expect(requested.some((u) => u.includes("/api/grc-dashboard"))).toBe(false);
  });

  test("with no initialDashboard (defensive fallback / a non-dashboard initial tab), the Dashboard panel still fetches for itself once switched to", async () => {
    const view = render(<GrcClient initialTab="dashboard" />);
    await waitFor(() => expect(view.getByText("Open Risks")).toBeTruthy());
    expect(requested.some((u) => u.includes("/api/grc-dashboard"))).toBe(true);
  });
});
