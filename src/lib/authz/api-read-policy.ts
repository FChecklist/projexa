// API_READ_WITHOUT_ROLE_CHECK (found by the 2026-11-07 signed-in smoke run on the Meridian test org): GET /api/employees, /api/sales-invoices,
// /api/vendors, /api/customers and /api/accounts answered 200 with real rows to a signed-in client_viewer and site_engineer.
// Writes were already gated by api-write-policy.ts; reads were deliberately left out of it. This is the narrow read-side counterpart:
// a short deny list of finance / HR / commercial read routes, enforced in middleware next to the write gate. It is a deny list on purpose, so
// the dashboards and field screens every role needs are untouched. A role not in the lists (owner, admin, pm, member) is never refused here.
import type { OrgRole } from "./roles";

// Finance and HR areas: neither a client viewer nor a site engineer has any business reading them.
const FINANCE_HR_PREFIXES = [
  "/api/employees",
  "/api/sales-invoices",
  "/api/accounts",
  "/api/journal-entries",
  "/api/trial-balance",
  "/api/balance-sheet",
  "/api/payroll",
  "/api/recruitment",
  "/api/hr",
  "/api/credit-notes",
] as const;

// Commercial party lists: hidden from the read-only client viewer; a site engineer still needs them (material receipts, vendors on site).
const COMMERCIAL_PREFIXES = ["/api/vendors", "/api/customers"] as const;

const startsWithSegment = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(prefix + "/");

function deniedRolesFor(pathname: string): readonly string[] | null {
  if (FINANCE_HR_PREFIXES.some((p) => startsWithSegment(pathname, p))) return ["client_viewer", "site_engineer"];
  if (COMMERCIAL_PREFIXES.some((p) => startsWithSegment(pathname, p))) return ["client_viewer"];
  return null;
}

/** True when a read of this path can be role-refused, so the middleware knows it must look the role up. */
export function isReadRestricted(pathname: string): boolean {
  return deniedRolesFor(pathname) !== null;
}

export function checkApiReadAccess(method: string, pathname: string, role: OrgRole | string | null): { allowed: boolean } {
  if (method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD") return { allowed: true };
  const denied = deniedRolesFor(pathname);
  if (!denied || role == null) return { allowed: true };
  return { allowed: !denied.includes(role) };
}
