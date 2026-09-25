/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-33. The local browser-first BOQ specs (e2e/boq-offline.spec.ts, e2e/boq-worker-filter.spec.ts) sign in a synthetic
// browser against e2e/support/fake-supabase-server.mjs instead of a real Supabase project. Those specs only run in a browser, on a server
// that takes minutes to compile, so what they depend on is checked here in seconds: the middleware's own call (createServerClient ->
// getClaims) accepts the stand-in's session cookie, refuses a token signed by any other key, and the browser client's getSession reads
// the same cookie without any request. A change to @supabase/ssr that stops accepting the cookie fails this test, not a CI browser job.
import { GlobalRegistrator } from "@happy-dom/global-registrator"
if (typeof globalThis.document === "undefined") GlobalRegistrator.register({ url: "http://localhost:3117/" })

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { createBrowserClient, createServerClient } from "@supabase/ssr"

let child: ChildProcess
let port = 0
let origin = ""

type Session = { userId: string; email: string; accessToken: string; cookieName: string; cookieValue: string }

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once("error", reject)
    s.listen(0, () => {
      const p = (s.address() as { port: number }).port
      s.close(() => resolve(p))
    })
  })
}

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${origin}/health`)
      if (res.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error("the local Auth stand-in did not start")
}

async function session(): Promise<Session> {
  const res = await fetch(`${origin}/__session?email=spec%40example.invalid`)
  return (await res.json()) as Session
}

function serverClientFor(cookieName: string, cookieValue: string) {
  return createServerClient(origin, "local-stub-anon-key", {
    cookies: { getAll: () => [{ name: cookieName, value: cookieValue }], setAll: () => {} },
  })
}

beforeAll(async () => {
  port = await freePort()
  origin = `http://localhost:${port}`
  child = spawn("node", ["e2e/support/fake-supabase-server.mjs"], {
    env: { ...process.env, FAKE_SUPABASE_PORT: String(port) },
    stdio: "ignore",
  })
  await waitForHealth()
})

afterAll(() => {
  child?.kill()
})

describe("the local Auth stand-in", () => {
  test("its session cookie is named the way @supabase/ssr names it for a localhost URL", async () => {
    const s = await session()
    expect(s.cookieName).toBe("sb-localhost-auth-token")
    expect(s.cookieValue.startsWith("base64-")).toBe(true)
    expect(s.cookieValue.length).toBeLessThan(3180) // one cookie, no chunk suffix
  })

  test("the middleware's getClaims() accepts the cookie, verifying the token against the stand-in's key set", async () => {
    const s = await session()
    const { data, error } = await serverClientFor(s.cookieName, s.cookieValue).auth.getClaims()
    expect(error).toBeNull()
    expect(data?.claims.sub).toBe(s.userId)
    expect(data?.claims.role).toBe("authenticated")
  })

  test("a token whose signature does not verify against the stand-in's key set is refused", async () => {
    const s = await session()
    const other = await session()
    const [h, p] = s.accessToken.split(".")
    const forged = `${h}.${p}.${other.accessToken.split(".")[2].split("").reverse().join("")}`
    const forgedSession = JSON.parse(Buffer.from(s.cookieValue.slice("base64-".length), "base64url").toString("utf8"))
    forgedSession.access_token = forged
    const forgedCookie = `base64-${Buffer.from(JSON.stringify(forgedSession)).toString("base64url")}`
    const { data } = await serverClientFor(s.cookieName, forgedCookie).auth.getClaims()
    expect(data?.claims?.sub).toBeUndefined()
  })

  test("a request with no cookie has no claims", async () => {
    const { data } = await createServerClient(origin, "local-stub-anon-key", { cookies: { getAll: () => [], setAll: () => {} } }).auth.getClaims()
    expect(data?.claims?.sub).toBeUndefined()
  })

  test("the browser client's getSession() reads the cookie and returns the token the gateway request will carry, with no network call", async () => {
    const s = await session()
    document.cookie = `${s.cookieName}=${s.cookieValue}; path=/`
    // Nothing may be requested: the token is unexpired, so a refresh is not due.
    const realFetch = globalThis.fetch
    const seen: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input))
      return realFetch(input, init)
    }) as typeof fetch
    try {
      const browser = createBrowserClient(origin, "local-stub-anon-key")
      const { data } = await browser.auth.getSession()
      expect(data.session?.access_token).toBe(s.accessToken)
      expect(data.session?.user.id).toBe(s.userId)
      expect(seen).toEqual([])
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
