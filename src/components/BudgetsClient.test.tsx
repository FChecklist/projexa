/// <reference types="bun-types" />
// R62 B7 regression tests for R43 F_003 (closed via PR #178 / R52 Gate 2).
// See that fault row's justification for the full history; two structurally
// distinct defects were fixed there and both regress silently if reverted:
//
//  1. load() read `await res.json()` without checking res.ok, so a failing
//     /api/project-budgets rendered the plain "No budgets found." empty
//     copy instead of the backend's own error.
//  2. createBudget() opened with a silent
//     `if (!name.trim() || !fiscalYearId || !accountId.trim() || !annualAmount) return;`
//     guard and the button was only `disabled={submitting || lookupsLoading}`
//     -- a user who clicked "Create Budget" with any required field empty
//     got no request and no message at all (fail-after-click).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const BudgetsClient = (await import("./BudgetsClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function router(handlers: Record<string, (method: string, init?: RequestInit) => Response>, calls?: { method: string; url: string }[]) {
  const entries = Object.entries(handlers).sort((a, b) => b[0].length - a[0].length);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls?.push({ method, url });
    for (const [path, handler] of entries) {
      if (url.includes(path)) return handler(method, init);
    }
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  }) as typeof fetch;
}

const DEFAULTS: Record<string, (method: string) => Response> = {
  "/api/project-budgets": (method) => (method === "GET" ? jsonRes({ projectBudgets: [] }) : jsonRes({ id: "b-new" }, 201)),
  "/api/companies": () => jsonRes({ companies: [] }),
  "/api/fiscal-years": () => jsonRes({ fiscalYears: [] }),
  "/api/cost-centers": () => jsonRes({ costCenters: [] }),
  "/api/accounts": () => jsonRes({ accounts: [] }),
};

describe("BudgetsClient (R43 F_003)", () => {
  test("a failed budgets load shows the backend's own error, not the false 'No budgets found' empty state", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/project-budgets": (method) => (method === "GET" ? jsonRes({ error: "Budgets down (503)" }, 500) : jsonRes({}, 201)),
    });

    const { getByText, queryByText } = render(<BudgetsClient />);

    await waitFor(() => expect(getByText(/Budgets down \(503\)/)).toBeDefined());
    expect(queryByText("No budgets found.")).toBeNull();
  });

  test("Create Budget with every required field blank names what's missing and fires no request, instead of a silent no-op", async () => {
    const calls: { method: string; url: string }[] = [];
    // Fiscal years/accounts are non-empty here specifically so blockedReason
    // stays null and the button is enabled -- otherwise the VERIDIAN
    // provisioning-gap guard (the OTHER half of this fault's fix, part (b))
    // would disable the button for an unrelated reason and this assertion
    // would never actually exercise createBudget()'s own field validation.
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/fiscal-years": () => jsonRes({ fiscalYears: [{ id: "fy-1", yearName: "FY26", startDate: "2026-01-01", endDate: "2026-12-31", isClosed: false }] }),
      "/api/accounts": () => jsonRes({ accounts: [{ id: "ac-1", accountName: "Materials", accountNumber: "5000" }] }),
    }, calls);

    const { getByRole, getByText } = render(<BudgetsClient />);
    await waitFor(() => expect(getByText("No budgets found.")).toBeDefined());

    fireEvent.click(getByRole("button", { name: /New Budget/i }));
    const dialog = getByRole("dialog");
    // Lookups fire on open; wait for the loading spinner to clear so the
    // real form (and its Create Budget button) is present.
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Create Budget/i })).toBeDefined());

    const postsBeforeClick = calls.filter((c) => c.method === "POST").length;
    fireEvent.click(within(dialog).getByRole("button", { name: /Create Budget/i }));

    // The old bug: this click produced nothing at all. The fix: real,
    // visible validation messages naming what's missing...
    await waitFor(() => expect(within(dialog).getByText("Budget name is required.")).toBeDefined());
    expect(within(dialog).getByText("Annual amount is required.")).toBeDefined();
    // ...and, unlike before, still no request until the form is actually valid.
    expect(calls.filter((c) => c.method === "POST").length).toBe(postsBeforeClick);
  });
});
