/// <reference types="bun-types" />
// R67 D-65 -- the project dashboard stops minting numbers from failed reads.
//
// Two real faults, both on the screen a PM opens every morning:
//
//   * the dashboard call's status was never read, so a 500's error body was
//     assigned to `dashboard` and money(dashboard.expenses) then called
//     .toLocaleString on an undefined. There is no error.tsx under
//     /dashboard/project, so that throw took the route down.
//   * the permits call ended in `.catch(() => ({ permits: [] }))`, so a
//     failure rendered "Permits Expiring: 0 — none due soon" in the sage
//     done tone: a confident all-clear from the one tile whose purpose is to
//     warn.
//
// R67 MERGE (lane F2's F-27). The permits FIGURE no longer comes from its own
// /api/permits call: VERIDIAN's dashboard payload carries
// permitsExpiringCount / permitsExpiredCount, computed in the same statement
// as everything else (compliance-tracker #1579), so that tile costs no request
// at all. The two permit assertions below are therefore CORRECTED to the read
// that now supplies the figure rather than deleted -- each keeps exactly the
// property it was written to protect: a failed read may not render the
// all-clear, and a successful read with genuinely none still may.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/dashboard/project",
}));

const DashboardProjectClient = (await import("./DashboardProjectClient")).default;

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const DASHBOARD_OK = {
  projectName: "Cedar Heights Villa - Phase 1",
  budget: 1000000,
  expenses: 250000,
  projectValue: null,
  earnedValue: null,
  percentByValue: null,
  contractValue: null,
  // F-27: the permit counts ride on this payload now.
  permitsExpiringCount: 0,
  permitsExpiredCount: 0,
};

/** Answers each url with a status and body chosen by the caller. */
function routeFetch(handler: (url: string) => { status: number; body: unknown }) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const { status, body } = handler(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

describe("DashboardProjectClient", () => {
  test("a 500 on the dashboard read shows the failure instead of crashing the route", async () => {
    routeFetch((url) =>
      url.includes("/api/dashboard/project")
        ? { status: 500, body: { error: "The construction data service returned an error." } }
        : { status: 200, body: {} }
    );

    const { container } = render(<DashboardProjectClient projectId="p-cedar" />);
    await waitFor(() => {
      expect(container.textContent).toContain("Couldn't load this project's dashboard");
    });
    expect(container.textContent).toContain("Retry");
  });

  test("a failed read never renders the permits all-clear -- the specific lie this fixes", async () => {
    // The figure now rides on the dashboard payload (F-27), so THAT is the
    // read whose failure must not produce "0 — none due soon". The permits
    // endpoint is answered 504 as well, to prove nothing on this screen asks
    // it any more.
    let askedPermits = false;
    routeFetch((url) => {
      if (url.includes("/api/permits")) askedPermits = true;
      if (url.includes("/api/dashboard/project")) return { status: 504, body: { error: "upstream gone" } };
      return { status: 200, body: {} };
    });

    const { container } = render(<DashboardProjectClient projectId="p-cedar" />);
    await waitFor(() => {
      expect(container.textContent).toContain("Couldn't load this project's dashboard");
    });
    expect(container.textContent).not.toContain("none due soon");
    expect(askedPermits).toBe(false);
  });

  test("a SUCCESSFUL read with genuinely no permits due still says so -- the honest all-clear survives", async () => {
    routeFetch((url) => {
      if (url.includes("/api/dashboard/project")) return { status: 200, body: DASHBOARD_OK };
      return { status: 200, body: {} };
    });

    const { container } = render(<DashboardProjectClient projectId="p-cedar" />);
    await waitFor(() => {
      expect(container.textContent).toContain("none due soon");
    });
    expect(container.textContent).not.toContain("Couldn't load this project's dashboard");
  });
});
