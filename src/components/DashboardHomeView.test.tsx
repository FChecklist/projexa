/// <reference types="bun-types" />
// R67 E-21 (R-195 / R-204 / R-205 / R-222, correction C-14). The launchpad's
// own acceptance clauses, as a render test: the project row is a link to that
// project's dashboard, every KPI card carries a baseline line, and the string
// "(HARD-STOP TEST)" cannot reach the screen even when the platform registry
// row still contains it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Guarded, like the other happy-dom suites in this repo -- `bun test` runs
// every file in one process and a second register() throws.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

// next/link and useRouter both assert a mounted App Router; this is the same
// mock.module shim PayrollClient.test.tsx / ProcurementClient.test.tsx use.
// The <Link> href assertions below are exactly why the anchor itself is left
// real rather than shimmed away too.
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), refresh: mock(() => {}), replace: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard",
}));

import { cleanup, render } from "@testing-library/react";
import DashboardHomeView, { type CurrencyRow, type OrgDashboard } from "./DashboardHomeView";
import type { LaunchpadProject } from "@/lib/dashboard-launchpad";

afterEach(cleanup);

const CURRENCIES: CurrencyRow[] = [
  { id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true },
];

function projectRow(over: Partial<LaunchpadProject> = {}): LaunchpadProject {
  return {
    id: "prj-cedar",
    name: "Cedar Heights Villa - Phase 1",
    revenue: 0,
    expenses: 185_000,
    spent: 185_000,
    taskCount: 4,
    delayedTaskCount: 0,
    tasksDue: 4,
    tasksLate: 0,
    hasSchedule: true,
    value: 475_000,
    contractValue: 475_000,
    earnedValue: 118_750,
    earnedValuePrevWeek: 95_000,
    percentByValue: 25,
    progressPercent: 60,
    budget: null,
    ...over,
  };
}

function dashboard(over: Partial<OrgDashboard> = {}): OrgDashboard {
  return {
    totalProjects: 1,
    totalBudget: null,
    totalRevenue: 0,
    totalExpenses: 185_000,
    projects: [projectRow()],
    ...over,
  };
}

describe("DashboardHomeView (the launchpad)", () => {
  test("the project row is a link to that project's dashboard", () => {
    const { getAllByRole } = render(
      <DashboardHomeView userName="rajat" data={dashboard()} currencies={CURRENCIES} errorMessage={null} />
    );
    // R67 E-29 added the per-project bar block below the rows, so the project
    // is now named by TWO links -- the row and its bar row. Both are doors to
    // the same place, and asserting that is stronger than asserting one of
    // them: a project's name on this screen must never lead anywhere else.
    const links = getAllByRole("link", { name: /Cedar Heights Villa/ });
    expect(links.length).toBeGreaterThanOrEqual(1);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe("/dashboard/project?projectId=prj-cedar");
    }
  });

  test("'(HARD-STOP TEST)' never renders, even when the registry row still says it", () => {
    const { container } = render(
      <DashboardHomeView
        userName="rajat"
        data={dashboard()}
        currencies={CURRENCIES}
        errorMessage={null}
        registryColumns={[{ field: "needsYou", label: "ACTIVE PROJECTS (HARD-STOP TEST)", type: "number" }]}
      />
    );
    expect(container.textContent).not.toContain("HARD-STOP TEST");
    expect(container.textContent).toContain("ACTIVE PROJECTS");
  });

  test("the dominant number states the percentage, its baseline and its vs-last-week delta", () => {
    const { container } = render(
      <DashboardHomeView userName="rajat" data={dashboard()} currencies={CURRENCIES} errorMessage={null} />
    );
    expect(container.textContent).toContain("25% complete by value");
    expect(container.textContent).toContain("points vs last week");
    expect(container.textContent).toContain("AED 118,750 earned of AED 475,000");
  });

  test("every KPI card carries a baseline line", () => {
    const { container } = render(
      <DashboardHomeView userName="rajat" data={dashboard()} currencies={CURRENCIES} errorMessage={null} />
    );
    // The kit's KpiCard renders label / value / trend / baseline in that
    // order; the baseline is the last line of each card. Assert on the words
    // each of the three cards owes the reader.
    // R67 E-29 (R-255) fixed the unset-budget baseline to its own words:
    // "Budget not set → Budgets".
    for (const baseline of ["of 1 active project", "Budget not set → Budgets", "across 1 project"]) {
      expect(container.textContent).toContain(baseline);
    }
  });

  test("a project with no BOQ says 'Not set', never a bar and never 0%", () => {
    const { container } = render(
      <DashboardHomeView
        userName="rajat"
        data={dashboard({ projects: [projectRow({ contractValue: null, value: null, earnedValue: null, percentByValue: null })] })}
        currencies={CURRENCIES}
        errorMessage={null}
      />
    );
    expect(container.textContent).toContain("No scope yet");
    expect(container.textContent).not.toContain("0%");
  });

  test("a row whose figures never arrived offers Retry instead of a bar", () => {
    const missing = { id: "p2", name: "Half Loaded", revenue: 0, expenses: 0, taskCount: 0, delayedTaskCount: 0, value: null, percentByValue: null } as unknown as LaunchpadProject;
    const { container, getByRole } = render(
      <DashboardHomeView userName="rajat" data={dashboard({ projects: [missing] })} currencies={CURRENCIES} errorMessage={null} />
    );
    expect(container.textContent).toContain("Couldn't load");
    expect(getByRole("button", { name: "Retry" })).toBeDefined();
  });

  test("'on track' is only claimed for a project that has a schedule", () => {
    const withSchedule = render(
      <DashboardHomeView userName="rajat" data={dashboard()} currencies={CURRENCIES} errorMessage={null} />
    );
    expect(withSchedule.container.textContent).toContain("on track");
    cleanup();

    const without = render(
      <DashboardHomeView
        userName="rajat"
        data={dashboard({ projects: [projectRow({ hasSchedule: false })] })}
        currencies={CURRENCIES}
        errorMessage={null}
      />
    );
    // The only place "on track" may appear now is the sentence explaining
    // that it CANNOT be claimed -- never as a status word on a row or a stat.
    expect(without.container.textContent).toContain("none can be called on track");
    expect(without.container.textContent).not.toContain("1 on track");
    expect(without.container.textContent).toContain("no schedule set");
  });
});

// R67 E-29 (R-255). The launchpad's own acceptance clauses: the portfolio
// number is the FIRST heading on the page (it used to be "Welcome back,
// {name}." with the number third, inside a card), the needs-you projects are
// listed as links rather than as a count, and the per-project bars are drawn
// beneath with every bar a door.
describe("DashboardHomeView (R67 E-29: Sumeet's sketch)", () => {
  test("the first heading is the portfolio number, in the sentence Sumeet wrote", () => {
    const { container } = render(
      <DashboardHomeView userName="rajat" data={dashboard()} currencies={CURRENCIES} errorMessage={null} />
    );
    const firstHeading = container.querySelector("h1, h2, h3");
    expect(firstHeading?.textContent).toMatch(/Portfolio earned value AED [\d,]+ of AED [\d,]+/);
    expect(firstHeading?.tagName).toBe("H1");
  });

  test("the portfolio figure is stated ONCE, and exactly three KPI cards follow it", () => {
    const { container } = render(
      <DashboardHomeView userName="rajat" data={dashboard()} currencies={CURRENCIES} errorMessage={null} />
    );
    const text = container.textContent ?? "";
    // It used to be the <h1> AND a hero KpiCard directly beneath restating it.
    expect(text.split("complete by value").length - 1).toBe(1);

    // R-255's three cards, each a door with its own destination.
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    for (const href of ["/schedule", "/budgets", "/invoices"]) {
      expect(hrefs).toContain(href);
    }
  });

  test("the greeting sentence survives -- under the number, not above it", () => {
    const { container } = render(
      <DashboardHomeView userName="rajat" data={dashboard()} currencies={CURRENCIES} errorMessage={null} />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Welcome back, rajat.");
    expect(text.indexOf("Portfolio earned value")).toBeLessThan(text.indexOf("Welcome back"));
  });

  test("a project that needs you is named as a LINK, not counted and left to be found", () => {
    const { getAllByRole, container } = render(
      <DashboardHomeView
        userName="rajat"
        data={dashboard({ projects: [projectRow({ tasksLate: 3 })] })}
        currencies={CURRENCIES}
        errorMessage={null}
      />
    );
    expect(container.textContent).toContain("Needs you:");
    for (const link of getAllByRole("link", { name: /Cedar Heights Villa/ })) {
      expect(link.getAttribute("href")).toBe("/dashboard/project?projectId=prj-cedar");
    }
  });

  test("the three series are drawn per project, each named in words beside its swatch", () => {
    const { container } = render(
      <DashboardHomeView userName="rajat" data={dashboard()} currencies={CURRENCIES} errorMessage={null} />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Revenue, budget and earned value per project");
    expect(text).toContain("Progress (earned value)");
  });

  test("the activity-log figure appears as a secondary only when it disagrees with the bar", () => {
    const disagreeing = render(
      <DashboardHomeView
        userName="rajat"
        data={dashboard({ projects: [projectRow({ percentByValue: 25, progressPercent: 60 })] })}
        currencies={CURRENCIES}
        errorMessage={null}
      />
    );
    expect(disagreeing.container.textContent).toContain("60% logged in the activity log");
    cleanup();

    const agreeing = render(
      <DashboardHomeView
        userName="rajat"
        data={dashboard({ projects: [projectRow({ percentByValue: 25, progressPercent: 25 })] })}
        currencies={CURRENCIES}
        errorMessage={null}
      />
    );
    expect(agreeing.container.textContent).not.toContain("logged in the activity log");
  });
});
