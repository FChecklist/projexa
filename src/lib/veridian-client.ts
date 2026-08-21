import { db, veridianCredentials } from "@/lib/db";
import { eq } from "drizzle-orm";

// PROJEXA's only connection to construction data: every call goes through
// VERIDIAN's /api/v1/projexa/* surface with a Bearer API key. This file
// never runs in the browser (server components / route handlers only) --
// no VERIDIAN key (per-org or platform) must ever reach the client.
//
// Platform provisioning (Priority 17): every new signup gets its own
// isolated VERIDIAN org + API key via POST /api/v1/platform/provision-org
// (see provisionVeridianOrg() below), stored per-organization in
// public.veridian_credentials. getVeridianApiKey(organizationId) is now the
// PRIMARY path for resolving a caller's key. VERIDIAN_API_KEY (the old
// single shared demo credential) is now a fallback only, used when a caller
// passes organizationId but that org has no veridian_credentials row yet
// (e.g. projexa_demo_org, or any org created before this change) -- see
// resolveApiKey() below. It also remains the key used when a caller omits
// organizationId entirely (legacy call sites still being migrated).
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

export class VeridianApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Looks up this org's own VERIDIAN API key from public.veridian_credentials.
// Returns null (never throws) when no row exists or the DB is unreachable --
// callers decide whether/how to fall back (see resolveApiKey()). A thrown
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
      `[veridian-client] getVeridianApiKey(${organizationId}) failed -- falling back to shared VERIDIAN_API_KEY if configured:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// Single place that decides which key a call uses. Priority order:
//   1. an explicit apiKey passed by the caller
//   2. this org's own row in veridian_credentials (the real multi-tenant path)
//   3. the shared VERIDIAN_API_KEY env var (demo/sandbox fallback -- keeps
//      pre-existing orgs with no credentials row, e.g. projexa_demo_org,
//      and any call site that hasn't been migrated to pass organizationId,
//      working exactly as before)
async function resolveApiKey(options: { apiKey?: string; organizationId?: string }): Promise<string> {
  if (options.apiKey) return options.apiKey;

  if (options.organizationId) {
    const perOrgKey = await getVeridianApiKey(options.organizationId);
    if (perOrgKey) return perOrgKey;
    if (process.env.VERIDIAN_API_KEY) return process.env.VERIDIAN_API_KEY;
    throw new VeridianApiError(
      `No VERIDIAN credentials configured for organization ${options.organizationId}, and no fallback VERIDIAN_API_KEY set`,
      500
    );
  }

  if (process.env.VERIDIAN_API_KEY) return process.env.VERIDIAN_API_KEY;
  throw new VeridianApiError("No VERIDIAN API key configured", 500);
}

type CallVeridianOptions = { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; apiKey?: string; organizationId?: string; root?: boolean };

// Priority 15, Wave 2: factored out of callVeridian() so the quotation PDF
// route (a real binary response, not JSON) can reuse the exact same
// auth/base-url/error-shape logic instead of duplicating it. callVeridian()
// below is now a thin `res.json()` wrapper around this -- every existing
// caller's behavior is unchanged.
export async function callVeridianRaw(path: string, options: CallVeridianOptions = {}): Promise<Response> {
  const apiKey = await resolveApiKey(options);

  const base = options.root ? VERIDIAN_API_ROOT : VERIDIAN_API_BASE;
  const res = await fetch(`${base}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

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
  const res = await fetch(`${base}${path}`, {
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
  const res = await fetch(`${base}${path}`, {
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

  const res = await fetch(`${VERIDIAN_API_ROOT}/platform/provision-org`, {
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
