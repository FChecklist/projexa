/// <reference types="bun-types" />
// LOCAL-FIRST R9 at the server's front door. A person who HAS a session must never be sent to /login because the sign-in
// service could not be reached or answered with something that is not "this refresh token is revoked". Only the server
// saying the refresh token is revoked is a real sign-out (and that still redirects to /login, exactly as before).
//
// Runs the real middleware with a session cookie whose access token expired (so a refresh is attempted) and a stubbed
// global fetch standing in for Supabase Auth. No network, no real project.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const ORIGIN = "http://localhost:3100";
const ENV_UNDER_TEST = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-not-a-real-credential",
} as const;
const saved: Record<string, string | undefined> = {};

const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
const realError = console.error;
const realWarn = console.warn;

beforeAll(() => {
  for (const [key, value] of Object.entries(ENV_UNDER_TEST)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realSetTimeout;
  console.error = realError;
  console.warn = realWarn;
});

const b64url = (s: string) => Buffer.from(s).toString("base64url");

/** The cookie @supabase/ssr reads, holding a session whose access token expired 100 s ago. Its name is sb-<first label of the URL host>-auth-token. */
function expiredSessionCookie(): string {
  const exp = Math.floor(Date.now() / 1000) - 100;
  const payload = { sub: "user-1", aud: "authenticated", role: "authenticated", exp };
  const session = {
    access_token: `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.sig`,
    refresh_token: "refresh-1",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: { id: "user-1", aud: "authenticated", email: "person@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  };
  return `sb-127-auth-token=base64-${b64url(JSON.stringify(session))}`;
}

async function visit(path: string, authAnswer: () => Response | Promise<Response>, cookie: string | null = expiredSessionCookie()) {
  globalThis.fetch = (async () => authAnswer()) as unknown as typeof fetch;
  // auth-js backs off between retries of a failed refresh (~30 s in all); the waits are not under test.
  globalThis.setTimeout = ((fn: () => void, _ms?: number, ...args: unknown[]) => realSetTimeout(fn, 0, ...args)) as typeof setTimeout;
  console.error = () => {};
  console.warn = () => {};
  const headers: Record<string, string> = cookie ? { cookie } : {};
  return middleware(new NextRequest(new URL(path, ORIGIN), { headers }));
}

const answer = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("a person with a session is never bounced to /login by a failure to confirm it", () => {
  test("the network to the sign-in service fails: a calm 503, no login redirect, the session cookie is not touched", async () => {
    const res = await visit("/dashboard", () => { throw new TypeError("fetch failed"); });
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(res.headers.get("set-cookie") ?? "").not.toContain("sb-127-auth-token");
    const body = await res.text();
    expect(body).toContain("still signed in");
    expect(body).not.toMatch(/password/i);
  });

  test("the sign-in service answers 503, 500 or 429: the same, never the login page", async () => {
    for (const status of [503, 500, 429, 408]) {
      const res = await visit("/dashboard", answer(status, { msg: "unavailable" }));
      expect(`${status}: ${res.status} ${res.headers.get("location")}`).toBe(`${status}: 503 null`);
    }
  });

  test("it applies to every protected page, not just /dashboard", async () => {
    for (const path of ["/scope", "/schedule", "/work-progress/new"]) {
      const res = await visit(path, () => { throw new TypeError("fetch failed"); });
      expect(`${path}: ${res.status}`).toBe(`${path}: 503`);
    }
  });

  test("the sign-in service says the refresh token is REVOKED: that is a real sign-out and still goes to /login", async () => {
    const res = await visit("/dashboard", answer(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!, ORIGIN);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirectTo")).toBe("/dashboard");
  });

  test("a visitor with NO session cookie is still sent to /login exactly as before", async () => {
    const res = await visit("/dashboard", () => { throw new TypeError("fetch failed"); }, null);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!, ORIGIN).pathname).toBe("/login");
  });

  test("API routes and public pages are not turned into 503s by the middleware", async () => {
    const api = await visit("/api/projects", () => { throw new TypeError("fetch failed"); });
    expect(api.status).toBe(200); // passes through to the route, whose own requireAuth() answers
    const login = await visit("/login", () => { throw new TypeError("fetch failed"); });
    expect(login.status).toBe(200);
  });
});
