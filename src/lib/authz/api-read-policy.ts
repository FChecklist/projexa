// API_READ_WITHOUT_ROLE_CHECK -- the server-side role gate for every GET /api route (the read-side twin of api-write-policy.ts).
//
// FOUND 2026-11-07 by the signed-in smoke run on the Meridian TEST org: a signed-in client_viewer and site_engineer got real rows (HTTP 200) from
// GET /api/employees (11), /api/sales-invoices (24), /api/vendors (23), /api/customers (16) and /api/accounts (3). Writes were role-gated by
// api-write-policy.ts; reads were left out ("a separate, narrower concern"), so any signed-in member could read finance, HR and commercial data.
//
// SHAPE: one checked-in table keyed by the route path under src/app/api, dynamic segments verbatim ("[id]"), enforced centrally in src/middleware.ts
// beside the write gate. api-read-policy.test.ts regenerates the GET-route set from disk and fails when a GET route has no entry (or an entry
// outlives its route), so a new read route cannot ship ungated.
//
// TIERS (same names as ROLE_GROUPS in roles.ts):
//   PUBLIC       deliberately open (token links, invite preview).
//   ANY_ROLE     every signed-in role including client_viewer: the project's own delivery data (BOQ/scope, progress, schedule, documents, drawings,
//                permits, meetings, change orders, reports, notifications). These are the screens a client viewer is there to see.
//   ANY_MEMBER   every role except the read-only client_viewer: site and team working data (attendance, labour, materials, site diary, tasks).
//   PM_OR_ABOVE  owner/admin/pm: money, commercial parties and pipeline, procurement, budgets, HR directory, company-level dashboards.
//   ORG_ADMIN    owner/admin: payroll, general ledger and accounts, audit, policies, org settings.
// A route that matches nothing falls to DEFAULT_READ_TIER (PM_OR_ABOVE): fail closed to the office tier, never to "anyone".
// ANY_ROLE and PUBLIC need no role lookup, so the middleware pays the membership query only for the restricted tiers.
import { ROLE_GROUPS, type OrgRole } from "./roles";

export type ReadTier = "PUBLIC" | "ANY_ROLE" | "ANY_MEMBER" | "PM_OR_ABOVE" | "ORG_ADMIN";

export const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

export const API_READ_POLICY: Readonly<Record<string, ReadTier>> = {
  "/access-review": "ORG_ADMIN",
  "/accounts": "ORG_ADMIN",
  "/ar-aging": "ORG_ADMIN",
  "/assistant": "ANY_MEMBER",
  "/attendance": "ANY_MEMBER",
  "/attendance/summary": "ANY_MEMBER",
  "/attendance/summary/pdf": "ANY_MEMBER",
  "/audit-engagements": "ORG_ADMIN",
  "/balance-sheet": "ORG_ADMIN",
  "/bank-reconciliation": "ORG_ADMIN",
  "/billing-claims": "ANY_ROLE",
  "/billing-claims/[id]": "ANY_ROLE",
  "/board": "ANY_MEMBER",
  "/capability-tree": "ANY_ROLE",
  "/chain-options": "ANY_ROLE",
  "/change-orders": "ANY_ROLE",
  "/change-orders/[id]": "ANY_ROLE",
  "/change-orders/[id]/signature-status": "ANY_ROLE",
  "/client-logs/issues": "ANY_ROLE",
  "/client-logs/issues/[id]": "ANY_ROLE",
  "/client-logs/timeline": "ANY_ROLE",
  "/companies": "ORG_ADMIN",
  "/compliance-register": "ORG_ADMIN",
  "/construction-materials/cost-report": "PM_OR_ABOVE",
  "/construction-materials/cost-report/export": "PM_OR_ABOVE",
  "/conversations": "ANY_ROLE",
  "/conversations/[id]/messages": "ANY_ROLE",
  "/cost-centers": "ORG_ADMIN",
  "/credit-notes": "PM_OR_ABOVE",
  "/credit-notes/[id]": "PM_OR_ABOVE",
  "/currencies": "ANY_ROLE",
  "/customers": "PM_OR_ABOVE",
  "/customers/[id]": "PM_OR_ABOVE",
  "/customers/[id]/overview": "PM_OR_ABOVE",
  "/dashboard-hierarchy/companies": "PM_OR_ABOVE",
  "/dashboard-hierarchy/companies/[companyId]/dashboard": "PM_OR_ABOVE",
  "/dashboard-hierarchy/companies/[companyId]/departments": "PM_OR_ABOVE",
  "/dashboard-hierarchy/companies/[companyId]/projects/[projectId]": "PM_OR_ABOVE",
  "/dashboard-hierarchy/companies/[companyId]/projects/[projectId]/category-distribution": "PM_OR_ABOVE",
  "/dashboard/project/[projectId]": "ANY_ROLE",
  "/design-materials": "PM_OR_ABOVE",
  "/documents": "ANY_ROLE",
  "/documents/[id]": "ANY_ROLE",
  "/drawings": "ANY_ROLE",
  "/drawings/[id]": "ANY_ROLE",
  "/drawings/[id]/document-url": "ANY_ROLE",
  "/drawings/export": "ANY_ROLE",
  "/email/[token]": "PUBLIC",
  "/employees": "PM_OR_ABOVE",
  "/employees/[id]": "PM_OR_ABOVE",
  "/exceptions": "PM_OR_ABOVE",
  "/expenses": "PM_OR_ABOVE",
  "/ffe": "PM_OR_ABOVE",
  "/ffe/[id]": "PM_OR_ABOVE",
  "/ffe/margin-summary": "PM_OR_ABOVE",
  "/finance-dashboard": "ORG_ADMIN",
  "/fiscal-years": "ORG_ADMIN",
  "/floor-plans": "PM_OR_ABOVE",
  "/floor-plans/[id]": "PM_OR_ABOVE",
  "/floor-plans/[id]/scene": "PM_OR_ABOVE",
  "/fraud-cases": "ORG_ADMIN",
  "/fraud-cases/[id]": "ORG_ADMIN",
  "/grc-dashboard": "ORG_ADMIN",
  "/hr/departments": "ORG_ADMIN",
  "/hr/org-chart": "PM_OR_ABOVE",
  "/integrations/google-sheets/status": "PM_OR_ABOVE",
  "/inventory/items": "PM_OR_ABOVE",
  "/inventory/items/[id]": "PM_OR_ABOVE",
  "/inventory/stock-balance": "ANY_MEMBER",
  "/inventory/stock-entries": "ANY_MEMBER",
  "/inventory/warehouses": "PM_OR_ABOVE",
  "/journal-entries": "ORG_ADMIN",
  "/journal-entries/[id]": "ORG_ADMIN",
  "/knowledge-base": "ANY_MEMBER",
  "/knowledge-base/[id]": "ANY_MEMBER",
  "/knowledge-base/search": "ANY_MEMBER",
  "/kpi-entries": "ANY_MEMBER",
  "/kpis": "PM_OR_ABOVE",
  "/kpis/[id]": "PM_OR_ABOVE",
  "/labour-roster": "ANY_MEMBER",
  "/labour-roster/[id]": "ANY_MEMBER",
  "/labour-roster/trades": "ANY_MEMBER",
  "/leads": "PM_OR_ABOVE",
  "/leads/[id]": "PM_OR_ABOVE",
  "/leads/[id]/history": "PM_OR_ABOVE",
  "/leave/balances": "ORG_ADMIN",
  "/leave/requests": "ANY_MEMBER",
  "/manpower-cost-report": "ANY_MEMBER",
  "/materials": "ANY_MEMBER",
  "/materials/[id]": "ANY_MEMBER",
  "/materials/issues": "ANY_MEMBER",
  "/materials/master": "ANY_MEMBER",
  "/materials/master/[id]": "ANY_MEMBER",
  "/meetings": "ANY_ROLE",
  "/meetings/[id]": "ANY_ROLE",
  "/milestones": "ANY_ROLE",
  "/module-chain": "ANY_ROLE",
  "/moms": "ANY_ROLE",
  "/moms/[id]": "ANY_ROLE",
  "/moms/[id]/pdf": "ANY_ROLE",
  "/moms/[id]/share-links": "PM_OR_ABOVE",
  "/mood-boards": "PM_OR_ABOVE",
  "/mood-boards/[id]": "PM_OR_ABOVE",
  "/notifications": "ANY_ROLE",
  "/opportunities": "PM_OR_ABOVE",
  "/opportunities/[id]": "PM_OR_ABOVE",
  "/opportunities/[id]/history": "PM_OR_ABOVE",
  "/org-members": "ANY_ROLE",
  "/org-users": "ANY_ROLE",
  "/org/invites": "ORG_ADMIN",
  "/org/invites/preview": "PUBLIC",
  "/org/own-ai": "ORG_ADMIN",
  "/org/own-ai/people": "ORG_ADMIN",
  "/org/repair": "ORG_ADMIN",
  "/organization": "ANY_ROLE",
  "/organization/currency": "ORG_ADMIN",
  "/organization/email-schedule": "ORG_ADMIN",
  "/payroll/employees/[id]/tax-exemptions": "ORG_ADMIN",
  "/payroll/income-tax-slabs": "ORG_ADMIN",
  "/payroll/payslips/[id]": "ORG_ADMIN",
  "/payroll/payslips/[id]/pdf": "ORG_ADMIN",
  "/payroll/runs": "ORG_ADMIN",
  "/payroll/runs/[id]": "ORG_ADMIN",
  "/payroll/runs/[id]/payslips": "ORG_ADMIN",
  "/payroll/salary-components": "ORG_ADMIN",
  "/payroll/salary-structures": "ORG_ADMIN",
  "/payroll/statutory-rules": "ORG_ADMIN",
  "/permits": "ANY_ROLE",
  "/permits/[id]": "ANY_ROLE",
  "/pill-usage": "ANY_MEMBER",
  "/policies": "ORG_ADMIN",
  "/policies/[id]": "ORG_ADMIN",
  "/procurement/goods-receipts": "PM_OR_ABOVE",
  "/procurement/goods-receipts/[id]": "PM_OR_ABOVE",
  "/procurement/purchase-orders": "PM_OR_ABOVE",
  "/procurement/purchase-orders/[id]": "PM_OR_ABOVE",
  "/procurement/quotations": "PM_OR_ABOVE",
  "/procurement/requisitions": "PM_OR_ABOVE",
  "/procurement/requisitions/[id]": "PM_OR_ABOVE",
  "/procurement/rfqs": "PM_OR_ABOVE",
  "/procurement/rfqs/[id]": "PM_OR_ABOVE",
  "/procurement/rfqs/[id]/comparison": "PM_OR_ABOVE",
  "/products": "PM_OR_ABOVE",
  "/profit-and-loss": "ORG_ADMIN",
  "/profit-and-loss-by-project": "ORG_ADMIN",
  "/project-budgets": "PM_OR_ABOVE",
  "/project-budgets/[id]": "PM_OR_ABOVE",
  "/project-budgets/[id]/variance": "PM_OR_ABOVE",
  "/projects": "ANY_ROLE",
  "/projects/[id]/approvals": "PM_OR_ABOVE",
  "/projects/[id]/category-distribution": "ANY_ROLE",
  "/projects/from-document": "ANY_MEMBER",
  "/projects/overview": "ANY_ROLE",
  "/punch-list": "ANY_ROLE",
  "/punch-list/[id]": "ANY_ROLE",
  "/purchase-orders": "PM_OR_ABOVE",
  "/quotations": "PM_OR_ABOVE",
  "/quotations/[id]": "PM_OR_ABOVE",
  "/quotations/[id]/pdf": "PM_OR_ABOVE",
  "/recruitment/applications": "PM_OR_ABOVE",
  "/recruitment/applications/[id]": "PM_OR_ABOVE",
  "/recruitment/applications/[id]/interviews": "PM_OR_ABOVE",
  "/recruitment/candidates": "PM_OR_ABOVE",
  "/recruitment/job-openings": "PM_OR_ABOVE",
  "/recruitment/job-openings/[id]": "PM_OR_ABOVE",
  "/reports/[reportName]": "ANY_ROLE",
  "/reports/[reportName]/export": "ANY_ROLE",
  "/reports/boq-analysis": "PM_OR_ABOVE",
  "/reports/budget-variance/export": "PM_OR_ABOVE",
  "/reports/catalog": "ANY_ROLE",
  "/reports/portfolio/budget-vs-actual": "PM_OR_ABOVE",
  "/rfis": "ANY_ROLE",
  "/rfis/[id]": "ANY_ROLE",
  "/risks": "PM_OR_ABOVE",
  "/risks/[id]": "PM_OR_ABOVE",
  "/sales-invoices": "PM_OR_ABOVE",
  "/sales-invoices/[id]": "PM_OR_ABOVE",
  "/sales-order-document-flow/[id]": "PM_OR_ABOVE",
  "/sales-orders": "PM_OR_ABOVE",
  "/sales-orders/[id]": "PM_OR_ABOVE",
  "/sales-pipeline": "PM_OR_ABOVE",
  "/schedule-tracker": "ANY_ROLE",
  "/schedule/baselines": "ANY_ROLE",
  "/schedule/baselines/[id]": "ANY_ROLE",
  "/schedule/gantt": "ANY_ROLE",
  "/schedule/sprints": "PM_OR_ABOVE",
  "/schedule/sprints/[id]/issues": "PM_OR_ABOVE",
  "/schedule/tasks": "ANY_ROLE",
  "/schedule/tasks/[id]": "ANY_ROLE",
  "/schedule/tasks/[id]/completion": "PM_OR_ABOVE",
  "/schedule/types": "ANY_ROLE",
  "/schedule/workload": "PM_OR_ABOVE",
  "/scope": "ANY_ROLE",
  "/scope/[id]": "ANY_ROLE",
  "/scope/[id]/compare": "ANY_ROLE",
  "/scope/categories": "ANY_ROLE",
  "/scope/cost-visibility": "ORG_ADMIN",
  "/scope/import/template": "ANY_ROLE",
  "/scope/lines": "ANY_ROLE",
  "/screen-drafts": "ANY_MEMBER",
  "/search": "ANY_ROLE",
  "/shared/mom/[token]/pdf": "PUBLIC",
  "/shell": "ANY_ROLE",
  "/site-diary": "ANY_MEMBER",
  "/site-diary/[id]": "ANY_MEMBER",
  "/site-instructions": "PM_OR_ABOVE",
  "/site-instructions/[id]": "PM_OR_ABOVE",
  "/submittals": "ANY_ROLE",
  "/submittals/[id]": "ANY_ROLE",
  "/tasks": "ANY_MEMBER",
  "/tasks/[id]": "ANY_MEMBER",
  "/tax-templates": "PM_OR_ABOVE",
  "/timesheets": "ANY_MEMBER",
  "/timesheets/[id]": "ANY_MEMBER",
  "/todos": "ANY_MEMBER",
  "/trial-balance": "ORG_ADMIN",
  "/vendor-risk": "ORG_ADMIN",
  "/vendors": "PM_OR_ABOVE",
  "/vendors/[id]": "PM_OR_ABOVE",
  "/vendors/[id]/bank-accounts": "PM_OR_ABOVE",
  "/vendors/[id]/portal-links": "PM_OR_ABOVE",
  "/vendors/[id]/qualification": "PM_OR_ABOVE",
  "/vendors/[id]/sanction-checks": "PM_OR_ABOVE",
  "/veridian-link": "ANY_ROLE",
  "/wiki": "ANY_MEMBER",
  "/wiki/[id]": "ANY_MEMBER",
  "/work-progress": "ANY_ROLE",
  "/work-progress/[id]": "ANY_ROLE",
  "/work-progress/activities": "ANY_ROLE",
  "/work-progress/photos": "ANY_ROLE",
  "/work-progress/report": "ANY_ROLE",
  "/work-progress/report/pdf": "ANY_ROLE",
  "/work-progress/report/xlsx": "ANY_ROLE",
};

export const DEFAULT_READ_TIER: ReadTier = "PM_OR_ABOVE";

function matchesPattern(pattern: string, segments: readonly string[]): boolean {
  const p = pattern.split("/").filter(Boolean);
  if (p.length !== segments.length) return false;
  return p.every((seg, i) => (seg.startsWith("[") && seg.endsWith("]")) || seg === segments[i]);
}

// Static patterns are tried before wildcard ones, so "/scope/lines" is never shadowed by "/scope/[id]" whatever the key order.
const ORDERED_PATTERNS: readonly string[] = Object.keys(API_READ_POLICY).sort((a, b) => Number(a.includes("[")) - Number(b.includes("[")));

export function resolveReadTier(pathname: string): ReadTier {
  const segments = pathname.replace(/^\/api/, "").split("/").filter(Boolean);
  if (segments.length === 0) return DEFAULT_READ_TIER;
  for (const pattern of ORDERED_PATTERNS) if (matchesPattern(pattern, segments)) return API_READ_POLICY[pattern];
  let best: { depth: number; tier: ReadTier } | null = null;
  for (const pattern of ORDERED_PATTERNS) {
    const depth = pattern.split("/").filter(Boolean).length;
    if (depth >= segments.length || !matchesPattern(pattern, segments.slice(0, depth))) continue;
    if (!best || depth > best.depth) best = { depth, tier: API_READ_POLICY[pattern] };
  }
  return best?.tier ?? DEFAULT_READ_TIER;
}

/** True when this read must look the caller's role up (anything but PUBLIC / ANY_ROLE). */
export function readNeedsRole(method: string, pathname: string): boolean {
  if (!READ_METHODS.has(method.toUpperCase())) return false;
  const t = resolveReadTier(pathname);
  return t !== "PUBLIC" && t !== "ANY_ROLE";
}

export function checkApiReadAccess(method: string, pathname: string, role: OrgRole | string | null): { allowed: true } | { allowed: false; tier: ReadTier } {
  if (!READ_METHODS.has(method.toUpperCase())) return { allowed: true };
  const tier = resolveReadTier(pathname);
  if (tier === "PUBLIC" || tier === "ANY_ROLE") return { allowed: true };
  if (role == null) return { allowed: true }; // no resolved membership: requireAuth()'s 400/503, not a role refusal
  const allowed = ROLE_GROUPS[tier === "ANY_MEMBER" ? "ANY_MEMBER" : tier] as readonly string[];
  return allowed.includes(role) ? { allowed: true } : { allowed: false, tier };
}
