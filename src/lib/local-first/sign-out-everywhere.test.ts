// LOCAL-FIRST R9/R10: signOutEverywhere (the one sign-out of every button) and the shell's reaction to a SIGNED_OUT event.
// The identity store is the REAL one (createIdentityStore over a fake localStorage and the real device database on fake-indexeddb);
// the auth client, the service worker and the workspace step are fakes that record the order of what happened.
import { afterEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { openDeviceMeta } from "./device-meta";
import {
  IDENTITY_STORAGE_KEY,
  createIdentityStore,
  resetDeliberateSignOutForTests,
  startIdentityMirror,
  type AuthLike,
  type DurableIdentity,
  type SessionLike,
} from "./identity";
import { classifySignedOut, reactToSignedOut, signOutEverywhere } from "./sign-out-everywhere";
import type { SignOutLocalResult } from "./sign-out";

afterEach(() => resetDeliberateSignOutForTests());

class FakeStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

const NOW = 1_760_000_000_000;
const identity = (over: Partial<DurableIdentity> = {}): DurableIdentity => ({
  userId: "user-1", email: "person@example.com", name: "Asha", orgId: "org-1", role: "site_engineer",
  lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 }, ...over,
});

function realStore() {
  const storage = new FakeStorage();
  const idb = new IDBFactory();
  const store = createIdentityStore({ storage, openMeta: () => openDeviceMeta(idb) });
  return { store, storage, idb };
}

function eventedAuth(over: Partial<AuthLike> = {}) {
  const calls: string[] = [];
  const listeners: ((event: string, session: SessionLike | null) => void)[] = [];
  const auth: AuthLike = {
    getSession: async () => ({ data: { session: null } }),
    setSession: async () => { calls.push("setSession"); return { error: null }; },
    signOut: async () => { calls.push("signOut"); return { error: null }; },
    onAuthStateChange: (cb) => { listeners.push(cb); return { data: { subscription: { unsubscribe: () => {} } } }; },
    ...over,
  };
  return { auth, calls, emit: (event: string, s: SessionLike | null) => listeners.forEach((l) => l(event, s)) };
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const nothingPending: SignOutLocalResult = { pending: 0, wiped: true, notice: null };

describe("signOutEverywhere: the workspace step, then THE deliberate sign-out", () => {
  test("workspace step BEFORE the identity is cleared; then the mirror is empty, the worker drops the person's caches, Supabase is told", async () => {
    const { store, storage } = realStore();
    await store.write(identity());
    const order: string[] = [];
    const { auth } = eventedAuth({ signOut: async () => { order.push("supabase.signOut"); return { error: null }; } });
    const result = await signOutEverywhere({
      auth,
      store,
      sw: { clearPerson: async (personId) => { order.push(`sw.clearPerson ${personId}`); return null; } },
      clearBrowserSession: () => order.push("manual clear"),
      finishWorkspace: async () => {
        order.push(`workspace (identity ${(await store.read()) ? "present" : "gone"})`);
        return nothingPending;
      },
    });
    expect(order).toEqual(["workspace (identity present)", "sw.clearPerson user-1", "supabase.signOut"]);
    expect(await store.read()).toBeNull();
    expect(storage.getItem(IDENTITY_STORAGE_KEY)).toBeNull();
    expect(result).toMatchObject({ notice: null, serverTold: true });
  });

  test("edits still pending: the notice comes back and the sign-out still completes", async () => {
    const { store } = realStore();
    await store.write(identity());
    const { auth, calls } = eventedAuth();
    const result = await signOutEverywhere({
      auth, store, sw: { clearPerson: async () => null }, clearBrowserSession: () => {},
      finishWorkspace: async () => ({ pending: 2, wiped: false, notice: "2 changes kept" }),
    });
    expect(result.notice).toBe("2 changes kept");
    expect(result.workspace).toMatchObject({ pending: 2, wiped: false });
    expect(calls).toContain("signOut");
    expect(await store.read()).toBeNull();
  });

  test("Supabase unreachable (offline): the session is cleared by hand, and the identity is still gone", async () => {
    const { store } = realStore();
    await store.write(identity());
    let manual = 0;
    const { auth } = eventedAuth({ signOut: async () => { throw new TypeError("fetch failed"); } });
    const result = await signOutEverywhere({ auth, store, sw: { clearPerson: async () => null }, clearBrowserSession: () => { manual += 1; }, finishWorkspace: async () => nothingPending });
    expect(result.serverTold).toBe(false);
    expect(manual).toBe(1);
    expect(await store.read()).toBeNull();
  });

  test("never throws: a workspace step that throws still lets the person sign out", async () => {
    const { store } = realStore();
    await store.write(identity());
    const { auth, calls } = eventedAuth();
    const result = await signOutEverywhere({ auth, store, sw: { clearPerson: async () => { throw new Error("no worker"); } }, clearBrowserSession: () => {}, finishWorkspace: async () => { throw new Error("boom"); } });
    expect(result.notice).toBeNull();
    expect(calls).toContain("signOut");
    expect(await store.read()).toBeNull();
  });

  test("after it, an unexpected-looking SIGNED_OUT does NOT bring the person back (no setSession from the mirror)", async () => {
    const { store } = realStore();
    await store.write(identity());
    const { auth, calls, emit } = eventedAuth();
    startIdentityMirror(auth, store, { isOffline: () => false });
    await signOutEverywhere({ auth, store, sw: { clearPerson: async () => null }, clearBrowserSession: () => {}, finishWorkspace: async () => nothingPending });
    emit("SIGNED_OUT", null);
    await tick();
    expect(calls).not.toContain("setSession");
    expect(await store.read()).toBeNull();
  });
});

describe("the shell's SIGNED_OUT reaction", () => {
  test("classifySignedOut: the person's click is deliberate; a live mirror means restoring; an empty mirror means ended", async () => {
    const { store } = realStore();
    expect(await classifySignedOut({ store, isDeliberate: () => true })).toBe("deliberate");
    expect(await classifySignedOut({ store, isDeliberate: () => false })).toBe("ended");
    await store.write(identity());
    expect(await classifySignedOut({ store, isDeliberate: () => false })).toBe("restoring");
    await store.write(identity({ session: null, lastRefreshAt: NOW + 1 }));
    expect(await classifySignedOut({ store, isDeliberate: () => false })).toBe("ended");
  });

  test("UNEXPECTED sign-out with a live mirror: the mirror restores the session, nothing is cleared, no trip to /login", async () => {
    const { store } = realStore();
    await store.write(identity());
    const { auth, calls, emit } = eventedAuth();
    startIdentityMirror(auth, store, { isOffline: () => false });
    const shell: string[] = [];
    let reaction: Promise<string> | null = null;
    auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") reaction = reactToSignedOut({ classify: () => classifySignedOut({ store }), cleanUp: () => shell.push("cleanUp"), goToLogin: () => shell.push("login"), wait: tick });
    });
    emit("SIGNED_OUT", null);
    await tick();
    expect(await reaction!).toBe("restoring");
    expect(calls).toContain("setSession");
    expect(shell).toEqual([]);
    expect(await store.read()).not.toBeNull();
  });

  test("UNEXPECTED sign-out, and the server then says the token is revoked: the second look finds the mirror empty -> cleanup and /login", async () => {
    const { store } = realStore();
    await store.write(identity());
    const { auth, emit } = eventedAuth({ setSession: async () => ({ error: { status: 400, message: "Invalid Refresh Token: Refresh Token Not Found" } }) });
    startIdentityMirror(auth, store, { isOffline: () => false });
    const shell: string[] = [];
    let reaction: Promise<string> | null = null;
    auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") reaction = reactToSignedOut({ classify: () => classifySignedOut({ store }), cleanUp: () => shell.push("cleanUp"), goToLogin: () => shell.push("login"), wait: () => tick().then(tick) });
    });
    emit("SIGNED_OUT", null);
    expect(await reaction!).toBe("ended");
    expect(shell).toEqual(["cleanUp", "login"]);
  });

  test("a deliberate sign-out (signOutEverywhere ran) cleans up and goes to /login at once, without waiting", async () => {
    const { store } = realStore();
    await store.write(identity());
    const { auth } = eventedAuth();
    await signOutEverywhere({ auth, store, sw: { clearPerson: async () => null }, clearBrowserSession: () => {}, finishWorkspace: async () => nothingPending });
    const shell: string[] = [];
    const kind = await reactToSignedOut({ cleanUp: () => shell.push("cleanUp"), goToLogin: () => shell.push("login"), classify: () => classifySignedOut({ store }), wait: () => { shell.push("waited"); return Promise.resolve(); } });
    expect(kind).toBe("deliberate");
    expect(shell).toEqual(["cleanUp", "login"]);
  });

  test("the later look is skipped once the shell is gone", async () => {
    const { store } = realStore();
    await store.write(identity());
    const shell: string[] = [];
    const kind = await reactToSignedOut({ cleanUp: () => shell.push("cleanUp"), goToLogin: () => shell.push("login"), classify: async () => { const k = await classifySignedOut({ store, isDeliberate: () => false }); await store.clear(); return k; }, wait: async () => {}, stillRelevant: () => false });
    expect(kind).toBe("restoring");
    expect(shell).toEqual([]);
  });
});
