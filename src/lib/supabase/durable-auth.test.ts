/// <reference types="bun-types" />
// LOCAL-FIRST R9: "once logged in, the user stays logged in FOREVER until they log out or choose to delete."
//
// Two layers of proof:
//   1. the wrapper's own rules, with a fake fetch (every status class);
//   2. the REAL auth-js client (GoTrueClient from node_modules) with the wrapper installed: a session whose access token has
//      expired and whose refresh fails is KEPT when the laptop is offline, on a network error, on 5xx / 408 / 429 / an HTML
//      page, and REMOVED only when the server answers, online, that the refresh token is revoked.
import { describe, expect, test } from "bun:test";
import { GoTrueClient } from "@supabase/auth-js";
import {
  classifyRefreshFailure,
  createDurableAuthFetch,
  hasSessionCookie,
  isRefreshTokenRequest,
  isTransientAuthError,
} from "./durable-auth";

const BASE = "https://example-project.supabase.co/auth/v1";
const REFRESH_URL = `${BASE}/token?grant_type=refresh_token`;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (status: number) => new Response("<html><body>Gateway</body></html>", { status, headers: { "content-type": "text/html" } });

describe("which request is a token refresh", () => {
  test("only POST .../auth/v1/token?grant_type=refresh_token", () => {
    expect(isRefreshTokenRequest(REFRESH_URL)).toBe(true);
    expect(isRefreshTokenRequest(new URL(REFRESH_URL))).toBe(true);
    expect(isRefreshTokenRequest(new Request(REFRESH_URL, { method: "POST" }))).toBe(true);
    expect(isRefreshTokenRequest(`${BASE}/token?x=1&grant_type=refresh_token`)).toBe(true);
    for (const other of [`${BASE}/token?grant_type=password`, `${BASE}/user`, `${BASE}/logout`, `${BASE}/signup`, `${BASE}/.well-known/jwks.json`, "https://example.com/api/token?grant_type=refresh_token"]) {
      expect(isRefreshTokenRequest(other)).toBe(false);
    }
  });
});

describe("what counts as 'the refresh token is really revoked'", () => {
  test("a 4xx whose JSON says so, in either of GoTrue's two error shapes", () => {
    expect(classifyRefreshFailure(400, JSON.stringify({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }))).toBe("revoked");
    expect(classifyRefreshFailure(400, JSON.stringify({ code: "refresh_token_not_found", message: "Invalid Refresh Token" }))).toBe("revoked");
    expect(classifyRefreshFailure(400, JSON.stringify({ error_code: "refresh_token_already_used" }))).toBe("revoked");
    expect(classifyRefreshFailure(400, JSON.stringify({ error: "invalid_grant", error_description: "Invalid Refresh Token: Already Used" }))).toBe("revoked");
    expect(classifyRefreshFailure(403, JSON.stringify({ error_code: "session_not_found" }))).toBe("revoked");
    expect(classifyRefreshFailure(401, JSON.stringify({ error_code: "user_banned" }))).toBe("revoked");
  });

  test("never a 5xx, 408, 429 or 404, whatever the body says", () => {
    const revokedBody = JSON.stringify({ error_code: "refresh_token_not_found" });
    for (const status of [500, 502, 503, 504, 520, 530, 408, 429, 404, 405, 418]) {
      expect(classifyRefreshFailure(status, revokedBody)).toBe("transient");
    }
  });

  test("a 4xx that does not name the token (rate limit text, validation, HTML, empty, not an object) keeps the session", () => {
    expect(classifyRefreshFailure(400, JSON.stringify({ error_code: "validation_failed", msg: "bad request" }))).toBe("transient");
    expect(classifyRefreshFailure(400, JSON.stringify({ error_code: "over_request_rate_limit" }))).toBe("transient");
    expect(classifyRefreshFailure(403, "<html>Captive portal</html>")).toBe("transient");
    expect(classifyRefreshFailure(400, "")).toBe("transient");
    expect(classifyRefreshFailure(400, "null")).toBe("transient");
    expect(classifyRefreshFailure(400, "[]")).toBe("transient");
    expect(classifyRefreshFailure(400, "42")).toBe("transient");
  });
});

describe("the fetch wrapper", () => {
  test("every request that is not a refresh passes through untouched, including its failures", async () => {
    const seen: string[] = [];
    const base = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return json(500, { error: "boom" });
    }) as typeof fetch;
    const durable = createDurableAuthFetch(base, { isOffline: () => true });
    const res = await durable(`${BASE}/user`);
    expect(res.status).toBe(500);
    expect(seen).toEqual([`${BASE}/user`]);
    const login = await durable(`${BASE}/token?grant_type=password`, { method: "POST" });
    expect(login.status).toBe(500); // sign-in errors must reach the login form as they are
  });

  test("offline: a refresh is not even attempted and throws a network-type error", async () => {
    let calls = 0;
    const events: unknown[] = [];
    const durable = createDurableAuthFetch((async () => { calls += 1; return json(200, {}); }) as typeof fetch, {
      isOffline: () => true,
      onTransientFailure: (i) => events.push(i),
    });
    await expect(durable(REFRESH_URL, { method: "POST" })).rejects.toBeInstanceOf(TypeError);
    expect(calls).toBe(0);
    expect(events).toEqual([{ status: null, reason: "offline" }]);
  });

  test("online and the network throws: the throw is passed on (auth-js reads it as retryable)", async () => {
    const failure = new TypeError("fetch failed");
    const durable = createDurableAuthFetch((async () => { throw failure; }) as typeof fetch);
    await expect(durable(REFRESH_URL, { method: "POST" })).rejects.toBe(failure);
  });

  test("any answer that is not 'revoked' becomes a thrown network error", async () => {
    for (const make of [() => json(500, { msg: "x" }), () => json(503, {}), () => html(502), () => json(429, { error_code: "over_request_rate_limit" }), () => json(408, {}), () => html(403), () => json(400, { error_code: "validation_failed" })]) {
      const durable = createDurableAuthFetch((async () => make()) as typeof fetch);
      await expect(durable(REFRESH_URL, { method: "POST" })).rejects.toBeInstanceOf(TypeError);
    }
  });

  test("a revoked answer is returned as it came, body still readable, so auth-js can end the session", async () => {
    const durable = createDurableAuthFetch((async () => json(400, { code: "refresh_token_not_found", message: "Invalid Refresh Token" })) as typeof fetch);
    const res = await durable(REFRESH_URL, { method: "POST" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "refresh_token_not_found", message: "Invalid Refresh Token" });
  });

  test("a good refresh is returned untouched", async () => {
    const durable = createDurableAuthFetch((async () => json(200, { access_token: "a" })) as typeof fetch);
    const res = await durable(REFRESH_URL, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: "a" });
  });
});

// ─── the real auth-js client ─────────────────────────────────────────────────────────────────────────

const b64url = (s: string) => Buffer.from(s).toString("base64url");
function expiredSession() {
  const exp = Math.floor(Date.now() / 1000) - 600; // the access token expired ten minutes ago
  const payload = { sub: "user-1", aud: "authenticated", role: "authenticated", exp };
  return {
    access_token: `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.sig`,
    refresh_token: "refresh-1",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: { id: "user-1", aud: "authenticated", email: "person@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  };
}

function memoryStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

/** Starts a real auth client over an expired stored session and lets it try to refresh through `answer`. */
async function recover(answer: () => Response | Promise<Response>, options: { offline?: boolean } = {}) {
  const storage = memoryStorage({ "sb-test-auth-token": JSON.stringify(expiredSession()) });
  let refreshCalls = 0;
  const base = (async () => {
    refreshCalls += 1;
    return answer();
  }) as unknown as typeof fetch;
  const client = new GoTrueClient({
    url: BASE,
    headers: {},
    storageKey: "sb-test-auth-token",
    storage,
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    fetch: createDurableAuthFetch(base, { isOffline: () => options.offline === true }),
  });
  const originalError = console.error;
  const originalWarn = console.warn;
  const realSetTimeout = globalThis.setTimeout;
  console.error = () => {};
  console.warn = () => {};
  // auth-js retries a retryable refresh failure with a doubling back-off (200 ms ... 25 s, about 30 s in all). The back-off is
  // not what is under test, so its waits are shortened; the number of attempts and every decision stay the real ones.
  globalThis.setTimeout = ((fn: () => void, _ms?: number, ...args: unknown[]) => realSetTimeout(fn, 0, ...args)) as typeof setTimeout;
  try {
    await client.initialize();
    const { data } = await client.getSession();
    return { stillStored: storage.data.has("sb-test-auth-token"), session: data.session, refreshCalls };
  } finally {
    globalThis.setTimeout = realSetTimeout;
    console.error = originalError;
    console.warn = originalWarn;
  }
}

describe("R9 with the real auth-js client: an expired access token and a refresh that fails", () => {
  test("OFFLINE: the session is kept and not even a request is sent", async () => {
    const result = await recover(() => json(200, {}), { offline: true });
    expect(result.stillStored).toBe(true);
    expect(result.refreshCalls).toBe(0);
  });

  test("the network throws: the session is kept", async () => {
    const result = await recover(() => { throw new TypeError("fetch failed"); });
    expect(result.stillStored).toBe(true);
  });

  test("OUR server or Supabase answers 5xx (including codes auth-js alone would treat as fatal): the session is kept", async () => {
    for (const status of [500, 502, 503, 504, 505, 511, 599]) {
      const result = await recover(() => json(status, { msg: "down" }));
      expect(`${status}: ${result.stillStored}`).toBe(`${status}: true`);
    }
  });

  test("a 429, a 408, an HTML page from a captive portal, an unrelated 400: the session is kept (auth-js alone would delete it)", async () => {
    for (const make of [() => json(429, { error_code: "over_request_rate_limit" }), () => json(408, {}), () => html(403), () => html(400), () => json(400, { error_code: "validation_failed" })]) {
      const result = await recover(make);
      expect(result.stillStored).toBe(true);
    }
  });

  test("ONLINE and the server answers that the refresh token is revoked: THAT ends the session", async () => {
    const result = await recover(() => json(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }));
    expect(result.stillStored).toBe(false);
    expect(result.session).toBeNull();
  });

  test("ONLINE, a 401 saying the session is gone also ends it", async () => {
    const result = await recover(() => json(401, { error_code: "session_not_found", message: "Session from session_id claim in JWT does not exist" }));
    expect(result.stillStored).toBe(false);
  });

  test("control: WITHOUT the wrapper auth-js deletes the session on a 429 (this is the hole the wrapper closes)", async () => {
    const storage = memoryStorage({ "sb-test-auth-token": JSON.stringify(expiredSession()) });
    const client = new GoTrueClient({
      url: BASE, headers: {}, storageKey: "sb-test-auth-token", storage, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false,
      fetch: (async () => json(429, { error_code: "over_request_rate_limit", msg: "slow down" })) as unknown as typeof fetch,
    });
    const originalError = console.error;
    console.error = () => {};
    try {
      await client.initialize();
      await client.getSession();
    } finally {
      console.error = originalError;
    }
    expect(storage.data.has("sb-test-auth-token")).toBe(false);
  });
});

describe("transient-error and session-cookie helpers", () => {
  test("isTransientAuthError: network-type errors yes, an auth rejection no", () => {
    expect(isTransientAuthError({ name: "AuthRetryableFetchError", message: "x" })).toBe(true);
    expect(isTransientAuthError(new TypeError("fetch failed"))).toBe(true);
    expect(isTransientAuthError(new Error("PROJEXA: this device is offline"))).toBe(true);
    expect(isTransientAuthError({ name: "AuthApiError", message: "Invalid Refresh Token: network" })).toBe(false);
    expect(isTransientAuthError({ name: "AuthSessionMissingError", message: "Auth session missing!" })).toBe(false);
    expect(isTransientAuthError(new Error("Invalid UTF-8 sequence"))).toBe(false);
    expect(isTransientAuthError(null)).toBe(false);
    expect(isTransientAuthError("fetch failed")).toBe(false);
  });

  test("hasSessionCookie sees the Supabase cookie, chunked or not, and nothing else", () => {
    expect(hasSessionCookie(["NEXT_LOCALE", "sb-abc-auth-token"])).toBe(true);
    expect(hasSessionCookie(["sb-abc-auth-token.0", "sb-abc-auth-token.1"])).toBe(true);
    expect(hasSessionCookie(["NEXT_LOCALE", "sb-abc-auth-token-code-verifier", "other"])).toBe(false);
    expect(hasSessionCookie([])).toBe(false);
  });
});
