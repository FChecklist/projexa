import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { runBootPass, type BootWiring } from "../boot";
import { createIdentityStore, type AuthLike } from "../identity";
import { createSyncClient } from "../sync-client";
import { getReleaseVersion } from "../shared-client";
import { releaseCacheName } from "./release-constants";
import type { SwClient, SwReply } from "./sw-client";
import { FakeCacheStorage, FakeMeta, builtRelease, fakeOrigin, fixtureFiles } from "./__fixtures__/fakes";
import { RUNNING_RELEASE_KEY, clientRelease, rememberRunningRelease, runningRelease } from "./running-release";

// lf-e12 (found in a real browser, e2e/lf-lifecycle-release.spec.ts): every sync call must name the release this laptop INSTALLED in
// X-Px-Client, or the service's release floor (compliance-tracker handler.ts updateRequired: it only reads a YYYY.MM.DD-NNN release)
// can never hold an old laptop back. Before the fix the header said the build's commit sha, or "dev".

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

describe("the release a laptop names", () => {
  test("only a real release number is remembered and returned", () => {
    const s = new MemoryStorage();
    expect(runningRelease(s)).toBeNull();
    rememberRunningRelease("2026.10.02-007", s);
    expect(runningRelease(s)).toBe("2026.10.02-007");
    rememberRunningRelease("abc123", s); // not a release: ignored, the remembered one stays
    expect(runningRelease(s)).toBe("2026.10.02-007");
    s.setItem(RUNNING_RELEASE_KEY, "garbage");
    expect(runningRelease(s)).toBeNull();
    rememberRunningRelease(null, s);
    expect(s.data.has(RUNNING_RELEASE_KEY)).toBe(false);
  });

  test("the header names the installed release; without one, the build's name; without that, dev", () => {
    const s = new MemoryStorage();
    expect(clientRelease({ storage: s, buildName: "f3a9c1d" })).toBe("f3a9c1d");
    expect(clientRelease({ storage: s })).toBe("dev");
    rememberRunningRelease("2026.10.02-002", s);
    expect(clientRelease({ storage: s, buildName: "f3a9c1d" })).toBe("2026.10.02-002");
    expect(clientRelease({ storage: null, buildName: null })).toBe("dev");
  });

  test("the shared sync client's getReleaseVersion is the installed release (the browser's localStorage)", () => {
    const s = new MemoryStorage();
    const g = globalThis as unknown as { localStorage?: unknown };
    const before = g.localStorage;
    g.localStorage = s;
    try {
      rememberRunningRelease("2026.10.02-004");
      expect(getReleaseVersion()).toBe("2026.10.02-004");
    } finally {
      g.localStorage = before;
    }
  });

  test("a sync call sends it in X-Px-Client", async () => {
    const s = new MemoryStorage();
    rememberRunningRelease("2026.10.02-005", s);
    let header: string | null = null;
    const client = createSyncClient({
      getAccessToken: async () => "t", baseUrl: "https://sync.invalid", maxRetries: 0, getReleaseVersion: () => clientRelease({ storage: s }),
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        header = new Headers(init?.headers).get("X-Px-Client");
        return new Response(JSON.stringify({ heads: {}, epoch: "e", server_time: new Date().toISOString() }), { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });
    await client.heads!().catch(() => null);
    expect(header).toMatch(/^2026\.10\.02-005; protocol=2; schema=\d+$/);
  });
});

describe("the boot remembers the release it installed", () => {
  test("after a pass that installs release V, rememberRelease is told V (and again on the next, offline, pass)", async () => {
    const V = "2026.10.02-009";
    const caches = new FakeCacheStorage();
    const meta = new FakeMeta();
    const storage = new MemoryStorage();
    await createIdentityStore({ storage, openMeta: async () => ({ meta, close: () => {} }) }).write({
      userId: "person-1", email: "a@example.invalid", name: null, orgId: null, role: null, lastRefreshAt: 1, signedInAt: 1,
      session: { access_token: "a", refresh_token: "r", expires_at: 1 },
    });
    const origin = fakeOrigin(builtRelease(V, fixtureFiles(3)));
    const sw: SwClient = {
      useRelease: async (version: string) => ({ ok: await caches.has(releaseCacheName(version)) }) as SwReply,
      setMode: async () => ({ ok: true }), setPerson: async () => ({ ok: true }), clearPerson: async () => ({ ok: true }),
      status: async () => ({ ok: true, version: V, personId: "person-1", localFirst: false }),
    };
    const auth: AuthLike = {
      getSession: async () => ({ data: { session: null } }), setSession: async () => ({ error: null }), signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    };
    const told: Array<string | null> = [];
    const state = { online: true };
    const wiring: BootWiring = {
      isDevelopment: false, isOnline: () => state.online, auth, identityStore: createIdentityStore({ storage, openMeta: async () => ({ meta, close: () => {} }) }),
      deviceMeta: meta, caches, storage: undefined, sw, ensureServiceWorker: async () => true, localFirstOn: () => false,
      syncClient: () => ({ manifest: async () => { throw new Error("offline"); } }),
      releaseClient: () => ({ current: async () => null, register: async () => true, ensureRegistered: async () => null, recordInstall: async () => true }),
      workspace: () => ({ isOnline: () => state.online, wasPrepared: () => false, hasData: async () => true, redownload: async () => ({ status: "done" }) }),
      fetchImpl: origin.fetch, gunzip: async (b) => new Uint8Array(gunzipSync(b)), listen: () => () => {},
      rememberRelease: (v) => told.push(v),
    };
    await runBootPass(wiring);
    expect(told).toEqual([V]);
    state.online = false;
    await runBootPass(wiring);
    expect(told).toEqual([V, V]);
  });
});
