/// <reference types="bun-types" />
// R62 B7 regression test for R48_EMPLOYEES_PAGE_CLIENT_CRASH_01 (Critical).
//
// THE DEFECT (R48 UAT session 2): /employees was the only one of 46 nav
// destinations that failed to render at all. GET /api/hr/org-chart answered
// a VERIDIAN failure with { error: "..." } and a real non-2xx status, but
// EmployeesClient did `setOrgChart(chartData)` with no res.ok check. That
// body parses fine and is truthy, so `!orgChart` did not catch it, and the
// render path's `orgChart.roots.length` read .length off undefined -- an
// unhandled TypeError that tore down the WHOLE tree (0 <main> elements),
// even though Org Chart is not the default tab, because the TabsContent
// children are built eagerly on every render.
//
// THE FIX (projexa#165 / ebbd0ddf03677e61f362de7696b5aefd3a518d5e): fetchJson
// reads the status before the body; an isOrgChart() type guard also nulls
// out a 200 that doesn't carry roots/byManager; Promise.all -> allSettled so
// one failing endpoint can't blank the other four tabs; a named error banner
// with Retry replaces the silent crash.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

// Dynamic import: see PayrollClient.test.tsx for why this must not be a
// static top-level import (Radix's useLayoutEffect no-op-vs-real decision is
// made at module-evaluation time, before GlobalRegistrator.register() runs).
const EmployeesClient = (await import("./EmployeesClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function router(handlers: Record<string, () => Response>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

// Every source load() reads (plus useOrgRole's own /api/organization),
// defaulted to a healthy empty/ok response so each test only overrides what
// it cares about.
const DEFAULTS: Record<string, () => Response> = {
  "/api/organization": () => jsonRes({ role: "owner", organization: { country: "US" } }),
  "/api/employees": () => jsonRes({ employees: [{ id: "e1", name: "Amina Yusuf", email: "amina@example.com", role: "member", departmentId: null, reportingToId: null, profile: null }] }),
  "/api/hr/departments": () => jsonRes({ departments: [] }),
  "/api/hr/org-chart": () => jsonRes({ employees: [], roots: [], byManager: {} }),
  "/api/leave/requests": () => jsonRes({ requests: [] }),
  "/api/leave/balances": () => jsonRes({ balances: [] }),
  "/api/companies": () => jsonRes({ companies: [] }),
};

describe("EmployeesClient (R48_EMPLOYEES_PAGE_CLIENT_CRASH_01)", () => {
  test("a failing /api/hr/org-chart (real VERIDIAN error, non-2xx) does not crash the page -- Directory still renders with a named error banner", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/hr/org-chart": () =>
        jsonRes({ error: "No VERIDIAN credentials configured for organization 9165 (AR-04)" }, 502),
    });

    const { getByText, getByRole } = render(<EmployeesClient />);

    // The regression: this used to throw "Cannot read properties of
    // undefined (reading 'length')" and leave 0 <main>-equivalent content on
    // the page. Proving the Directory tab's own data rendered is the proof
    // the tree did not tear down.
    await waitFor(() => expect(getByText("Amina Yusuf")).toBeDefined());

    // The failure must be named, not hidden -- the whole point of C19
    // ERROR_TRUTHFUL / the fix's error banner.
    expect(getByRole("alert")).toBeDefined();
    expect(getByText(/Org chart: No VERIDIAN credentials configured/)).toBeDefined();

    // A crash-recovery banner is not the same as a real Retry -- the fix's
    // banner carries a working one.
    expect(getByRole("button", { name: "Retry" })).toBeDefined();
  });

  test("a 200 org-chart response that is missing roots/byManager is treated as absent, not indexed into directly", async () => {
    // Guards against a second way the same crash could reappear: a healthy
    // status with an unexpected shape must not reach `orgChart.roots.length`
    // either -- isOrgChart() must still reject it.
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/hr/org-chart": () => jsonRes({ unexpectedShape: true }),
    });

    const { getByText, queryByRole } = render(<EmployeesClient />);

    await waitFor(() => expect(getByText("Amina Yusuf")).toBeDefined());
    // No crash, and no false error either -- a healthy 2xx must not be
    // reported as a load failure.
    expect(queryByRole("alert")).toBeNull();
  });

  test("the healthy path still renders employees with no error banner at all", async () => {
    globalThis.fetch = router(DEFAULTS);

    const { getByText, queryByRole } = render(<EmployeesClient />);

    await waitFor(() => expect(getByText("Amina Yusuf")).toBeDefined());
    expect(queryByRole("alert")).toBeNull();
  });
});
