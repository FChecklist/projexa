import { db, veridianCredentials } from "@/lib/db";
import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";

// PROJEXA's only connection to construction data: every call goes through
// VERIDIAN's /api/v1/projexa/* surface with a Bearer API key. This file
// never runs in the browser (server components / route handlers only) --
// no VERIDIAN key (per-org or platform) must ever reach the client.
//
// Platform provisioning (Priority 17): every new signup gets its own
// isolated VERIDIAN org + API key via POST /api/v1/platform/provision-org
// (see provisionVeridianOrg() below), stored per-organization in
// public.veridian_credentials. getVeridianApiKey(organizationId) is the
// ONLY path for resolving an org-scoped caller's key -- see resolveApiKey()
// below. Per AR-04 (fail loud, never silently swap tenants), a caller that
// passes organizationId but has no veridian_credentials row gets a thrown
// error, never the shared VERIDIAN_API_KEY. That shared key remains in use
// only as the key for calls that omit organizationId entirely (legacy call
// sites still being migrated).
const VERIDIAN_API_BASE = process.env.VERIDIAN_API_BASE_URL ?? "https://veridian-compliance-ai.vercel.app/api/v1/projexa";

// A handful of real, already-shipped VERIDIAN v1 endpoints PROJEXA needs
// (labour roster, KPI entries, generic documents) were never re-exported
// under /api/v1/projexa/* -- they only exist at their original /api/v1/*
// location (e.g. /api/v1/construction/labour-roster, /api/v1/documents).
// Rather than waiting on VERIDIAN to add projexa/* aliases for them, calls
// that need one of those paths pass `root: true` to reach VERIDIAN_API_ROOT
// (the base URL one level up, stripped of the "/projexa" suffix) instead of
// VERIDIAN_API_BASE. Same auth, same host, just a different path prefix.
// The platform provisioning endpoint (/platform/provision-org) also lives
// under this root, one level above the /projexa/* surface.
const VERIDIAN_API_ROOT = VERIDIAN_API_BASE.replace(/\/projexa$/, "");

// Point 118: the public share-link resolve route lives OUTSIDE /api/v1
// entirely (compliance-tracker's own /api/reports/share/[token], mirroring
// /api/veri-meetings/share/[token] -- neither is under /api/v1/*, since
// they carry no auth of any kind, Bearer or session). Exported so the
// public share page can reach it with a plain, unauthenticated fetch --
// never through callVeridian/callVeridianRaw, which always resolve an API
// key first and would defeat the point of a link that needs no credentials.
export const VERIDIAN_ORIGIN = VERIDIAN_API_ROOT.replace(/\/api\/v1$/, "");

// R52 / R46S11_03. `message` is what the user reads: virtually every /api
// route in this repo returns it verbatim as { error: <message> }, and several
// screens render that string directly. So it must never carry anything the
// user should not see. `detail` is the operator's half -- the internal URL and
// the exact budget -- and is only ever logged server-side, never returned.
export class VeridianApiError extends Error {
  readonly detail?: string;
  constructor(message: string, public status: number, detail?: string) {
    super(message);
    this.detail = detail;
  }
}

// R46 (production incident, 2026-08-25: "Vercel Runtime Timeout Error: Task
// timed out after 300 seconds" on /api/projects, /api/scope, /api/module-chain,
// /api/currencies, /dashboard, /dashboard/overview and others -- 5 real
// users affected, 20:00:14Z-03:08:19Z, still recurring). Root cause:
// VERIDIAN's own backend independently hangs on some of these same logical
// endpoints (confirmed via its own Vercel runtime errors, an identical
// timeout error group recurring there since 2026-07-15 -- a pre-existing,
// chronic condition, not something this incident's investigation caused or
// could fix from this side). Every fetch() in this file had NO timeout at
// all, so a VERIDIAN hang meant the calling PROJEXA route just sat on the
// unbounded fetch until Vercel's own 300s function cap killed the whole
// request -- the single shared choke point behind failures on otherwise
// unrelated routes, since virtually every PROJEXA API route goes through
// this one client. This does not fix VERIDIAN's hang (that's a separate,
// upstream investigation) -- it bounds PROJEXA's own exposure to it: a
// hung upstream now fails fast with a clear, catchable VeridianApiError
// instead of consuming the full 300s Vercel limit on every affected route.
const VERIDIAN_FETCH_TIMEOUT_MS = 20_000;

// R52: ONE bounded retry, and ONLY for requests that are safe to repeat.
//
// MEASURED 2026-08-26, not assumed. Twenty sequential probes of
// /api/v1/projexa/dashboard with an INVALID bearer token -- so the only work
// asked of the upstream is boot, look the key up, reject it with 401:
//   19 responded 401 in 0.65s-3.4s
//    1 hung and returned nothing after 21.3s
// A second run the same minute hung 1 in 8. So the upstream hangs roughly
// 5-12% of the time, each hang costing the full 20s timeout.
//
// THE IMPORTANT PART, which changes the diagnosis on record: THIS IS NOT A
// COLD START. The fault register attributes these timeouts to a cold boot, and
// an earlier probe run in this session showed a textbook warm-up curve that
// supported it. It does not survive twenty probes: the hang lands on probe 8
// of 8 and probe 1 of 20, with sub-second responses either side. A warm
// function hangs too. Cold start is at most the first request; this is chronic
// and intermittent.
//
// WHY A RETRY IS THE RIGHT FIX HERE AND NOT A PAPER-OVER: the hangs are
// independent -- every probe adjacent to a hang succeeded in about a second.
// One retry therefore turns a ~5% user-visible failure into ~0.25%, which is
// the difference between "the demo broke" and "that page took a moment". It
// does NOT fix the upstream, which lives in compliance-tracker and is another
// session's to own; it bounds PROJEXA's exposure, exactly as the 20s timeout
// above already does.
//
// *** ONLY IDEMPOTENT METHODS ARE RETRIED. *** A timeout means we never saw a
// response -- it does NOT mean the server did no work. Retrying a POST could
// create a second BOQ, a second permit or a second task, and a silent double
// write is far worse than the error it would be hiding. GET and HEAD are safe
// to repeat; everything else fails on the first timeout exactly as before.
const VERIDIAN_RETRY_ON_TIMEOUT = true;

function isIdempotent(init: RequestInit): boolean {
  const m = (init.method ?? "GET").toUpperCase();
  return m === "GET" || m === "HEAD";
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

// R67 F-06/F-07/F-08/F-09, decision D-04. The 20 s ceiling above exists to stop
// a hung upstream consuming Vercel's whole 300 s function budget -- it is a
// LAST resort, not a page's latency budget. A module page that renders a list
// has no business waiting twenty seconds: after eight it should say so and
// offer Retry, which is what the user can actually act on.
//
// So a caller may state its own, SHORTER budget. It is opt-in and it can only
// tighten, never loosen: whichever of the caller's budget and the 20 s ceiling
// is smaller wins, so no call site can accidentally extend PROJEXA's exposure
// to the chronic upstream hang documented above.
export const VERIDIAN_PAGE_BUDGET_MS = 8_000;

function budgetFor(timeoutMs?: number): number {
  if (!timeoutMs || timeoutMs <= 0) return VERIDIAN_FETCH_TIMEOUT_MS;
  return Math.min(timeoutMs, VERIDIAN_FETCH_TIMEOUT_MS);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
  const attempts = VERIDIAN_RETRY_ON_TIMEOUT && isIdempotent(init) ? 2 : 1;
  const budgetMs = budgetFor(timeoutMs);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(budgetMs) });
    } catch (err) {
      lastErr = err;
      if (!isTimeout(err)) throw err;
      if (attempt < attempts) {
        // Logged so a retry is visible in the runtime logs rather than hiding
        // the upstream's real failure rate behind a success.
        console.warn(`[veridian] timed out after ${budgetMs}ms, retrying once:`, url);
      }
    }
  }

  if (isTimeout(lastErr)) {
    // R52 / R46S11_03. This message used to end in `: ${url}`, and that string
    // reached owner-facing UI intact -- "VERIDIAN request timed out after
    // 20000ms: https://veridian-compliance-ai.vercel.app/api/v1/projexa/dashboard"
    // was rendered on /dashboard/project, /dashboard/overview and /reports. It
    // leaked the internal backend hostname, the internal path and the exact
    // timeout budget to every user who hit a slow call.
    //
    // The real cause is kept -- the user is told a timeout happened, on which
    // service, and that it was retried -- which is what C19 ERROR_TRUTHFUL
    // asks for. The internal address and the millisecond budget move to
    // `detail`, which is logged here and never returned to a client.
    const detail = `VERIDIAN request timed out after ${budgetMs}ms${attempts > 1 ? " on both attempts" : ""}: ${url}`;
    console.error(`[veridian] ${detail}`);
    throw new VeridianApiError(
      attempts > 1
        ? "The construction data service did not respond in time, on two attempts. Please retry."
        : "The construction data service did not respond in time. Please retry.",
      504,
      detail
    );
  }
  throw lastErr;
}

// Looks up this org's own VERIDIAN API key from public.veridian_credentials.
// Returns null (never throws) when no row exists or the DB is unreachable --
// resolveApiKey() below turns either case into a thrown, fail-loud AR-04
// error rather than silently substituting the shared key. A thrown
// DB-connectivity error here (e.g. DATABASE_URL not yet configured -- see
// src/lib/db/index.ts) must not take down every request; it should just mean
// "couldn't resolve a per-org key this time," same as "no row yet."
export async function getVeridianApiKey(organizationId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ apiKey: veridianCredentials.veridianApiKey })
      .from(veridianCredentials)
      .where(eq(veridianCredentials.organizationId, organizationId))
      .limit(1);
    return row?.apiKey ?? null;
  } catch (err) {
    console.error(
      `[veridian-client] getVeridianApiKey(${organizationId}) failed -- treating as no per-org key found:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// Single place that decides which key a call uses. Priority order:
//   1. an explicit apiKey passed by the caller
//   2. this org's own row in veridian_credentials (the real multi-tenant path)
//   3. if organizationId was omitted entirely (legacy call sites still being
//      migrated), the shared VERIDIAN_API_KEY env var (demo/sandbox
//      fallback). An organizationId that WAS provided but has no per-org
//      row never falls back to this shared key -- see the AR-04 guard below.
export async function resolveApiKey(options: { apiKey?: string; organizationId?: string }): Promise<string> {
  if (options.apiKey) return options.apiKey;

  if (options.organizationId) {
    const perOrgKey = await getVeridianApiKey(options.organizationId);
    if (perOrgKey) return perOrgKey;
    // AR-04 fail-loud guard: a request that identifies a tenant but has no
    // per-org credentials MUST fail, never silently authenticate as whatever
    // tenant the shared VERIDIAN_API_KEY belongs to. Falling back here would
    // be a cross-tenant data leak (E-45) -- empty is a legitimate answer, a
    // shared key never is.
    throw new VeridianApiError(
      `No VERIDIAN credentials configured for organization ${options.organizationId}, and per-org requests may not fall back to a shared key (AR-04)`,
      500
    );
  }

  if (process.env.VERIDIAN_API_KEY) return process.env.VERIDIAN_API_KEY;
  throw new VeridianApiError("No VERIDIAN API key configured", 500);
}

// R48_NO_CURRENCY_UI_01: "PUT" added so /api/organization/currency can call
// VERIDIAN's PUT /currencies/base (compliance-tracker PR #1391) -- every
// prior caller in this file used POST/PATCH for writes, so PUT was simply
// never needed here before.
// R67 F-06..F-09 (D-04): `timeoutMs` lets a module page state its own request
// budget (see VERIDIAN_PAGE_BUDGET_MS above). It can only tighten the 20 s
// ceiling, never extend it, and it is optional -- every existing caller keeps
// the ceiling it has always had.
type CallVeridianOptions = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; apiKey?: string; organizationId?: string; root?: boolean; timeoutMs?: number };

// Priority 15, Wave 2: factored out of callVeridian() so the quotation PDF
// route (a real binary response, not JSON) can reuse the exact same
// auth/base-url/error-shape logic instead of duplicating it. callVeridian()
// below is now a thin `res.json()` wrapper around this -- every existing
// caller's behavior is unchanged.
export async function callVeridianRaw(path: string, options: CallVeridianOptions = {}): Promise<Response> {
  const apiKey = await resolveApiKey(options);

  const base = options.root ? VERIDIAN_API_ROOT : VERIDIAN_API_BASE;
  const res = await fetchWithTimeout(`${base}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  }, options.timeoutMs);

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new VeridianApiError(errorBody.error ?? `VERIDIAN API request failed (${res.status})`, res.status);
  }
  return res;
}

export async function callVeridian<T = unknown>(path: string, options: CallVeridianOptions = {}): Promise<T> {
  const res = await callVeridianRaw(path, options);
  return res.json() as Promise<T>;
}

// Priority 15 Wave 2: callVeridian() above always parses the response as
// JSON, which breaks for binary responses (the new payslip PDF endpoint
// returns Content-Type: application/pdf). Same auth/base-URL resolution as
// callVeridian, but returns the raw ArrayBuffer + content-type instead of
// assuming JSON.
export async function callVeridianBinary(
  path: string,
  options: { apiKey?: string; organizationId?: string; root?: boolean } = {}
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const apiKey = await resolveApiKey(options);

  const base = options.root ? VERIDIAN_API_ROOT : VERIDIAN_API_BASE;
  const res = await fetchWithTimeout(`${base}${path}`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new VeridianApiError(errorBody.error ?? `VERIDIAN API request failed (${res.status})`, res.status);
  }
  return { body: await res.arrayBuffer(), contentType: res.headers.get("Content-Type") ?? "application/octet-stream" };
}

// Priority 13/Wave 143 (Permits/Drawings/Documents real upload): callVeridian()
// always JSON-encodes its body, which can't carry file bytes. This is the
// multipart twin -- relays a FormData body (file + fields) straight through
// with the same Bearer auth/base-URL/error-shape as callVeridianRaw, letting
// fetch set its own multipart Content-Type/boundary header (setting it
// manually here would omit the boundary and break the upload).
export async function callVeridianUpload<T = unknown>(
  path: string,
  formData: FormData,
  options: { apiKey?: string; organizationId?: string; root?: boolean } = {}
): Promise<T> {
  const apiKey = await resolveApiKey(options);
  const base = options.root ? VERIDIAN_API_ROOT : VERIDIAN_API_BASE;
  const res = await fetchWithTimeout(`${base}${path}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: formData,
    cache: "no-store",
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new VeridianApiError(errorBody.error ?? `VERIDIAN API request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

// Platform provisioning (Priority 17): calls VERIDIAN's platform-level
// provisioning endpoint to create a brand-new, fully isolated VERIDIAN org
// for a PROJEXA customer at signup time. This is a DIFFERENT credential
// class from everything else in this file -- VERIDIAN_PLATFORM_APPLICATION_KEY
// is a platform-wide application key (authorizes "create a new tenant"),
// never a customer's own scoped key, and it must never be used for any
// other call in this file. Server-side only, same as every other export
// here; this is additionally never expected to run per-request (only once,
// at signup).
//
// Contract (as specified by the PROJEXA<->VERIDIAN integration task; the
// sibling session building this endpoint in compliance-tracker is the
// authoritative source if it drifts from this):
//   POST {VERIDIAN_API_ROOT}/platform/provision-org
//   Authorization: Bearer <VERIDIAN_PLATFORM_APPLICATION_KEY>
//   body: { customerOrgName: string, country?: string, primaryCurrency?: string }
//   201 -> { organisationId: string, apiKey: string }  (apiKey returned once)
//   401 -> bad/missing platform key; 400 -> missing customerOrgName
export type ProvisionVeridianOrgParams = {
  customerOrgName: string;
  country?: string;
  primaryCurrency?: string;
};

export type ProvisionVeridianOrgResult = {
  organisationId: string;
  apiKey: string;
};

export async function provisionVeridianOrg(params: ProvisionVeridianOrgParams): Promise<ProvisionVeridianOrgResult> {
  const platformKey = process.env.VERIDIAN_PLATFORM_APPLICATION_KEY;
  if (!platformKey) {
    throw new VeridianApiError(
      "VERIDIAN_PLATFORM_APPLICATION_KEY is not configured -- cannot provision a new VERIDIAN org for this signup",
      500
    );
  }
  if (!params.customerOrgName || !params.customerOrgName.trim()) {
    throw new VeridianApiError("customerOrgName is required to provision a VERIDIAN org", 400);
  }

  const res = await fetchWithTimeout(`${VERIDIAN_API_ROOT}/platform/provision-org`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${platformKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customerOrgName: params.customerOrgName,
      ...(params.country ? { country: params.country } : {}),
      ...(params.primaryCurrency ? { primaryCurrency: params.primaryCurrency } : {}),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new VeridianApiError(
      errorBody.error ?? `VERIDIAN provision-org request failed (${res.status})`,
      res.status
    );
  }

  const data = await res.json().catch(() => null) as { organisationId?: string; apiKey?: string } | null;
  if (!data?.organisationId || !data?.apiKey) {
    throw new VeridianApiError("VERIDIAN provision-org returned an unexpected response shape", 502);
  }

  return { organisationId: data.organisationId, apiKey: data.apiKey };
}

// Perf, 2026-08-27: cached counterpart to callVeridian() for GET-only,
// read-heavy, slowly-changing reference/lookup data -- currency master list,
// cost centers, fiscal years. Deliberately NOT used for anything that shows
// a live/current figure (dashboard totals, AR aging, balance sheet, invoice
// status) or any write path; those keep calling callVeridian() directly with
// its existing cache: "no-store".
//
// SECURITY, read before reusing this for a new route: every VERIDIAN call
// in this file is per-tenant -- the exact same `path` (e.g. "/currencies")
// returns a DIFFERENT org's data depending solely on which per-org Bearer
// token resolveApiKey() attached (see AR-04 above), never on the URL. Next's
// ordinary `fetch()` cache keys on URL + method + body only, NOT headers --
// so naively adding `next: { revalidate }` to the shared fetch() inside
// fetchWithTimeout() would silently serve org A's cached response to org B
// on org B's next request. That is a real cross-tenant leak (same class as
// E-45), not a theoretical one, which is why this helper exists instead of
// touching that shared fetch call.
//
// unstable_cache's cache key is derived from `keyParts` PLUS the serialized
// arguments passed to the wrapped function -- organizationId is both an
// explicit keyPart and the function's sole argument, so it is org-scoped
// two independent ways. Define the returned fetcher ONCE per route at
// module scope (as every call site below does) rather than inside the
// request handler -- unstable_cache is meant to be created once, not
// re-wrapped on every request.
//
// This uses Next's built-in Data Cache -- the same mechanism ISR/`fetch`
// revalidation uses. It ships on every Vercel plan including Hobby; it is
// not a paid add-on.
//
// Caller must already have run requireAuth() (or equivalent) and confirmed
// the request is authorized BEFORE calling the returned fetcher -- this
// only caches the downstream data for an already-authorized org, it never
// substitutes for the authorization check itself.
export function createCachedVeridianGet<T = unknown>(
  cacheKey: string,
  path: string,
  revalidateSeconds: number
): (organizationId: string) => Promise<T> {
  return unstable_cache(
    (organizationId: string) => callVeridian<T>(path, { organizationId }),
    [cacheKey, path],
    { revalidate: revalidateSeconds, tags: [cacheKey] }
  );
}
