/// <reference types="bun-types" />
// R-81 ("NO visible pill may be unwired"). Two jobs:
//
//  1. Keep SHIPPED_ROUTES honest. It is a checked-in list (a client component
//     cannot read the filesystem), so this test regenerates it from the real
//     src/app/**/page.tsx files and asserts exact equality in BOTH directions
//     -- a page added without being listed, or a page deleted and left listed,
//     fails here instead of shipping a dead pill to a demo.
//
//  2. Assert the sidebar itself is clean: every href AppSidebar declares must
//     resolve to a real page. This is the regression guard that makes R-81
//     stay closed rather than being true only on the day it was measured.
//
// The route walk below deliberately uses fs.readdirSync rather than any shell
// glob: src/app contains [id]/[token] dynamic segments, and bracket paths are
// wildcards in PowerShell (silently matching nothing) -- a known way to get a
// confidently wrong file count in this project.
import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { SHIPPED_ROUTES, isShippedRoute, filterShippedNav } from "./nav-routes";

const APP_ROOT = join(import.meta.dir, "..", "app");
const SIDEBAR_PATH = join(import.meta.dir, "..", "components", "AppSidebar.tsx");

function walkPageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkPageFiles(full, out);
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

function routesOnDisk(): string[] {
  return walkPageFiles(APP_ROOT)
    .map((file) => {
      const rel = file.slice(APP_ROOT.length).split(sep).join("/");
      // "/(app)/rfis/page.tsx" -> "/rfis": strip the file, then the route
      // groups, which are organisational only and never appear in a URL.
      const route = rel.replace(/\/page\.tsx$/, "").replace(/\/\([^/]+\)/g, "");
      return route === "" ? "/" : route;
    })
    .sort();
}

function sidebarHrefs(): string[] {
  const source = readFileSync(SIDEBAR_PATH, "utf8");
  return [...source.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("SHIPPED_ROUTES", () => {
  test("matches the real src/app/**/page.tsx routes exactly, in both directions", () => {
    expect([...SHIPPED_ROUTES].sort()).toEqual(routesOnDisk());
  });

  test("lists no route twice", () => {
    expect(new Set(SHIPPED_ROUTES).size).toBe(SHIPPED_ROUTES.length);
  });
});

describe("isShippedRoute", () => {
  test("accepts a static route that exists", () => {
    expect(isShippedRoute("/rfis")).toBe(true);
  });

  test("ignores the ?projectId= suffix the sidebar appends to every project-scoped link", () => {
    expect(isShippedRoute("/rfis?projectId=abc123")).toBe(true);
  });

  test("matches a dynamic route by pattern rather than treating it as a dead end", () => {
    expect(isShippedRoute("/permits/some-real-id")).toBe(true);
    expect(isShippedRoute("/floor-plans/plan-7/walkthrough")).toBe(true);
  });

  test("rejects a route with no page.tsx behind it", () => {
    expect(isShippedRoute("/gst-reconciliation")).toBe(false);
    expect(isShippedRoute("/permits/some-id/extra-segment")).toBe(false);
  });
});

describe("filterShippedNav", () => {
  test("drops unwired items and keeps wired ones", () => {
    const sections = [
      { titleKey: "s1", items: [{ href: "/rfis" }, { href: "/not-a-real-page" }, { href: "/scope" }] },
    ];
    expect(filterShippedNav(sections)[0].items).toEqual([{ href: "/rfis" }, { href: "/scope" }]);
  });

  test("drops a section left with no items, rather than rendering an empty header", () => {
    const sections = [
      { titleKey: "dead", items: [{ href: "/nope" }] },
      { titleKey: "live", items: [{ href: "/scope" }] },
    ];
    expect(filterShippedNav(sections).map((s) => s.titleKey)).toEqual(["live"]);
  });

  test("preserves the other fields on a section it keeps", () => {
    const sections = [{ titleKey: "keep", extra: 42, items: [{ href: "/scope" }] }];
    expect(filterShippedNav(sections)[0].extra).toBe(42);
  });
});

describe("AppSidebar's declared nav entries (R-81 regression guard)", () => {
  test("every sidebar href resolves to a real page", () => {
    const unwired = sidebarHrefs().filter((href) => !isShippedRoute(href));
    expect(unwired).toEqual([]);
  });

  test("the sidebar declares at least one entry, so an empty nav can never pass this suite silently", () => {
    expect(sidebarHrefs().length).toBeGreaterThan(0);
  });
});

// R52 / R48_NAV_OMITS_LIVE_MODULE_ROUTE_01. The guard above only ever asked
// one of the two questions -- "does every nav entry have a page behind it?"
// It never asked the reverse, "does every page have a nav entry in front of
// it?", and that is the direction /site-materials fell through: a live,
// fully-rendering module (HTTP 200, its own heading, three working tabs) with
// no nav entry at all, reachable only by typing the URL. C01 REACHABLE calls
// that a fail in its own words -- "reachable by clicking through the app shell
// from the home screen, without typing a URL".
//
// The fault record asked for exactly this check to become standing rather than
// a one-off measurement, so here it is. The allowlist below is the whole point
// of the test: a route may only be absent from the nav if someone wrote down
// WHY, which makes the next omission a deliberate decision instead of an
// oversight nobody notices for months.
const ROUTES_INTENTIONALLY_NOT_IN_NAV: ReadonlySet<string> = new Set([
  // Public and auth surfaces -- outside the authenticated app shell entirely,
  // so a sidebar entry would be meaningless.
  "/",
  "/how-it-works",
  "/login",
  "/signup",
  "/auth/callback",
  "/invite/[token]",
  "/share/report/[token]",

  // Reached from their own parent flow, never from the top-level nav: you
  // open a customer from the customers list, a permit from the permits list,
  // a project dashboard by clicking a project row. Listing these would put an
  // href with no id in it into the sidebar.
  "/customers/[id]",
  "/customers/new",
  "/permits/[id]",
  "/permits/new",
  "/floor-plans/[id]",
  "/floor-plans/[id]/walkthrough",
  "/dashboard/project",

  // Real-screen conversion catch-up (2026-08-30): every one of these is the
  // exact same class as /customers/[id] and /permits/new above -- a real
  // Object Page or create screen reached by clicking a row/button on its own
  // list page (e.g. "New Vendor" on /vendors routes to /vendors/new; a row
  // on /vendors routes to /vendors/[id]), never a standalone sidebar item.
  // They accumulated across this session's whole real-screen conversion
  // (module #17 Materials through module #33 Vendors) plus other modules
  // built in earlier sessions (accounting/budgets/change-orders/documents/
  // drawings/employees/expenses/ffe/grc/inventory/schedule/scope) without
  // this test ever being run to catch the drift -- confirmed by diffing a
  // fresh routesOnDisk() walk against the pre-existing SHIPPED_ROUTES/nav
  // entries, not assumed. See nav-routes.ts's own comment for the same
  // 161-route re-measurement.
  // R67 lane D22 (item D-41): the ERP fiscal-year ledger's own create/object
  // screens, moved here with the list they belong to when /budgets became the
  // project's BOQ budget screen. Same class as every other row in this block --
  // reached from the "Finance Budgets (ERP)" list, never from the sidebar.
  "/accounting/annual-budgets/[id]",
  "/accounting/annual-budgets/new",
  "/accounting/companies/new",
  "/accounting/journal-entries/[id]",
  "/accounting/journal-entries/new",
  "/change-orders/[id]",
  "/change-orders/new",
  "/documents/[id]",
  "/documents/upload",
  "/drawings/[id]",
  "/drawings/new",
  "/employees/[id]",
  "/employees/departments/new",
  "/employees/leave/balance/new",
  "/employees/leave/new",
  "/employees/new",
  "/expenses/new",
  "/ffe/[id]",
  "/ffe/new",
  "/grc/access-review/[id]",
  "/grc/access-review/new",
  "/grc/audits/new",
  "/grc/cases/[id]",
  "/grc/cases/new",
  "/grc/findings/new",
  "/grc/policies/[id]",
  "/grc/policies/new",
  "/grc/risks/[id]",
  "/grc/risks/new",
  "/grc/vendors/new",
  "/inventory/items/[id]",
  "/inventory/items/new",
  "/inventory/stock-entries/new",
  "/inventory/warehouses/new",
  "/invoices/[id]",
  "/invoices/credit-notes/[id]",
  "/invoices/credit-notes/new",
  "/invoices/new",
  "/knowledge-base/[id]",
  "/knowledge-base/new",
  "/kpis/[id]",
  "/kpis/new",
  "/labour/[id]",
  "/labour/attendance/new",
  "/labour/new",
  "/materials/[id]",
  "/materials/new",
  "/materials/receipts/new",
  "/meetings/[id]",
  "/meetings/new",
  "/moms/[id]",
  "/moms/new",
  "/mood-boards/[id]",
  "/mood-boards/new",
  "/payroll/components/new",
  "/payroll/runs/[id]",
  "/payroll/runs/[id]/payslips/[payslipId]",
  "/payroll/runs/new",
  "/payroll/statutory-rules/new",
  "/payroll/structures/new",
  "/payroll/tax-slabs/new",
  "/procurement/goods-receipts/[id]",
  "/procurement/goods-receipts/new",
  "/procurement/purchase-orders/[id]",
  "/procurement/quotations/new",
  "/procurement/requisitions/[id]",
  "/procurement/requisitions/new",
  "/procurement/rfqs/[id]",
  "/procurement/rfqs/new",
  "/punch-list/[id]",
  "/punch-list/new",
  "/purchase-orders/new",
  "/quotations/[id]",
  "/quotations/new",
  "/recruitment/applications/[id]",
  "/recruitment/applications/new",
  "/recruitment/candidates/new",
  "/recruitment/openings/[id]",
  "/recruitment/openings/new",
  "/rfis/[id]",
  "/rfis/new",
  "/sales-orders/[id]",
  "/sales-orders/new",
  "/sales/leads/[id]",
  "/sales/leads/new",
  "/sales/opportunities/[id]",
  "/sales/opportunities/new",
  "/schedule/log-time",
  "/schedule/sprints/new",
  "/schedule/tasks/[id]",
  "/schedule/tasks/new",
  "/scope/[id]",
  "/scope/[id]/compare",
  "/scope/[id]/revise",
  "/scope/new",
  "/site-diary/[id]",
  "/site-diary/new",
  "/submittals/[id]",
  "/submittals/new",
  "/vendors/[id]",
  "/vendors/new",
  "/wiki/[id]",
  "/wiki/new",
]);

describe("every module route is reachable by clicking (C01 REACHABLE)", () => {
  test("no page.tsx exists without either a nav entry or a written reason", () => {
    const navHrefs = new Set(sidebarHrefs().map((h) => h.split("?")[0].split("#")[0]));
    const unreachable = routesOnDisk().filter(
      (route) => !navHrefs.has(route) && !ROUTES_INTENTIONALLY_NOT_IN_NAV.has(route)
    );
    // If this fails: either add the route to AppSidebar's NAV_SECTIONS, or add
    // it to ROUTES_INTENTIONALLY_NOT_IN_NAV above WITH a comment saying why.
    // Do not delete this assertion.
    expect(unreachable).toEqual([]);
  });

  test("the allowlist itself stays honest -- every excused route still exists on disk", () => {
    const onDisk = new Set(routesOnDisk());
    const stale = [...ROUTES_INTENTIONALLY_NOT_IN_NAV].filter((route) => !onDisk.has(route));
    expect(stale).toEqual([]);
  });

  test("/site-materials specifically is in the nav -- the route this guard was written for", () => {
    expect(sidebarHrefs()).toContain("/site-materials");
  });
});
