// "Sign in with PROJEXA" for AI connectors, the consent page's logic. The sign-in service (compliance-tracker supabase/functions/projexa-oauth)
// redirects the browser to /connect/authorize/<payload>, where <payload> is base64url(JSON {c,r,s,h,n}). The request is carried in the PATH
// because the login redirect keeps only the path of the page a visitor wanted, never its query string.

export const OAUTH_BASE = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-oauth"
export const OAUTH_ISSUER = "https://projexa-ai.com"
export const LINK_DAYS = 30

export type ConsentRequest = { clientId: string; redirectUri: string; state: string; codeChallenge: string; clientName: string }

/** Where the connector's tool may be sent back to: https, or plain http only for a program on this very computer. */
export function safeReturnAddress(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.hash || u.username || u.password) return false
  return u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))
}

/** The request, or null when anything about it is off. The service re-checks every field; this only keeps junk off the screen. */
export function decodeConsentPayload(payload: string): ConsentRequest | null {
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (ch) => ch.charCodeAt(0)))) as Record<string, unknown>
    const { c, r, s, h, n } = o
    if (typeof c !== "string" || !/^px_[0-9a-f]{24}$/.test(c)) return null
    if (typeof r !== "string" || !safeReturnAddress(r)) return null
    if (typeof h !== "string" || !/^[A-Za-z0-9\-_]{43}$/.test(h)) return null
    return { clientId: c, redirectUri: r, state: typeof s === "string" ? s.slice(0, 500) : "", codeChallenge: h, clientName: typeof n === "string" && n.trim() ? n.trim().slice(0, 80) : "An AI assistant" }
  } catch {
    return null
  }
}

/** The pxa_ token inside a minted link address, or null. */
export function tokenFromLink(link: string): string | null {
  return /pxa_[0-9a-f]{64}/.exec(link)?.[0] ?? null
}

/** The address the browser goes to when the person says no. */
export function denyAddress(req: ConsentRequest): string {
  const u = new URL(req.redirectUri)
  u.searchParams.set("error", "access_denied")
  u.searchParams.set("error_description", "The person chose not to connect.")
  if (req.state) u.searchParams.set("state", req.state)
  return u.toString()
}
