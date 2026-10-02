// LOCAL-FIRST slice 2 (owner directive 2026-10-02): the sync engine that copies the projects a person may
// already read into that laptop's own IndexedDB, so screens read from the laptop first.
//
// What it does, in order:
//   1. read the manifest (who the token belongs to, which projects, which kinds);
//   2. for every project, read the project's change-feed position BEFORE the first full pull and keep it
//      (so a change made between "read the head" and "finished pulling" is never missed);
//   3. for every project x kind, pull pages until has_more is false, store each page, THEN advance the
//      stored cursor, so an interrupted sync resumes where it stopped and a later sync pulls only changes;
//      each stored row remembers the server's version, signature and key id (CONTRACT.md section 0/1);
//   4. apply `deleted: true` as removal; drop projects the person no longer belongs to;
//   5. apply the project's change feed (/changes): a tombstone removes the local row, and an insert/update
//      with a version higher than ours is fetched by id -- this is how a row of a table WITHOUT updated_at
//      (which the keyset cursor cannot see change) is refreshed;
//   6. after a pair was pulled to the end, at most once a day, reconcile deletes against the server's id list
//      (the repair path for deletes made before change tracking existed).
//
// Guarantees (each one has a test in replica.test.ts or replica-versions.test.ts):
//   * the cursors (page cursor AND change-feed position) move only after their page is stored (a failing page
//     keeps the earlier pages);
//   * a record of another organisation is never stored, and never overwrites one;
//   * a DIRTY row (a pending local edit, see outbox.ts) is never overwritten, deleted, or handed over by a
//     pull, a tombstone or a reconcile: local-db.ts parks what the server said in the row's serverCopy;
//   * one database per signed-in person (localDbNameFor), and a manifest for a different person is refused,
//     so two people on one laptop never mix;
//   * pages are processed one at a time and written in small chunks with a yield to the main thread between
//     them, so 10,000 rows never freeze the screen and are never all held in memory;
//   * at most two pulls are in flight; errors become a report/status, they are never thrown into the UI;
//   * a 426 (this release is below the service's minimum) stops the run, is reported as "update_required", and
//     pauses sync (no further calls) until resume() -- nothing else is touched.
//
// Browser data is a cache and a proposal, never authority: money and approval figures are revalidated on
// the server (owner-approved safeguard). This file only reads; edits go through outbox.ts.

import { changeCursorKey, localDbNameFor, openLocalDb, reconcileKey, type LocalDb } from "./local-db";
import {
  SYNC_CHANGES_LIMIT, SYNC_ID_LIST_LIMIT, SYNC_PAGE_LIMIT, SyncError,
  type SyncChange, type SyncClient, type SyncCursor, type SyncErrorKind, type SyncItem, type SyncManifest, type UpdateRequiredDetails,
} from "./sync-client";

export { changeCursorKey, reconcileKey };

export type ReplicaStatus = "idle" | "syncing" | "done" | "partial" | "signed_out" | "update_required" | "error";

export type ReplicaProgress = {
  projectsDone: number;
  projectsTotal: number;
  pairsDone: number;
  pairsTotal: number;
  itemsStored: number;
  currentProject: string | null;
};

export type ReplicaIssue = { projectId?: string; kind?: string; reason: SyncErrorKind | "store" | "org_mismatch" | "user_mismatch" | "no_progress"; message: string };

export type SyncReport = {
  status: ReplicaStatus;
  projectsTotal: number;
  projectsSynced: number;
  itemsStored: number;
  itemsRemoved: number;
  /** Rows added, refreshed or removed because the change feed named them. */
  changesApplied: number;
  /** Rows dropped by a delete reconcile (they are also counted in itemsRemoved). */
  reconciledRemoved: number;
  issues: ReplicaIssue[];
  /** Set with status "update_required": what the service said about the newest and the oldest allowed release. */
  updateRequired?: UpdateRequiredDetails;
  /** ms since epoch when this run finished, or null when it did not complete. */
  syncedAt: number | null;
};

export type ReplicaOptions = {
  /** The signed-in person: the database name and the manifest check both use it. */
  userId: string;
  client: SyncClient;
  /** IndexedDB factory (tests pass fake-indexeddb). Defaults to the browser's. */
  idb?: IDBFactory;
  onProgress?: (progress: ReplicaProgress) => void;
  onStatus?: (status: ReplicaStatus, report: SyncReport | null) => void;
  pageLimit?: number;
  /** Pulls in flight at once. */
  concurrency?: number;
  /** Rows written per transaction; a yield follows every chunk. */
  chunkSize?: number;
  /** Safety stop for a service that never stops saying has_more. */
  maxPagesPerKind?: number;
  /** Hands the thread back to the browser. Injected so tests can count the yields. */
  yieldFn?: () => Promise<void>;
  now?: () => number;
  /** Called with the number of rows of every write transaction (diagnostics, and the test that no write stretch is long). */
  onChunk?: (rows: number) => void;
  /** A (project, kind) is reconciled against the server's id list at most this often. Default one day. */
  reconcileEveryMs?: number;
  /**
   * COST (package lf-e6). A (project, kind) whose deletes the change feed carries (manifest `deletes_supported: true`) only
   * needs the id-list repair for deletes made before its feed position existed: at most this often. Default seven days.
   */
  feedReconcileEveryMs?: number;
  /** COST: at most this many (project, kind) id-list repairs per whole sync, so the repair is spread over several runs. Default 12. */
  reconcileBudgetPerRun?: number;
  /** COST: a one-project run within this long of that project's last change-feed check, for kinds the feed covers, sends nothing. Default 2 minutes. */
  projectFreshMs?: number;
  /** COST: a one-project run reuses the manifest stored by an earlier run of at most this age instead of asking again. Default 6 hours. */
  manifestMaxAgeMs?: number;
};

export type Replica = {
  /** Copies every readable project. Safe to call again: it resumes and only pulls changes. */
  sync(signal?: AbortSignal, onProgress?: (progress: ReplicaProgress) => void): Promise<SyncReport>;
  /** Brings one project (optionally one kind) up to date, e.g. in the background after a screen opened it. */
  syncProject(projectId: string, kind?: string, signal?: AbortSignal): Promise<SyncReport>;
  /**
   * Drops local, non-dirty rows of (project, kind) that the server's id list no longer holds. Normally run by sync()
   * after a pair was pulled to the end, at most once a day per pair; `force` runs it now.
   */
  reconcileDeletes(projectId: string, kind: string, options?: { force?: boolean; signal?: AbortSignal }): Promise<{ removed: number; skipped: boolean }>;
  /** Lifts the pause a 426 put on sync (call it once the app has been updated). */
  resume(): void;
  getStatus(): { status: ReplicaStatus; report: SyncReport | null };
};

// ─── meta keys (shared with local-reader.ts) ─────────────────────────────────────────────────────────

export const MANIFEST_KEY = "sync:manifest";
export const LAST_SYNC_KEY = "sync:last";
export const cursorKey = (projectId: string, kind: string) => `sync:cursor:${projectId}:${kind}`;
/** Written only when a (project, kind) has been pulled to the end at least once: the reader trusts this, not the cursor. */
export const doneKey = (projectId: string, kind: string) => `sync:done:${projectId}:${kind}`;

/**
 * `feedKinds` (absent in what an older build stored): the kinds whose every change, tombstones included, the change feed
 * carries (manifest `deletes_supported: true`). A pulled-to-the-end pair of such a kind is kept current by the feed alone.
 */
export type StoredManifest = { userId: string; orgId: string; projectIds: string[]; kinds: string[]; at: number; feedKinds?: string[] };
export type DoneMarker = { at: number; redacted: boolean; hiddenFields: string[] };

const defaultYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const FEED_RECONCILE_EVERY_MS = 7 * ONE_DAY_MS;
export const RECONCILE_BUDGET_PER_RUN = 12;
export const PROJECT_FRESH_MS = 2 * 60_000;
export const MANIFEST_MAX_AGE_MS = 6 * 60 * 60_000;

function emptyReport(status: ReplicaStatus): SyncReport {
  return { status, projectsTotal: 0, projectsSynced: 0, itemsStored: 0, itemsRemoved: 0, changesApplied: 0, reconciledRemoved: 0, issues: [], syncedAt: null };
}

function isProjectScoped(k: SyncManifest["kinds"][number]): boolean {
  return k.project_scoped !== false;
}

/** A row that names another organisation inside its own data is refused outright, whatever the manifest said. */
export function foreignOrg(data: unknown, orgId: string): boolean {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  for (const key of ["org_id", "orgId", "organisation_id", "organization_id"]) {
    const v = d[key];
    if (typeof v === "string" && v !== orgId) return true;
  }
  return false;
}

export function createReplica(options: ReplicaOptions): Replica {
  const pageLimit = Math.min(options.pageLimit ?? SYNC_PAGE_LIMIT, SYNC_PAGE_LIMIT);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 2));
  const chunkSize = Math.max(1, options.chunkSize ?? 200);
  const maxPages = options.maxPagesPerKind ?? 2000;
  const yieldFn = options.yieldFn ?? defaultYield;
  const now = options.now ?? (() => Date.now());
  const reconcileEveryMs = options.reconcileEveryMs ?? ONE_DAY_MS;
  const feedReconcileEveryMs = options.feedReconcileEveryMs ?? FEED_RECONCILE_EVERY_MS;
  const reconcileBudget = Math.max(0, options.reconcileBudgetPerRun ?? RECONCILE_BUDGET_PER_RUN);
  const projectFreshMs = Math.max(0, options.projectFreshMs ?? PROJECT_FRESH_MS);
  const manifestMaxAgeMs = Math.max(0, options.manifestMaxAgeMs ?? MANIFEST_MAX_AGE_MS);
  /** When each project's change feed was last read to its end by this replica (memory only: a reload checks again once). */
  const feedCheckedAt = new Map<string, number>();

  // A client object without the version-aware calls (an older build, a minimal test double) is still a valid client:
  // it simply has no change feed and no id list, so those two steps are skipped for it.
  const hasFeed = typeof options.client.changes === "function" && typeof options.client.pullIds === "function";
  const hasIds = typeof options.client.ids === "function";

  let status: ReplicaStatus = "idle";
  let lastReport: SyncReport | null = null;
  let inFlight: Promise<SyncReport> | null = null;
  let inFlightKey = "";
  /** Set by a 426: no call leaves this replica until resume(). */
  let paused: UpdateRequiredDetails | null = null;

  const setStatus = (next: ReplicaStatus, report: SyncReport | null) => {
    status = next;
    if (report) lastReport = report;
    options.onStatus?.(next, report);
  };

  async function storePage(db: LocalDb, orgId: string, projectId: string, kind: string, items: SyncItem[], report: SyncReport, kid?: string | null) {
    if (items.some((i) => !i.deleted && foreignOrg(i.data, orgId))) {
      throw Object.assign(new Error("A record of another organisation was refused."), { replicaReason: "org_mismatch" as const });
    }
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const last = new Map<string, SyncItem>();
      for (const item of chunk) last.set(item.id, item); // within one chunk the later change wins
      const puts: Parameters<LocalDb["putRecords"]>[0] = [];
      const dels: string[] = [];
      for (const item of last.values()) {
        const id = `${kind}:${item.id}`;
        if (item.deleted) dels.push(id);
        else {
          puts.push({
            id, type: kind, orgId, projectId, data: item.data,
            updatedAt: Date.parse(item.updated_at) || now(),
            serverUpdatedAt: item.updated_at,
            // An older service sends no version/signature: the row is stored without them, as before.
            ...(item.version !== undefined ? { serverVersion: item.version } : {}),
            ...(item.sig ? { sig: item.sig } : {}),
            ...(item.sig && kid ? { kid } : {}),
          });
        }
      }
      options.onChunk?.(chunk.length);
      // fromServer: a dirty row (a pending local edit) is never overwritten or deleted by this; local-db.ts parks the news instead.
      const stored = await db.putRecords(puts, { fromServer: true }); // not `+= await`: that reads the old total before the await and loses a concurrent worker's update
      report.itemsStored += stored;
      const removed = await db.deleteRecords(dels, { fromServer: true });
      report.itemsRemoved += removed;
      await yieldFn();
    }
  }

  async function clearPair(db: LocalDb, orgId: string, projectId: string, kind: string, report: SyncReport) {
    const rows = await db.listByProject(orgId, kind, projectId);
    const removed = await db.deleteRecords(rows.filter((r) => !r.dirty).map((r) => r.id)); // a dirty row is the person's edit: the outbox decides its fate
    report.itemsRemoved += removed;
    await db.setMeta(cursorKey(projectId, kind), null);
    await db.setMeta(doneKey(projectId, kind), null);
  }

  async function pullPair(db: LocalDb, orgId: string, projectId: string, kind: string, report: SyncReport, signal: AbortSignal) {
    let cursor = ((await db.getMeta<SyncCursor | null>(cursorKey(projectId, kind))) ?? null) as SyncCursor | null;
    let redacted = false;
    let hidden: string[] = [];
    for (let pageNo = 0; pageNo < maxPages; pageNo += 1) {
      if (signal.aborted) throw new SyncError("aborted", "The sync was cancelled.");
      const page = await options.client.pull({ projectId, kind, after: cursor, limit: pageLimit }, signal);
      await storePage(db, orgId, projectId, kind, page.items, report, page.kid);
      // The page is stored: only now may the cursor move.
      const next = page.next_cursor ?? cursor;
      if (page.has_more && (page.next_cursor === null || page.next_cursor === cursor)) {
        throw Object.assign(new Error("The sync service said there is more but did not move its cursor."), { replicaReason: "no_progress" as const });
      }
      if (next !== null) await db.setMeta(cursorKey(projectId, kind), next);
      redacted = redacted || page.redacted;
      hidden = page.hidden_fields.length ? page.hidden_fields : hidden;
      cursor = next;
      if (!page.has_more) {
        await db.setMeta(doneKey(projectId, kind), { at: now(), redacted, hiddenFields: hidden } satisfies DoneMarker);
        return;
      }
      await yieldFn();
    }
    throw Object.assign(new Error("The sync service sent more pages than allowed."), { replicaReason: "no_progress" as const });
  }

  // ─── the change feed (CONTRACT.md section 1, /changes) ─────────────────────────────────────────────────

  /**
   * Reads the project's head position and keeps it, once, BEFORE the first full pull: anything that changes after this
   * point is named by the feed, anything before it is in the pull. Returns false when the service has no feed for this
   * project (an older service answers 404), in which case nothing is stored and the feed is skipped.
   */
  async function ensureChangeCursor(db: LocalDb, projectId: string, signal: AbortSignal): Promise<boolean> {
    const stored = await db.getMeta<{ seq: number } | null>(changeCursorKey(projectId));
    if (stored && typeof stored.seq === "number") return true;
    try {
      const head = await options.client.changes({ projectId, afterSeq: null, limit: 1 }, signal);
      await db.setMeta(changeCursorKey(projectId), { seq: head.head_seq });
      return true;
    } catch (err) {
      if (err instanceof SyncError && err.kind === "not_found") return false;
      throw err;
    }
  }

  async function applyChangePage(db: LocalDb, orgId: string, projectId: string, kinds: Set<string>, changes: SyncChange[], report: SyncReport, signal: AbortSignal) {
    // Within one page the latest change to a record is the one that counts.
    const latest = new Map<string, SyncChange>();
    for (const change of changes) if (kinds.has(change.kind)) latest.set(`${change.kind}:${change.id}`, change);

    const dels: string[] = [];
    const candidates: SyncChange[] = [];
    for (const [fullId, change] of latest) {
      if (change.op === "D") dels.push(fullId);
      else candidates.push(change);
    }
    const local = await db.getRecordsByIds(candidates.map((c) => `${c.kind}:${c.id}`));
    const toFetch = new Map<string, string[]>();
    for (const change of candidates) {
      const row = local.get(`${change.kind}:${change.id}`);
      // A dirty row keeps the person's data; the freshest SERVER version we hold for it is its parked copy.
      const known = row ? (row.dirty ? row.serverCopy?.version ?? row.serverVersion : row.serverVersion) : undefined;
      if (row && known !== undefined && known !== null && known >= change.version) continue;
      const list = toFetch.get(change.kind) ?? [];
      list.push(change.id);
      toFetch.set(change.kind, list);
    }

    if (dels.length) {
      const removed = await db.deleteRecords(dels, { fromServer: true });
      report.itemsRemoved += removed;
      report.changesApplied += removed;
    }
    for (const [kind, ids] of toFetch) {
      if (signal.aborted) throw new SyncError("aborted", "The sync was cancelled.");
      const page = await options.client.pullIds({ projectId, kind, ids }, signal);
      await storePage(db, orgId, projectId, kind, page.items, report, page.kid);
      report.changesApplied += page.items.length;
    }
  }

  async function applyChanges(db: LocalDb, orgId: string, projectId: string, kinds: Set<string>, report: SyncReport, signal: AbortSignal) {
    const stored = await db.getMeta<{ seq: number } | null>(changeCursorKey(projectId));
    if (!stored || typeof stored.seq !== "number") return;
    let cursor = stored.seq;
    for (let pageNo = 0; pageNo < maxPages; pageNo += 1) {
      if (signal.aborted) throw new SyncError("aborted", "The sync was cancelled.");
      const page = await options.client.changes({ projectId, afterSeq: cursor, limit: SYNC_CHANGES_LIMIT }, signal);
      await applyChangePage(db, orgId, projectId, kinds, page.changes, report, signal);
      if (page.has_more && page.next_seq <= cursor) {
        throw Object.assign(new Error("The change feed said there is more but did not move."), { replicaReason: "no_progress" as const });
      }
      // The page's effects are stored: only now may the feed position move.
      if (page.next_seq > cursor) {
        await db.setMeta(changeCursorKey(projectId), { seq: page.next_seq });
        cursor = page.next_seq;
      }
      if (!page.has_more) return;
      await yieldFn();
    }
    throw Object.assign(new Error("The change feed sent more pages than allowed."), { replicaReason: "no_progress" as const });
  }

  // ─── reconcile deletes (CONTRACT.md section 1, /ids) ───────────────────────────────────────────────────

  async function reconcilePair(db: LocalDb, orgId: string, projectId: string, kind: string, signal: AbortSignal, force: boolean, everyMs = reconcileEveryMs): Promise<{ removed: number; skipped: boolean }> {
    const stamp = await db.getMeta<{ at: number } | null>(reconcileKey(projectId, kind));
    if (!force && stamp && now() - stamp.at < everyMs) return { removed: 0, skipped: true };

    // The local rows are listed BEFORE the id list is fetched: a row that arrives while the (possibly slow) list is
    // being read is not in this snapshot and so can never be mistaken for a deleted one.
    const before = await db.listByProject(orgId, kind, projectId);
    if (before.length === 0) {
      await db.setMeta(reconcileKey(projectId, kind), { at: now() }); // nothing to drop, so no call is spent
      return { removed: 0, skipped: true };
    }
    const onServer = new Set<string>();
    let after: string | null = null;
    for (let pageNo = 0; ; pageNo += 1) {
      if (pageNo >= maxPages) throw Object.assign(new Error("The sync service sent more id pages than allowed."), { replicaReason: "no_progress" as const });
      if (signal.aborted) throw new SyncError("aborted", "The sync was cancelled.");
      const page = await options.client.ids({ projectId, kind, afterId: after, limit: SYNC_ID_LIST_LIMIT }, signal);
      for (const id of page.ids) onServer.add(id);
      if (!page.has_more) break;
      if (page.next_id === null || page.next_id === after) {
        throw Object.assign(new Error("The sync service said there are more ids but did not move its cursor."), { replicaReason: "no_progress" as const });
      }
      after = page.next_id;
      await yieldFn();
    }
    const prefix = kind.length + 1;
    const gone = before.filter((r) => !r.dirty && !onServer.has(r.id.slice(prefix))).map((r) => r.id);
    // fromServer: a row that became dirty since the snapshot is still protected inside the database layer.
    const removed = await db.deleteRecords(gone, { fromServer: true });
    await db.setMeta(reconcileKey(projectId, kind), { at: now() });
    return { removed, skipped: false };
  }

  // ─── one run ───────────────────────────────────────────────────────────────────────────────────────────────

  async function run(scope: { projectId?: string; kind?: string }, signal?: AbortSignal, progressCb?: (p: ReplicaProgress) => void, allowStored = true): Promise<SyncReport> {
    const report = emptyReport("syncing");
    setStatus("syncing", report);
    const internal = new AbortController();
    const onOuter = () => internal.abort();
    signal?.addEventListener("abort", onOuter, { once: true });
    let db: LocalDb | null = null;

    const finish = (final: ReplicaStatus): SyncReport => {
      report.status = final;
      report.syncedAt = final === "done" ? now() : null;
      setStatus(final, report);
      return report;
    };

    // Set when a one-project run relied on the stored manifest and the service then said the project is not there (404):
    // the run is repeated once with a fresh manifest, so a project the person lost is still cleared exactly as before.
    let staleStoredManifest = false;
    try {
      db = await openLocalDb(options.idb ?? globalThis.indexedDB, localDbNameFor(options.userId));
      const wholeRun = scope.projectId === undefined;
      const previous = await db.getMeta<StoredManifest>(MANIFEST_KEY);

      // COST: a one-project run (a screen opened, the scheduler's check of one project) does not ask for the manifest again
      // while the stored one is recent, covers this project and says which kinds the feed carries. A whole run always asks.
      const stored = !wholeRun && allowStored && previous && previous.userId === options.userId && Array.isArray(previous.feedKinds)
        && Array.isArray(previous.projectIds) && previous.projectIds.includes(scope.projectId!) && now() - previous.at < manifestMaxAgeMs
        ? previous : null;

      let orgId: string;
      let kinds: string[];
      let feedKinds: Set<string>;
      let projectIds: string[];
      if (stored) {
        orgId = stored.orgId;
        kinds = stored.kinds;
        feedKinds = new Set(stored.feedKinds);
        projectIds = stored.projectIds;
      } else {
        const manifest = await options.client.manifest(internal.signal);
        if (manifest.user.id !== options.userId) {
          report.issues.push({ reason: "user_mismatch", message: "The sign-in on this laptop does not match the person this workspace belongs to." });
          return finish("error");
        }
        orgId = manifest.user.org_id;
        if (previous && previous.orgId !== orgId) {
          report.issues.push({ reason: "org_mismatch", message: "This laptop's copy belongs to a different organisation, so nothing was synced." });
          return finish("error");
        }
        kinds = manifest.kinds.filter(isProjectScoped).map((k) => k.kind);
        feedKinds = new Set(manifest.kinds.filter((k) => isProjectScoped(k) && k.deletes_supported === true).map((k) => k.kind));
        projectIds = manifest.projects.map((p) => p.id);
      }

      // Projects this person no longer belongs to leave the laptop (only on a full run: a partial one has no full list to compare).
      if (wholeRun && previous) {
        for (const gone of previous.projectIds.filter((id) => !projectIds.includes(id))) {
          const removed = await db.deleteByProject(orgId, gone);
          report.itemsRemoved += removed;
          for (const kind of new Set([...previous.kinds, ...kinds])) {
            await db.setMeta(cursorKey(gone, kind), null);
            await db.setMeta(doneKey(gone, kind), null);
            await db.setMeta(reconcileKey(gone, kind), null);
          }
          await db.setMeta(changeCursorKey(gone), null);
        }
      }

      const targetProjects = wholeRun ? projectIds : projectIds.filter((id) => id === scope.projectId);
      const targetKinds = scope.kind ? kinds.filter((k) => k === scope.kind) : kinds;
      if (!wholeRun && targetProjects.length === 0) {
        // Asked for a project the service does not list: the person cannot read it, so nothing of it may stay here.
        const removed = await db.deleteByProject(orgId, scope.projectId!);
        report.itemsRemoved += removed;
        // ... and the stored manifest stops naming it, so a later one-project run does not trust it for this project again.
        if (previous?.projectIds?.includes(scope.projectId!)) {
          await db.setMeta(MANIFEST_KEY, { ...previous, projectIds: previous.projectIds.filter((id) => id !== scope.projectId) } satisfies StoredManifest);
        }
        report.issues.push({ projectId: scope.projectId, reason: "not_found", message: "That project is not available to you." });
        return finish("partial");
      }

      // Written before any pull, so a reader always knows the organisation of whatever a half-finished run stored. A run that
      // reused the stored manifest learned nothing new about it, so it leaves it (and its age) as it is.
      if (!stored) {
        await db.setMeta(MANIFEST_KEY, {
          userId: options.userId, orgId,
          projectIds: wholeRun ? projectIds : [...new Set([...(previous?.projectIds ?? []), ...targetProjects])],
          kinds, at: now(), feedKinds: [...feedKinds],
        } satisfies StoredManifest);
      }

      // A pair the feed keeps current: its project has a feed position, the feed carries the kind's deletes, and it was pulled
      // to the end once. Its keyset pull would only ever return what the feed already names, so it is not asked again.
      const feedCovered = async (projectId: string, kind: string): Promise<boolean> =>
        feedKinds.has(kind)
        && !!(await db!.getMeta<{ seq: number } | null>(changeCursorKey(projectId)))
        && !!(await db!.getMeta<DoneMarker | null>(doneKey(projectId, kind)));

      // COST: the same project was read to the end of its feed a moment ago (a screen opened twice, the scheduler right after a
      // screen) and every asked kind is feed-covered: nothing can be learned by asking again so soon.
      if (!wholeRun && hasFeed && projectFreshMs > 0) {
        const checked = feedCheckedAt.get(scope.projectId!);
        if (checked !== undefined && now() - checked < projectFreshMs) {
          let allCovered = targetKinds.length > 0;
          for (const k of targetKinds) if (!(await feedCovered(scope.projectId!, k))) { allCovered = false; break; }
          if (allCovered) {
            report.projectsTotal = 1;
            report.projectsSynced = 1;
            return finish("done");
          }
        }
      }

      report.projectsTotal = targetProjects.length;
      const failedProjects = new Set<string>();
      const state: { fatal: SyncError | null } = { fatal: null };
      const noteFatal = (err: unknown, projectId?: string, kind?: string): boolean => {
        if (err instanceof SyncError && (err.kind === "signed_out" || err.kind === "update_required")) {
          if (!state.fatal) state.fatal = err;
          report.issues.push({ projectId, kind, reason: err.kind, message: err.message });
          internal.abort();
          return true;
        }
        return false;
      };
      const issueFor = (err: unknown, projectId: string, kind?: string) => {
        const syncKind = err instanceof SyncError ? err.kind : null;
        const reason = syncKind ?? (err as { replicaReason?: ReplicaIssue["reason"] }).replicaReason ?? "store";
        report.issues.push({ projectId, kind, reason, message: err instanceof Error ? err.message : String(err) });
      };
      /** Runs `task` for every item, at most `concurrency` at a time, until the run is aborted. */
      const pool = async <T,>(items: T[], task: (item: T) => Promise<void>) => {
        let next = 0;
        const worker = async () => {
          while (!internal.signal.aborted) {
            const item = items[next++];
            if (item === undefined) return;
            await task(item);
          }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, worker));
      };

      // 1. Each project's change-feed position, read BEFORE its first full pull.
      const withFeed = new Set<string>();
      await pool(hasFeed ? targetProjects : [], async (projectId) => {
        try {
          if (await ensureChangeCursor(db!, projectId, internal.signal)) withFeed.add(projectId);
        } catch (err) {
          if (noteFatal(err, projectId)) return;
          if (err instanceof SyncError && err.kind === "aborted") return;
          // Without the position nothing could be pulled safely (a later read of the head would skip what changed meanwhile).
          failedProjects.add(projectId);
          issueFor(err, projectId);
        }
      });

      // 2. The full / incremental pulls.
      const pullable = targetProjects.filter((p) => !failedProjects.has(p));
      const pairs = pullable.flatMap((p) => targetKinds.map((k) => ({ projectId: p, kind: k })));
      const remaining = new Map(pullable.map((p) => [p, targetKinds.length]));
      let pairsDone = 0;
      let projectsDone = failedProjects.size;
      let projectsClean = 0;
      if (targetKinds.length === 0) { projectsDone += pullable.length; projectsClean = pullable.length; }
      let currentProject: string | null = null;

      const emitProgress = () =>
        (progressCb ?? options.onProgress)?.({
          projectsDone, projectsTotal: targetProjects.length, pairsDone, pairsTotal: pairs.length,
          itemsStored: report.itemsStored, currentProject,
        });
      emitProgress();

      let repairsLeft = reconcileBudget;
      await pool(pairs, async (pair) => {
        currentProject = pair.projectId;
        try {
          const onFeed = withFeed.has(pair.projectId) && feedKinds.has(pair.kind);
          const covered = onFeed && (await feedCovered(pair.projectId, pair.kind));
          const fromScratch = !covered && ((await db!.getMeta<SyncCursor | null>(cursorKey(pair.projectId, pair.kind))) ?? null) === null;
          // COST: a feed-covered pair is brought up to date by step 4 (the feed), not by another keyset sweep.
          if (!covered) await pullPair(db!, orgId, pair.projectId, pair.kind, report, internal.signal);
          // 3. Repair deletes made before change tracking existed (never fatal, never a report issue). COST: only in a whole run,
          // at most `reconcileBudgetPerRun` id lists per run; a feed-covered pair at most weekly; a pair just copied from scratch
          // AFTER its feed position was taken cannot hold such a delete, so it is stamped without a call.
          try {
            let result = { removed: 0 };
            if (hasIds && wholeRun) {
              if (onFeed && fromScratch) await db!.setMeta(reconcileKey(pair.projectId, pair.kind), { at: now() });
              else if (repairsLeft > 0) {
                const r = await reconcilePair(db!, orgId, pair.projectId, pair.kind, internal.signal, false, onFeed ? feedReconcileEveryMs : reconcileEveryMs);
                if (!r.skipped) repairsLeft -= 1;
                result = r;
              }
            }
            report.itemsRemoved += result.removed;
            report.reconciledRemoved += result.removed;
          } catch (err) {
            if (noteFatal(err, pair.projectId, pair.kind)) return;
            // not_found: an older service has no /ids -- stamp the day so it is not asked again; anything else: try again next sync.
            if (err instanceof SyncError && err.kind === "not_found") await db!.setMeta(reconcileKey(pair.projectId, pair.kind), { at: now() });
          }
        } catch (err) {
          failedProjects.add(pair.projectId);
          const syncKind = err instanceof SyncError ? err.kind : null;
          if (noteFatal(err, pair.projectId, pair.kind)) return;
          if (syncKind === "aborted") return;
          if (syncKind === "not_found") {
            if (stored) staleStoredManifest = true;
            // No longer readable (or the kind was retired): what was copied for this pair must not stay.
            await clearPair(db!, orgId, pair.projectId, pair.kind, report).catch(() => {});
            report.issues.push({ projectId: pair.projectId, kind: pair.kind, reason: "not_found", message: "No longer available to you, so its local copy was removed." });
          } else {
            issueFor(err, pair.projectId, pair.kind);
          }
        }
        pairsDone += 1;
        const left = (remaining.get(pair.projectId) ?? 1) - 1;
        remaining.set(pair.projectId, left);
        if (left === 0) {
          projectsDone += 1;
          if (!failedProjects.has(pair.projectId)) projectsClean += 1;
        }
        emitProgress();
      });

      // 4. What the change feed names: tombstones, and rows whose version moved without their timestamp.
      if (!state.fatal && !internal.signal.aborted) {
        const kindSet = new Set(kinds);
        await pool([...withFeed].filter((p) => !failedProjects.has(p)), async (projectId) => {
          try {
            await applyChanges(db!, orgId, projectId, kindSet, report, internal.signal);
            feedCheckedAt.set(projectId, now());
          } catch (err) {
            if (noteFatal(err, projectId)) return;
            if (err instanceof SyncError && err.kind === "aborted") return;
            if (err instanceof SyncError && err.kind === "not_found") {
              if (stored) staleStoredManifest = true;
              return; // the project went away between the pull and the feed: the next sync clears it
            }
            failedProjects.add(projectId);
            projectsClean = Math.max(0, projectsClean - 1);
            issueFor(err, projectId);
          }
        });
      }

      if (stored && staleStoredManifest && !state.fatal) {
        // The stored manifest named a project the service no longer serves to this person: ask for the manifest and run again.
        signal?.removeEventListener("abort", onOuter);
        db.close();
        db = null;
        return run(scope, signal, progressCb, false);
      }

      report.projectsSynced = projectsClean;
      const stop = state.fatal;
      if (stop?.kind === "signed_out") return finish("signed_out");
      if (stop?.kind === "update_required") {
        report.updateRequired = stop.update ?? { current: null, minCompatible: null };
        paused = report.updateRequired;
        return finish("update_required");
      }
      if (signal?.aborted) return finish("partial");

      if (report.issues.length > 0) return finish(projectsClean > 0 || report.itemsStored > 0 ? "partial" : "error");
      if (wholeRun) await db.setMeta(LAST_SYNC_KEY, { at: now() });
      return finish("done");
    } catch (err) {
      if (err instanceof SyncError) {
        report.issues.push({ reason: err.kind, message: err.message });
        if (err.kind === "update_required") {
          report.updateRequired = err.update ?? { current: null, minCompatible: null };
          paused = report.updateRequired;
          return finish("update_required");
        }
        return finish(err.kind === "signed_out" ? "signed_out" : "error");
      }
      report.issues.push({ reason: "store", message: err instanceof Error ? err.message : String(err) });
      return finish("error");
    } finally {
      signal?.removeEventListener("abort", onOuter);
      db?.close();
    }
  }

  function pausedReport(): SyncReport {
    const report = emptyReport("update_required");
    report.updateRequired = paused ?? { current: null, minCompatible: null };
    report.issues.push({ reason: "update_required", message: "PROJEXA on this laptop must be updated before it can sync." });
    return report;
  }

  function runLocked(key: string, scope: { projectId?: string; kind?: string }, signal?: AbortSignal, progressCb?: (p: ReplicaProgress) => void): Promise<SyncReport> {
    // A 426 paused sync: no call leaves this replica until the app has been updated.
    if (paused) return Promise.resolve(pausedReport());
    // The same request while one is already running joins it instead of starting a second copy.
    if (inFlight && inFlightKey === key) return inFlight;
    const start = async (): Promise<SyncReport> => {
      const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
      if (!locks?.request) return run(scope, signal, progressCb);
      // Two tabs of one person must not sync into the same database at once.
      const result = await locks.request(`px-sync:${options.userId}`, { ifAvailable: true }, async (lock) => (lock ? run(scope, signal, progressCb) : null));
      if (result) return result;
      const busy = emptyReport("idle");
      busy.issues.push({ reason: "store", message: "Another tab is already syncing." });
      return busy;
    };
    const p = start().finally(() => { if (inFlight === p) { inFlight = null; inFlightKey = ""; } });
    inFlight = p;
    inFlightKey = key;
    return p;
  }

  return {
    sync: (signal, onProgress) => runLocked("all", {}, signal, onProgress),
    syncProject: (projectId, kind, signal) => runLocked(`p:${projectId}:${kind ?? "*"}`, { projectId, kind }, signal),
    async reconcileDeletes(projectId, kind, o) {
      if (paused) return { removed: 0, skipped: true };
      const db = await openLocalDb(options.idb ?? globalThis.indexedDB, localDbNameFor(options.userId));
      try {
        const manifest = await db.getMeta<StoredManifest>(MANIFEST_KEY);
        if (!manifest) return { removed: 0, skipped: true }; // never synced: nothing here to reconcile
        const controller = new AbortController();
        o?.signal?.addEventListener("abort", () => controller.abort(), { once: true });
        return await reconcilePair(db, manifest.orgId, projectId, kind, controller.signal, o?.force === true);
      } finally {
        db.close();
      }
    },
    resume() { paused = null; },
    getStatus: () => ({ status, report: lastReport }),
  };
}
