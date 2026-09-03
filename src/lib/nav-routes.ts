// R-81 ("NO visible pill may be unwired") -- the shipped-route registry the
// sidebar filters itself against, so a nav entry pointing at a page that does
// not exist can never render for a prospect clicking at random.
//
// WHY AN EXPLICIT LIST RATHER THAN A GLOB: the sidebar is a client component,
// so it cannot read the filesystem at runtime, and Next.js exposes no
// route manifest to client code. The list below is therefore checked in --
// but it is NOT hand-maintained on trust: nav-routes.test.ts regenerates it
// from the real src/app/**/page.tsx files on every test run and fails, in
// both directions, if this array and the filesystem ever disagree. Adding a
// page without listing it here, or deleting a page and leaving it listed,
// both break the build's test step rather than silently shipping a dead pill.
//
// MEASURED, not estimated. Re-measured 2026-08-30 after the real-screen
// conversion's Object Page / create-screen build-out ([id] detail routes +
// .../new create routes across ~20+ modules, module #17 Materials through
// module #33 Vendors) pushed this well past the 60 last checked in on
// 2026-08-26 -- this array had gone stale under every one of those
// conversions without nav-routes.test.ts ever being run to catch it (the
// session's own tsc+eslint verification loop never covered this file). 161
// page.tsx files exist under src/app, confirmed via the same Node
// fs.readdirSync walk nav-routes.test.ts itself uses (this tree contains
// [id]/[token] dynamic segments, and a PowerShell path with unescaped
// brackets is a wildcard that silently matches nothing -- see that file's
// own comment). All 161 are listed below.
export const SHIPPED_ROUTES: readonly string[] = [
  "/",
  "/accounting",
  "/accounting/companies/new",
  "/accounting/journal-entries/[id]",
  "/accounting/journal-entries/new",
  // R67 E-27 (R-213): the Analysis leaf's real destination.
  "/analysis",
  "/auth/callback",
  "/budgets",
  "/budgets/[id]",
  "/budgets/new",
  "/change-orders",
  "/change-orders/[id]",
  "/change-orders/new",
  "/copilot",
  "/customers",
  "/customers/[id]",
  "/customers/new",
  "/dashboard",
  "/dashboard/hierarchy",
  "/dashboard/overview",
  "/dashboard/project",
  "/documents",
  "/documents/[id]",
  "/documents/upload",
  "/drawings",
  "/drawings/[id]",
  "/drawings/new",
  "/employees",
  "/employees/[id]",
  "/employees/departments/new",
  "/employees/leave/balance/new",
  "/employees/leave/new",
  "/employees/new",
  "/expenses",
  "/expenses/new",
  "/ffe",
  "/ffe/[id]",
  "/ffe/new",
  "/floor-plans",
  "/floor-plans/[id]",
  "/floor-plans/[id]/walkthrough",
  "/grc",
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
  "/how-it-works",
  "/hr",
  "/inventory",
  "/inventory/items/[id]",
  "/inventory/items/new",
  "/inventory/stock-entries/new",
  "/inventory/warehouses/new",
  "/invite/[token]",
  "/invoices",
  "/invoices/[id]",
  "/invoices/credit-notes/[id]",
  "/invoices/credit-notes/new",
  "/invoices/new",
  "/knowledge-base",
  "/knowledge-base/[id]",
  "/knowledge-base/new",
  "/kpis",
  "/kpis/[id]",
  "/kpis/new",
  "/labour",
  "/labour/[id]",
  "/labour/attendance/new",
  "/labour/new",
  "/login",
  "/materials",
  "/materials/[id]",
  "/materials/new",
  "/materials/receipts/new",
  "/meetings",
  "/meetings/[id]",
  "/meetings/new",
  "/moms",
  "/moms/[id]",
  "/moms/new",
  "/mood-boards",
  "/mood-boards/[id]",
  "/mood-boards/new",
  "/payroll",
  "/payroll/components/new",
  "/payroll/runs/[id]",
  "/payroll/runs/[id]/payslips/[payslipId]",
  "/payroll/runs/new",
  "/payroll/statutory-rules/new",
  "/payroll/structures/new",
  "/payroll/tax-slabs/new",
  "/permits",
  "/permits/[id]",
  "/permits/new",
  "/procurement",
  "/procurement/goods-receipts/[id]",
  "/procurement/goods-receipts/new",
  "/procurement/purchase-orders/[id]",
  "/procurement/quotations/new",
  "/procurement/requisitions/[id]",
  "/procurement/requisitions/new",
  "/procurement/rfqs/[id]",
  "/procurement/rfqs/new",
  "/punch-list",
  "/punch-list/[id]",
  "/punch-list/new",
  "/purchase-orders",
  "/purchase-orders/new",
  "/quotations",
  "/quotations/[id]",
  "/quotations/new",
  "/recruitment",
  "/recruitment/applications/[id]",
  "/recruitment/applications/new",
  "/recruitment/candidates/new",
  "/recruitment/openings/[id]",
  "/recruitment/openings/new",
  "/reports",
  "/rfis",
  "/rfis/[id]",
  "/rfis/new",
  "/sales",
  "/sales-orders",
  "/sales-orders/[id]",
  "/sales-orders/new",
  "/sales/leads",
  "/sales/leads/[id]",
  "/sales/leads/new",
  "/sales/opportunities",
  "/sales/opportunities/[id]",
  "/sales/opportunities/new",
  "/schedule",
  "/schedule/log-time",
  "/schedule/sprints/new",
  "/schedule/tasks/[id]",
  "/schedule/tasks/new",
  "/scope",
  "/scope/[id]",
  "/scope/[id]/compare",
  "/scope/[id]/revise",
  "/scope/new",
  "/settings",
  "/share/report/[token]",
  "/signup",
  "/site-diary",
  "/site-diary/[id]",
  "/site-diary/new",
  "/site-materials",
  "/submittals",
  "/submittals/[id]",
  "/submittals/new",
  "/vendors",
  "/vendors/[id]",
  "/vendors/new",
  "/wiki",
  "/wiki/[id]",
  "/wiki/new",
  "/work-progress",
];

const STATIC_ROUTES = new Set(SHIPPED_ROUTES.filter((r) => !r.includes("[")));

// Dynamic routes ("/permits/[id]") are matched by pattern, so a nav entry
// deep-linking into one is not mistaken for a dead end. `[...slug]` catch-alls
// are handled too even though this repo has none today -- cheaper than
// discovering the gap the first time one is added.
const DYNAMIC_ROUTE_PATTERNS = SHIPPED_ROUTES.filter((r) => r.includes("[")).map(
  (r) =>
    new RegExp(
      "^" +
        r
          .replace(/[.*+?^${}()|\\]/g, "\\$&")
          .replace(/\[\.\.\.[^\]]+\]/g, ".+")
          .replace(/\[[^\]]+\]/g, "[^/]+") +
        "$"
    )
);

// A nav href is "wired" when a real page.tsx backs it. Query strings and
// hash fragments are stripped first: the sidebar appends `?projectId=...` to
// every project-scoped link (see AppSidebar's buildSharedSections), and that
// suffix says nothing about whether the route exists.
export function isShippedRoute(href: string): boolean {
  const route = href.split("?")[0].split("#")[0];
  if (STATIC_ROUTES.has(route)) return true;
  return DYNAMIC_ROUTE_PATTERNS.some((re) => re.test(route));
}

// Drops every nav item whose route does not exist, then drops any section
// left with no items (an empty section header is its own kind of dead end).
// Generic over the item/section shape so the sidebar's own NavItem/NavSection
// types flow straight through without this file importing a component.
export function filterShippedNav<Item extends { href: string }, Section extends { items: Item[] }>(
  sections: readonly Section[]
): Section[] {
  return sections
    .map((section) => ({ ...section, items: section.items.filter((item) => isShippedRoute(item.href)) }))
    .filter((section) => section.items.length > 0);
}
