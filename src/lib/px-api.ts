// AUDIT-100 A2: THE ONE SWITCH between PROJEXA's /api routes on Vercel and the Supabase Edge Function `projexa-api` (compliance-tracker
// supabase/functions/projexa-api), which answers a listed set of the same routes with the same contract (status, JSON, errors, role gate:
// src/lib/projexa-api-parity.test.ts records it, compliance-tracker replays it).
//
//   pxApiFetch("/api/exceptions?projectId=p1", init)
//     base empty (default today)  -> fetch("/api/exceptions?projectId=p1", init)            same origin, the session cookie, Vercel
//     base set, route listed      -> fetch(base + "/api/exceptions?projectId=p1", init)     no cookie; Authorization: Bearer <access token>
//     base set, route NOT listed  -> same origin, exactly as today (the function would answer 404: it is deny by default)
//
// The base is NEXT_PUBLIC_PX_API_BASE when the build sets it (the empty string means "same origin", which is also the KILL SWITCH), else
// PX_API_DEFAULT_BASE below. A signed-in person with no access token in the browser (should not happen) also goes same origin.
// Every caller of a listed route in the browser goes through this function: src/lib/local-first/shell/snapshot-cache.ts (dashboard,
// exceptions and BOQ-analysis snapshots), shell/documents-file-cache.ts (the three file-signing reads), shell/pending-edits.ts (the BOQ line
// edit). src/lib/px-api.test.ts holds the list equal to ai-os/audit37/projexa-api-routes.json.

export const PX_API_EDGE_URL = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-api";

/** "" = same origin (Vercel). Flipped to PX_API_EDGE_URL only after the function is deployed and its live smoke matched Vercel. */
export const PX_API_DEFAULT_BASE: string = "";

/** The routes (and methods) the edge function answers; equal to ai-os/audit37/projexa-api-routes.json (src/lib/px-api.test.ts). */
export const PX_EDGE_ROUTES: Readonly<Record<string, readonly string[]>> = {
  "/api/dashboard/project/:projectId": ["GET"],
  "/api/exceptions": ["GET"],
  "/api/reports/boq-analysis": ["GET"],
  "/api/scope/line-items/:id": ["PATCH"],
  "/api/documents/:id": ["GET", "PATCH"],
  "/api/drawings/:id/document-url": ["GET"],
  "/api/permits/:id": ["GET", "PATCH", "DELETE"],
};

export function pxApiBase(env: string | undefined = process.env.NEXT_PUBLIC_PX_API_BASE): string {
  return (env === undefined ? PX_API_DEFAULT_BASE : env.trim()).replace(/\/+$/, "");
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
