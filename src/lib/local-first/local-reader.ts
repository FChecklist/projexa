// LOCAL-FIRST slice 2: read the laptop's own copy first, fall back to the server only when the copy does
// not have what the screen asked for yet.
//
//   readLocal(kind, {projectId, ...})          rows of one kind of one project from this laptop
//   loadLocalFirst(kind, projectId, fallback)  local rows when that (project, kind) was synced to the end
//                                              at least once, otherwise the fallback (the existing server read)
//   useLocalFirst(kind, projectId, fallback)   the same as a React hook, plus a background revalidation
//
// "Synced" means the sync engine finished pulling that (project, kind) once (replica.ts doneKey). A copy
// that stopped half way is NOT used: showing a partial BOQ as if it were the whole one would be worse than
// showing the server's.
//
// These rows are a cache and a proposal. Anything that decides money or an approval is revalidated on the
// server; nothing here is authority.

import { useCallback, useEffect, useRef, useState } from "react";
import { localDbNameFor, openLocalDb, type LocalDb } from "./local-db";
import { MANIFEST_KEY, doneKey, type DoneMarker, type StoredManifest } from "./replica";

/** localStorage key of the feature flag. Only the exact text "1" turns local-first screens on. */
export const LOCAL_FIRST_FLAG = "px-local-first";

export function isLocalFirstEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(LOCAL_FIRST_FLAG) === "1";
  } catch {
    return false;
  }
}

let activeUserId: string | null = null;
/** Remembered when a replica is created for a person, so a screen need not ask the browser client again. */
export function setActiveLocalUser(userId: string | null): void {
  activeUserId = userId;
}

async function defaultUserId(): Promise<string | null> {
  if (activeUserId) return activeUserId;
  try {
    const { createClient } = await import("@/lib/supabase/client");
    const { data } = await createClient().auth.getUser();
    activeUserId = data.user?.id ?? null;
  } catch {
    activeUserId = null;
  }
  return activeUserId;
}

/** The signed-in person this laptop is working for, or null when nobody is (or the browser client cannot say). */
export async function resolveLocalUserId(): Promise<string | null> {
  return defaultUserId();
}

export type LocalAccess = {
  /** An open database (not closed by these functions), or ... */
  db?: LocalDb;
  /** ... the person whose database to open, and the IndexedDB to open it in. */
  userId?: string;
  idb?: IDBFactory;
};

async function withDb<T>(access: LocalAccess, fn: (db: LocalDb) => Promise<T>): Promise<T | null> {
  if (access.db) return fn(access.db);
  const userId = access.userId ?? (await defaultUserId());
  if (!userId) return null;
  const idb = access.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!idb) return null;
  const db = await openLocalDb(idb, localDbNameFor(userId));
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

/** When (project, kind) was last pulled to the end, or null when it never was on this laptop. */
export async function localSyncInfo(kind: string, projectId: string, access: LocalAccess = {}): Promise<DoneMarker | null> {
  const marker = await withDb(access, (db) => db.getMeta<DoneMarker | null>(doneKey(projectId, kind)));
  return marker ?? null;
}

export type ReadLocalOptions<T> = LocalAccess & {
  projectId: string;
  /** Defaults to the organisation the replica recorded. A mismatch with it returns nothing, never another organisation's rows. */
  orgId?: string;
  filter?: (row: T) => boolean;
  sort?: (a: T, b: T) => number;
  limit?: number;
};

export async function readLocal<T = unknown>(kind: string, options: ReadLocalOptions<T>): Promise<T[]> {
  const rows = await withDb(options, async (db) => {
    const manifest = await db.getMeta<StoredManifest | null>(MANIFEST_KEY);
    const orgId = options.orgId ?? manifest?.orgId;
    if (!orgId || (manifest && manifest.orgId !== orgId)) return [] as T[];
    const records = await db.listByProject(orgId, kind, options.projectId);
    let out = records.map((r) => r.data as T);
    if (options.filter) out = out.filter(options.filter);
    if (options.sort) out = [...out].sort(options.sort);
    if (options.limit !== undefined) out = out.slice(0, Math.max(0, options.limit));
    return out;
  });
  return rows ?? [];
}

export type LocalFirstState = "loading" | "local" | "server" | "error";

export type LocalFirstResult<T> = { rows: T[]; state: "local" | "server"; syncedAt: number | null };

/** Local rows when synced, else the fallback. A local read that fails is treated as "not synced": the server answers. */
export async function loadLocalFirst<T>(
  kind: string,
  projectId: string,
  fallback: () => Promise<T[]>,
  options: Omit<ReadLocalOptions<T>, "projectId"> = {}
): Promise<LocalFirstResult<T>> {
  try {
    const info = await localSyncInfo(kind, projectId, options);
    if (info) {
      const rows = await readLocal<T>(kind, { ...options, projectId });
      return { rows, state: "local", syncedAt: info.at };
    }
  } catch {
    /* fall through to the server */
  }
  return { rows: await fallback(), state: "server", syncedAt: null };
}

export type UseLocalFirstOptions<T> = Omit<ReadLocalOptions<T>, "projectId"> & {
  /**
   * Brings the laptop's copy up to date in the background. The default asks the shared replica to pull
   * changes for this (project, kind). Pass your own in tests.
   */
  revalidate?: (ctx: { kind: string; projectId: string; userId: string | null }) => Promise<void>;
  /** Set false to skip the background revalidation. */
  background?: boolean;
};

export type UseLocalFirstValue<T> = {
  rows: T[];
  state: LocalFirstState;
  error: string | null;
  /** True while the background revalidation runs. */
  refreshing: boolean;
  syncedAt: number | null;
};

export function useLocalFirst<T = unknown>(
  kind: string,
  projectId: string | null | undefined,
  fallbackFetcher: () => Promise<T[]>,
  options: UseLocalFirstOptions<T> = {}
): UseLocalFirstValue<T> {
  const [value, setValue] = useState<UseLocalFirstValue<T>>({ rows: [], state: "loading", error: null, refreshing: false, syncedAt: null });
  // The caller's functions are read through refs so an inline arrow does not restart the load on every render.
  const fetcherRef = useRef(fallbackFetcher);
  const optionsRef = useRef(options);
  // Updated in an effect, not during render. Effects run in order, so this one is before the load effect below.
  useEffect(() => {
    fetcherRef.current = fallbackFetcher;
    optionsRef.current = options;
  });

  const run = useCallback(async (isCancelled: () => boolean) => {
    if (!projectId) return;
    const opts = optionsRef.current;
    const { revalidate: _r, background: _b, ...access } = opts;
    void _r; void _b;
    try {
      const first = await loadLocalFirst<T>(kind, projectId, () => fetcherRef.current(), access);
      if (isCancelled()) return;
      setValue({ rows: first.rows, state: first.state, error: null, refreshing: opts.background !== false, syncedAt: first.syncedAt });
    } catch (err) {
      if (isCancelled()) return;
      setValue({ rows: [], state: "error", error: err instanceof Error ? err.message : "Could not load this data", refreshing: false, syncedAt: null });
      return;
    }
    if (opts.background === false) return;

    // Background revalidation: pull changes into the laptop's copy, then show the copy if it is now complete.
    try {
      const userId = opts.userId ?? (await defaultUserId());
      if (opts.revalidate) await opts.revalidate({ kind, projectId, userId });
      else if (userId) await (await import("./replica-shared")).revalidateViaSharedReplica({ kind, projectId, userId });
      const info = await localSyncInfo(kind, projectId, access);
      if (isCancelled()) return;
      if (info) {
        const rows = await readLocal<T>(kind, { ...access, projectId });
        if (isCancelled()) return;
        setValue({ rows, state: "local", error: null, refreshing: false, syncedAt: info.at });
        return;
      }
    } catch {
      /* revalidation is best effort: the screen already has rows */
    }
    if (!isCancelled()) setValue((v) => ({ ...v, refreshing: false }));
  }, [kind, projectId]);

  useEffect(() => {
    let cancelled = false;
    setValue({ rows: [], state: "loading", error: null, refreshing: false, syncedAt: null });
    void run(() => cancelled);
    return () => { cancelled = true; };
  }, [run]);

  return value;
}
