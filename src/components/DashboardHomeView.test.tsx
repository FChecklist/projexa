/// <reference types="bun-types" />
// R67 D-02. The lane's acceptance for this item is a Playwright run against a
// local dev server, which this lane may not start; these are the same
// assertions against the rendered view with the server-resolved props passed
// in directly (which is exactly how dashboard/page.tsx supplies them).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// render()'s bound queries, not `screen` -- see ProjectCreateClient.test.tsx.
import { cleanup, fireEvent, render } from "@testing-library/react";

const push = mock((_: string) => {});
// Spread the real module rather than replacing it: this view's tree reaches
// the kit's HomeGreeting, which imports usePathname, and a bare replacement
// makes that a hard "Export named 'usePathname' not found" at import time.
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({ ...realNavigation, useRouter: () => ({ push }) }));

const DashboardHomeView = (await import("./DashboardHomeView")).default;

const CURRENCIES = [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true }];

// An org with real revenue and spend but NO budget rows -- the exact shape the
// audit measured rendering "AED 0" as though a budget of zero had been set.
const DATA = {
  totalProjects: 2,
  totalBudget: null,
  totalRevenue: 847300,
  totalExpenses: 1250000,
  projects: [
    // R67 D-62: the row carries BOTH money facts under their real names now.
    // p1 has a value somebody typed; p2 has neither, which must read "Not set".
    { id: "p1", name: "Cedar Heights Villa - Phase 1", revenue: 500000, expenses: 750000, taskCount: 10, delayedTaskCount: 1, contractValue: 4000000, projectValue: 4200000, projectValueSource: "entered" as const, earnedValue: 1000000, percentByValue: 25 },
    { id: "p2", name: "Riverside Business Park", revenue: 347300, expenses: 500000, taskCount: 4, delayedTaskCount: 0, contractValue: null, projectValue: null, projectValueSource: null, earnedValue: null, percentByValue: null },
  ],
};

function renderHome(overrides: Partial<Parameters<typeof DashboardHomeView>[0]> = {}) {
  return render(
    <DashboardHomeView
      userName="rajat"
      data={DATA}
      currencies={CURRENCIES}
      errorMessage={null}
      permitsExpiring={3}
      {...overrides}
    />
  );
}

afterEach(() => {
  cleanup();
  push.mockClear();
});

// R67 MERGE (D-11, lane E2 x lane D1): E2's E-21 (R-222) acceptance clause,
// restated against this screen's real columns. D-02's rewrite dropped the
// specific field the platform's polluted registry row was seeded against
// ("needsYou"), but columnLabel() sanitizes every field the same way, so this
// asserts the fix at a field the merged screen actually renders.
describe("DashboardHomeView registry labels (E2 E-21 / R-222)", () => {
  test("'(HARD-STOP TEST)' never renders, even when the registry row still says it", () => {
    const view = renderHome({
      registryColumns: [{ field: "project", label: "PROJECT (HARD-STOP TEST)", type: "text" }],
    });
    expect(view.container.textContent ?? "").not.toContain("HARD-STOP TEST");
    expect(view.getByText("PROJECT")).toBeTruthy();
  });
});

describe("DashboardHomeView KPI band", () => {
  test("an org with no budget rows is told so in words", () => {
    const view = renderHome();
    expect(view.getByText("budget not set")).toBeTruthy();
  });

  test("nothing in the band renders a currency-prefixed zero for a figure nobody set", () => {
    const view = renderHome();
    expect(view.container.textContent ?? "").not.toMatch(/AED\s*0\b/);
  });

  test("never says 'over budget' when there is no budget to be over", () => {
    const view = renderHome();
    expect(view.queryByText("over budget")).toBeNull();
  });

  test("says 'over budget' only once a real budget is exceeded", () => {
    const view = renderHome({ data: { ...DATA, totalBudget: 900000 } });
    expect(view.getByText("over budget")).toBeTruthy();
    // R67 D-61 changed this from "budget AED 900,000" to two decimals. The
    // home used to be the ONLY screen rendering whole units
    // (maximumFractionDigits: 0, in a private copy of the formatter), so the
    // same budget read "AED 900,000" here and "AED 900,000.00" on /scope.
    expect(view.getByText("budget AED 900,000.00")).toBeTruthy();
  });

  test("the Revenue card is a real door to /invoices", () => {
    const view = renderHome();
    fireEvent.click(view.getByRole("button", { name: /Revenue/ }));
    expect(push).toHaveBeenCalledWith("/invoices");
  });

  test("the primary card reports portfolio earned value against contract, skipping the project with no BOQ", () => {
    const view = renderHome();
    const card = view.getByText("Portfolio earned value").closest("button")!;
    // AED 1,000,000.00 also appears in the project table below, which is the
    // point: the band is summed from the same rows, so the two agree.
    // R67 D-61: two decimals, the same as every other money surface.
    expect(card.textContent).toContain("AED 1,000,000.00");
    expect(card.textContent).toContain("of AED 4,000,000.00 contract (25 %)");
  });

  test("with no BOQ anywhere the primary card says so and offers the next step", () => {
    const view = renderHome({
      data: { ...DATA, projects: DATA.projects.map((p) => ({ ...p, contractValue: null, earnedValue: null, percentByValue: null })) },
    });
    expect(view.getByText("No BOQ yet")).toBeTruthy();
    expect(view.getByText("Import a BOQ")).toBeTruthy();
  });

  test("a failed permits read is words, not a zero", () => {
    const view = renderHome({ permitsExpiring: null });
    expect(view.getByText("Not loaded")).toBeTruthy();
    expect(view.getByText("the permits read failed")).toBeTruthy();
  });

  test("the project count is not repeated as a KPI tile -- the greeting already states it", () => {
    const view = renderHome();
    expect(view.queryByText("Active Projects")).toBeNull();
  });
});

describe("DashboardHomeView projects table (D-01)", () => {
  test("a project with no BOQ still reads 'No scope yet' and still opens its dashboard", () => {
    const view = renderHome();
    expect(view.getByText("No scope yet")).toBeTruthy();
    fireEvent.click(view.getByLabelText("Open Riverside Business Park"));
    expect(push).toHaveBeenCalledWith("/dashboard/project?projectId=p2");
  });

  test("Enter on a focused row opens it, so the row is not mouse-only", () => {
    const view = renderHome();
    fireEvent.keyDown(view.getByLabelText("Open Cedar Heights Villa - Phase 1"), { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/dashboard/project?projectId=p1");
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
    const link = view.getByRole("link", { name: "Create Project" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/projects/new");
    expect(view.queryByRole("dialog")).toBeNull();
  });
});

// ─── R67 D-62: one project-money model ───────────────────────────────────────
describe("R67 D-62: the home names both money facts and says where each came from", () => {
  test("the two columns are headed for what they are, not both called 'Value'", () => {
    const view = renderHome();
    // Matched on the header ROW's text rather than by exact node text: lane
    // G-05 appends the currency unit to every money heading (" (AED)"), so the
    // <th> reads "Contract value (AED)" and an exact-text query would miss it.
    // The point of the assertion is that the two facts are named differently
    // and that neither is still headed the bare word "Value".
    const headers = view.getAllByRole("columnheader").map((h) => h.textContent ?? "");
    expect(headers.some((h) => h.startsWith("Contract value"))).toBe(true);
    expect(headers.some((h) => h.startsWith("Project value"))).toBe(true);
    expect(headers.some((h) => h.trim() === "Value" || h.trim().startsWith("Value ("))).toBe(false);
  });

  test("a project value somebody typed is shown with its source named", () => {
    const view = renderHome();
    const row = view.getByRole("row", { name: /Open Cedar Heights Villa/ });
    expect(row.textContent).toContain("AED 4,200,000.00");
    expect(row.textContent).toContain("(entered)");
    // ...and its contract value, the OTHER fact, is still its own figure.
    expect(row.textContent).toContain("AED 4,000,000.00");
  });

  test("a project with neither source reads 'Not set', never a zero", () => {
    const view = renderHome();
    const row = view.getByRole("row", { name: /Open Riverside Business Park/ });
    expect(row.textContent).toContain("Not set");
    expect(row.textContent).not.toContain("AED 0.00");
  });
});
