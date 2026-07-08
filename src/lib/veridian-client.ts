// PROJEXA's only connection to construction data: every call goes through
// VERIDIAN's /api/v1/projexa/* surface with a Bearer API key. This file
// never runs in the browser (server components / route handlers only) --
// the VERIDIAN API key must never reach the client.
//
// MVP note: VERIDIAN_API_KEY below is a single stubbed credential (one
// demo customer's key) so the actual data pipeline + UI could be built and
// verified end-to-end first. The real multi-tenant version looks up each
// signed-in PROJEXA customer's own stored key from PROJEXA's own database
// instead of this env var -- that's the next increment, not yet built.
const VERIDIAN_API_BASE = process.env.VERIDIAN_API_BASE_URL ?? "https://veridian-compliance-ai.vercel.app/api/v1"

export class VeridianApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

export async function callVeridian<T = unknown>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; apiKey?: string } = {}
): Promise<T> {
  const apiKey = options.apiKey ?? process.env.VERIDIAN_API_KEY
  if (!apiKey) throw new VeridianApiError("No VERIDIAN API key configured", 500)

  const res = await fetch(`${VERIDIAN_API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  })

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: res.statusText }))
    throw new VeridianApiError(errorBody.error ?? `VERIDIAN API request failed (${res.status})`, res.status)
  }
  return res.json() as Promise<T>
}
