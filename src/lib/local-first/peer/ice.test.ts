// AUDIT-100 B22: the ICE-server source. Run: bun test --isolate src/lib/local-first/peer/ice.test.ts
import { describe, expect, test } from "bun:test";
import { createIceSource, parseIceAnswer, sanitizeIceServers } from "./ice";
import { DEFAULT_ICE_SERVERS } from "./transport";

const TURN = { urls: ["turn:turn.example.test:3478?transport=udp", "turns:turn.example.test:5349"], username: "u1", credential: "c1" };

function fakeFetch(answers: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    const a = answers.shift() ?? { status: 500 };
    if (a instanceof Error) throw a;
    return new Response(JSON.stringify(a.body ?? null), { status: a.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("sanitizeIceServers", () => {
  test("keeps stun/turn/turns with credentials, drops everything else", () => {
    expect(sanitizeIceServers([TURN, { urls: "stun:stun.example.test:3478" }])).toEqual([TURN, { urls: ["stun:stun.example.test:3478"] }]);
    expect(sanitizeIceServers([{ urls: "https://evil.test" }, { urls: "javascript:alert(1)" }, null, 5, "turn:x"])).toEqual([]);
    // a relay without its credential cannot be used: dropped rather than offered
    expect(sanitizeIceServers([{ urls: "turn:turn.example.test:3478" }])).toEqual([]);
    expect(sanitizeIceServers([{ urls: "turn:t:1", username: 1, credential: "x" }])).toEqual([]);
    // a single object (Cloudflare's older shape) is read as a list of one
    expect(sanitizeIceServers(TURN)).toEqual([TURN]);
    expect(sanitizeIceServers(Array.from({ length: 20 }, () => TURN))).toHaveLength(8);
  });
  test("reads Cloudflare / our service ({iceServers, ttl}) and metered.ca (bare array) answers", () => {
    expect(parseIceAnswer({ iceServers: [TURN], ttl: 600 })).toEqual({ servers: [TURN], ttlS: 600 });
    expect(parseIceAnswer({ iceServers: TURN })).toEqual({ servers: [TURN], ttlS: 3600 });
    expect(parseIceAnswer([TURN])).toEqual({ servers: [TURN], ttlS: 3600 });
    expect(parseIceAnswer({ ice_servers: [TURN], ttl: 999_999 }).ttlS).toBe(86_400);
    expect(parseIceAnswer("nope")).toEqual({ servers: [], ttlS: 3600 });
  });
});

describe("createIceSource", () => {
  test("no endpoint configured: STUN only and not one request (today's behaviour)", async () => {
    const f = fakeFetch([]);
    const s = createIceSource({ url: "", token: async () => "tok", fetchImpl: f.impl });
    await s.refresh();
    expect(s.peek()).toEqual(DEFAULT_ICE_SERVERS);
    expect(s.hasRelay()).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("configured: fetches short-lived relay credentials with the person's own token, adds them to STUN, refreshes before expiry", async () => {
    let t = 1_000_000;
    const f = fakeFetch([{ status: 200, body: { iceServers: [TURN], ttl: 600 } }, { status: 200, body: { iceServers: [{ ...TURN, credential: "c2" }], ttl: 600 } }]);
    const s = createIceSource({ url: "https://sync.example.test/ice", token: async () => "person-token", fetchImpl: f.impl, now: () => t });
    await s.refresh();
    expect(f.calls).toEqual([{ url: "https://sync.example.test/ice", auth: "Bearer person-token" }]);
    expect(s.peek()).toEqual([...DEFAULT_ICE_SERVERS, TURN]);
    await s.refresh(); // still fresh: no second request
    expect(f.calls).toHaveLength(1);
    t += 6 * 60_000; // inside the last five minutes: refreshed
    await s.refresh();
    expect(f.calls).toHaveLength(2);
    expect(s.peek().at(-1)).toMatchObject({ credential: "c2" });
    t += 11 * 60_000; // expired and nothing new: back to STUN only
    expect(s.peek()).toEqual(DEFAULT_ICE_SERVERS);
  });

  test("failure, a bad answer, signed out or offline: STUN only, never throws, and backs off", async () => {
    let t = 0;
    const f = fakeFetch([new Error("dial tcp"), { status: 200, body: { iceServers: [{ urls: "https://x" }] } }, { status: 403 }]);
    const s = createIceSource({ url: "https://x.test/ice", token: async () => "tok", fetchImpl: f.impl, now: () => t });
    await s.refresh();
    expect(s.peek()).toEqual(DEFAULT_ICE_SERVERS);
    await s.refresh(); // backing off: no request
    expect(f.calls).toHaveLength(1);
    t += 5 * 60_000 + 1;
    await s.refresh(); // a bad answer is not used
    expect(s.hasRelay()).toBe(false);
    t += 5 * 60_000 + 1;
    await s.refresh();
    expect(f.calls).toHaveLength(3);
    expect(s.peek()).toEqual(DEFAULT_ICE_SERVERS);

    const g = fakeFetch([{ status: 200, body: [TURN] }]);
    const signedOut = createIceSource({ url: "https://x.test/ice", token: async () => null, fetchImpl: g.impl });
    await signedOut.refresh();
    const offline = createIceSource({ url: "https://x.test/ice", token: async () => "tok", fetchImpl: g.impl, isOnline: () => false });
    await offline.refresh();
    expect(g.calls).toEqual([]);
  });
});
