// AUDIT-100 A2: THE ONE SWITCH between PROJEXA's /api routes on Vercel and the Supabase Edge Function `projexa-api` (compliance-tracker
// supabase/functions/projexa-api), which answers a listed set of the same routes with the same contract (status, JSON, errors, role gate:
// src/lib/projexa-api-parity.test.ts records it, compliance-tracker replays it).
//
//   pxApiFetch("/api/exceptions?projectId=p1", init)
//     base empty                  -> fetch("/api/exceptions?projectId=p1", init)            same origin, the session cookie, Vercel
//     base set, route listed      -> fetch(base + "/api/exceptions?projectId=p1", init)     no cookie; Authorization: Bearer <access token>
//     base set, route NOT listed  -> same origin, exactly as today (the function would answer 404: it is deny by default)
//
// The base is NEXT_PUBLIC_PX_API_BASE when the build sets it (the empty string means "same origin", which is also the KILL SWITCH), else
// PX_API_DEFAULT_BASE below on the production origins only. A person with no access token in the browser also goes same origin.
// Every caller of a listed route in the browser goes through this function: src/lib/local-first/shell/snapshot-cache.ts (dashboard,
// exceptions and BOQ-analysis snapshots), shell/documents-file-cache.ts (the three file-signing reads), shell/pending-edits.ts (the BOQ line
// edit), and, since AUDIT-100 A2 batch 2, src/lib/fetch-json.ts / src/lib/use-submit.ts and the online screens' direct calls of the batch-2
// routes (fetch -> viaPxApi). src/lib/projexa-api-edge.test.ts holds the list equal to ai-os/audit37/projexa-api-routes.json.

import { PX_EDGE_REVALIDATE, PX_REVALIDATABLE } from "@/lib/px-api-revalidate-table";
export { PX_EDGE_REVALIDATE, PX_REVALIDATABLE };
export type { PxRevalidate } from "@/lib/px-api-revalidate-table";

export const PX_API_EDGE_URL = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-api";

/**
 * AUDIT-100 A2 phase 3: THE DEFAULT IS THE EDGE FUNCTION, on the production origins (the only browser origins the function's CORS answers;
 * a preview deployment, the e2e rig and local dev keep same-origin). Deployed + live-smoked identical to Vercel before this flip
 * (ai-os/audit37/A2_PROGRESS.md). KILL SWITCHES, either one: set PX_API_EDGE_ENABLED to false here (a one-line revert PR), or build with
 * NEXT_PUBLIC_PX_API_BASE="" (an explicit empty base always means same origin).
 */
export const PX_API_EDGE_ENABLED: boolean = true;
export const PX_API_DEFAULT_BASE: string = PX_API_EDGE_ENABLED ? PX_API_EDGE_URL : "";
/** The origins the default applies to (= the function's ALLOWED_ORIGINS minus the local dev ports). */
export const PX_EDGE_ORIGINS: readonly string[] = ["https://projexa-ai.com", "https://www.projexa-ai.com"];

/** The routes (and methods) the edge function answers; equal to ai-os/audit37/projexa-api-routes.json (src/lib/px-api.test.ts). */
export const PX_EDGE_ROUTES: Readonly<Record<string, readonly string[]>> = {
  "/api/dashboard/project/:projectId": ["GET"],
  "/api/exceptions": ["GET"],
  "/api/reports/boq-analysis": ["GET"],
  "/api/scope/line-items/:id": ["PATCH"],
  "/api/documents/:id": ["GET", "PATCH"],
  "/api/drawings/:id/document-url": ["GET"],
  "/api/permits/:id": ["DELETE", "GET", "PATCH"],
  "/api/vendors": ["GET", "POST"],
  "/api/companies": ["GET", "POST"],
  "/api/customers": ["GET", "POST"],
  "/api/employees": ["GET", "POST"],
  "/api/hr/departments": ["GET", "POST"],
  "/api/inventory/items": ["GET", "POST"],
  "/api/accounts": ["GET"],
  "/api/inventory/warehouses": ["GET", "POST"],
  "/api/recruitment/candidates": ["GET", "POST"],
  "/api/recruitment/job-openings": ["GET", "POST"],
  "/api/access-review": ["GET", "POST"],
  "/api/audit-engagements": ["GET", "POST"],
  "/api/board": ["GET", "PATCH"],
  "/api/ffe": ["GET", "POST"],
  "/api/leave/requests": ["GET", "POST"],
  "/api/payroll/runs": ["GET", "POST"],
  "/api/payroll/salary-components": ["GET", "POST"],
  "/api/procurement/requisitions": ["GET", "POST"],
  "/api/procurement/rfqs": ["GET", "POST"],
  "/api/projects/:id": ["PATCH"],
  "/api/sales-invoices": ["GET", "POST"],
  "/api/schedule/gantt": ["GET"],
  "/api/change-orders/:id/signature-status": ["GET"],
  "/api/credit-notes": ["GET", "POST"],
  "/api/expenses": ["GET", "POST"],
  "/api/floor-plans/:id/rooms/:roomId": ["DELETE", "PATCH"],
  "/api/fraud-cases": ["GET", "POST"],
  "/api/fraud-cases/:id": ["GET", "PATCH"],
  "/api/grc-dashboard": ["GET"],
  "/api/journal-entries": ["GET", "POST"],
  "/api/kpis": ["GET", "POST"],
  "/api/leads": ["GET", "POST"],
  "/api/leave/balances": ["GET", "POST"],
  "/api/opportunities": ["GET", "POST"],
  "/api/payroll/income-tax-slabs": ["GET", "POST"],
  "/api/payroll/salary-structures": ["GET", "POST"],
  "/api/payroll/statutory-rules": ["GET", "POST"],
  "/api/policies": ["GET", "POST"],
  "/api/policies/:id": ["GET", "PATCH"],
  "/api/procurement/goods-receipts": ["GET", "POST"],
  "/api/procurement/purchase-orders": ["GET", "POST"],
  "/api/procurement/quotations": ["GET", "POST"],
  "/api/quotations": ["GET", "POST"],
  "/api/recruitment/applications": ["GET", "POST"],
  "/api/risks": ["GET", "POST"],
  "/api/risks/:id": ["GET", "PATCH"],
  "/api/sales-orders": ["GET", "POST"],
  "/api/schedule/tasks/:id": ["GET", "PATCH"],
  "/api/submittals": ["GET", "POST"],
  "/api/vendor-risk": ["GET", "POST"],
  "/api/access-review/certifications/:id": ["PATCH"],
  "/api/ar-aging": ["GET"],
  "/api/attendance/bulk": ["POST"],
  "/api/audit-findings": ["POST"],
  "/api/audit-findings/:id": ["PATCH"],
  "/api/balance-sheet": ["GET"],
  "/api/bank-reconciliation": ["GET"],
  "/api/compliance-register": ["GET", "POST"],
  "/api/credit-notes/:id/submit": ["POST"],
  "/api/customers/:id/overview": ["GET"],
  "/api/ffe/margin-summary": ["GET"],
  "/api/finance-dashboard": ["GET"],
  "/api/floor-plans": ["GET", "POST"],
  "/api/floor-plans/:id/placements": ["POST"],
  "/api/floor-plans/:id/placements/:placementId": ["DELETE", "PATCH"],
  "/api/floor-plans/:id/rooms": ["POST"],
  "/api/floor-plans/:id/scene": ["GET"],
  "/api/hr/org-chart": ["GET"],
  "/api/inventory/items/:id": ["GET"],
  "/api/inventory/stock-balance": ["GET"],
  "/api/inventory/stock-entries": ["GET", "POST"],
  "/api/journal-entries/:id": ["GET"],
  "/api/journal-entries/:id/submit": ["POST"],
  "/api/labour-roster/trades": ["GET"],
  "/api/leads/:id/history": ["GET"],
  "/api/leads/bulk-reassign": ["POST"],
  "/api/meetings/:id": ["GET", "PATCH"],
  "/api/meetings/:id/outcomes": ["POST"],
  "/api/moms/share-links/:linkId": ["DELETE"],
  "/api/mood-boards/:id/items/:itemId": ["DELETE"],
  "/api/opportunities/:id/history": ["GET"],
  "/api/opportunities/bulk-reassign": ["POST"],
  "/api/procurement/requisitions/:id": ["GET"],
  "/api/procurement/rfqs/:id/comparison": ["GET"],
  "/api/profit-and-loss": ["GET"],
  "/api/profit-and-loss-by-project": ["GET"],
  "/api/project-budgets/:id": ["GET", "PATCH"],
  "/api/project-budgets/:id/cancel": ["POST"],
  "/api/project-budgets/:id/submit": ["POST"],
  "/api/quotations/:id/convert": ["POST"],
  "/api/reports/catalog": ["GET"],
  "/api/sales-invoices/:id/cancel": ["POST"],
  "/api/sales-invoices/:id/payments": ["POST"],
  "/api/sales-invoices/:id/submit": ["POST"],
  "/api/sales-orders/bulk-status": ["POST"],
  "/api/sales-pipeline": ["GET"],
  "/api/schedule/baselines/:id": ["GET"],
  "/api/schedule/sprints/:id": ["PATCH"],
  "/api/schedule/tasks/:id/completion": ["GET", "PATCH"],
  "/api/schedule/types": ["GET"],
  "/api/scope/:id/approve": ["POST"],
  "/api/scope/:id/submit": ["POST"],
  "/api/site-instructions/:id": ["GET"],
  "/api/tax-templates": ["GET"],
  "/api/trial-balance": ["GET"],
  "/api/wiki/:id": ["GET", "PATCH"],
  // AUDIT-100 A2 batch 5 (own role sets, VERIDIAN root, empty / lenient / defaulted bodies)
  "/api/change-orders": ["GET", "POST"],
  "/api/change-orders/:id": ["GET", "PATCH"],
  "/api/construction-budget/lines": ["POST"],
  "/api/credit-notes/:id": ["GET"],
  "/api/documents/:id/dispose": ["POST"],
  "/api/drawings/:id": ["DELETE", "GET", "PATCH"],
  "/api/employees/:id": ["GET", "PATCH"],
  "/api/ffe/:id": ["GET", "PATCH"],
  "/api/floor-plans/:id": ["GET", "PATCH"],
  "/api/kpi-entries": ["GET", "POST"],
  "/api/kpi-entries/:id/approve": ["POST"],
  "/api/kpis/:id": ["GET"],
  "/api/labour-roster/:id": ["GET", "PATCH"],
  "/api/leads/:id": ["GET", "PATCH"],
  "/api/leave/requests/:id/decision": ["POST"],
  "/api/materials": ["GET", "POST"],
  "/api/materials/:id": ["GET", "PATCH"],
  "/api/materials/issues": ["GET", "POST"],
  "/api/materials/master/:id": ["GET", "PATCH"],
  "/api/milestones": ["GET", "POST"],
  "/api/milestones/:id": ["PATCH"],
  "/api/module-chain": ["GET"],
  "/api/moms/:id": ["DELETE", "GET", "PATCH"],
  "/api/moms/:id/action-items": ["POST"],
  "/api/moms/:id/generate-intelligence": ["POST"],
  "/api/mood-boards/:id": ["GET", "PATCH", "POST"],
  "/api/opportunities/:id": ["GET", "PATCH"],
  "/api/payroll/employees/:id/income-tax-slab": ["POST"],
  "/api/payroll/employees/:id/tax-exemptions": ["GET", "POST"],
  "/api/payroll/payslips/:id": ["GET"],
  "/api/payroll/payslips/:id/finalize": ["POST"],
  "/api/payroll/payslips/:id/tds": ["POST"],
  "/api/payroll/runs/:id": ["GET"],
  "/api/payroll/runs/:id/payslips": ["GET"],
  "/api/payroll/runs/:id/process": ["POST"],
  "/api/procurement/goods-receipts/:id": ["GET"],
  "/api/procurement/goods-receipts/:id/submit": ["POST"],
  "/api/procurement/purchase-orders/:id": ["DELETE", "GET", "PATCH"],
  "/api/procurement/purchase-orders/:id/submit": ["POST"],
  "/api/procurement/requisitions/:id/submit": ["POST"],
  "/api/procurement/rfqs/:id": ["GET"],
  "/api/procurement/rfqs/:id/send": ["POST"],
  "/api/project-budgets": ["GET", "POST"],
  "/api/punch-list/:id": ["GET", "PATCH"],
  "/api/purchase-orders": ["GET", "POST"],
  "/api/quotations/:id": ["GET", "PATCH"],
  "/api/quotations/:id/revisions": ["POST"],
  "/api/recruitment/applications/:id": ["GET"],
  "/api/recruitment/applications/:id/hire": ["POST"],
  "/api/recruitment/applications/:id/interviews": ["GET", "POST"],
  "/api/recruitment/applications/:id/stage": ["POST"],
  "/api/recruitment/interviews/:id/feedback": ["POST"],
  "/api/recruitment/job-openings/:id": ["GET"],
  "/api/recruitment/job-openings/:id/status": ["POST"],
  "/api/reports/definitions/:id/run": ["POST"],
  "/api/rfis/:id": ["GET", "PATCH"],
  "/api/sales-invoices/:id": ["GET"],
  "/api/sales-order-document-flow/:id": ["GET"],
  "/api/sales-orders/:id": ["GET", "PATCH"],
  "/api/schedule-tracker": ["GET"],
  "/api/screen-drafts/:id": ["DELETE", "PATCH"],
  "/api/site-diary": ["GET", "POST"],
  "/api/site-diary/:id": ["GET"],
  "/api/timesheets/:id": ["DELETE", "GET", "PATCH"],
  "/api/timesheets/:id/approve": ["POST"],
  "/api/timesheets/:id/reject": ["POST"],
  "/api/timesheets/:id/submit": ["POST"],
  "/api/vendors/:id/bank-accounts": ["GET", "POST"],
  "/api/vendors/:id/portal-links": ["GET", "POST"],
  "/api/vendors/:id/portal-links/:linkId": ["DELETE"],
  "/api/vendors/:id/qualification": ["GET", "POST"],
  "/api/vendors/:id/sanction-checks": ["GET", "POST"],  // AUDIT-100 A2 batch 6 (body validation / reshaping, query rebuilding, response reshaping: each a spec key ported from the handler)
  "/api/schedule/baselines": ["GET", "POST"],
  "/api/schedule/sprints": ["GET", "POST"],
  "/api/schedule/sprints/:id/issues": ["DELETE", "GET", "POST"],
  "/api/schedule/tasks": ["GET", "POST"],
  "/api/schedule/workload": ["GET", "POST"],
  "/api/wiki": ["GET", "POST"],
  "/api/work-progress/activities": ["GET", "POST"],
  "/api/timesheets/submit-day": ["POST"],
  "/api/timesheets/review-day": ["POST"],
  "/api/timesheets": ["GET", "POST"],
  "/api/work-progress/:id": ["DELETE", "GET", "PATCH"],
  "/api/tasks": ["GET", "POST"],
  "/api/tasks/:id": ["GET"],
  "/api/org/internal-ai": ["GET", "PUT"],
  "/api/attendance/summary": ["GET"],
  "/api/billing-claims": ["GET", "POST"],
  "/api/construction-materials/cost-report": ["GET"],
  "/api/knowledge-base/search": ["GET"],
  "/api/manpower-cost-report": ["GET"],
  "/api/org-users": ["GET"],
  "/api/project-budgets/:id/variance": ["GET"],
  "/api/reports/portfolio/budget-vs-actual": ["GET"],
  "/api/scope/:id/compare": ["GET"],
  "/api/scope/categories": ["GET", "POST"],
  "/api/scope/categories/:id": ["DELETE", "PATCH"],
  "/api/scope/cost-visibility": ["GET", "PATCH"],
  "/api/scope/lines": ["GET"],
  "/api/screen-drafts": ["GET", "POST"],
  "/api/design-materials": ["GET", "POST"],
  "/api/products": ["GET"],
  "/api/projects/overview": ["GET"],
  "/api/vendors/:id": ["DELETE", "GET", "PATCH"],
  "/api/customers/:id": ["DELETE", "GET", "PATCH"],
  // AUDIT-100 A2 batch 7 (cross-request caches, writes that clear a page-side cache, uploads, redaction by role, the BOQ create check)
  "/api/cost-centers": ["GET"],
  "/api/currencies": ["GET"],
  "/api/fiscal-years": ["GET"],
  "/api/documents": ["GET", "POST"],
  "/api/drawings": ["GET", "POST"],
  "/api/permits": ["GET", "POST"],
  "/api/labour-roster": ["GET", "POST"],
  "/api/materials/master": ["GET", "POST"],
  "/api/meetings": ["GET", "POST"],
  "/api/moms": ["GET", "POST"],
  "/api/mood-boards": ["GET", "POST"],
  "/api/knowledge-base": ["GET", "POST"],
  "/api/knowledge-base/:id": ["GET", "PATCH"],
  "/api/projects": ["GET", "POST"],
  "/api/scope": ["GET", "POST"],
  // AUDIT-100 A2 batch 8 (two reads combined; a company named in the path)
  "/api/projects/:id/category-distribution": ["GET"],
  "/api/dashboard-hierarchy/companies/:companyId/dashboard": ["GET"],
  "/api/dashboard-hierarchy/companies/:companyId/departments": ["GET"],
  "/api/dashboard-hierarchy/companies/:companyId/projects/:projectId/category-distribution": ["GET"],
};

/** How long a write waits for Vercel to clear the page-side entries before it returns anyway (the write itself already succeeded). */
export const PX_REVALIDATE_WAIT_MS = 2_500;

/** AUDIT-100 A2 batch 5: Next routes that stay on Vercel but win over a dynamic edge route for some path (the App Router prefers a literal
 *  segment: GET /api/drawings/export is the xlsx download, not /api/drawings/:id). Such a path stays same-origin. Equal to the generated
 *  SHADOW_ROUTES of the edge function (src/lib/projexa-api-edge.test.ts). */
export const PX_EDGE_SHADOWS: readonly string[] = [
  "/api/drawings/export",
  "/api/labour-roster/import",
  "/api/projects/from-document",
  "/api/work-progress/photos",
  "/api/work-progress/report",
];

/**
 * AUDIT-100 G-09: routes the function answers that are NOT /api proxies of the inventory (so they are not in PX_EDGE_ROUTES, which is held equal to
 * ai-os/audit37/projexa-api-routes.json): new-organisation provisioning and its repair run inside the function (supabase/functions/projexa-api/org-provision.ts).
 * Same switch (PX_API_EDGE_ENABLED / NEXT_PUBLIC_PX_API_BASE=""), so the Vercel routes /api/org/provision and /api/org/repair stay as the kill-switched fallback.
 */
export const PX_EDGE_EXTRA_ROUTES: Readonly<Record<string, readonly string[]>> = {
  "/api/org/provision": ["POST"],
  "/api/org/repair": ["GET", "POST"],
};

function currentOrigin(): string | null {
  return typeof window !== "undefined" && window.location ? window.location.origin : null;
}

/** The base for a listed route: an explicit NEXT_PUBLIC_PX_API_BASE wins (the empty string = same origin); else the default on a production origin. */
export function pxApiBase(env: string | undefined = process.env.NEXT_PUBLIC_PX_API_BASE, origin: string | null = currentOrigin()): string {
  if (env !== undefined) return env.trim().replace(/\/+$/, "");
  return origin && PX_EDGE_ORIGINS.includes(origin) ? PX_API_DEFAULT_BASE.replace(/\/+$/, "") : "";
}

/** True when `method path` is one of the edge function's routes. `path` may carry a query string. The path is resolved the way the App
 *  Router resolves it (a literal segment beats a dynamic one, over the edge routes AND the Vercel routes that shadow them), then the method
 *  must be one of that route's. */
export function isEdgeRoute(method: string, path: string): boolean {
  return matchEdgeRoute(method, path) !== null;
}

/** The edge route pattern a `method path` is answered by ("/api/knowledge-base/:id"), or null when it stays on Vercel. */
export function matchEdgeRoute(method: string, path: string): string | null {
  if (!path.startsWith("/api/")) return null;
  const segs = path.split("?")[0]!.split("/").filter(Boolean);
  let best: { rank: string; route: string; methods: readonly string[] | null } | null = null;
  const consider = (route: string, methods: readonly string[] | null) => {
    const pat = route.split("/").filter(Boolean);
    if (pat.length !== segs.length || !pat.every((p, i) => (p.startsWith(":") ? segs[i]!.length > 0 : p === segs[i]))) return;
    const rank = pat.map((p) => (p.startsWith(":") ? "0" : "1")).join("");
    if (!best || rank > best.rank) best = { rank, route, methods };
  };
  for (const [route, methods] of Object.entries(PX_EDGE_ROUTES)) consider(route, methods);
  for (const [route, methods] of Object.entries(PX_EDGE_EXTRA_ROUTES)) consider(route, methods);
  for (const route of PX_EDGE_SHADOWS) consider(route, null);
  const found = best as { rank: string; route: string; methods: readonly string[] | null } | null;
  return found?.methods?.includes(method.toUpperCase()) ? found.route : null;
}

async function browserAccessToken(): Promise<string | null> {
  try {
    const { createClient } = await import("@/lib/supabase/client");
    const { data } = await createClient().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export type PxApiDeps = { fetchImpl?: typeof fetch; getAccessToken?: () => Promise<string | null>; base?: string; revalidateWaitMs?: number };

/** After the edge answered a write whose Next handler clears page-side cache entries: ask Vercel's one small route to clear the same ones. Waits (a
 *  bounded time) so the person's next navigation sees the new row, never fails the write, never throws. Same-origin, with the session cookie. */
export async function revalidateAfterEdgeWrite(
  method: string,
  path: string,
  res: Response,
  doFetch: typeof fetch,
  waitMs: number = PX_REVALIDATE_WAIT_MS
): Promise<void> {
  const route = matchEdgeRoute(method, path);
  const rule = route ? PX_EDGE_REVALIDATE[`${method.toUpperCase()} ${route}`] : undefined;
  if (!rule) return;
  if ((rule.when ?? "success") === "success" && !res.ok) return;
  try {
    const call = doFetch("/api/cache/revalidate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({ tags: rule.tags, paths: rule.paths ?? [] }),
    }).then(() => undefined, () => undefined);
    await Promise.race([call, new Promise<void>((resolve) => setTimeout(resolve, waitMs))]);
  } catch {
    // a cache that was not cleared is up to 30 s of an old list, never a failed save
  }
}

/** fetch() for PROJEXA's own /api routes: same origin, or the edge function for a listed route when the switch is on. */
export async function pxApiFetch(input: string, init: RequestInit = {}, deps: PxApiDeps = {}): Promise<Response> {
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = deps.base ?? pxApiBase();
  const method = (init.method ?? "GET").toUpperCase();
  if (base && isEdgeRoute(method, input)) {
    const token = await (deps.getAccessToken ?? browserAccessToken)();
    if (token) {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      const res = await doFetch(`${base}${input}`, { ...init, headers, credentials: "omit" });
      if (method !== "GET") await revalidateAfterEdgeWrite(method, input, res, doFetch, deps.revalidateWaitMs);
      return res;
    }
  }
  return doFetch(input, init);
}

/** pxApiFetch with fetch()'s own signature, for the callers that take an injectable fetch (tests inject theirs; production gets this). */
export const viaPxApi: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  typeof input === "string" ? pxApiFetch(input, init) : fetch(input, init)) as typeof fetch;
