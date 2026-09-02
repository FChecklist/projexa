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

  test("a failed permits read reads as an en-dash and 'could not load', never 0 / none due soon", async () => {
    routeFetch((url) => {
      if (url.includes("/api/dashboard/project")) return { status: 200, body: DASHBOARD_OK };
      if (url.includes("/api/permits")) return { status: 504, body: { error: "upstream gone" } };
      return { status: 200, body: {} };
    });

    const { container } = render(<DashboardProjectClient projectId="p-cedar" />);
    await waitFor(() => {
      expect(container.textContent).toContain("Permits Expiring");
    });
    expect(container.textContent).toContain("could not load");
    // The all-clear wording must be absent: it is the specific lie this fixes.
    expect(container.textContent).not.toContain("none due soon");
  });

  test("a SUCCESSFUL permits read with genuinely none still says so -- the honest all-clear survives", async () => {
    routeFetch((url) => {
      if (url.includes("/api/dashboard/project")) return { status: 200, body: DASHBOARD_OK };
      if (url.includes("/api/permits")) return { status: 200, body: { permits: [] } };
      return { status: 200, body: {} };
    });

    const { container } = render(<DashboardProjectClient projectId="p-cedar" />);
    await waitFor(() => {
      expect(container.textContent).toContain("none due soon");
    });
    expect(container.textContent).not.toContain("could not load");
  });
});
