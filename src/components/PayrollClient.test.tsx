/// <reference types="bun-types" />
// R43 F_031: the first data-load wave (Payroll Runs + Employees) used
// Promise.all([fetch(a), fetch(b)]) -- if BOTH calls failed together, only
// the FIRST rejection's reason ever reached the banner, and neither
// setRuns() nor setEmployees() ran even when one of the two had actually
// succeeded. Separately, none of the five tabs checked load-failure state at
// all: every tab gated purely on `array.length === 0`, so the default-open
// "Payroll Runs" tab still showed "No payroll runs yet." underneath a banner
// that had already named a real failure.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws ("Failed to register. Happy DOM
// has already been globally registered."), and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own comment on
// this. Register only if no DOM is installed yet, so this suite still passes
// standalone AND alongside every other happy-dom-based suite.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

// PayrollClient.tsx calls useRouter() (added for the row/create-button
// navigation seen below) -- outside a real Next.js app tree, that throws
// "invariant expected app router to be mounted" the moment the component
// renders, since there's no real router context to read from. This test
// predates that useRouter() call and never provided one. Mocked here (must
// run before PayrollClient is imported below) rather than wrapped in a real
// AppRouterContext.Provider -- only .push is ever called by this component,
// so a bare mock is enough and keeps this file's existing render() calls
// (no wrapper) unchanged.
mock.module("next/navigation", () => ({ useRouter: () => ({ push: mock(() => {}) }) }));

// Dynamically imported (not a static top-level import) so this module -- and
// therefore its transitive @radix-ui/react-tabs -> @radix-ui/react-presence
// -> @radix-ui/react-use-layout-effect chain -- is only evaluated AFTER
// GlobalRegistrator.register() has run. @radix-ui/react-use-layout-effect
// decides real-vs-noop useLayoutEffect with a module-scope
// `globalThis?.document ? ... : ...` check; with a static import that check
// runs at this file's hoisted-import time, BEFORE register() has created
// `document`, permanently wiring Radix's Presence (tab-content mount/unmount
// on switch) to a no-op for the rest of the process. A dynamic import here
// defers evaluation to this line, by which point `document` already exists.
const PayrollClient = (await import("./PayrollClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Routes the fake global fetch by which /api path the request targets. */
function router(handlers: Record<string, () => Response>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

// Every source PayrollClient.load() reads, defaulted to a healthy empty
// response so each test only has to override the one or two it cares about.
const DEFAULTS: Record<string, () => Response> = {
  "/api/payroll/runs": () => jsonRes({ runs: [] }),
  "/api/employees": () => jsonRes({ employees: [] }),
  "/api/payroll/salary-components": () => jsonRes({ components: [] }),
  "/api/payroll/salary-structures": () => jsonRes({ structures: [] }),
  "/api/payroll/statutory-rules": () => jsonRes({ rules: [] }),
  "/api/payroll/income-tax-slabs": () => jsonRes({ slabs: [] }),
  "/api/organization": () => jsonRes({ role: "owner", organization: { country: "US" } }),
};

describe("PayrollClient (R43 F_031: first-wave Promise.all -> Promise.allSettled, per-tab error surfacing)", () => {
  test("both first-wave calls failing together names BOTH errors -- Promise.all only ever surfaced the first", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/payroll/runs": () => jsonRes({ error: "Payroll runs down (X)" }, 500),
      "/api/employees": () => jsonRes({ error: "Employees down (Y)" }, 500),
    });

    const { getAllByText, getByText, queryByText } = render(<PayrollClient />);

    await waitFor(() => expect(getAllByText(/Payroll runs down \(X\)/).length).toBeGreaterThan(0));
    // The second failure must ALSO be named -- the old Promise.all discarded
    // it entirely because only the first rejection's reason ever propagated.
    expect(getByText(/Employees down \(Y\)/)).toBeDefined();
    // The exact fault: an ambiguous empty-state must never sit underneath a
    // banner that has already named the failure, on the tab open by default.
    expect(queryByText("No payroll runs yet.")).toBeNull();
  });

  test("one first-wave call failing does not discard the other's successful data (old Promise.all discarded BOTH)", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/payroll/runs": () => jsonRes({ runs: [{ id: "r1", month: 1, year: 2026, status: "draft", processedAt: null }] }),
      "/api/employees": () => jsonRes({ error: "Employees down" }, 500),
    });

    const { getByText } = render(<PayrollClient />);

    // The run that succeeded must still render...
    await waitFor(() => expect(getByText(/Jan 2026/)).toBeDefined());
    // ...alongside a real, named error for the sibling that failed.
    expect(getByText(/Employees down/)).toBeDefined();
  });

  test("a tab whose OWN source failed shows a real error INSIDE ITS OWN PANEL, not a fake empty state, even while the default tab is a genuine empty state", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/payroll/salary-components": () => jsonRes({ error: "Salary components down" }, 500),
    });

    const { getByRole, getByText, queryByText } = render(<PayrollClient />);

    // Runs tab (default, open on mount): genuinely empty, not a failure --
    // must show the real empty-state copy, not an error.
    await waitFor(() => expect(getByText("No payroll runs yet.")).toBeDefined());

    // Radix Tabs switches on mousedown (see @radix-ui/react-tabs), not click.
    fireEvent.mouseDown(getByRole("tab", { name: /Salary Components/i }), { button: 0 });

    // Scoped to the tabpanel itself (getByRole excludes the hidden, inactive
    // ones) -- NOT the always-visible summary banner above the tabs, which
    // would show this same message regardless of which tab is open. This is
    // what actually proves the fix threaded the per-tab error into the tab's
    // OWN empty-state branch, not just into the pre-existing banner.
    await waitFor(() => {
      const panel = within(getByRole("tabpanel"));
      expect(panel.getByText(/Salary components down/)).toBeDefined();
      expect(panel.queryByText("No salary components yet.")).toBeNull();
    });
    expect(queryByText("No salary components yet.")).toBeNull();
  });
});
