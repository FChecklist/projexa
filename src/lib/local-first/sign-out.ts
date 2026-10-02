// LOCAL-FIRST: what a sign-out does to this laptop's copy of the person's workspace.
//
// POLICY (package lf-fc, 2026-10-02; review cost:COST-05 + data:F11; the owner's priority is cost > ease of work > security):
//   * By DEFAULT a sign-out KEEPS the person's copy (`projexa-local:<userId>`) on this laptop. Signing in again then costs NOTHING
//     (no first sync of every project x kind, no re-download of every row) and the workspace works offline at once. The per-person
//     database name already keeps two people on one laptop apart. The copy is protected at rest only by the browser profile's own
//     storage (the residual privacy risk: someone with access to this browser profile can read it).
//   * ONE explicit choice deletes it: "Sign out and delete this laptop's copy" (`deleteLocalCopy: true`), for a shared or
//     borrowed computer. The decision and its reason are recorded in docs/local-first/CONTRACT.md (the owner may veto it).
//   * Pending edits and drafts ALWAYS survive, in both modes: the outbox is flushed first (the session is still alive); whatever is
//     still pending -- or a draft the server turned down (FB data:F2, outbox-signout.ts) -- keeps the database, and the person is
//     told in plain words.
//   * A delete that fails or is blocked (another tab of PROJEXA holds the database open) is SAID, never silent (data:F11).
//   * The BOQ hints (`px-local-first-boq:<id>`, not per person) are removed in EVERY path. The "workspace ready" key is removed only
//     when the copy really was deleted (a kept copy is still ready: the next sign-in must not pay for a first sync again).
//   * With the local-first flag OFF and no delete asked for, this is INERT (cost:FLAG-16): no Supabase call, no IndexedDB listing,
//     no database opened, no outbox loaded. With the flag off nothing creates a copy any more (WorkspacePrepare / replica-shared).
//   * Only the person signing out is ever looked at. An unknown person (no session, no remembered user) means nothing is deleted:
//     the old behaviour of deleting EVERY `projexa-local:*` database with nothing pending (other people's included) is gone.
//
// This function never throws and never holds a sign-out hostage: the flush is given a few seconds, the delete a few more.
//
// Callers: signOutEverywhere (AccountMenu, AppTopbar, SettingsClient: before the session ends) and M24Shell's SIGNED_OUT reaction
// (no session, so nothing can be sent; the copy is kept by the default policy).

import { localDbNameFor, openLocalDb, LOCAL_DB_NAME } from "./local-db";
import { isLocalFirstEnabled, resolveLocalUserId, setActiveLocalUser } from "./local-reader";
import { keptWorkOnSignOut } from "./outbox-signout";
import { readyKey } from "./prepare-workspace";
import type { Outbox } from "./outbox";

export type SignOutLocalResult = {
  /** Edits (and drafts) still waiting after the flush. */
  pending: number;
  /** True when the person's database was deleted. */
  wiped: boolean;
  /** Plain words for the person, or null when there is nothing to say. */
  notice: string | null;
  /** True when the person's copy stayed on this laptop (the default policy, or because work was pending, or a failed delete). */
  kept?: boolean;
  /** True when a delete was asked for and did not complete (blocked by another tab, or the browser refused). */
  deleteFailed?: boolean;
};

export type SignOutOptions = {
  /** The person signing out. Omitted: the active local user (may ask Supabase); null/"" = unknown: nothing is deleted. */
  userId?: string | null;
  idb?: IDBFactory;
  /** The explicit choice "Sign out and delete this laptop's copy". Default false: the copy is kept. */
  deleteLocalCopy?: boolean;
  /** The local-first flag. Default: isLocalFirstEnabled(). */
  localFirstOn?: () => boolean;
  /** The outbox that can flush for this person. Default: the shared one (loaded only if the database holds ops). */
  outbox?: Pick<Outbox, "flush"> | null;
  /** Empties the BOQ device copy (only when the copy is deleted). Default: boq-line-cache's clearBoqDeviceCopiesOnSignOut. */
  clearBoqCopy?: () => Promise<void>;
  /** How long the flush may take. Default 8 s. */
  flushTimeoutMs?: number;
  /** How long a delete may wait (another tab holding the database blocks it). Default 4 s. */
  deleteTimeoutMs?: number;
  /** Removes the localStorage hints. Default: the real localStorage. */
  storage?: Pick<Storage, "removeItem" | "key" | "length"> | null;
  /** The same notice is not returned twice within this long (this tab's own sign-out is followed by a SIGNED_OUT event). Default 60 s. */
  noticeDedupeMs?: number;
};

const BOQ_HINT_PREFIX = "px-local-first-boq:";
const DB_PREFIX = `${LOCAL_DB_NAME}:`;

/** Delete mode, edits still pending: the copy was kept so the work is not lost. */
export function pendingNotice(pending: number): string {
  return pending === 1
    ? "1 change you made on this laptop has not reached the server yet, so this laptop kept your workspace. Nothing is lost: sign in again to finish syncing it."
    : `${pending} changes you made on this laptop have not reached the server yet, so this laptop kept your workspace. Nothing is lost: sign in again to finish syncing them.`;
}

/** Default (keep) mode, edits still pending: they stay with the kept copy. */
export function pendingKeptNotice(pending: number): string {
  return pending === 1
    ? "1 change you made on this laptop has not reached the server yet. It is kept safely on this laptop: sign in again to finish syncing it."
    : `${pending} changes you made on this laptop have not reached the server yet. They are kept safely on this laptop: sign in again to finish syncing them.`;
}

/** A delete that did not complete (data:F11). */
export const DELETE_FAILED_NOTICE =
  "This laptop's copy of your workspace could not be deleted, probably because PROJEXA is still open in another tab or window. Close the other PROJEXA tabs, sign in, and choose \"Sign out and delete this laptop's copy\" again.";

/** A delete asked for when the person cannot be told apart (no session, no remembered user). */
export const DELETE_UNKNOWN_PERSON_NOTICE =
  "This laptop's copy of your workspace was not deleted because PROJEXA could not tell whose it is. Sign in, then choose \"Sign out and delete this laptop's copy\".";

/** Resolves true when the database is gone, false when the delete failed or was blocked for longer than `timeoutMs`. */
function deleteDatabase(idb: IDBFactory, name: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(ok); } };
    try {
      const request = idb.deleteDatabase(name);
      request.onsuccess = () => finish(true);
      request.onerror = () => finish(false);
      request.onblocked = () => { /* another tab holds it open: it closes itself on versionchange; wait for success or the timeout */ };
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

/** Names of the person databases this browser holds, or null when the browser cannot list them (older Firefox). */
async function listLocalDatabaseNames(idb: IDBFactory): Promise<string[] | null> {
  const list = (idb as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases;
  if (typeof list !== "function") return null;
  try {
    return (await list.call(idb)).map((d) => d.name ?? "").filter((n) => n.startsWith(DB_PREFIX));
  } catch {
    return null;
  }
}

function removeBoqHints(storage: Pick<Storage, "removeItem" | "key" | "length"> | null): void {
  if (!storage) return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(BOQ_HINT_PREFIX)) stale.push(key);
    }
    for (const key of stale) storage.removeItem(key);
  } catch { /* storage blocked: nothing to remove */ }
}

let lastNotice: { text: string; at: number } | null = null;

/** Forgets the last notice given (tests; and nothing else needs it). */
export function forgetLastSignOutNotice(): void {
  lastNotice = null;
}

export async function finishLocalWorkspaceOnSignOut(options: SignOutOptions = {}): Promise<SignOutLocalResult> {
  const result: SignOutLocalResult = { pending: 0, wiped: false, notice: null };
  const notices: string[] = [];
  const deleteCopy = options.deleteLocalCopy === true;
  const storage = options.storage === undefined ? (typeof localStorage === "undefined" ? null : localStorage) : options.storage;
  try {
    // The BOQ hints name a BOQ (title, status, project), not a person: they never outlive a sign-out (data:F11).
    removeBoqHints(storage);

    // Flag off and no delete asked for: nothing here was ever filled, so nothing is looked at (cost:FLAG-16).
    if (!deleteCopy && !(options.localFirstOn ?? isLocalFirstEnabled)()) return result;

    const idb = options.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    if (!idb) return result;

    let userId = options.userId === undefined ? await resolveLocalUserId() : options.userId;
    if (userId === "") userId = null;
    if (!userId) {
      if (deleteCopy) notices.push(DELETE_UNKNOWN_PERSON_NOTICE);
      return finish();
    }
    const name = localDbNameFor(userId);
    // Only a database that exists: opening one that does not would create it. When the browser cannot list them, trust the name.
    const existing = await listLocalDatabaseNames(idb);
    if (existing !== null && !existing.includes(name)) {
      if (deleteCopy) removeReadyKey(userId);
      return finish();
    }

    // 1. Flush, only when the database actually holds ops.
    const waiting = await countOps(idb, name).catch(() => 0);
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
        await Promise.race([(async () => { await outbox!.flush(); if ((await countOps(idb, name).catch(() => 0)) > 0) await outbox!.flush(); })().catch(() => {}), timeout]);
      }
    }

    // 2. What must survive whatever the mode: pending ops, and drafts the server turned down (FB data:F2).
    const pending = await countOps(idb, name).catch(() => 1); // when in doubt, keep it
    const kept = await keptWorkOnSignOut(idb, name).catch(() => ({ keep: true, drafts: 0, refused: [] as string[], notice: null as string | null }));
    result.pending = pending + kept.drafts;
    if (pending > 0) notices.push(deleteCopy ? pendingNotice(pending) : pendingKeptNotice(pending));
    if (kept.notice) notices.push(kept.notice);

    if (!deleteCopy || pending > 0 || kept.keep) {
      result.kept = true;
      return finish(userId);
    }

    // 3. The explicit choice: delete this laptop's copy.
    if (await deleteDatabase(idb, name, options.deleteTimeoutMs ?? 4000)) {
      result.wiped = true;
      await (options.clearBoqCopy ?? (async () => (await import("@/lib/boq-line-cache")).clearBoqDeviceCopiesOnSignOut()))().catch(() => {});
      // The next sign-in on this laptop prepares the workspace again (its database is gone).
      removeReadyKey(userId);
    } else {
      result.kept = true;
      result.deleteFailed = true;
      notices.push(DELETE_FAILED_NOTICE);
    }
    return finish(userId);
  } catch {
    return result;
  }

  function removeReadyKey(userId: string) {
    try { storage?.removeItem(readyKey(userId)); } catch { /* storage blocked */ }
  }

  async function finish(userId?: string): Promise<SignOutLocalResult> {
    if (userId) {
      try { (await import("./outbox-shared")).releaseSharedOutbox(userId); } catch { /* never created */ }
    }
    setActiveLocalUser(null);
    if (notices.length > 0) {
      const text = notices.join(" ");
      // The SIGNED_OUT event that follows this tab's own sign-out would say it again: once is enough.
      if (!(lastNotice && lastNotice.text === text && Date.now() - lastNotice.at < (options.noticeDedupeMs ?? 60_000))) result.notice = text;
      lastNotice = { text, at: Date.now() };
    }
    return result;
  }
}
