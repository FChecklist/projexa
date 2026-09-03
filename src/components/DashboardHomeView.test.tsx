/// <reference types="bun-types" />
// R67 D-02, second-merge restatement. D-02's own acceptance was a Playwright
// run against a local dev server on a KPI-band + project-TABLE layout; this
// lane's own E-01/E-19 rewrite (landed first on this branch, before D1's D-02
// commits reached main) replaced that whole layout with the ONE NUMBER +
// portfolio chart + ProjectRowList + secondary DashboardCard band this file
// now renders against. D-02's FACTS survive (no fabricated "AED 0", "over
// budget" only when a budget is exceeded, permits read failure is words not a
// zero, D-62's dual money facts on a project) -- restated against the
// surviving mechanism rather than the table it no longer has. See
// DashboardHomeView.tsx's own R67 MERGE comment for which lane's structure won
// and why.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// render()'s bound queries, not `screen` -- see ProjectCreateClient.test.tsx.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BUDGET_NOT_ENTERED } from "@/lib/dashboard-kpis";

const push = mock((_: string) => {});
// R67 second-merge fix: a bare spread of the real module left useSearchParams()
// throwing/null outside a real Next.js router context -- this view's tree now
// also reaches DashboardFilterDrawer (E-02), which calls useSearchParams()
// unconditionally on render. Full replacement, not a spread, following the
// same pattern DashboardFilterDrawer's own test file already uses.
mock.module("next/navigation", () => ({
  useRouter: () => ({ push, replace: () => {}, prefetch: () => {}, refresh: () => {} }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

const DashboardHomeView = (await import("./DashboardHomeView")).default;

const CURRENCIES = [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true }];

// An org with real revenue and spend but NO budget rows -- the exact shape the
// audit measured rendering "AED 0" as though a budget of zero had been set.
//
// `value` is the field portfolioContractValue()/dashboardKpis()/ProjectRow all
// actually read (contractValue's own deprecated alias -- see
// construction-dashboard-service.ts#OrgDashboardProjectSummary); `contractValue`/
// `projectValue`/`projectValueSource` are D-62's own named facts, carried
// alongside it so the R67 D-62 describe block below can assert them too.
const DATA = {
  totalProjects: 2,
  totalBudget: null,
  totalLedgerBudget: null,
  totalRevenue: 847300,
  totalExpenses: 1250000,
  projects: [
    // p1 has a value somebody typed; p2 has neither, which must read "Not set".
    { id: "p1", name: "Cedar Heights Villa - Phase 1", revenue: 500000, expenses: 750000, taskCount: 10, delayedTaskCount: 1, value: 4000000, contractValue: 4000000, projectValue: 4200000, projectValueSource: "entered" as const, earnedValue: 1000000, percentByValue: 25 },
    { id: "p2", name: "Riverside Business Park", revenue: 347300, expenses: 500000, taskCount: 4, delayedTaskCount: 0, value: null, contractValue: null, projectValue: null, projectValueSource: null, earnedValue: null, percentByValue: null },
  ],
};

function renderHome(overrides: Partial<Parameters<typeof DashboardHomeView>[0]> = {}) {
  return render(
    <DashboardHomeView
      userName="rajat"
      data={DATA}
      currencies={CURRENCIES}
      errorMessage={null}
      today="2026-09-03"
      permitsExpiring={3}
      {...overrides}
    />
  );
}

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("DashboardHomeView KPI band (R67 E-19, restated from D-02)", () => {
  test("an org with no budget rows is told so in words", () => {
    const view = renderHome();
    // Both the Budget tile and the Expenses tile (nothing to measure spend
    // against without one) carry this sentence.
    expect(view.getAllByText(new RegExp(BUDGET_NOT_ENTERED.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))).length).toBeGreaterThan(0);
  });

  test("nothing in the band renders a currency-prefixed zero for a figure nobody set", () => {
    const view = renderHome();
    expect(view.container.textContent ?? "").not.toMatch(/AED\s*0\.00\b/);
  });

  test("never claims a direction on the Budget tile when there is no budget to compare against", () => {
    const view = renderHome();
    // dashboardKpis() returns direction: null whenever budget is not entered,
    // and kpiSubtitle() renders NO direction glyph/word for a null direction
    // -- so the budget tile's own subtitle is the baseline alone. (Other
    // tiles, e.g. Revenue vs contract value, have a real direction of their
    // own regardless of whether a budget exists -- this checks the Budget
    // tile specifically, not the whole page.)
    const budgetLink = view.getByRole("link", { name: /^Total Budget/ });
    expect(budgetLink.textContent).not.toMatch(/▲|▼/);
  });

  test("shows a real over/under direction once a real budget is exceeded", () => {
    const view = renderHome({ data: { ...DATA, totalBudget: 900000 } });
    // Expenses (1,250,000) > Budget (900,000): the Expenses tile compares
    // against the budget and is over it. formatKpi() is whole units (KPI
    // tiles show no fraction -- see DashboardHomeView.tsx's own comment).
    // DEFAULT_COLUMNS' own fallback label for this field is "Spend", not the
    // tile's internal title "Total Expenses".
    const expensesLink = view.getByRole("link", { name: /^Spend/ });
    expect(expensesLink.textContent).toMatch(/▲ over/);
    expect(expensesLink.textContent).toMatch(/vs AED 900,000 budget/);
  });

  test("the Revenue tile is a real door to /invoices", () => {
    const view = renderHome();
    // DashboardCard's own accessible name is `${title}: ${value}`, anchored
    // at the start so a project row's own "Revenue" figure-label (RowFigures)
    // does not also match -- every row's whole card is a link too, and its
    // own text includes the word "Revenue".
    const link = view.getByRole("link", { name: /^Revenue/ }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/invoices");
  });

  test("the primary card reports portfolio earned value against contract, skipping the project with no BOQ", () => {
    const view = renderHome();
    const card = view.getByTestId("dashboard-one-number");
    // AED 1,000,000 also appears on p1's own row below, which is the point:
    // the primary card is summed from the same rows the list renders.
    expect(card.textContent).toContain("1,000,000");
    expect(card.textContent).toContain("4,000,000");
    expect(card.textContent).toContain("25%");
  });

  test("with no BOQ anywhere the primary card says so and offers the next step", () => {
    const view = renderHome({
      data: { ...DATA, projects: DATA.projects.map((p) => ({ ...p, value: null, earnedValue: null, percentByValue: null })) },
    });
    expect(view.getByTestId("dashboard-one-number").textContent).toBe("No BOQ yet");
    expect(view.getByText(/Import a BOQ/)).toBeTruthy();
  });

  test("a failed permits read is stated in words on the greeting, not folded in as a silent zero", () => {
    // null is the read-failed state; renderHome's default (3) already proves
    // the success path renders the count (see the stats-chip test below).
    const view = renderHome({ permitsExpiring: null });
    expect(view.queryByText(/permits expiring/)).toBeNull();
  });

  test("a real permits count renders on the greeting as an attention stat", () => {
    const view = renderHome({ permitsExpiring: 3 });
    expect(view.getByText("3 permits expiring")).toBeTruthy();
  });

  // R67 second-merge note: D1's OWN D-02 design dropped the Active Projects
  // tile (the count already lives in the greeting -- see this lane's own
  // dashboard-kpis.ts header). This branch's dashboardKpis() did NOT adopt
  // that removal -- it still returns a projectsTile among its four -- so the
  // tile IS present. Restated to the actual, current behaviour: the count is
  // both in the greeting sentence AND on its own tile, and neither is wrong.
  test("the project count appears in the greeting sentence", () => {
    const view = renderHome();
    expect(view.getByText(/You have 2 active projects/)).toBeTruthy();
  });
});

describe("DashboardHomeView project rows (R67 E-01/E-19, restated from D-01)", () => {
  test("a project with no BOQ still renders and still opens its dashboard", () => {
    const view = renderHome();
    expect(view.getByText("Riverside Business Park")).toBeTruthy();
    fireEvent.click(view.getByText("Riverside Business Park"));
    expect(push).toHaveBeenCalledWith("/dashboard/project?projectId=p2");
  });

  // R67 MERGE. This test was auto-merged (main never touched it) and still
  // asked for a control named "+ New" -- lane D1's wording. Both lanes shipped
  // this control as part of D-01, and the merged component deliberately keeps
  // main's "Create Project": on the HOME screen a bare "+ New" says least about
  // what it creates, and it is the same words ProjectsOverviewClient's empty
  // state now uses, so one product does not name one destination two ways. See
  // DashboardHomeView.tsx's own comment on the control. The ASSERTION is
  // unchanged in substance -- a real link to a real route, and no dialog.
  test("the home's create control is a link to the real route, not a dialog trigger", () => {
    const view = renderHome();
    const links = view.getAllByRole("link", { name: /Create Project|New project/ });
    expect(links.some((l) => l.getAttribute("href") === "/projects/new")).toBe(true);
    expect(view.queryByRole("dialog")).toBeNull();
  });
});

// ─── R67 D-62: one project-money model ───────────────────────────────────────
// Restated against ProjectRow's own rendering (second-merge fold-in of D-62's
// per-row Project value + source, folded into the row-list card rather than
// the table column D1 originally shipped it on -- see ProjectRow.tsx's own
// comment).
describe("R67 D-62: the home names both money facts and says where each came from", () => {
  test("a project value somebody typed is shown with its source named", () => {
    const view = renderHome();
    const p1Value = view.getByText("Cedar Heights Villa - Phase 1").closest("a")!.querySelector('[data-testid="project-row-project-value"]')!;
    expect(p1Value.textContent).toContain("4,200,000.00");
    expect(p1Value.textContent).toContain("(entered)");
    // ...and its contract value, the OTHER fact, is still its own figure.
    expect(view.getByText("Cedar Heights Villa - Phase 1").closest("a")!.textContent).toContain("4,000,000.00");
  });

  test("a project with neither source reads 'Not set', never a zero", () => {
    const view = renderHome();
    const p2Value = view.getByText("Riverside Business Park").closest("a")!.querySelector('[data-testid="project-row-project-value"]')!;
    expect(p2Value.textContent).toContain("Not set");
    expect(p2Value.textContent).not.toContain("AED 0.00");
  });
});
