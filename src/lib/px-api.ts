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
};

function currentOrigin(): string | null {
  return typeof window !== "undefined" && window.location ? window.location.origin : null;
}

/** The base for a listed route: an explicit NEXT_PUBLIC_PX_API_BASE wins (the empty string = same origin); else the default on a production origin. */
export function pxApiBase(env: string | undefined = process.env.NEXT_PUBLIC_PX_API_BASE, origin: string | null = currentOrigin()): string {
  if (env !== undefined) return env.trim().replace(/\/+$/, "");
  return origin && PX_EDGE_ORIGINS.includes(origin) ? PX_API_DEFAULT_BASE.replace(/\/+$/, "") : "";
}

/** True when `method path` is one of the edge function's routes. `path` may carry a query string. */
export function isEdgeRoute(method: string, path: string): boolean {
  if (!path.startsWith("/api/")) return false;
  const segs = path.split("?")[0]!.split("/").filter(Boolean);
  for (const [route, methods] of Object.entries(PX_EDGE_ROUTES)) {
    if (!methods.includes(method.toUpperCase())) continue;
    const pat = route.split("/").filter(Boolean);
    if (pat.length === segs.length && pat.every((p, i) => (p.startsWith(":") ? segs[i]!.length > 0 : p === segs[i]))) return true;
  }
  return false;
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

export type PxApiDeps = { fetchImpl?: typeof fetch; getAccessToken?: () => Promise<string | null>; base?: string };

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
      return doFetch(`${base}${input}`, { ...init, headers, credentials: "omit" });
    }
  }
  return doFetch(input, init);
}

/** pxApiFetch with fetch()'s own signature, for the callers that take an injectable fetch (tests inject theirs; production gets this). */
export const viaPxApi: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  typeof input === "string" ? pxApiFetch(input, init) : fetch(input, init)) as typeof fetch;
