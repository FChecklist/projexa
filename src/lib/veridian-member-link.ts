// AUDIT-100 (audit100/link-invited-members): EVERY MEMBER GETS THEIR OWN VERIDIAN USER.
//
// THE GAP. Only an organisation's first person was ever linked to a VERIDIAN user (a compliance.users row whose auth_user_id is their PROJEXA sign-in).
// Everyone who joined through an invitation had none, so their AI work link mint, the "Copy AI prompt" button and the welcome e-mail all failed with
// 403 USER_NOT_LINKED ("not linked").
//
// THE FIX, two callers of ONE service call:
//   1. right after an invitation is accepted (src/app/api/org/invites/accept/route.ts), before the welcome e-mail mints the person's link;
//   2. lazily, when an AI work link call answers USER_NOT_LINKED (src/lib/ai-work-link-core.ts): an existing member who joined before this fix is
//      linked the first time they use the AI link, and the call is sent once more.
// The service is POST <projexa-api Edge Function>/link-member (compliance-tracker supabase/functions/projexa-api/member-link.ts) with the person's OWN
// session token: it reads the person's organisation and PROJEXA role from PROJEXA's memberships with that token and the organisation's VERIDIAN
// organisation from veridian_credentials server-side, so nothing the browser sends picks the organisation or the role, and no key is in any browser.
// The VERIDIAN role it gives is never more than the PROJEXA role had: owner/admin -> admin, pm -> manager, site_engineer/member -> member,
// client_viewer -> client_viewer (read-only). It is idempotent and never changes the role of a person who is already linked (drizzle/0728 there).
//
// NEVER BLOCKING, NEVER THROWING: every failure (no session, network, timeout, a refusal) is an answer {linked:false, outcome}, and the callers carry on
// exactly as they did before this file existed. Nothing here logs a token.
//
// THE URL IS A CODE CONSTANT, like AWL_URL in ai-work-link-core.ts: a public address changed by a reviewed edit.
export const MEMBER_LINK_URL = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-api/link-member"
export const MEMBER_LINK_TIMEOUT_MS = 8_000

export type MemberLinkResult = { linked: boolean; outcome: string; role?: string | null }

export type MemberLinkDeps = {
  fetch?: typeof fetch
  url?: string
  timeoutMs?: number
}

/** One call to the service with this session token. Never throws. */
export async function requestMemberLink(token: string | null | undefined, deps: MemberLinkDeps = {}): Promise<MemberLinkResult> {
  if (!token) return { linked: false, outcome: "no_session" }
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? MEMBER_LINK_TIMEOUT_MS)
  try {
    const res = await doFetch(deps.url ?? MEMBER_LINK_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
    if (!res.ok) return { linked: false, outcome: `http_${res.status}` }
    return { linked: o.linked === true, outcome: typeof o.outcome === "string" ? o.outcome : "unknown", role: typeof o.role === "string" ? o.role : null }
  } catch {
    return { linked: false, outcome: controller.signal.aborted ? "timeout" : "network" }
  } finally {
    clearTimeout(timer)
  }
}
