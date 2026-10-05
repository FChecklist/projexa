// AUDIT-100 A2 / A3 / A21 / A22 (Vercel used as little as possible, user RAM first, no email on a daily sign-in): the MEASURING side of the specs
// lf-lifecycle-vercel-budget, lf-lifecycle-resources, lf-lifecycle-signin-no-email and lf-lifecycle-first-use.
//
// What leaves the laptop is counted from the browser itself, never from what the page says it did: every request of the browser context, the page's
// own and the service worker's own (Playwright reports both), is classified by WHERE it goes. A page request that the service worker answered from the
// laptop's own copy (response.fromServiceWorker()) never left the laptop and is not counted as network. The sync service and every /api call are
// answered by the specs inside the browser (page.route), so "an /api call" here means "the page ASKED the Vercel origin": exactly the call that would
// be a Vercel function invocation in production.

import type { BrowserContext, Request } from "@playwright/test"

export const APP_PORT = Number(process.env.BOQ_LOCAL_PORT ?? 3117)
export const APP_HOST = `localhost:${APP_PORT}`
export const STUB_PORT = Number(process.env.BOQ_LOCAL_SUPABASE_PORT ?? 54399)

/** Where a request goes. "vercel-*" = the app origin (Vercel in production). */
export type Dest =
  | "vercel-api" // the app origin /api/**: a Vercel function invocation
  | "vercel-page" // the app origin, a page / RSC / route that is not /api and not a static file: a Vercel function or ISR render
  | "vercel-static" // /_next/static, /_release, /sw.js, public files: a CDN file, no function
  | "edge-sync" // the projexa-sync Supabase Edge Function
  | "edge-api" // the projexa-api Supabase Edge Function (AUDIT-100 A2: the proxy routes it answers instead of Vercel)
  | "edge-other" // any other Supabase Edge Function
  | "supabase-auth" // the Auth service (the local stand-in on the rig)
  | "other"

export type Seen = { at: number; method: string; url: string; dest: Dest; fromSw: boolean; answeredBySw: boolean; path: string }

const STATIC_PREFIXES = ["/_next/static/", "/_release/", "/_next/image", "/favicon", "/icons/", "/images/", "/fonts/"]
const STATIC_FILES = new Set(["/sw.js", "/manifest.webmanifest", "/robots.txt", "/sitemap.xml", "/favicon.ico"])

export function classify(url: string): { dest: Dest; path: string } {
  const u = new URL(url)
  const path = u.pathname
  if (u.host === APP_HOST) {
    if (path === "/api" || path.startsWith("/api/")) return { dest: "vercel-api", path }
    if (STATIC_FILES.has(path) || STATIC_PREFIXES.some((p) => path.startsWith(p))) return { dest: "vercel-static", path }
    return { dest: "vercel-page", path }
  }
  if (u.host.endsWith(".supabase.co") && path.startsWith("/functions/v1/projexa-sync")) return { dest: "edge-sync", path }
  if (u.host.endsWith(".supabase.co") && path.startsWith("/functions/v1/projexa-api/")) return { dest: "edge-api", path: path.slice("/functions/v1/projexa-api".length) }
  if (u.host.endsWith(".supabase.co") && path.startsWith("/functions/v1/")) return { dest: "edge-other", path }
  if (u.host === `localhost:${STUB_PORT}` || (u.host.endsWith(".supabase.co") && path.startsWith("/auth/v1/"))) return { dest: "supabase-auth", path }
  return { dest: "other", path }
}

/** A stable name for an /api route so ids do not make every call a new entry: "/api/scope/line-items/abc123" -> "/api/scope/line-items/:id". */
export function routeKey(path: string): string {
  return path
    .split("/")
    .map((seg, i) => (i > 2 && (/^[0-9a-f-]{8,}$/i.test(seg) || /\d/.test(seg) || seg.length > 24) ? ":id" : seg))
    .join("/")
}

export type Traffic = {
  /** Every request of the context since the start, in order. */
  all: Seen[]
  /** Starts a window: the returned function gives the requests seen since this call. */
  mark(): () => Seen[]
  stop(): void
}

/** Records every request of the context (pages and service workers). The answered-by-worker flag is read when the request finishes. */
export function trackTraffic(context: BrowserContext): Traffic {
  const all: Seen[] = []
  const onRequest = (r: Request) => {
    const { dest, path } = classify(r.url())
    all.push({ at: Date.now(), method: r.method(), url: r.url(), dest, fromSw: r.serviceWorker() !== null, answeredBySw: false, path })
  }
  const onFinished = async (r: Request) => {
    const seen = [...all].reverse().find((s) => s.url === r.url() && s.method === r.method() && s.fromSw === (r.serviceWorker() !== null))
    const res = await r.response().catch(() => null)
    if (seen && res) seen.answeredBySw = res.fromServiceWorker()
  }
  context.on("request", onRequest)
  context.on("requestfinished", onFinished)
  return {
    all,
    mark() {
      const from = all.length
      return () => all.slice(from)
    },
    stop() {
      context.off("request", onRequest)
      context.off("requestfinished", onFinished)
    },
  }
}

/** The requests of a window that really LEFT the laptop: the worker's own fetches, and page requests the worker did not answer from its copy. */
export const leftTheLaptop = (seen: Seen[]) => seen.filter((s) => s.fromSw || !s.answeredBySw)

export function countByDest(seen: Seen[]): Record<Dest, number> {
  const out: Record<Dest, number> = { "vercel-api": 0, "vercel-page": 0, "vercel-static": 0, "edge-sync": 0, "edge-api": 0, "edge-other": 0, "supabase-auth": 0, other: 0 }
  for (const s of seen) out[s.dest] += 1
  return out
}

/** Distinct "METHOD route" of the /api requests of a window, with how many times each. */
export function apiRoutes(seen: Seen[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of seen.filter((x) => x.dest === "vercel-api")) {
    const k = `${s.method} ${routeKey(s.path)}`
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

// ─── mail ──────────────────────────────────────────────────────────────────────────────────────

const MAIL_HOSTS = /(^|\.)(resend\.com|postmarkapp\.com|sendgrid\.net|mailgun\.(org|net)|smtp[0-9a-z.-]*|amazonaws\.com|mandrillapp\.com|sparkpostmail\.com)$/i

/**
 * True when a request is one that makes a mail go out: the Auth service's recover / OTP / magic-link / resend / signup / verify / email-change calls, any
 * /api or Edge Function route about mail, a mail provider's host, or a password grant that is really a one-time-code grant. A plain password grant
 * (POST /auth/v1/token?grant_type=password) and the session read (GET /auth/v1/user) are NOT mail.
 */
export function isMailSend(method: string, url: string, body: string | null = null): boolean {
  const u = new URL(url)
  if (MAIL_HOSTS.test(u.hostname)) return true
  const p = u.pathname
  if (/^\/auth\/v1\/(recover|otp|magiclink|resend|signup|verify|invite)\/?$/.test(p)) return true
  if (/^\/auth\/v1\/user\/?$/.test(p) && method !== "GET") return true // an email or password change: Auth mails the old and the new address
  if (/^\/auth\/v1\/token\/?$/.test(p)) {
    const grant = u.searchParams.get("grant_type")
    if (grant && grant !== "password" && grant !== "refresh_token") return true
    if (body && /"(token_hash|otp|type)"\s*:/.test(body)) return true
  }
  if (/\/(api|functions\/v1)\/[^?]*(email|mail|invite|digest|forgot|recover|reset)/i.test(p) && method !== "GET") return true
  return false
}
