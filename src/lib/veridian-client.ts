import { db, veridianCredentials } from "@/lib/db";
import { eq } from "drizzle-orm";

// PROJEXA's only connection to construction data: every call goes through
// VERIDIAN's /api/v1/projexa/* surface with a Bearer API key. This file
// never runs in the browser (server components / route handlers only) --
// the VERIDIAN API key must never reach the client.
//
// MVP note: VERIDIAN_API_KEY below is a single stubbed credential (one
// demo customer's key) used when no organizationId/apiKey is passed, so the
// data pipeline + UI could be built and verified end-to-end first. Real
// multi-tenant calls should pass organizationId and let getVeridianApiKey()
// look up that customer's own stored key via public.veridian_credentials.
const VERIDIAN_API_BASE = process.env.VERIDIAN_API_BASE_URL ?? "https://veridian-compliance-ai.vercel.app/api/v1/projexa";

// A handful of real, already-shipped VERIDIAN v1 endpoints PROJEXA needs
// (labour roster, KPI entries, generic documents) were never re-exported
// under /api/v1/projexa/* -- they only exist at their original /api/v1/*
// location (e.g. /api/v1/construction/labour-roster, /api/v1/documents).
// Rather than waiting on VERIDIAN to add projexa/* aliases for them, calls
// that need one of those paths pass `root: true` to reach VERIDIAN_API_ROOT
// (the base URL one level up, stripped of the "/projexa" suffix) instead of
// VERIDIAN_API_BASE. Same auth, same host, just a different path prefix.
const VERIDIAN_API_ROOT = VERIDIAN_API_BASE.replace(/\/projexa$/, "");

export class VeridianApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function getVeridianApiKey(organizationId: string): Promise<string> {
  const [row] = await db
    .select({ apiKey: veridianCredentials.veridianApiKey })
    .from(veridianCredentials)
    .where(eq(veridianCredentials.organizationId, organizationId))
    .limit(1);

  if (!row) {
    throw new VeridianApiError(`No VERIDIAN credentials configured for organization ${organizationId}`, 500);
  }
  return row.apiKey;
}

export async function callVeridian<T = unknown>(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; apiKey?: string; organizationId?: string; root?: boolean } = {}
): Promise<T> {
  const apiKey = options.apiKey ?? (options.organizationId ? await getVeridianApiKey(options.organizationId) : process.env.VERIDIAN_API_KEY);
  if (!apiKey) throw new VeridianApiError("No VERIDIAN API key configured", 500);

  const base = options.root ? VERIDIAN_API_ROOT : VERIDIAN_API_BASE;
  const res = await fetch(`${base}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new VeridianApiError(errorBody.error ?? `VERIDIAN API request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}
