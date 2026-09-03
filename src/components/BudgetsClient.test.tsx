/// <reference types="bun-types" />
// R67 F-08 (R-112) acceptance test — the runnable half of the list assertion.
//
// The item's acceptance is a Playwright timing run ("the column header
// 'Annual Amount' visible within 700 ms"). The property behind that number is
// what is asserted here, without a server: the header is on screen on the
// FIRST render, before any response has resolved, because the loading state is
// a skeleton carrying the real headers rather than a bare spinner.
//
// The second half of the fault was that the list could not be read at all: it
// showed a name and a status, and neither WHICH YEAR nor HOW MUCH. Those two
// columns now come from the row payload (VERIDIAN's listBudgets folds them on
// inside the transaction it already holds), so they cost no extra request.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// `screen` is intentionally not imported: @testing-library/dom binds it to
// document.body at module-evaluation time, before GlobalRegistrator.register()
// has created `document`.
import { cleanup, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), prefetch: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
}));

const BudgetsClient = (await import("./BudgetsClient")).default;
const { __resetCurrenciesCacheForTests } = await import("@/lib/currency");

afterEach(() => {
  cleanup();
  __resetCurrenciesCacheForTests();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const BUDGETS = [
  {
    id: "b1",
    name: "FY26 Site Works",
    fiscalYearId: "fy1",
    fiscalYearName: "FY 2026",
    annualAmount: 125000.5,
    companyId: null,
    costCenterId: null,
    status: "approved",
    actionIfExceeded: "warn",
  },
  {
    id: "b2",
    name: "Legacy",
    fiscalYearId: "fy-gone",
    fiscalYearName: null,
    annualAmount: 0,
    companyId: null,
    costCenterId: null,
    status: "draft",
    actionIfExceeded: null,
  },
];

function stubFetch(budgets: unknown[] = BUDGETS, options: { never?: boolean } = {}) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (options.never) return new Promise<Response>(() => {}); // never resolves
    if (url.includes("/api/project-budgets")) return jsonRes({ projectBudgets: budgets });
    // R67 G-05 (integration): a REAL base-currency row. The merged screen
    // formats money through useOrgMoney, and with `currencies: []` these rows
    // render through the "no currency set" path -- a warning glyph and no code
    // -- which is a degraded state, not the one a user normally sees. Same
    // reasoning ScopeClient.test.tsx states for its own fixture.
    if (url.includes("/api/currencies")) {
      return jsonRes({ currencies: [{ id: "c-1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] });
    }
    return jsonRes({});
  }) as typeof fetch;
  return calls;
}

describe("BudgetsClient", () => {
  test("the real headers, including 'Annual Amount', are on screen on the first render -- before any response resolves", () => {
    stubFetch(BUDGETS, { never: true });

    const { getByText } = render(<BudgetsClient />);

    // No waitFor: this is the very first painted frame.
    expect(getByText("Name")).toBeDefined();
    expect(getByText("Fiscal Year")).toBeDefined();
    expect(getByText("Annual Amount")).toBeDefined();
    expect(getByText("Status")).toBeDefined();
  });

  test("the fiscal year and the amount render from the row payload -- no second request per budget", async () => {
    const calls = stubFetch();

    const { getByText } = render(<BudgetsClient />);

    await waitFor(() => expect(getByText("FY26 Site Works")).toBeDefined());
    expect(getByText("FY 2026")).toBeDefined();
    // R67 G-05 (integration): the amount is formatted by the ONE money
    // formatter every list in this product now uses -- "AED 125,000.50", the
    // same shape LabourClient renders. It was a bare "125,000.50" while this
    // screen formatted money itself. The fact asserted is unchanged: the
    // payload's own amount, to two places, with no per-row request.
    expect(getByText("AED 125,000.50")).toBeDefined();

    // Exactly one budgets request for two rows.
    expect(calls.filter((u) => u.includes("/api/project-budgets"))).toHaveLength(1);
  });

  test("an unresolvable fiscal year is an em-dash, never the raw id", async () => {
    const calls = stubFetch();

    const { getByText, queryByText } = render(<BudgetsClient />);

    await waitFor(() => expect(getByText("Legacy")).toBeDefined());
    expect(queryByText("fy-gone")).toBeNull();
    expect(calls.length).toBeGreaterThan(0);
  });

  test("the companies filter comes from props -- the list makes no /api/companies request of its own", async () => {
    const calls = stubFetch();

    const { getByText } = render(
      <BudgetsClient
        companies={[{ id: "c1", companyName: "Skyline", abbr: "SKY", parentCompanyId: null, isGroup: false, defaultCurrencyId: null, country: null, dateOfIncorporation: null, isActive: true }]}
      />
    );

    await waitFor(() => expect(getByText("FY26 Site Works")).toBeDefined());
    expect(calls.filter((u) => u.includes("/api/companies"))).toHaveLength(0);
  });

  test("a failing budgets request shows the backend's own words, not 'No budgets found.'", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/project-budgets")) return jsonRes({ error: "ERP module is not enabled for this organisation" }, 403);
      return jsonRes({ currencies: [] });
    }) as typeof fetch;

    const { getByText, queryByText } = render(<BudgetsClient />);

    await waitFor(() => expect(getByText(/ERP module is not enabled/)).toBeDefined());
    expect(queryByText("No budgets found.")).toBeNull();
  });
});
