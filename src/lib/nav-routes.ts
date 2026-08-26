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
// MEASURED, not estimated (2026-08-26, two independent mechanisms that
// agreed): 60 page.tsx files exist under src/app -- PowerShell
// `Get-ChildItem -LiteralPath ... -Recurse -Filter page.tsx` returned 60, and
// an independent Node fs.readdirSync walk returned the same 60. (-LiteralPath
// matters here: this tree contains [id]/[token] dynamic segments, and a
// PowerShell path with unescaped brackets is a wildcard that silently matches
// nothing.) All 60 are listed below.
export const SHIPPED_ROUTES: readonly string[] = [
  "/",
  "/accounting",
  "/auth/callback",
  "/budgets",
  "/change-orders",
  "/copilot",
  "/customers",
  "/customers/[id]",
  "/dashboard",
  "/dashboard/hierarchy",
  "/dashboard/overview",
  "/dashboard/project",
  "/documents",
  "/drawings",
  "/employees",
  "/expenses",
  "/ffe",
  "/floor-plans",
  "/floor-plans/[id]",
  "/floor-plans/[id]/walkthrough",
  "/grc",
  "/how-it-works",
  "/hr",
  "/inventory",
  "/invite/[token]",
  "/invoices",
  "/knowledge-base",
  "/kpis",
  "/labour",
  "/login",
  "/materials",
  "/meetings",
  "/moms",
  "/mood-boards",
  "/payroll",
  "/permits",
  "/permits/[id]",
  "/permits/new",
  "/procurement",
  "/punch-list",
  "/purchase-orders",
  "/quotations",
  "/recruitment",
  "/reports",
  "/rfis",
  "/sales",
  "/sales-orders",
  "/sales/leads",
  "/sales/opportunities",
  "/schedule",
  "/scope",
  "/settings",
  "/share/report/[token]",
  "/signup",
  "/site-diary",
  "/site-materials",
  "/submittals",
  "/vendors",
  "/wiki",
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
