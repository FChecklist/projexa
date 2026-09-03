/// <reference types="bun-types" />
// R67 D-43 acceptance, asserted against the real component rather than a
// Playwright walk (this session may not start a dev server).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { PROJECT_PREFERENCE_KEY } from "@/lib/project-preference";

const push = mock((_href: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, prefetch: () => {} }) }));

const BudgetsClient = (await import("./BudgetsClient")).default;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Handler = () => Response | Promise<Response>;

function router(handlers: Record<string, Handler>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const path of Object.keys(handlers).sort((a, b) => b.length - a.length)) {
      if (url.includes(path)) return handlers[path]();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

const PROJECTS = [{ id: "proj-cedar", name: "Cedar Heights Villa - Phase 1" }];
const FISCAL_YEARS = [{ id: "fy1", yearName: "FY 2026" }];

const BUDGET = {
  id: "bud-1", name: "Site budget 2026", fiscalYearId: "fy1", companyId: null, costCenterId: null,
  status: "draft", actionIfExceeded: null,
};

function handlers(over: Partial<Record<string, Handler>> = {}): Record<string, Handler> {
  return {
    "/api/project-budgets": () => jsonRes({ projectBudgets: [] }),
    "/api/companies": () => jsonRes({ companies: [] }),
    "/api/fiscal-years": () => jsonRes({ fiscalYears: FISCAL_YEARS }),
    "/api/projects": () => jsonRes({ projects: PROJECTS }),
    "/api/organization": () => jsonRes({ organization: { id: "o1", name: "Skyline Builders" }, role: "pm" }),
    "/api/currencies": () => jsonRes({ currencies: [{ id: "c1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] }),
    ...over,
  } as Record<string, Handler>;
}

function renderClient(over: Partial<Record<string, Handler>> = {}) {
  globalThis.fetch = router(handlers(over));
  return render(<BudgetsClient registryColumns={null} />);
}

function headerButtonTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll("button")]
    .map((b) => b.textContent ?? "")
    .filter((t) => t.startsWith("Filter") || t.startsWith("Export") || t.startsWith("+ New"));
}

afterEach(() => {
  cleanup();
  push.mockClear();
  try { window.sessionStorage.clear(); } catch {}
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("BudgetsClient -- the landing copy (D-43)", () => {
  test("the sub-copy speaks to the user and names where the OTHER budget lives", async () => {
    const { getByText, queryByText } = renderClient();

    await waitFor(() =>
      expect(
        getByText("Annual budgets by account and fiscal year. For the budget against each BOQ line, open Scope of Work › Cost Variance.")
      ).toBeDefined()
    );
    // The changelog sentence is gone.
    expect(queryByText(/no more guessing an opaque ID/)).toBeNull();
  });

  test("the empty state names the org and offers TWO next steps -- never 'No budgets found.'", async () => {
    const { getByText, queryByText } = renderClient();

    await waitFor(() => expect(getByText("No budgets yet for Skyline Builders")).toBeDefined());
    expect(getByText("+ New Budget")).toBeDefined();
    expect(queryByText("No budgets found.")).toBeNull();
  });

  test("with no project on the rail, the BOQ route says why it cannot be taken", async () => {
    const { getByTestId } = renderClient();

    await waitFor(() => expect(getByTestId("budgets-boq")).toBeDefined());
    const boq = getByTestId("budgets-boq") as HTMLButtonElement;
    expect(boq.textContent).toBe("Open BOQ budget → (Pick a project first)");
    expect(boq.disabled).toBe(true);
  });

  test("with a project on the rail it is enabled and opens that project's Cost Variance", async () => {
    window.localStorage.setItem(PROJECT_PREFERENCE_KEY, "proj-cedar");
    const { getByTestId } = renderClient();

    await waitFor(() => expect((getByTestId("budgets-boq") as HTMLButtonElement).disabled).toBe(false));
    expect((getByTestId("budgets-boq") as HTMLButtonElement).textContent).toBe("Open BOQ budget →");

    fireEvent.click(getByTestId("budgets-boq"));
    expect(push).toHaveBeenCalledWith("/scope?tab=cost-variance&projectId=proj-cedar");
  });

  test("'+ New Budget' opens the create route", async () => {
    const { getByTestId } = renderClient();
    await waitFor(() => expect(getByTestId("budgets-new")).toBeDefined());
    fireEvent.click(getByTestId("budgets-new"));
    expect(push).toHaveBeenCalledWith("/budgets/new");
  });
});

describe("BudgetsClient -- the standard header trio (D-43)", () => {
  test("Filter | Export | + New render in that DOM order, with reasons while there are no rows", async () => {
    const { container, getByText } = renderClient();

    await waitFor(() => expect(getByText("No budgets yet for Skyline Builders")).toBeDefined());
    const texts = headerButtonTexts(container);
    expect(texts[0]).toContain("Filter");
    expect(texts[1]).toContain("Export");
    expect(texts[2]).toContain("+ New");
    expect(texts[0]).toContain("No budgets to filter");
    expect(texts[1]).toContain("No budgets to export");
  });

  test("once rows exist the two are usable again", async () => {
    const { container, getByText } = renderClient({
      "/api/project-budgets": () => jsonRes({ projectBudgets: [BUDGET] }),
    });

    await waitFor(() => expect(getByText("Site budget 2026")).toBeDefined());
    const texts = headerButtonTexts(container);
    expect(texts[0]).toBe("Filter");
    expect(texts[1]).toBe("Export");
  });
});

describe("BudgetsClient -- the list is meaningful once rows exist (D-43)", () => {
  // R67 D-43 x F-08 (integration). This fixture is the LEGACY path: a row that
  // carries fiscalYearId but no fiscalYearName, i.e. a VERIDIAN older than the
  // change that resolves the name upstream. The id-to-name lookup still runs
  // for it, so the assertion is unchanged -- but it is now awaited, because the
  // lookup is no longer fired on mount for every visit. It is fired only when a
  // loaded row turns out to lack a name, which is the whole point of F-08 and
  // is asserted directly by the test below.
  test("Fiscal Year is resolved to its NAME, not left as an opaque id", async () => {
    const { getByText } = renderClient({
      "/api/project-budgets": () => jsonRes({ projectBudgets: [BUDGET] }),
    });

    await waitFor(() => expect(getByText("Site budget 2026")).toBeDefined());
    expect(getByText("Fiscal Year")).toBeDefined();
    await waitFor(() => expect(getByText("FY 2026")).toBeDefined());
  });

  // R67 F-08. THE ROUND TRIP THIS ITEM REMOVES. /budgets used to fetch the
  // whole fiscal-year list on every visit purely to turn one id per row into
  // one string. listBudgets now resolves the name inside the transaction it
  // already holds, so when the row carries it, that request is not made at all.
  test("a row that carries its own year name costs NO /api/fiscal-years request", async () => {
    const requested: string[] = [];
    const inner = router(handlers({
      "/api/project-budgets": () =>
        jsonRes({ projectBudgets: [{ ...BUDGET, fiscalYearName: "FY 2026" }] }),
    }));
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requested.push(typeof input === "string" ? input : input.toString());
      return inner(input, init);
    }) as typeof fetch;

    const { getByText } = render(<BudgetsClient registryColumns={null} />);

    await waitFor(() => expect(getByText("Site budget 2026")).toBeDefined());
    await waitFor(() => expect(getByText("FY 2026")).toBeDefined());
    expect(requested.some((u) => u.includes("/api/fiscal-years"))).toBe(false);
  });

  test("an Annual Amount the list DTO carries is formatted in the org currency", async () => {
    const { getByText } = renderClient({
      "/api/project-budgets": () => jsonRes({ projectBudgets: [{ ...BUDGET, annualAmount: "150000" }] }),
    });

    await waitFor(() => expect(getByText("AED 150,000.00")).toBeDefined());
  });

  test("a failing upstream is an error with Retry, never an empty list", async () => {
    const { getByText, queryByText } = renderClient({
      "/api/project-budgets": () => jsonRes({ error: "The ERP module didn't answer" }, 502),
    });

    await waitFor(() => expect(getByText("Couldn't load budgets: The ERP module didn't answer")).toBeDefined());
    expect(queryByText("No budgets yet for Skyline Builders")).toBeNull();
  });
});
