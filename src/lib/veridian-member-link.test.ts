/// <reference types="bun-types" />
// AUDIT-100 (link-invited-members). src/lib/veridian-member-link.ts and the lazy heal it gives the AI work link client (src/lib/ai-work-link-core.ts):
//   * requestMemberLink: POSTs the person's OWN session token to projexa-api /link-member and nothing else (no body: the service reads the
//     organisation and role itself); never throws; every failure is linked:false
//   * the AI work link client: a call answered 403 USER_NOT_LINKED links the person ONCE and, only when that worked, sends the same call ONCE more;
//     it never loops, never heals any other refusal, and the person never sees a worse error than before
import { describe, expect, test } from "bun:test"
import { createAwlClient, AwlError } from "./ai-work-link-core"
import { MEMBER_LINK_URL, requestMemberLink } from "./veridian-member-link"

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const notLinked = () => ok({ error: "Your PROJEXA account is not linked to a PROJEXA user - ask your admin", status: 403, code: "USER_NOT_LINKED" }, 403)
const minted = () => ok({ link_id: "l1", level: 1, expires_at: "2026-10-07T00:00:00Z", links: { link: "https://x/awl/tok", inbox: null } }, 201)

describe("requestMemberLink", () => {
  test("POSTs the session token to the projexa-api /link-member address, with no body, and reads the answer", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return ok({ linked: true, outcome: "created", role: "manager" })
    }) as unknown as typeof fetch
    expect(await requestMemberLink("tok-1", { fetch: f })).toEqual({ linked: true, outcome: "created", role: "manager" })
    expect(MEMBER_LINK_URL).toBe("https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-api/link-member")
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe(MEMBER_LINK_URL)
    expect(seen[0].init.method).toBe("POST")
    expect(seen[0].init.body).toBeUndefined()
    expect(seen[0].init.headers).toEqual({ Authorization: "Bearer tok-1", Accept: "application/json" })
    expect(seen[0].init.credentials).toBe("omit")
  })

  test("never throws: no session, a guard answer, an HTTP error, a network failure, a timeout", async () => {
    const calls: string[] = []
    const never = (async () => {
      calls.push("x")
      throw new Error("must not be called")
    }) as unknown as typeof fetch
    expect(await requestMemberLink(null, { fetch: never })).toEqual({ linked: false, outcome: "no_session" })
    expect(calls).toEqual([])
    expect(await requestMemberLink("t", { fetch: (async () => ok({ linked: false, outcome: "email_taken" })) as unknown as typeof fetch })).toEqual({ linked: false, outcome: "email_taken", role: null })
    expect(await requestMemberLink("t", { fetch: (async () => ok({ error: "x" }, 503)) as unknown as typeof fetch })).toEqual({ linked: false, outcome: "http_503" })
    expect(await requestMemberLink("t", { fetch: (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch })).toEqual({ linked: false, outcome: "unknown", role: null })
    expect(await requestMemberLink("t", { fetch: (async () => { throw new TypeError("refused") }) as unknown as typeof fetch })).toEqual({ linked: false, outcome: "network" })
    const hang = ((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch
    expect(await requestMemberLink("t", { fetch: hang, timeoutMs: 30 })).toEqual({ linked: false, outcome: "timeout" })
  })
})

describe("the AI work link client heals a not-linked member once", () => {
  const session = { accessToken: async () => "tok-1", refresh: async () => "tok-2" }

  test("USER_NOT_LINKED -> link the person -> the same mint is sent once more and succeeds", async () => {
    const urls: string[] = []
    const linkTokens: string[] = []
    let mints = 0
    const f = (async (url: string) => {
      urls.push(url)
      return ++mints === 1 ? notLinked() : minted()
    }) as unknown as typeof fetch
    const client = createAwlClient({ session, fetch: f, memberLink: async (t) => (linkTokens.push(t), { linked: true, outcome: "created" }) })
    const out = await client.mintUserLink({ days: 1, label: "x" })
    expect(out.linkId).toBe("l1")
    expect(linkTokens).toEqual(["tok-1"])
    expect(urls).toHaveLength(2)
    expect(urls.every((u) => u.endsWith("/user-link"))).toBe(true)
  })

  test("the default heal calls /link-member with the same fetch and token", async () => {
    const urls: string[] = []
    let mints = 0
    const f = (async (url: string) => {
      urls.push(url)
      if (url === MEMBER_LINK_URL) return ok({ linked: true, outcome: "created", role: "member" })
      return ++mints === 1 ? notLinked() : minted()
    }) as unknown as typeof fetch
    const out = await createAwlClient({ session, fetch: f }).mintUserLink({ days: 1 })
    expect(out.linkId).toBe("l1")
    expect(urls.map((u) => (u === MEMBER_LINK_URL ? "link-member" : u.split("/").pop()))).toEqual(["user-link", "link-member", "user-link"])
  })

  test("never a loop: still not linked after the heal -> the original error, two mint sends and one heal in all", async () => {
    let sends = 0
    let heals = 0
    const f = (async () => (sends++, notLinked())) as unknown as typeof fetch
    const client = createAwlClient({ session, fetch: f, memberLink: async () => (heals++, { linked: true, outcome: "already_linked" }) })
    const err = await client.mintUserLink({ days: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(AwlError)
    expect(err.code).toBe("USER_NOT_LINKED")
    expect(sends).toBe(2)
    expect(heals).toBe(1)
  })

  test("a heal that does not link (or throws) -> the original USER_NOT_LINKED, no second mint", async () => {
    for (const memberLink of [async () => ({ linked: false, outcome: "email_taken" }), async () => { throw new Error("down") }]) {
      let sends = 0
      const client = createAwlClient({ session, fetch: (async () => (sends++, notLinked())) as unknown as typeof fetch, memberLink })
      const err = await client.mintUserLink({ days: 1 }).catch((e) => e)
      expect(err.code).toBe("USER_NOT_LINKED")
      expect(sends).toBe(1)
    }
  })

  test("no heal for any other refusal, and none when switched off", async () => {
    let heals = 0
    const memberLink = async () => (heals++, { linked: true, outcome: "created" })
    for (const res of [() => ok({ error: "no", code: "ROLE_TOO_LOW" }, 403), () => ok({ error: "x", code: "RATE_LIMITED" }, 429), () => ok({ error: "bad" }, 400)]) {
      await createAwlClient({ session, fetch: (async () => res()) as unknown as typeof fetch, memberLink }).mintUserLink({ days: 1 }).catch(() => null)
    }
    expect(heals).toBe(0)
    let sends = 0
    const off = await createAwlClient({ session, fetch: (async () => (sends++, notLinked())) as unknown as typeof fetch, memberLink: null }).mintUserLink({ days: 1 }).catch((e) => e)
    expect(off.code).toBe("USER_NOT_LINKED")
    expect(sends).toBe(1)
  })

  test("the stale-session retry still works alongside the heal (stale -> refresh -> not linked -> heal -> ok)", async () => {
    const tokens: string[] = []
    let n = 0
    const f = (async (_u: string, init: RequestInit) => {
      tokens.push(String((init.headers as Record<string, string>).Authorization))
      n++
      if (n === 1) return ok({ error: "stale", code: "SESSION_STALE" }, 401)
      if (n === 2) return notLinked()
      return minted()
    }) as unknown as typeof fetch
    const out = await createAwlClient({ session, fetch: f, memberLink: async () => ({ linked: true, outcome: "created" }) }).mintUserLink({ days: 1 })
    expect(out.linkId).toBe("l1")
    expect(tokens).toEqual(["Bearer tok-1", "Bearer tok-2", "Bearer tok-2"])
  })
})
