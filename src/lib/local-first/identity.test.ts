import { afterEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { GoTrueClient } from "@supabase/auth-js";
import { createDurableAuthFetch } from "@/lib/supabase/durable-auth";
import { deviceMetaStore } from "./device-meta";
import {
  IDENTITY_STORAGE_KEY,
  clearSupabaseBrowserSession,
  createIdentityStore,
  getDurableIdentity,
  identityFromSession,
  isDeliberateSignOut,
  mirrorSession,
  resetDeliberateSignOutForTests,
  restoreSessionIfMissing,
  signOutDeliberately,
  startIdentityMirror,
  updateIdentityProfile,
  type AuthLike,
  type DurableIdentity,
  type IdentityStore,
  type SessionLike,
} from "./identity";
import { META_KEYS } from "./release/release-constants";
import { FakeMeta } from "./release/__fixtures__/fakes";

afterEach(() => resetDeliberateSignOutForTests());

const NOW = 1_760_000_000_000;

const session = (over: Partial<SessionLike> & { id?: string } = {}): SessionLike => ({
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_at: 1_760_003_600,
  user: { id: over.id ?? "user-1", email: "person@example.com", user_metadata: { full_name: "Asha Rao" } },
  ...over,
});

class FakeStorage {
  data = new Map<string, string>();
  broken = false;
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { if (this.broken) throw new Error("blocked"); return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.broken) throw new Error("blocked"); this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

function stores(opts: { storage?: FakeStorage | null; meta?: FakeMeta | null } = {}) {
  const storage = opts.storage === undefined ? new FakeStorage() : opts.storage;
  const meta = opts.meta === undefined ? new FakeMeta() : opts.meta;
  const store = createIdentityStore({ storage, openMeta: meta ? async () => ({ meta, close: () => {} }) : undefined });
  return { store, storage, meta };
}

const id = (over: Partial<DurableIdentity> = {}): DurableIdentity => ({
  userId: "user-1", email: "person@example.com", name: "Asha Rao", orgId: "org-1", role: "site_engineer",
  lastRefreshAt: NOW, signedInAt: NOW - 1000, session: { access_token: "a", refresh_token: "r", expires_at: 1 }, ...over,
});

describe("the identity is mirrored in two places and either can rebuild the other", () => {
  test("write puts it in localStorage AND the local database meta; read returns it", async () => {
    const { store, storage, meta } = stores();
    await store.write(id());
    expect(JSON.parse(storage!.data.get(IDENTITY_STORAGE_KEY)!)).toMatchObject({ userId: "user-1", orgId: "org-1" });
    expect(meta!.data.get(META_KEYS.identity)).toMatchObject({ userId: "user-1", role: "site_engineer", lastRefreshAt: NOW });
    expect(await store.read()).toEqual(id());
  });

  test("the NEWER copy wins and the older or missing one is healed from it", async () => {
    const { store, storage, meta } = stores();
    storage!.data.set(IDENTITY_STORAGE_KEY, JSON.stringify(id({ lastRefreshAt: NOW, role: "old" })));
    meta!.data.set(META_KEYS.identity, id({ lastRefreshAt: NOW + 5000, role: "new" }));
    expect((await store.read())!.role).toBe("new");
    expect(JSON.parse(storage!.data.get(IDENTITY_STORAGE_KEY)!).role).toBe("new");
  });

  test("a lost localStorage copy is rebuilt from the database, and a lost database copy from localStorage", async () => {
    const a = stores();
    a.meta!.data.set(META_KEYS.identity, id());
    expect((await a.store.read())!.userId).toBe("user-1");
    expect(a.storage!.data.has(IDENTITY_STORAGE_KEY)).toBe(true);
    const b = stores();
    b.storage!.data.set(IDENTITY_STORAGE_KEY, JSON.stringify(id()));
    expect((await b.store.read())!.userId).toBe("user-1");
    expect(b.meta!.data.get(META_KEYS.identity)).toMatchObject({ userId: "user-1" });
  });

  test("blocked localStorage, unavailable database, corrupt JSON: whatever is left is used; nothing throws on read", async () => {
    const blocked = stores();
    blocked.meta!.data.set(META_KEYS.identity, id());
    blocked.storage!.broken = true;
    expect((await blocked.store.read())!.userId).toBe("user-1");
    const noDb = stores({ meta: null });
    noDb.storage!.data.set(IDENTITY_STORAGE_KEY, JSON.stringify(id()));
    expect((await noDb.store.read())!.userId).toBe("user-1");
    const corrupt = stores();
    corrupt.storage!.data.set(IDENTITY_STORAGE_KEY, "{not json");
    corrupt.meta!.data.set(META_KEYS.identity, { userId: "" });
    expect(await corrupt.store.read()).toBeNull();
  });

  test("write succeeds if EITHER copy was kept, and fails loudly only when neither could be", async () => {
    const half = stores();
    half.storage!.broken = true;
    await half.store.write(id());
    expect(half.meta!.data.get(META_KEYS.identity)).toBeDefined();
    const none = stores({ meta: null });
    none.storage!.broken = true;
    await expect(none.store.write(id())).rejects.toThrow(/could not be kept/);
  });

  test("clear removes both copies", async () => {
    const { store, storage, meta } = stores();
    await store.write(id());
    await store.clear();
    expect(storage!.data.has(IDENTITY_STORAGE_KEY)).toBe(false);
    expect(meta!.data.get(META_KEYS.identity)).toBeNull();
    expect(await store.read()).toBeNull();
  });

  test("the real device database (IndexedDB) keeps it across a close and reopen", async () => {
    const idb = new IDBFactory();
    const a = createIdentityStore({ storage: null, openMeta: async () => { const { openDeviceMeta } = await import("./device-meta"); return openDeviceMeta(idb); } });
    await a.write(id());
    const b = createIdentityStore({ storage: null, openMeta: async () => { const { openDeviceMeta } = await import("./device-meta"); return openDeviceMeta(idb); } });
    expect((await b.read())!.email).toBe("person@example.com");
    expect(await deviceMetaStore(idb).getMeta(META_KEYS.identity)).toMatchObject({ userId: "user-1" });
  });
});

describe("building the identity from a session", () => {
  test("keeps the organisation and role the app learned for the SAME person; never carries them to another", () => {
    const first = identityFromSession(session(), null, NOW);
    expect(first).toMatchObject({ userId: "user-1", email: "person@example.com", name: "Asha Rao", orgId: null, role: null, lastRefreshAt: NOW, signedInAt: NOW });
    const learned = { ...first, orgId: "org-1", role: "pm" };
    const refreshed = identityFromSession(session({ access_token: "access-2" }), learned, NOW + 3600_000);
    expect(refreshed).toMatchObject({ orgId: "org-1", role: "pm", lastRefreshAt: NOW + 3600_000, signedInAt: NOW });
    expect(refreshed.session!.access_token).toBe("access-2");
    const other = identityFromSession(session({ id: "user-2" }), learned, NOW);
    expect(other).toMatchObject({ userId: "user-2", orgId: null, role: null });
  });

  test("mirrorSession stores it; updateIdentityProfile adds what is learned later, ignoring empty values", async () => {
    const { store } = stores();
    await mirrorSession(store, session(), () => NOW);
    await updateIdentityProfile(store, { orgId: "org-9", role: "owner", name: "" });
    expect(await store.read()).toMatchObject({ userId: "user-1", orgId: "org-9", role: "owner", name: "Asha Rao" });
    expect(await updateIdentityProfile(stores().store, { orgId: "x" })).toBeNull(); // nobody to update
  });

  test("mirrorSession never throws, even when storage is gone", async () => {
    const none = stores({ meta: null });
    none.storage!.broken = true;
    expect(await mirrorSession(none.store, session())).toBeNull();
  });
});

// ─── R9 acceptance: offline / 5xx never signs out ──────────────────────────────────────────────────

function fakeAuth(over: Partial<AuthLike> = {}): AuthLike & { calls: string[] } {
  const calls: string[] = [];
  const auth: AuthLike = {
    getSession: async () => { calls.push("getSession"); return { data: { session: null } }; },
    setSession: async () => { calls.push("setSession"); return { error: null }; },
    signOut: async () => { calls.push("signOut"); return { error: null }; },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    ...over,
  };
  return Object.assign(auth, { calls });
}

describe("R9: the app opens offline from the cached identity, without calling Supabase", () => {
  test("getDurableIdentity is storage only: an auth client that throws on every call is never touched", async () => {
    const { store } = stores();
    await store.write(id());
    const auth = fakeAuth({
      getSession: async () => { throw new Error("must not be called"); },
      setSession: async () => { throw new Error("must not be called"); },
      signOut: async () => { throw new Error("must not be called"); },
    });
    const identity = await getDurableIdentity(store);
    expect(identity).toMatchObject({ userId: "user-1", orgId: "org-1", role: "site_engineer" });
    expect(auth.calls).toEqual([]);
  });

  test("a store that throws is 'nobody known', not an exception", async () => {
    const broken: IdentityStore = { read: async () => { throw new Error("boom"); }, write: async () => {}, clear: async () => {} };
    expect(await getDurableIdentity(broken)).toBeNull();
  });
});

describe("R9: restoring a lost session from the mirror, and what ends the identity", () => {
  async function mirrored() {
    const s = stores();
    await s.store.write(id());
    return s;
  }

  test("a session that is there needs nothing", async () => {
    const { store } = await mirrored();
    const auth = fakeAuth({ getSession: async () => ({ data: { session: session() } }) });
    expect(await restoreSessionIfMissing(auth, store, { isOffline: () => false })).toBe("present");
    expect(auth.calls).toEqual([]);
  });

  test("no session and no mirror: nothing to restore", async () => {
    const auth = fakeAuth();
    expect(await restoreSessionIfMissing(auth, stores().store, { isOffline: () => false })).toBe("none");
  });

  test("OFFLINE: the mirror is kept and not a single auth request is made", async () => {
    const { store } = await mirrored();
    const auth = fakeAuth();
    expect(await restoreSessionIfMissing(auth, store, { isOffline: () => true })).toBe("kept_offline");
    expect(auth.calls).toEqual(["getSession"]);
    expect(await store.read()).not.toBeNull();
  });

  test("ONLINE and the session is rebuilt", async () => {
    const { store } = await mirrored();
    const auth = fakeAuth();
    expect(await restoreSessionIfMissing(auth, store, { isOffline: () => false })).toBe("restored");
    expect(auth.calls).toEqual(["getSession", "setSession"]);
  });

  test("a server or network failure keeps the mirror (retryable errors, a thrown fetch, our own wrapper's error)", async () => {
    for (const failure of [{ name: "AuthRetryableFetchError", message: "x", status: 503 }, new TypeError("fetch failed"), new Error("PROJEXA: the sign-in service answered 503")]) {
      const { store } = await mirrored();
      const viaReturn = fakeAuth({ setSession: async () => ({ error: failure }) });
      expect(await restoreSessionIfMissing(viaReturn, store, { isOffline: () => false })).toBe("kept_transient");
      const viaThrow = fakeAuth({ setSession: async () => { throw failure; } });
      expect(await restoreSessionIfMissing(viaThrow, store, { isOffline: () => false })).toBe("kept_transient");
      expect(await store.read()).not.toBeNull();
    }
  });

  test("ONLINE and the server says the refresh token is revoked (4xx): THAT ends the identity", async () => {
    const { store, storage, meta } = await mirrored();
    const auth = fakeAuth({ setSession: async () => ({ error: { name: "AuthApiError", message: "Invalid Refresh Token: Refresh Token Not Found", status: 400 } }) });
    expect(await restoreSessionIfMissing(auth, store, { isOffline: () => false })).toBe("revoked");
    expect(await store.read()).toBeNull();
    expect(storage!.data.has(IDENTITY_STORAGE_KEY)).toBe(false);
    expect(meta!.data.get(META_KEYS.identity)).toBeNull();
  });
});

// The real auth-js client, the real durable fetch and the real mirror, end to end.
const b64url = (s: string) => Buffer.from(s).toString("base64url");
const fakeJwt = (exp: number) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify({ sub: "user-1", aud: "authenticated", role: "authenticated", exp }))}.sig`;

async function realRestore(answer: () => Response | Promise<Response>, mirrorIdentity = true) {
  const { store } = stores();
  if (mirrorIdentity) await store.write(id({ session: { access_token: fakeJwt(Math.floor(Date.now() / 1000) - 600), refresh_token: "refresh-1", expires_at: Math.floor(Date.now() / 1000) - 600 } }));
  const memory = new Map<string, string>();
  const client = new GoTrueClient({
    url: "https://example-project.supabase.co/auth/v1", headers: {}, storageKey: "sb-test-auth-token", autoRefreshToken: false, persistSession: true, detectSessionInUrl: false,
    storage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) },
    fetch: createDurableAuthFetch((async () => answer()) as unknown as typeof fetch, { isOffline: () => false }),
  });
  const realSetTimeout = globalThis.setTimeout;
  const quiet = [console.error, console.warn] as const;
  console.error = () => {};
  console.warn = () => {};
  globalThis.setTimeout = ((fn: () => void, _ms?: number, ...a: unknown[]) => realSetTimeout(fn, 0, ...a)) as typeof setTimeout;
  try {
    const outcome = await restoreSessionIfMissing(client as unknown as AuthLike, store, { isOffline: () => false });
    return { outcome, identity: await store.read() };
  } finally {
    globalThis.setTimeout = realSetTimeout;
    [console.error, console.warn] = quiet as unknown as [typeof console.error, typeof console.warn];
  }
}

describe("R9 end to end with the real auth-js client and the durable fetch", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  test("a 5xx / 429 / HTML answer while ONLINE never signs the person out: the identity stays", async () => {
    for (const make of [() => json(500, {}), () => json(503, {}), () => json(429, { error_code: "over_request_rate_limit" }), () => new Response("<html>gateway</html>", { status: 502 })]) {
      const { outcome, identity } = await realRestore(make);
      expect(outcome).toBe("kept_transient");
      expect(identity).not.toBeNull();
    }
  });

  test("the network throwing never signs the person out", async () => {
    const { outcome, identity } = await realRestore(() => { throw new TypeError("fetch failed"); });
    expect(outcome).toBe("kept_transient");
    expect(identity?.userId).toBe("user-1");
  });

  test("a 400/401 saying the refresh token is revoked, while ONLINE, DOES end the identity", async () => {
    const revoked = await realRestore(() => json(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }));
    expect(revoked.outcome).toBe("revoked");
    expect(revoked.identity).toBeNull();
    const gone = await realRestore(() => json(401, { error_code: "session_not_found", message: "Session from session_id claim in JWT does not exist" }));
    expect(gone.outcome).toBe("revoked");
    expect(gone.identity).toBeNull();
  });

  test("a good answer rebuilds the session", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const { outcome } = await realRestore(() => json(200, { access_token: fakeJwt(exp), token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "refresh-2", user: { id: "user-1", aud: "authenticated", email: "person@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } }));
    expect(outcome).toBe("restored");
  });
});

// ─── following the Supabase session ──────────────────────────────────────────────────────────────

function eventedAuth() {
  let callback: (event: string, session: SessionLike | null) => void = () => {};
  const auth = fakeAuth({
    onAuthStateChange: (cb) => { callback = cb; return { data: { subscription: { unsubscribe: () => { callback = () => {}; } } } }; },
  });
  return { auth, emit: (event: string, s: SessionLike | null) => callback(event, s) };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

describe("startIdentityMirror", () => {
  test("a sign-in, then each refreshed token, updates the mirror", async () => {
    const { store } = stores();
    const { auth, emit } = eventedAuth();
    let clock = NOW;
    startIdentityMirror(auth, store, { isOffline: () => false, now: () => clock });
    emit("SIGNED_IN", session());
    await tick();
    clock = NOW + 3600_000;
    emit("TOKEN_REFRESHED", session({ access_token: "access-2", refresh_token: "refresh-2" }));
    await tick();
    expect(await store.read()).toMatchObject({ userId: "user-1", lastRefreshAt: NOW + 3600_000, signedInAt: NOW, session: { access_token: "access-2", refresh_token: "refresh-2" } });
  });

  test("an UNEXPECTED sign-out event is not believed: the session is rebuilt from the mirror, and a transient failure keeps the mirror", async () => {
    const { store } = stores();
    await store.write(id());
    const { auth, emit } = eventedAuth();
    const outcomes: string[] = [];
    auth.setSession = async () => ({ error: new TypeError("fetch failed") });
    startIdentityMirror(auth, store, { isOffline: () => false, onRestoreOutcome: (o) => outcomes.push(o) });
    emit("SIGNED_OUT", null);
    await tick();
    expect(outcomes).toEqual(["kept_transient"]);
    expect(await store.read()).not.toBeNull();
  });

  test("a sign-out the person did on purpose is NOT second-guessed", async () => {
    const { store } = stores();
    await store.write(id());
    const { auth, emit } = eventedAuth();
    const setCalls: string[] = [];
    auth.setSession = async () => { setCalls.push("setSession"); return { error: null }; };
    startIdentityMirror(auth, store, { isOffline: () => false });
    await signOutDeliberately({ auth, store, sw: { clearPerson: async () => null }, clearBrowserSession: () => {} });
    emit("SIGNED_OUT", null);
    await tick();
    expect(setCalls).toEqual([]);
    expect(await store.read()).toBeNull();
  });

  test("a new sign-in after a deliberate sign-out re-arms the guard", async () => {
    const { store } = stores();
    const { auth, emit } = eventedAuth();
    startIdentityMirror(auth, store, { isOffline: () => false });
    await signOutDeliberately({ auth, store, sw: { clearPerson: async () => null }, clearBrowserSession: () => {} });
    expect(isDeliberateSignOut()).toBe(true);
    emit("SIGNED_IN", session());
    await tick();
    expect(isDeliberateSignOut()).toBe(false);
  });

  test("the returned function stops listening", async () => {
    const { store } = stores();
    const { auth, emit } = eventedAuth();
    const stop = startIdentityMirror(auth, store, { isOffline: () => false });
    stop();
    emit("SIGNED_IN", session());
    await tick();
    expect(await store.read()).toBeNull();
  });
});

describe("signOutDeliberately: the ONLY way an identity ends", () => {
  test("clears the mirror first, tells the worker whose release to drop, then ends the Supabase session", async () => {
    const { store } = stores();
    await store.write(id());
    const order: string[] = [];
    const wrapped: IdentityStore = {
      read: () => store.read(),
      write: (i) => store.write(i),
      clear: async () => { order.push("clear-identity"); await store.clear(); },
    };
    const sw = { clearPerson: async (personId: string | null) => { order.push(`worker:${personId}`); return { ok: true }; } };
    const auth = fakeAuth({ signOut: async () => { order.push("supabase-signOut"); return { error: null }; } });
    const result = await signOutDeliberately({ auth, store: wrapped, sw });
    expect(order).toEqual(["clear-identity", "worker:user-1", "supabase-signOut"]);
    expect(result).toEqual({ serverTold: true });
    expect(await store.read()).toBeNull();
  });

  test("when the server cannot be reached (offline) the session is ended locally by hand, and the person is still signed out", async () => {
    const { store } = stores();
    await store.write(id());
    let cleared = 0;
    const auth = fakeAuth({ signOut: async () => ({ error: { name: "AuthRetryableFetchError", message: "offline" } }) });
    const result = await signOutDeliberately({ auth, store, sw: { clearPerson: async () => null }, clearBrowserSession: () => { cleared += 1; } });
    expect(result).toEqual({ serverTold: false });
    expect(cleared).toBe(1);
    expect(await store.read()).toBeNull();
    const thrown = fakeAuth({ signOut: async () => { throw new TypeError("fetch failed"); } });
    await store.write(id());
    expect(await signOutDeliberately({ auth: thrown, store, sw: { clearPerson: async () => null }, clearBrowserSession: () => { cleared += 1; } })).toEqual({ serverTold: false });
    expect(cleared).toBe(2);
  });

  test("never throws, even when the worker and the store both fail", async () => {
    const store: IdentityStore = { read: async () => { throw new Error("x"); }, write: async () => {}, clear: async () => { throw new Error("y"); } };
    const result = await signOutDeliberately({ auth: fakeAuth(), store, sw: { clearPerson: async () => { throw new Error("no worker"); } }, clearBrowserSession: () => {} });
    expect(result).toEqual({ serverTold: true });
  });

  test("clearSupabaseBrowserSession removes only the Supabase session cookies and storage entries", () => {
    const jar = new Map([["sb-abc-auth-token", "1"], ["sb-abc-auth-token.0", "2"], ["NEXT_LOCALE", "en"], ["other", "x"]]);
    const cookieWrites: string[] = [];
    const storage = new FakeStorage();
    storage.setItem("sb-abc-auth-token", "tok");
    storage.setItem("px-local-first", "1");
    storage.setItem(IDENTITY_STORAGE_KEY, "{}");
    clearSupabaseBrowserSession({
      cookie: { get: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "), set: (v) => cookieWrites.push(v) },
      storage,
    });
    expect(cookieWrites.map((w) => w.split("=")[0]).sort()).toEqual(["sb-abc-auth-token", "sb-abc-auth-token.0"]);
    expect(cookieWrites.every((w) => w.includes("Max-Age=0"))).toBe(true);
    expect([...storage.data.keys()].sort()).toEqual([IDENTITY_STORAGE_KEY, "px-local-first"].sort());
  });

  test("nothing else clears the identity: offline, transient failures and an unexpected sign-out event never call store.clear()", async () => {
    let clears = 0;
    const base = stores().store;
    await base.write(id());
    const spy: IdentityStore = { read: () => base.read(), write: (i) => base.write(i), clear: async () => { clears += 1; await base.clear(); } };
    const { auth, emit } = eventedAuth();
    auth.setSession = async () => ({ error: { name: "AuthRetryableFetchError", message: "503" } });
    startIdentityMirror(auth, spy, { isOffline: () => false });
    emit("SIGNED_OUT", null);
    await tick();
    await restoreSessionIfMissing(auth, spy, { isOffline: () => true });
    await restoreSessionIfMissing(auth, spy, { isOffline: () => false });
    expect(clears).toBe(0);
    expect(await base.read()).not.toBeNull();
  });
});
