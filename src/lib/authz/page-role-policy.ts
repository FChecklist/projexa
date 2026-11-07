// The page-side twin of api-read-policy.ts: finance, HR and commercial SCREENS are redirected to /dashboard for a role that may not read their
// data. Found 2026-11-07: /accounting /payroll /employees /recruitment opened (HTTP 200) for a client_viewer and a site_engineer. The API gate is the
// security boundary; this keeps those roles from landing on a broken or empty screen and keeps the address bar honest. Menu items for most of
// these modules are already hidden (module-catalogue `hidden`), so this only matters for a typed or bookmarked address.
import { ROLE_GROUPS } from "./roles";

export type PageTier = "ORG_ADMIN" | "PM_OR_ABOVE";

// Page path prefixes under src/app/(app). Anything not listed stays open to every signed-in role.
export const PAGE_ROLE_POLICY: Readonly<Record<string, PageTier>> = {
  "/payroll": "ORG_ADMIN",
  "/accounting": "ORG_ADMIN",
  "/grc": "ORG_ADMIN",
  "/finance": "ORG_ADMIN",
  "/employees": "PM_OR_ABOVE",
  "/recruitment": "PM_OR_ABOVE",
  "/hr": "PM_OR_ABOVE",
  "/customers": "PM_OR_ABOVE",
  "/vendors": "PM_OR_ABOVE",
  "/sales": "PM_OR_ABOVE",
  "/sales-orders": "PM_OR_ABOVE",
  "/quotations": "PM_OR_ABOVE",
  "/proposals": "PM_OR_ABOVE",
  "/procurement": "PM_OR_ABOVE",
  "/purchase-orders": "PM_OR_ABOVE",
  "/invoices": "PM_OR_ABOVE",
  "/expenses": "PM_OR_ABOVE",
  "/budgets": "PM_OR_ABOVE",
  "/inventory": "PM_OR_ABOVE",
  "/kpis": "PM_OR_ABOVE",
};

function tierFor(pathname: string): PageTier | null {
  for (const [prefix, tier] of Object.entries(PAGE_ROLE_POLICY)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return tier;
  }
  return null;
}

/** True when this page address needs the caller's role looked up. */
export function pageNeedsRole(pathname: string): boolean {
  return tierFor(pathname) !== null;
}

/** A null role (no resolved membership) is never refused here: the page's own sign-in/org handling decides. */
export function checkPageRoleAccess(pathname: string, role: string | null): { allowed: boolean } {
  const tier = tierFor(pathname);
  if (!tier || role == null) return { allowed: true };
  return { allowed: (ROLE_GROUPS[tier] as readonly string[]).includes(role) };
}
