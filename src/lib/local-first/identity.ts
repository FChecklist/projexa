// LOCAL-FIRST R9 (owner order 2026-10-02): "once logged in, the user stays logged in FOREVER until they log out or choose to delete.
// Never signed out by a failed refresh, being offline, or a server error. When offline the app opens using the cached identity."
//
// THREE LAYERS, each able to rebuild the others:
//   1. the Supabase session itself (cookie, 400 days) -- kept alive by the durable fetch wrapper (supabase/durable-auth.ts): a
//      refresh that fails for any reason except "the server says this refresh token is revoked" never ends it;
//   2. a MIRROR of the identity in two places on this laptop -- localStorage (`px-identity-v1`) and the local database's meta store
//      (key `identity`, IndexedDB): who the person is (user id, email, name, organisation, role), when their token last refreshed,
//      and the session tokens, so the session can be rebuilt if the cookie is lost (a Safari 7-day cap on script-written
//      cookies, a cleared cookie jar);
//   3. the shell that opens offline reads layer 2 and NEVER calls Supabase: getDurableIdentity() is storage only.
//
// WHAT ENDS AN IDENTITY: signOutDeliberately() (the person's own click) and the server answering, while the laptop is online, that
// the refresh token is revoked/invalid. Nothing else: not offline, not a 5xx, not a timeout, not a lost cookie.
//
// signOutDeliberately() is the ONLY path that clears the identity. It is exported here for the sign-out call sites; this change does
// not edit those call sites.

import { isTransientAuthError } from "@/lib/supabase/durable-auth";
import { META_KEYS } from "./release/release-constants";
import type { MetaStore } from "./release/installer";
import { createSwClient, type SwClient } from "./release/sw-client";

/** localStorage key of the mirror. */
export const IDENTITY_STORAGE_KEY = "px-identity-v1";

export type MirroredSession = { access_token: string; refresh_token: string; expires_at: number | null };

export type DurableIdentity = {
  userId: string;
  email: string | null;
  name: string | null;
  orgId: string | null;
  role: string | null;
  /** ms since epoch of the last time Supabase handed this laptop a (new) token. */
  lastRefreshAt: number;
  /** ms since epoch the identity was first mirrored here. */
  signedInAt: number;
  session: MirroredSession | null;
};

// ─── the two mirrored copies ────────────────────────────────────────────────────────────────────

export type IdentityStore = {
  read(): Promise<DurableIdentity | null>;
  write(identity: DurableIdentity): Promise<void>;
  clear(): Promise<void>;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isIdentity(v: unknown): v is DurableIdentity {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.userId === "string" && o.userId.length > 0 && typeof o.lastRefreshAt === "number";
}

function parseIdentity(raw: unknown): DurableIdentity | null {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return isIdentity(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The identity store: localStorage + the local database meta. `openMeta` opens the device-level database (the caller closes via the
 * returned release function). Either copy may be missing or broken (private window, blocked storage, a cleared database): reading
 * takes the NEWER one and heals the other from it; writing writes both and succeeds if either did.
 */
export function createIdentityStore(deps: {
  storage?: StorageLike | null;
  openMeta?: () => Promise<{ meta: MetaStore; close: () => void }>;
}): IdentityStore {
  const readLocal = (): DurableIdentity | null => {
    try {
      return deps.storage ? parseIdentity(deps.storage.getItem(IDENTITY_STORAGE_KEY)) : null;
    } catch {
      return null;
    }
  };
  const writeLocal = (identity: DurableIdentity): boolean => {
    try {
      deps.storage?.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
      return Boolean(deps.storage);
    } catch {
      return false;
    }
  };
  async function withMeta<T>(fn: (meta: MetaStore) => Promise<T>): Promise<T | undefined> {
    if (!deps.openMeta) return undefined;
    try {
      const opened = await deps.openMeta();
      try {
        return await fn(opened.meta);
      } finally {
        opened.close();
      }
    } catch {
      return undefined;
    }
  }
  const readMeta = async () => parseIdentity(await withMeta((m) => m.getMeta(META_KEYS.identity))) ?? null;
  const writeMeta = async (identity: DurableIdentity): Promise<boolean> => (await withMeta(async (m) => { await m.setMeta(META_KEYS.identity, identity); return true; })) === true;

  return {
    async read() {
      const [local, meta] = [readLocal(), await readMeta()];
      const newest = local && meta ? (meta.lastRefreshAt > local.lastRefreshAt ? meta : local) : local ?? meta;
      if (!newest) return null;
      // Heal whichever copy is missing or older.
      if (!local || local.lastRefreshAt < newest.lastRefreshAt) writeLocal(newest);
      if (!meta || meta.lastRefreshAt < newest.lastRefreshAt) await writeMeta(newest);
      return newest;
    },
    async write(identity) {
      const a = writeLocal(identity);
      const b = await writeMeta(identity);
      if (!a && !b) throw new Error("The identity could not be kept on this laptop (storage is blocked).");
    },
    async clear() {
      try {
        deps.storage?.removeItem(IDENTITY_STORAGE_KEY);
      } catch {
        /* nothing to do */
      }
      await withMeta(async (m) => { await m.setMeta(META_KEYS.identity, null); });
    },
  };
}

// ─── building and reading the identity ─────────────────────────────────────────────────────────

export type SessionLike = {
  access_token: string;
  refresh_token: string;
  expires_at?: number | null;
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null };
};

/** The identity for a Supabase session, keeping what an earlier identity of the SAME person already knew (organisation, role, name). */
export function identityFromSession(session: SessionLike, previous: DurableIdentity | null, now: number): DurableIdentity {
  const same = previous && previous.userId === session.user.id ? previous : null;
  const meta = session.user.user_metadata ?? {};
  const metaName = typeof meta.name === "string" ? meta.name : typeof meta.full_name === "string" ? meta.full_name : null;
  return {
    userId: session.user.id,
    email: session.user.email ?? same?.email ?? null,
    name: metaName ?? same?.name ?? null,
    orgId: same?.orgId ?? null,
    role: same?.role ?? null,
    lastRefreshAt: now,
    signedInAt: same?.signedInAt ?? now,
    session: { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at ?? null },
  };
}

/** Mirrors a session (a sign-in, a refreshed token, the initial session). Best effort: a storage failure never reaches the caller. */
export async function mirrorSession(store: IdentityStore, session: SessionLike, now: () => number = Date.now): Promise<DurableIdentity | null> {
  try {
    const identity = identityFromSession(session, await store.read(), now());
    await store.write(identity);
    return identity;
  } catch {
    return null;
  }
}

/** Remembers the organisation / role / name once the app learns them (from the shell's bootstrap or the sync manifest). */
export async function updateIdentityProfile(store: IdentityStore, patch: Partial<Pick<DurableIdentity, "orgId" | "role" | "name" | "email">>): Promise<DurableIdentity | null> {
  try {
    const current = await store.read();
    if (!current) return null;
    const next: DurableIdentity = { ...current };
    for (const key of ["orgId", "role", "name", "email"] as const) {
      const value = patch[key];
      if (typeof value === "string" && value) next[key] = value;
    }
    await store.write(next);
    return next;
  } catch {
    return null;
  }
}

/** The person this laptop knows, from storage ONLY. No network, no Supabase: this is what the offline shell opens with. */
export async function getDurableIdentity(store: IdentityStore): Promise<DurableIdentity | null> {
  try {
    return await store.read();
  } catch {
    return null;
  }
}

// ─── keeping the session itself alive ──────────────────────────────────────────────────────────

export type AuthLike = {
  getSession(): Promise<{ data: { session: SessionLike | null } }>;
  setSession(tokens: { access_token: string; refresh_token: string }): Promise<{ error: unknown }>;
  signOut(options?: { scope?: "global" | "local" | "others" }): Promise<{ error: unknown }>;
  onAuthStateChange(callback: (event: string, session: SessionLike | null) => void): { data: { subscription: { unsubscribe(): void } } };
};

export type RestoreOutcome = "present" | "restored" | "none" | "kept_offline" | "kept_transient" | "revoked";

/**
 * If Supabase has no session (the cookie was lost) but the mirror still holds the refresh token, rebuild the session from it.
 *   offline                                  -> keep the mirror, change nothing, send nothing
 *   server unreachable / 5xx / any transient -> keep the mirror (a later start tries again)
 *   the server says the token is revoked     -> THAT ends the identity: the mirror is cleared
 */
export async function restoreSessionIfMissing(auth: AuthLike, store: IdentityStore, options: { isOffline: () => boolean }): Promise<RestoreOutcome> {
  try {
    const { data } = await auth.getSession();
    if (data.session) return "present";
  } catch {
    /* treat as no session and try the mirror */
  }
  const identity = await getDurableIdentity(store);
  if (!identity?.session?.refresh_token) return "none";
  if (options.isOffline()) return "kept_offline";
  try {
    const { error } = await auth.setSession({ access_token: identity.session.access_token, refresh_token: identity.session.refresh_token });
    if (!error) return "restored";
    if (isTransientAuthError(error)) return "kept_transient";
  } catch (err) {
    if (isTransientAuthError(err)) return "kept_transient";
  }
  await store.clear().catch(() => {});
  return "revoked";
}

let deliberateSignOut = false;

/** True from the moment the person clicked sign-out. The auth listener uses it to tell their click from an unexpected SIGNED_OUT. */
export function isDeliberateSignOut(): boolean {
  return deliberateSignOut;
}

/** For tests. */
export function resetDeliberateSignOutForTests(): void {
  deliberateSignOut = false;
}

/**
 * Keeps the mirror in step with the Supabase session. A token refresh or sign-in updates it. An UNEXPECTED sign-out event (the
 * cookie vanished, another tab) is not believed: the session is rebuilt from the mirror (restoreSessionIfMissing), which only gives
 * up when the server itself says the token is revoked. A deliberate sign-out has already cleared the mirror.
 */
export function startIdentityMirror(auth: AuthLike, store: IdentityStore, options: { isOffline: () => boolean; now?: () => number; onRestoreOutcome?: (outcome: RestoreOutcome) => void }): () => void {
  const subscription = auth.onAuthStateChange((event, session) => {
    // Never await inside the callback: auth-js holds its lock while this runs, and a call back into auth would deadlock.
    setTimeout(() => {
      if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION" || event === "USER_UPDATED")) {
        // A new sign-in after a deliberate sign-out is a fresh identity: unexpected sign-outs are guarded again from here on.
        if (event === "SIGNED_IN") deliberateSignOut = false;
        void mirrorSession(store, session, options.now);
        return;
      }
      if (!session && (event === "SIGNED_OUT" || event === "INITIAL_SESSION") && !deliberateSignOut) {
        void restoreSessionIfMissing(auth, store, options).then((outcome) => options.onRestoreOutcome?.(outcome));
      }
    }, 0);
  });
  return () => subscription.data.subscription.unsubscribe();
}

// ─── the ONLY way an identity ends ─────────────────────────────────────────────────────────────

export type SignOutDeps = {
  auth: Pick<AuthLike, "signOut">;
  store: IdentityStore;
  /** Tells the service worker this person signed out. Default: the real worker. */
  sw?: Pick<SwClient, "clearPerson">;
  /**
   * Keep the (public) release cache on the laptop for this same person's next sign-in, no shell served online meanwhile (offline it opens the passcode sign-in, B20) (AUDIT-100 A3, step 1b).
   * False: the release caches are deleted (the explicit "Sign out and delete this laptop's copy"). Default false.
   */
  keepRelease?: boolean;
  /** Removes the Supabase session cookies and storage entries by hand, for when the server could not be reached to end the session. */
  clearBrowserSession?: () => void;
};

/** Removes every `sb-*-auth-token*` cookie and `sb-*` localStorage entry. The fallback of signOutDeliberately when offline. */
export function clearSupabaseBrowserSession(env: { cookie?: { get(): string; set(value: string): void }; storage?: Pick<Storage, "length" | "key" | "removeItem"> | null } = defaultBrowserEnv()): void {
  try {
    const names = (env.cookie?.get() ?? "").split(";").map((c) => c.split("=")[0]!.trim()).filter((n) => /^sb-.+-auth-token/.test(n));
    for (const name of names) env.cookie?.set(`${name}=; Max-Age=0; Path=/; SameSite=Lax`);
  } catch {
    /* ignore */
  }
  try {
    const storage = env.storage;
    if (storage) {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i)!);
      for (const key of keys) if (/^sb-.+-auth-token/.test(key)) storage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

function defaultBrowserEnv() {
  if (typeof document === "undefined") return {};
  return {
    cookie: { get: () => document.cookie, set: (v: string) => { document.cookie = v; } },
    storage: typeof localStorage === "undefined" ? null : localStorage,
  };
}

/**
 * THE sign-out. In this order, because each step must survive the failure of the next:
 *   1. clear the identity mirror (so no other tab or a later start can rebuild the session from it),
 *   2. tell the service worker this person signed out (no shell is served online from its release; kept for this person's next sign-in when keepRelease),
 *   3. end the Supabase session; when the server cannot be reached (offline) end it locally by hand instead.
 * Never throws. Returns whether the server was told.
 */
export async function signOutDeliberately(deps: SignOutDeps): Promise<{ serverTold: boolean }> {
  deliberateSignOut = true;
  let personId: string | null = null;
  try {
    personId = (await deps.store.read())?.userId ?? null;
  } catch {
    personId = null;
  }
  await deps.store.clear().catch(() => {});
  try {
    await (deps.sw ?? createSwClient()).clearPerson(personId, deps.keepRelease ? { keepRelease: true } : undefined);
  } catch {
    /* no worker: nothing to clear */
  }
  let serverTold = false;
  try {
    const { error } = await deps.auth.signOut();
    serverTold = !error;
  } catch {
    serverTold = false;
  }
  if (!serverTold) (deps.clearBrowserSession ?? (() => clearSupabaseBrowserSession()))();
  return { serverTold };
}
