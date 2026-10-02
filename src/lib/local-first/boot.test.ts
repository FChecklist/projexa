import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { LOCAL_FIRST_FLAG } from "./mode";
import { runBootPass, startBoot, type BootWiring } from "./boot";
import { createIdentityStore, type AuthLike, type DurableIdentity } from "./identity";
import { META_KEYS, releaseCacheName } from "./release/release-constants";
import type { SwClient, SwReply } from "./release/sw-client";
import type { SyncManifest } from "./sync-client";
import { shellManifestKey } from "./shell/manifest-cache";
import { FakeCacheStorage, FakeMeta, builtRelease, fakeOrigin, fixtureFiles } from "./release/__fixtures__/fakes";

const NOW = 1_760_000_000_000;
const V1 = "2026.10.02-001";

class FakeSw implements SwClient {
  pointer: { version: string; personId: string | null; localFirst: boolean } | null = null;
  calls: string[] = [];
  constructor(private caches: FakeCacheStorage) {}
  async useRelease(version: string, personId?: string | null, localFirst?: boolean): Promise<SwReply | null> {
    this.calls.push(`use:${version}`);
    if (!(await this.caches.has(releaseCacheName(version)))) return { ok: false };
    this.pointer = { version, personId: personId ?? null, localFirst: localFirst ?? false };
    return { ok: true };
  }
  async setMode(localFirst: boolean): Promise<SwReply | null> { this.calls.push(`mode:${localFirst}`); if (this.pointer) this.pointer.localFirst = localFirst; return { ok: true }; }
  async setPerson(personId: string): Promise<SwReply | null> { this.calls.push(`person:${personId}`); return { ok: true }; }
  async clearPerson(): Promise<SwReply | null> { return { ok: true }; }
  async status(): Promise<SwReply | null> { this.calls.push("status"); return { ok: true, version: this.pointer?.version ?? null, personId: this.pointer?.personId ?? null, localFirst: this.pointer?.localFirst ?? false }; }
}

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

const identity: DurableIdentity = {
  userId: "person-1", email: "asha@example.com", name: null, orgId: null, role: null, lastRefreshAt: NOW, signedInAt: NOW,
  session: { access_token: "access", refresh_token: "refresh", expires_at: 1 },
};

function harness(over: { signedIn?: boolean; online?: boolean; development?: boolean; hasSession?: boolean } = {}) {
  const caches = new FakeCacheStorage();
  const deviceMeta = new FakeMeta();
  const identityStore = createIdentityStore({ storage: new MemoryStorage(), openMeta: async () => ({ meta: deviceMeta, close: () => {} }) });
  const origin = fakeOrigin(builtRelease(V1, fixtureFiles(4)));
  const sw = new FakeSw(caches);
  const state = { online: over.online ?? true, flag: false, now: NOW };
  const calls = { persist: 0, manifest: 0, redownload: 0, setSession: 0, getSession: 0 };
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const auth: AuthLike = {
    getSession: async () => { calls.getSession += 1; return { data: { session: over.hasSession ? ({ access_token: "a", refresh_token: "r", user: { id: "person-1" } } as never) : null } }; },
    setSession: async () => { calls.setSession += 1; return { error: null }; },
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  };
  const manifest: SyncManifest = { user: { id: "person-1", name: "Asha Rao", role: "pm", org_id: "org-1" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }], kinds: [] };
  const wiring: BootWiring = {
    isDevelopment: over.development ?? false,
    isOnline: () => state.online,
    auth,
    identityStore,
    deviceMeta,
    caches,
    storage: { persisted: async () => false, persist: async () => { calls.persist += 1; return true; } },
    sw,
    ensureServiceWorker: async () => true,
    localFirstOn: () => state.flag,
    syncClient: () => ({ manifest: async () => { calls.manifest += 1; return manifest; } }),
    releaseClient: () => ({ current: async () => null, register: async () => true, ensureRegistered: async () => null, recordInstall: async () => true }),
    workspace: () => ({
      isOnline: () => state.online,
      wasPrepared: () => true,
      hasData: async () => false,
      redownload: async () => { calls.redownload += 1; return { status: "done" }; },
      budgetMs: 1000,
    }),
    fetchImpl: origin.fetch,
    gunzip: async (b) => new Uint8Array(gunzipSync(b)),
    listen: (type, fn) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
      return () => set.delete(fn);
    },
    now: () => state.now,
  };
  const emit = (type: string, event: unknown = {}) => { for (const fn of listeners.get(type) ?? []) fn(event); };
  return {
    wiring, state, calls, origin, sw, caches, deviceMeta, identityStore, emit, listeners,
    signIn: async () => { if (over.signedIn !== false) await identityStore.write(identity); },
  };
}

describe("a boot pass", () => {
  test("nobody signed in: nothing is asked of the browser and nothing is fetched (a marketing visitor costs nothing)", async () => {
    const h = harness({ signedIn: false });
    await h.signIn();
    expect(await runBootPass(h.wiring)).toEqual({ personId: null });
    expect(h.calls).toEqual({ persist: 0, manifest: 0, redownload: 0, setSession: 0, getSession: 0 });
    expect(h.origin.requests).toEqual([]);
    expect(h.sw.calls).toEqual([]);
  });

  test("signed in and online: persistence asked, the release installed for this person, the project names and role cached, the data checked", async () => {
    const h = harness();
    await h.signIn();
    expect(await runBootPass(h.wiring)).toEqual({ personId: "person-1" });
    expect(h.calls.persist).toBe(1);
    expect(h.sw.pointer).toEqual({ version: V1, personId: "person-1", localFirst: false });
    expect(await h.caches.has(releaseCacheName(V1))).toBe(true);
    expect(h.calls.manifest).toBe(1);
    expect(h.deviceMeta.data.get(shellManifestKey("person-1"))).toMatchObject({ projects: [{ id: "p1", name: "Cedar Heights Villa" }] });
    expect(await h.identityStore.read()).toMatchObject({ orgId: "org-1", role: "pm", name: "Asha Rao" });
    expect(h.calls.redownload).toBe(1); // prepared before, no data in IndexedDB: the existing workspace download runs again
  });

  test("signed in and OFFLINE: no network request of any kind, but the worker's pointer is still repaired", async () => {
    const h = harness();
    await h.signIn();
    await runBootPass(h.wiring); // installed while online
    h.sw.pointer = null; // the worker lost its record
    h.state.online = false;
    h.origin.requests.length = 0;
    h.calls.manifest = 0;
    h.calls.redownload = 0;
    expect(await runBootPass(h.wiring)).toEqual({ personId: "person-1" });
    expect(h.origin.requests).toEqual([]);
    expect(h.calls.manifest).toBe(0);
    expect(h.calls.redownload).toBe(0);
    expect(h.sw.pointer?.version).toBe(V1);
  });

  test("a development server installs no release and registers no worker, but the person is still known", async () => {
    const h = harness({ development: true });
    await h.signIn();
    await runBootPass(h.wiring);
    expect(h.sw.calls).toEqual([]);
    expect(h.origin.requests).toEqual([]);
    expect(await h.caches.keys()).toEqual([]);
  });
});

describe("startBoot", () => {
  test("a lost session is rebuilt from the mirror before anything else; then the pass runs", async () => {
    const h = harness({ hasSession: false });
    await h.signIn();
    const handle = startBoot(h.wiring);
    await handle.settled();
    expect(h.calls.setSession).toBe(1);
    expect(h.sw.pointer?.version).toBe(V1);
    handle.stop();
  });

  test("coming back online runs another pass, but never more than once a minute", async () => {
    const h = harness();
    await h.signIn();
    const handle = startBoot(h.wiring);
    await handle.settled();
    const before = h.calls.getSession;
    h.emit("online"); // a second after the first pass: throttled
    await handle.settled();
    expect(h.calls.getSession).toBe(before);
    h.state.now += 61_000;
    h.emit("online");
    await handle.settled();
    expect(h.calls.getSession).toBeGreaterThan(before);
    handle.stop();
  });

  test("another tab flipping local-first mode reaches the worker; other storage keys are ignored", async () => {
    const h = harness();
    await h.signIn();
    const handle = startBoot(h.wiring);
    await handle.settled();
    h.sw.calls.length = 0;
    h.state.flag = true;
    h.emit("storage", { key: "something-else" });
    h.emit("storage", { key: LOCAL_FIRST_FLAG });
    await Promise.resolve();
    expect(h.sw.calls).toEqual(["mode:true"]);
    handle.stop();
  });

  test("stop() detaches every listener", async () => {
    const h = harness();
    await h.signIn();
    const handle = startBoot(h.wiring);
    await handle.settled();
    handle.stop();
    expect([...h.listeners.values()].every((set) => set.size === 0)).toBe(true);
  });
});
