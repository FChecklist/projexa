// LOCAL-FIRST: what a sign-out does to this laptop's copy of the person's workspace.
//
// PRIVACY RULE (owner order 2026-10-02): a signed-out laptop must not keep the person's data. So at sign-out:
//   1. the outbox is FLUSHED (the session is still alive, so edits made offline can still reach the server);
//   2. if NOTHING is pending, the person's `projexa-local:<userId>` database is deleted, their BOQ device copy is
//      emptied, and the little hints local-first leaves in localStorage are removed;
//   3. if edits are STILL pending (the laptop is offline, the server refused to answer, a conflict waits for a
//      decision), the database is KEPT -- deleting it would throw away work the person did and has not seen land --
//      and a plain sentence tells the person so. Signing in again resumes the flush.
//
// This function never throws and never holds a sign-out hostage: the flush is given a few seconds, then whatever is
// still pending counts as pending.
//
// Callers (AccountMenu, AppTopbar, SettingsClient: before supabase.auth.signOut(); M24Shell: on a SIGNED_OUT event,
// which carries no session, so there is nothing left to flush with and anything pending is simply kept) show the
// returned `notice` when it is not null.

import { localDbNameFor, openLocalDb, LOCAL_DB_NAME } from "./local-db";
import { resolveLocalUserId, setActiveLocalUser } from "./local-reader";
import { readyKey } from "./prepare-workspace";
import type { Outbox } from "./outbox";

export type SignOutLocalResult = {
  /** Edits still waiting after the flush (summed over the databases looked at). */
  pending: number;
  /** True when at least one database was deleted. */
  wiped: boolean;
  /** Plain words for the person, or null when there is nothing to say. */
  notice: string | null;
};

export type SignOutOptions = {
  /** The person signing out. Omitted: the active local user; unknown: every local database on this browser is looked at. */
  userId?: string | null;
  idb?: IDBFactory;
  /** The outbox that can flush for this person. Default: the shared one (created only if the database holds ops). */
  outbox?: Pick<Outbox, "flush"> | null;
  /** Empties the BOQ device copy. Default: boq-line-cache's clearBoqDeviceCopiesOnSignOut. */
  clearBoqCopy?: () => Promise<void>;
  /** How long the flush may take. Default 8 s. */
  flushTimeoutMs?: number;
  /** Removes the localStorage hints. Default: the real localStorage. */
  storage?: Pick<Storage, "removeItem" | "key" | "length"> | null;
  /** The same notice is not returned twice within this long (this tab's own sign-out is followed by a SIGNED_OUT event). Default 60 s. */
  noticeDedupeMs?: number;
};

const BOQ_HINT_PREFIX = "px-local-first-boq:";
const DB_PREFIX = `${LOCAL_DB_NAME}:`;

export function pendingNotice(pending: number): string {
  return pending === 1
    ? "1 change you made on this laptop has not reached the server yet, so this laptop kept your workspace. Nothing is lost: sign in again to finish syncing it."
    : `${pending} changes you made on this laptop have not reached the server yet, so this laptop kept your workspace. Nothing is lost: sign in again to finish syncing them.`;
}

function deleteDatabase(idb: IDBFactory, name: string, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(ok); } };
    try {
      const request = idb.deleteDatabase(name);
      request.onsuccess = () => finish(true);
      request.onerror = () => finish(false);
      request.onblocked = () => { /* another tab holds it open: it closes itself on versionchange; wait for success */ };
      timer = setTimeout(() => finish(false), timeoutMs);
    } catch {
      finish(false);
    }
  });
}

async function countOps(idb: IDBFactory, name: string): Promise<number> {
  const db = await openLocalDb(idb, name);
  try {
    return (await db.listOps()).length;
  } finally {
    db.close();
  }
}

/** Names of the local databases this browser holds, or null when the browser cannot list them (older Firefox). */
async function listLocalDatabaseNames(idb: IDBFactory): Promise<string[] | null> {
  const list = (idb as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases;
  if (typeof list !== "function") return null;
  try {
    return (await list.call(idb)).map((d) => d.name ?? "").filter((n) => n.startsWith(DB_PREFIX));
  } catch {
    return null;
  }
}

let lastNotice: { text: string; at: number } | null = null;

/** Forgets the last notice given (tests; and nothing else needs it). */
export function forgetLastSignOutNotice(): void {
  lastNotice = null;
}

export async function finishLocalWorkspaceOnSignOut(options: SignOutOptions = {}): Promise<SignOutLocalResult> {
  const result: SignOutLocalResult = { pending: 0, wiped: false, notice: null };
  try {
    const idb = options.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    if (!idb) return result;

    let userId = options.userId === undefined ? await resolveLocalUserId() : options.userId;
    if (userId === "") userId = null;
    // Only databases that exist: opening one that does not would create it. When the browser cannot list them, trust the name.
    const existing = await listLocalDatabaseNames(idb);
    const names = userId ? [localDbNameFor(userId)].filter((n) => existing === null || existing.includes(n)) : existing ?? [];
    if (names.length === 0) return result;

    // 1. Flush: only for the person signing out, and only when the database actually holds ops.
    if (userId) {
      const waiting = await countOps(idb, localDbNameFor(userId)).catch(() => 0);
      if (waiting > 0) {
        let outbox = options.outbox;
        if (outbox === undefined) {
          try {
            outbox = (await import("./outbox-shared")).getSharedOutbox(userId);
          } catch {
            outbox = null;
          }
        }
        if (outbox) {
          const timeout = new Promise<void>((resolve) => setTimeout(resolve, options.flushTimeoutMs ?? 8000));
          // Twice: an edit that was joined to a pass already ending is sent by the second one.
          await Promise.race([(async () => { await outbox!.flush(); if ((await countOps(idb, localDbNameFor(userId!)).catch(() => 0)) > 0) await outbox!.flush(); })().catch(() => {}), timeout]);
        }
      }
    }

    // 2. Delete what has nothing pending; keep what has.
    let wipedAny = false;
    for (const name of names) {
      const pending = await countOps(idb, name).catch(() => 1); // when in doubt, keep it
      if (pending > 0) {
        result.pending += pending;
        continue;
      }
      if (await deleteDatabase(idb, name)) wipedAny = true;
    }
    result.wiped = wipedAny;

    if (wipedAny) {
      await (options.clearBoqCopy ?? (async () => (await import("@/lib/boq-line-cache")).clearBoqDeviceCopiesOnSignOut()))().catch(() => {});
      const storage = options.storage === undefined ? (typeof localStorage === "undefined" ? null : localStorage) : options.storage;
      if (storage) {
        try {
          const stale: string[] = [];
          for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (key && key.startsWith(BOQ_HINT_PREFIX)) stale.push(key);
          }
          for (const key of stale) storage.removeItem(key);
          // The next sign-in on this laptop prepares the workspace again (its database is gone).
          if (userId) storage.removeItem(readyKey(userId));
        } catch { /* storage blocked: nothing to remove */ }
      }
    }

    if (userId) {
      try { (await import("./outbox-shared")).releaseSharedOutbox(userId); } catch { /* never created */ }
    }
    setActiveLocalUser(null);

    if (result.pending > 0) {
      const text = pendingNotice(result.pending);
      // The SIGNED_OUT event that follows this tab's own sign-out would say it again: once is enough.
      if (!(lastNotice && lastNotice.text === text && Date.now() - lastNotice.at < (options.noticeDedupeMs ?? 60_000))) result.notice = text;
      lastNotice = { text, at: Date.now() };
    }
    return result;
  } catch {
    return result;
  }
}
