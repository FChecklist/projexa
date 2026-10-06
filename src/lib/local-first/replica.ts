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
//      (the repair path for deletes made before change tracking existed) -- and (AUDIT-100 B8) at the next run, at most hourly, for a
//      pair that took rows from a PEER since its last reconcile (a stale peer may hand back a row the server deleted long ago);
//   7. (AUDIT-100 B8) check with the server, by id, the rows a peer said were deleted (an unsigned hint: never a delete by itself).
//   Every server delete in 4-7 leaves a LOCAL TOMBSTONE (local-db.ts schema 5), so no pull, feed page or peer stores that record again
//   at the deleted version or older.
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

import { SYNC_BUSY_MESSAGE } from "./sync-busy";
import {
  PEER_SUSPECT_KEY, SUSPECT_TTL_MS, changeCursorKey, localDbNameFor, openLocalDb, peerTouchedKey, reconcileKey, type LocalDb, type PeerSuspect,
} from "./local-db";
import { createRequestPacer, type RequestPacer } from "./rate-pacer";
import {
  ORG_PROJECT, SYNC_CHANGES_LIMIT, SYNC_ID_LIST_LIMIT, SYNC_PAGE_LIMIT, SyncError, manifestSignInId,
  type SyncChange, type SyncClient, type SyncCursor, type SyncErrorKind, type SyncItem, type SyncManifest, type UpdateRequiredDetails,
} from "./sync-client";
// lf-e7: the organisation kinds and the role / class / epoch rules live in their own files; this one only calls them.
import { ORG_CHECK_KEY, applyClasses, assertPageClass, classSignal, isClassSignal, noteEpoch, resetEverything, resetProject, type ClassSignal } from "./replica-class";
import { ORG_CHECK_EVERY_MS, checkOrganisation, orgKindsOf } from "./replica-org";
import { reportFault } from "./sync-fault-report";

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

export type ReplicaIssue = {
  projectId?: string; kind?: string;
  /** "cooling_down": a run that sent nothing because the breaker stopped an earlier one; "refused": a pair the server answered 400/413. */
  reason: SyncErrorKind | "store" | "org_mismatch" | "user_mismatch" | "no_progress" | "cooling_down" | "refused" | ClassSignal["replicaReason"];
  message: string;
};

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
  /** The project the person is looking at (or opened last): a whole run copies it FIRST so it opens from the laptop while the rest follows. */
  priorityProject?: () => string | null;
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
  /**
   * COST (AUDIT-100 B8): a (project, kind) that took rows from a PEER since its last id-list reconcile is reconciled at its next run -- a
   * one-project run included -- but at most this often, and inside reconcileBudgetPerRun. Default one hour. Without it, a row a stale
   * peer handed back after this laptop's tombstone expired stayed until the weekly repair (feed-covered pairs) or for good (no whole run).
   */
  peerReconcileEveryMs?: number;
  /** COST: a one-project run within this long of that project's last change-feed check, for kinds the feed covers, sends nothing. Default 2 minutes. */
  projectFreshMs?: number;
  /** COST: a one-project run reuses the manifest stored by an earlier run of at most this age instead of asking again. Default 6 hours. */
  manifestMaxAgeMs?: number;
  /**
   * lf-e7 COST: a one-project run (the scheduler's round) also checks the ORGANISATION at most this often: one GET /heads (classes, epoch,
   * the organisation feed's head), plus one /changes only when that head moved. Default one hour.
   */
  orgCheckEveryMs?: number;
  /**
   * COST (package lf-fc, wire:F07): every request this replica sends first waits for this pacer (rate-pacer.ts, 100 a minute in a
   * sliding minute, under the server's 120). Default: a pacer of its own on the real clock. null: no pacing (tests that count only).
   * The app shares one pacer per browser tab (shared-client.ts sharedPacer).
   */
  pacer?: RequestPacer | null;
  /** COST (lf-fc, cost:COST-04): consecutive transport failures (network, timeout, 5xx) that stop a run. Default 3. */
  breakerThreshold?: number;
  /** COST: the first stop after the breaker trips; doubles per consecutive trip up to cooldownCapMs. Defaults 1 minute / 30 minutes. */
  cooldownBaseMs?: number;
  cooldownCapMs?: number;
  /** COST: a 429 WITHOUT Retry-After (the server's daily quota) stops sync at least this long (doubling, capped at 6 h). Default 1 hour. */
  dailyCooldownMs?: number;
  /** COST: a (project, kind) the server refused outright (400 / 413) is not asked again for this long. Default one day. */
  refusedRetryMs?: number;
};

export type Replica = {
  /** Copies every readable project. Safe to call again: it resumes and only pulls changes. */
  sync(signal?: AbortSignal, onProgress?: (progress: ReplicaProgress) => void): Promise<SyncReport>;
  /**
   * Brings one project (optionally one kind) up to date, e.g. in the background after a screen opened it. `moved: true` = the caller
   * KNOWS the project changed (GET /heads said its head passed the stored position, server-step.ts heads mode): the "read a moment
   * ago" shortcut (projectFreshMs) is skipped, since it would otherwise ignore that news for up to two minutes.
   */
  syncProject(projectId: string, kind?: string, signal?: AbortSignal, options?: { moved?: boolean }): Promise<SyncReport>;
  /**
   * Drops local, non-dirty rows of (project, kind) that the server's id list no longer holds. Normally run by sync()
   * after a pair was pulled to the end, at most once a day per pair; `force` runs it now.
   */
  reconcileDeletes(projectId: string, kind: string, options?: { force?: boolean; signal?: AbortSignal }): Promise<{ removed: number; skipped: boolean }>;
  /** Lifts the pause a 426 put on sync (call it once the app has been updated). */
  resume(): void;
  /**
   * COST (package FC): the caller KNOWS this project's feed has nothing past the stored position right now (GET /heads said its head
   * equals it, server-step.ts heads mode). Counts as a feed check for the "read a moment ago" shortcut (projectFreshMs), so a screen
   * opened just after does not ask the feed again. Optional: other Replica implementations may lack it.
   */
  noteFeedCurrent?(projectId: string): void;
  getStatus(): { status: ReplicaStatus; report: SyncReport | null };
};

// ─── meta keys (shared with local-reader.ts) ─────────────────────────────────────────────────────────

export const MANIFEST_KEY = "sync:manifest";
export const LAST_SYNC_KEY = "sync:last";

/**
 * How far back the first /changes request of every run re-reads (CONTRACT.md section 1). The feed's `seq` is taken when a row is written,
 * not when its transaction commits, so a long transaction becomes visible with seqs BELOW a position a laptop already holds; the backend
 * documents this (drizzle/0679 header, KNOWN LIMIT) and asks laptops to re-ask from `after_seq - 200`. Re-reading is idempotent: a version
 * the laptop already holds is skipped without a request. Set to 0 once the backend's commit-order-safe cursor (an xid visibility horizon
 * on projexa_sync_changes) has landed. Review F08.
 */
export const CHANGE_FEED_OVERLAP = 200;
export const cursorKey = (projectId: string, kind: string) => `sync:cursor:${projectId}:${kind}`;
/** Written only when a (project, kind) has been pulled to the end at least once: the reader trusts this, not the cursor. */
export const doneKey = (projectId: string, kind: string) => `sync:done:${projectId}:${kind}`;

/**
 * `feedKinds` (absent in what an older build stored): the kinds whose every change, tombstones included, the change feed
 * carries (manifest `deletes_supported: true`). A pulled-to-the-end pair of such a kind is kept current by the feed alone.
 */
export type StoredManifest = {
  userId: string; orgId: string; projectIds: string[]; kinds: string[]; at: number; feedKinds?: string[];
  /** The manifest said PROJEXA's own AI is on (ai-off/internal-ai.ts). Absent or false: off. */
  internalAi?: boolean;
  /**
   * lf-e7: the ORGANISATION kinds the role may read (stored under project ORG_PROJECT), those the feed carries deletes for, and those
   * that must never move laptop to laptop (manifest `peer_shareable: false`). Absent (an older build or service): none.
   */
  orgKinds?: string[];
  orgFeedKinds?: string[];
  orgNoPeerKinds?: string[];
  /**
   * AUDIT-100 B10: the project NAMES of the manifest this record was written from (id -> name). The shell's own name cache
   * (shell/manifest-cache.ts) is refreshed once a day, so a project made or given today arrived in `projectIds` but showed in the
   * dropdown as "Project <id>" until tomorrow. Absent in a record written by an older build.
   */
  projectNames?: Record<string, string>;
};
export type DoneMarker = { at: number; redacted: boolean; hiddenFields: string[] };
/**
 * A project's change-feed position (meta changeCursorKey). `seq` is all an older build wrote and all other readers use. lf-e7 adds
 * `fresh` (taken by a head read and not moved since) and `noOverlapBelow` (the server's history is pruned below this: do not re-read it).
 */
export type FeedPosition = { seq: number; fresh?: number; noOverlapBelow?: number };
/** The smallest change-log retention the backend's prune accepts (drizzle/0686 projexa_prune_change_log: keep >= 1 day). */
export const FEED_TRUST_MS = 24 * 60 * 60 * 1000;

const defaultYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const FEED_RECONCILE_EVERY_MS = 7 * ONE_DAY_MS;
export const RECONCILE_BUDGET_PER_RUN = 12;
export const PEER_RECONCILE_EVERY_MS = 60 * 60_000;
/** COST (AUDIT-100 B8): at most this many peer `gone` hints are checked with the server per run (one /pull by ids per (project, kind)). */
export const SUSPECTS_PER_RUN = 160;
export const PROJECT_FRESH_MS = 2 * 60_000;
export const MANIFEST_MAX_AGE_MS = 6 * 60 * 60_000;

// ─── COST (package lf-fc, review cost:COST-04 / wire:F07): the circuit breaker ─────────────────────────────────────────────
//
// Before: a pull that failed with a network error, a timeout, a 5xx or a 429 was recorded and the run went on with EVERY remaining
// (project, kind), each with its own retries -- one failed run at P=10 was 851 requests, and every new tab repeated it. Now:
//   * BREAKER_THRESHOLD consecutive transport failures (network / timeout / 5xx), anywhere in the run, stop it at once;
//   * a 429 stops it at once: with Retry-After the pacer holds every request until then; WITHOUT Retry-After (the daily quota,
//     "Try again tomorrow") the stop is long (DAILY_COOLDOWN_MS, doubling, capped at 6 h);
//   * a 403 (the person is not linked / not allowed any more) stops it at once, for an hour;
//   * the stop is stored in the person's database (COOLDOWN_KEY) with an exponential, capped length, so the next run -- a screen's
//     syncProject, the scheduler, ANOTHER TAB -- sends nothing until it ends; a run that finishes "done" clears it;
//   * a (project, kind) the server refuses outright (400 / 413: it will say the same next time) is not asked again for a day.
// Expected cost of a failed run: a handful of requests instead of hundreds (cost/replica-breaker.test.ts).
export const COOLDOWN_KEY = "sync:cooldown";
export const refusedKey = (projectId: string, kind: string) => `sync:refused:${projectId}:${kind}`;
export const BREAKER_THRESHOLD = 3;
export const COOLDOWN_BASE_MS = 60_000;
export const COOLDOWN_CAP_MS = 30 * 60_000;
export const DAILY_COOLDOWN_MS = 60 * 60_000;
export const DAILY_COOLDOWN_CAP_MS = 6 * 60 * 60_000;
export const FORBIDDEN_COOLDOWN_MS = 60 * 60_000;
export const REFUSED_RETRY_MS = ONE_DAY_MS;
export type Cooldown = { until: number; reason: string; trips: number };

const TRANSPORT_FAILURES: ReadonlySet<SyncErrorKind> = new Set(["network", "timeout", "server", "rate_limited"]);

/** Every call of `client` first waits for the pacer. Calls the client does not have stay absent (an older client has no feed). */
function pacedClient(client: SyncClient, pacer: RequestPacer): SyncClient {
  const paced = <A extends unknown[], R>(fn: ((...a: A) => Promise<R>) | undefined): ((...a: A) => Promise<R>) | undefined =>
    typeof fn === "function"
      ? async (...a: A) => {
        await pacer.take(a.find((x): x is AbortSignal => typeof AbortSignal !== "undefined" && x instanceof AbortSignal));
        return fn.apply(client, a);
      }
      : undefined;
  const out: Partial<SyncClient> = {};
  for (const name of ["manifest", "pull", "pullIds", "changes", "ids", "push", "heads"] as const) {
    const fn = paced((client as Record<string, unknown>)[name] as ((...a: unknown[]) => Promise<unknown>) | undefined);
    if (fn) (out as Record<string, unknown>)[name] = fn;
  }
  return out as SyncClient;
}

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

/**
 * The copy order of a first (whole) run: the person's current project first, every other project after it in the service's order.
 * Without this the project they are looking at could be the LAST of ~20 to arrive (first install measured 2026-10-06: the biggest project
 * holds most of the ~28,000 rows and came last), and its screens said "has not finished copying" for minutes.
 */
export function putFirst<T>(items: readonly T[], first: T | null | undefined): T[] {
  if (first === null || first === undefined || !items.includes(first)) return [...items];
  return [first, ...items.filter((x) => x !== first)];
}
function safePriority(get: (() => string | null) | undefined): string | null {
  try { return get ? get() : null; } catch { return null; }
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
  const peerReconcileEveryMs = Math.max(0, options.peerReconcileEveryMs ?? PEER_RECONCILE_EVERY_MS);
  const projectFreshMs = Math.max(0, options.projectFreshMs ?? PROJECT_FRESH_MS);
  const manifestMaxAgeMs = Math.max(0, options.manifestMaxAgeMs ?? MANIFEST_MAX_AGE_MS);
  const orgCheckEveryMs = Math.max(0, options.orgCheckEveryMs ?? ORG_CHECK_EVERY_MS);
  /** When each project's change feed was last read to its end by this replica (memory only: a reload checks again once). */
  const feedCheckedAt = new Map<string, number>();
  const pacer = options.pacer === undefined ? createRequestPacer() : options.pacer;
  const client = pacer ? pacedClient(options.client, pacer) : options.client;
  const breakerThreshold = Math.max(1, options.breakerThreshold ?? BREAKER_THRESHOLD);
  const cooldownBaseMs = Math.max(0, options.cooldownBaseMs ?? COOLDOWN_BASE_MS);
  const cooldownCapMs = Math.max(cooldownBaseMs, options.cooldownCapMs ?? COOLDOWN_CAP_MS);
  const dailyCooldownMs = Math.max(0, options.dailyCooldownMs ?? DAILY_COOLDOWN_MS);
  const refusedRetryMs = Math.max(0, options.refusedRetryMs ?? REFUSED_RETRY_MS);

  /** How long a run stopped by `err` keeps sync quiet, for the `trips`-th consecutive stop. */
  const cooldownFor = (err: SyncError, trips: number): number => {
    const doubling = (base: number, cap: number) => Math.min(cap, base * 2 ** Math.max(0, trips - 1));
    if (err.kind === "rate_limited") {
      return err.retryAfterMs !== undefined
        ? Math.max(err.retryAfterMs, doubling(cooldownBaseMs, cooldownCapMs))
        : doubling(dailyCooldownMs, Math.max(dailyCooldownMs, DAILY_COOLDOWN_CAP_MS));
    }
    if (err.status === 403) return FORBIDDEN_COOLDOWN_MS;
    return doubling(cooldownBaseMs, cooldownCapMs);
  };

  // A client object without the version-aware calls (an older build, a minimal test double) is still a valid client:
  // it simply has no change feed and no id list, so those two steps are skipped for it.
  const hasFeed = typeof client.changes === "function" && typeof client.pullIds === "function";
  const hasIds = typeof client.ids === "function";

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
      const delVersions: Record<string, number> = {};
      for (const item of last.values()) {
        const id = `${kind}:${item.id}`;
        if (item.deleted) { dels.push(id); if (item.version !== undefined) delVersions[id] = item.version; }
        else {
          puts.push({
            id, type: kind, orgId, projectId, data: item.data,
            updatedAt: Date.parse(item.updated_at) || now(),
            serverUpdatedAt: item.updated_at,
            // An older service sends no version/signature: the row is stored without them, as before.
            ...(item.version !== undefined ? { serverVersion: item.version } : {}),
            ...(item.sig ? { sig: item.sig } : {}),
            ...(item.sig && kid ? { kid } : {}),
            // lf-e9: the px3 signature travels on to peers with the row (only next to a px2 one: a peer needs both)
            ...(item.sig && kid && item.sig3 ? { sig3: item.sig3 } : {}),
          });
        }
      }
      options.onChunk?.(chunk.length);
      // fromServer: a dirty row (a pending local edit) is never overwritten or deleted by this; local-db.ts parks the news instead.
      const stored = await db.putRecords(puts, { fromServer: true }); // not `+= await`: that reads the old total before the await and loses a concurrent worker's update
      report.itemsStored += stored;
      // AUDIT-100 B8: a server delete leaves a tombstone, so an older copy (a stale peer's) is never stored again
      const removed = await db.deleteRecords(dels, { fromServer: true, tombstone: { orgId, projectId, versions: delVersions } });
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
      const page = await client.pull({ projectId, kind, after: cursor, limit: pageLimit }, signal);
      await assertPageClass(db, projectId, page); // lf-e7: a page cut for another role is never stored beside this project's rows
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
      const head = await client.changes({ projectId, afterSeq: null, limit: 1 }, signal);
      if ((await noteEpoch(db, head.epoch)) === "changed") throw classSignal("epoch_changed", { epoch: head.epoch });
      // `fresh` (lf-e7): this position came from a head read taken right before a whole pull (at `fresh`, ms), not moved since
      await db.setMeta(changeCursorKey(projectId), { seq: head.head_seq, fresh: now() } satisfies FeedPosition);
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
    const delVersions: Record<string, number> = {};
    const candidates: SyncChange[] = [];
    for (const [fullId, change] of latest) {
      if (change.op === "D") { dels.push(fullId); delVersions[fullId] = change.version; }
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
      // AUDIT-100 B8: the D's version is kept as a tombstone: a peer still holding that version (or an older one) cannot hand it back
      const removed = await db.deleteRecords(dels, { fromServer: true, tombstone: { orgId, projectId, versions: delVersions } });
      report.itemsRemoved += removed;
      report.changesApplied += removed;
    }
    for (const [kind, ids] of toFetch) {
      if (signal.aborted) throw new SyncError("aborted", "The sync was cancelled.");
      const page = await client.pullIds({ projectId, kind, ids }, signal);
      await assertPageClass(db, projectId, page);
      await storePage(db, orgId, projectId, kind, page.items, report, page.kid);
      report.changesApplied += page.items.length;
    }
  }

  async function applyChanges(db: LocalDb, orgId: string, projectId: string, kinds: Set<string>, report: SyncReport, signal: AbortSignal) {
    const stored = await db.getMeta<FeedPosition | null>(changeCursorKey(projectId));
    if (!stored || typeof stored.seq !== "number") return;
    let cursor = stored.seq;
    let fresh = typeof stored.fresh === "number" ? stored.fresh : null;
    // lf-e7: below this the server's history is known to be pruned (an earlier overlap re-read was refused there), so it is not asked again
    let noOverlapBelow = typeof stored.noOverlapBelow === "number" ? stored.noOverlapBelow : 0;
    // The first page of a run re-reads CHANGE_FEED_OVERLAP positions; the stored position itself never moves backwards.
    let ask = Math.min(cursor, Math.max(0, cursor - CHANGE_FEED_OVERLAP, noOverlapBelow));
    for (let pageNo = 0; pageNo < maxPages; pageNo += 1) {
      if (signal.aborted) throw new SyncError("aborted", "The sync was cancelled.");
      const page = await client.changes({ projectId, afterSeq: ask, limit: SYNC_CHANGES_LIMIT }, signal);
      // lf-e7: a new epoch makes every version here meaningless; reset_required makes this project's position useless. Both are acted
      // on by run() (resetEverything / resetProject, then one more run); nothing of this page is applied.
      if ((await noteEpoch(db, page.epoch)) === "changed") throw classSignal("epoch_changed", { epoch: page.epoch });
      if (page.reset_required) {
        // The overlap re-read (ask below our own position) can reach under the server's pruned history (its floor) when our position
        // sits just above it: that is not a stale laptop. Ask again from our own position first, and remember not to reach below it
        // again; only a refusal THERE is a real reset (without this, every run after a prune would re-download the project).
        if (ask < cursor) {
          ask = cursor;
          noOverlapBelow = cursor;
          await db.setMeta(changeCursorKey(projectId), { seq: cursor, noOverlapBelow, ...(fresh !== null ? { fresh } : {}) } satisfies FeedPosition);
          continue;
        }
        // A position taken by a head read less than FEED_TRUST_MS ago (right before a whole pull, never moved since), with nothing on
        // the server after it: a resync would land exactly here again. The prune only removes history older than its retention (at
        // least one day, drizzle/0686), so nothing after this position can have been pruned: this is the server answering a head BELOW
        // its own floor (a feed whose whole history was pruned and that has been quiet since; reported to the backend), not a stale
        // laptop. Carry on. An older position is reset as usual (at most one such resync a day).
        if (fresh !== null && now() - fresh < FEED_TRUST_MS && page.head_seq <= cursor) return;
        throw classSignal("reset_required", { projectId });
      }
      await applyChangePage(db, orgId, projectId, kinds, page.changes, report, signal);
      if (page.has_more && page.next_seq <= ask) {
        throw Object.assign(new Error("The change feed said there is more but did not move."), { replicaReason: "no_progress" as const });
      }
      // The page's effects are stored: only now may the feed position move.
      if (page.next_seq > cursor) {
        await db.setMeta(changeCursorKey(projectId), { seq: page.next_seq, ...(noOverlapBelow > 0 ? { noOverlapBelow } : {}) } satisfies FeedPosition);
        cursor = page.next_seq;
        fresh = null;
      }
      ask = Math.max(ask, page.next_seq);
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
      await db.setMeta(peerTouchedKey(projectId, kind), null);
      return { removed: 0, skipped: true };
    }
    const onServer = new Set<string>();
    let after: string | null = null;
    for (let pageNo = 0; ; pageNo += 1) {
      if (pageNo >= maxPages) throw Object.assign(new Error("The sync service sent more id pages than allowed."), { replicaReason: "no_progress" as const });
      if (signal.aborted) throw new SyncError("aborted", "The sync was cancelled.");
      const page = await client.ids({ projectId, kind, afterId: after, limit: SYNC_ID_LIST_LIMIT }, signal);
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
    // AUDIT-100 B8: the server no longer lists them, so each leaves a tombstone at the version this laptop held (a peer cannot hand it back)
    const removed = await db.deleteRecords(gone, { fromServer: true, tombstone: { orgId, projectId } });
    await db.setMeta(reconcileKey(projectId, kind), { at: now() });
    await db.setMeta(peerTouchedKey(projectId, kind), null); // the peer rows of this pair are now checked against the server
    return { removed, skipped: false };
  }

  // ─── peer `gone` hints (AUDIT-100 B8) ───────────────────────────────────────────────────────────────────────
  //
  // A peer that holds a tombstone tells a laptop still holding the row (protocol.ts `gone`). That message is NOT signed (the server signs
  // rows, never deletions), so it never deletes anything by itself: the row is only kept out of sharing (localdb-store.ts) and checked here
  // with the server -- one /pull by ids per (project, kind), at most SUSPECTS_PER_RUN ids per run. Served live: stored (and the hint
  // dropped). Served `deleted`, or not served at all: removed WITH a tombstone, exactly like a delete read from the change feed.
  async function verifySuspects(db: LocalDb, orgId: string, projects: Set<string>, kinds: (projectId: string) => Set<string>, report: SyncReport, signal: AbortSignal): Promise<void> {
    const all = ((await db.getMeta<PeerSuspect[] | null>(PEER_SUSPECT_KEY)) ?? []).filter((s) => now() - s.at < SUSPECT_TTL_MS);
    const mine = all.filter((s) => projects.has(s.project) && kinds(s.project).has(s.kind)).slice(0, SUSPECTS_PER_RUN);
    if (mine.length === 0) return;
    const groups = new Map<string, PeerSuspect[]>();
    for (const s of mine) {
      const key = `${s.project}|${s.kind}`;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    const settled = new Set<string>();
    for (const list of groups.values()) {
      if (signal.aborted) throw new SyncError("aborted", "The sync was cancelled.");
      const { project, kind } = list[0]!;
      const page = await client.pullIds({ projectId: project, kind, ids: list.map((s) => s.id) }, signal);
      await assertPageClass(db, project, page);
      const served = new Map(page.items.map((i) => [i.id, i]));
      const live = page.items.filter((i) => !i.deleted);
      if (live.length) await storePage(db, orgId, project, kind, live, report, page.kid);
      const gone = list.filter((s) => !served.has(s.id) || served.get(s.id)!.deleted).map((s) => `${kind}:${s.id}`);
      const versions: Record<string, number> = {};
      for (const s of list) { const v = served.get(s.id)?.version; if (v !== undefined) versions[`${kind}:${s.id}`] = v; }
      if (gone.length) {
        const removed = await db.deleteRecords(gone, { fromServer: true, tombstone: { orgId, projectId: project, versions } });
        report.itemsRemoved += removed;
        report.changesApplied += removed;
      }
      for (const s of list) settled.add(`${s.project}|${s.kind}|${s.id}`);
    }
    // re-read: a peer may have added hints while the server was asked
    const now_ = ((await db.getMeta<PeerSuspect[] | null>(PEER_SUSPECT_KEY)) ?? []).filter((s) => now() - s.at < SUSPECT_TTL_MS);
    await db.setMeta(PEER_SUSPECT_KEY, now_.filter((s) => !settled.has(`${s.project}|${s.kind}|${s.id}`)));
  }

  // ─── one run ───────────────────────────────────────────────────────────────────────────────────────────────

  async function run(scope: { projectId?: string; kind?: string; moved?: boolean }, signal?: AbortSignal, progressCb?: (p: ReplicaProgress) => void, allowStored = true, retried = false): Promise<SyncReport> {
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
    /** COST: stores the stop that `err` (the error that tripped the breaker) asks for; the next run of any tab respects it. */
    const startCooldown = async (err: SyncError) => {
      if (!db) return;
      const prev = await db.getMeta<Cooldown | null>(COOLDOWN_KEY).catch(() => null);
      const trips = (prev && typeof prev.trips === "number" ? prev.trips : 0) + 1;
      const ms = cooldownFor(err, trips);
      await db.setMeta(COOLDOWN_KEY, { until: now() + ms, reason: err.kind, trips } satisfies Cooldown).catch(() => {});
      if (err.kind === "rate_limited" && err.retryAfterMs !== undefined) pacer?.pauseFor(err.retryAfterMs);
      report.issues.push({ reason: err.kind, message: `Sync stopped after the sync service failed (${err.message}); it tries again in about ${Math.max(1, Math.round(ms / 60_000))} minute(s).` });
    };
    try {
      db = await openLocalDb(options.idb ?? globalThis.indexedDB, localDbNameFor(options.userId));
      const wholeRun = scope.projectId === undefined;

      // COST (cost:COST-04): an earlier run was stopped by the breaker and its stop has not ended: send nothing at all.
      const cooling = await db.getMeta<Cooldown | null>(COOLDOWN_KEY);
      if (cooling && typeof cooling.until === "number" && now() < cooling.until) {
        report.issues.push({ reason: "cooling_down", message: "Sync is paused for a few minutes after the sync service failed; it tries again by itself." });
        return finish("error");
      }

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
      let internalAi = false;
      // lf-e7: the organisation kinds the role may read (synced under ORG_PROJECT in a whole run), and the classes the server cuts for now
      let org = { kinds: stored?.orgKinds ?? [], feedKinds: stored?.orgFeedKinds ?? [], noPeerKinds: stored?.orgNoPeerKinds ?? [] };
      let freshManifest: SyncManifest | null = null;
      if (stored) {
        orgId = stored.orgId;
        kinds = stored.kinds;
        feedKinds = new Set(stored.feedKinds);
        projectIds = stored.projectIds;
      } else {
        const manifest = await client.manifest(internal.signal);
        // The laptop knows its person by the SIGN-IN id; the manifest says whose it is in user.auth_user_id (manifestSignInId; client review F01).
        if (manifestSignInId(manifest) !== options.userId) {
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
        projectIds = manifest.projects.map((p) => p.id).filter((id) => id !== ORG_PROJECT);
        internalAi = manifest.internal_ai === true;
        org = orgKindsOf(manifest);
        freshManifest = manifest;
      }
      const orgFeedKinds = new Set(org.feedKinds);
      const isFeedKind = (projectId: string, kind: string) => (projectId === ORG_PROJECT ? orgFeedKinds : feedKinds).has(kind);
      /** Every kind whose positions a reset must clear: what this run knows and what the stored manifest knew. */
      const allProjectKinds = [...new Set([...(previous?.kinds ?? []), ...kinds])];
      const allOrgKinds = [...new Set([...(previous?.orgKinds ?? []), ...org.kinds])];

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

      const targetProjects = wholeRun ? putFirst(projectIds, safePriority(options.priorityProject)) : projectIds.filter((id) => id === scope.projectId);
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

      // lf-e7: the manifest's view of the person, applied BEFORE any pull: a project (or the organisation) whose recorded class differs is
      // reset (its rows were redacted for another role), an organisation kind the role may no longer read leaves, the classes are recorded.
      if (freshManifest) {
        const outcome = await applyClasses(db, {
          orgId, projects: projectIds, viewClass: freshManifest.view_class, orgViewClass: freshManifest.org_view_class,
          projectKinds: allProjectKinds, orgKinds: allOrgKinds, orgKindsNow: org.kinds, orgKindsBefore: previous?.orgKinds ?? [], now: now(),
        });
        report.itemsRemoved += outcome.removed;
        // a one-project run re-pulls only its own project: the next scheduler round must be a whole one for the others
        if (!wholeRun && outcome.reset.some((p) => p !== scope.projectId)) await db.setMeta(LAST_SYNC_KEY, null);
      }

      // Written before any pull, so a reader always knows the organisation of whatever a half-finished run stored. A run that
      // reused the stored manifest learned nothing new about it, so it leaves it (and its age) as it is.
      if (!stored) {
        const freshNames = Object.fromEntries((freshManifest?.projects ?? []).filter((p) => typeof p.name === "string" && p.name.trim()).map((p) => [p.id, p.name as string]));
        await db.setMeta(MANIFEST_KEY, {
          userId: options.userId, orgId,
          projectIds: wholeRun ? projectIds : [...new Set([...(previous?.projectIds ?? []), ...targetProjects])],
          kinds, at: now(), feedKinds: [...feedKinds], ...(internalAi ? { internalAi: true } : {}),
          orgKinds: org.kinds, orgFeedKinds: org.feedKinds, orgNoPeerKinds: org.noPeerKinds,
          projectNames: wholeRun ? freshNames : { ...(previous?.userId === options.userId ? previous?.projectNames ?? {} : {}), ...freshNames },
        } satisfies StoredManifest);
      }

      // A pair the feed keeps current: its project has a feed position, the feed carries the kind's deletes, and it was pulled
      // to the end once. Its keyset pull would only ever return what the feed already names, so it is not asked again.
      const feedCovered = async (projectId: string, kind: string): Promise<boolean> =>
        isFeedKind(projectId, kind)
        && !!(await db!.getMeta<{ seq: number } | null>(changeCursorKey(projectId)))
        && !!(await db!.getMeta<DoneMarker | null>(doneKey(projectId, kind)));

      // COST: the same project was read to the end of its feed a moment ago (a screen opened twice, the scheduler right after a
      // screen) and every asked kind is feed-covered: nothing can be learned by asking again so soon.
      if (!wholeRun && hasFeed && projectFreshMs > 0 && !scope.moved) {
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
      const state: { fatal: SyncError | null; tripped: SyncError | null; consecutive: number } = { fatal: null, tripped: null, consecutive: 0 };
      /**
       * COST (cost:COST-04): the circuit breaker. Called with every request failure (and with nothing after every success). Returns true
       * when the run must stop: a 429 or a 403 at once, network / timeout / 5xx after `breakerThreshold` in a row. Stopping aborts every
       * worker of this run; the remaining pairs are not tried.
       */
      const noteTransport = (err?: unknown): boolean => {
        if (state.tripped) return true;
        if (err === undefined) { state.consecutive = 0; return false; }
        if (!(err instanceof SyncError)) return false;
        const now403 = err.kind === "bad_response" && err.status === 403;
        if (!TRANSPORT_FAILURES.has(err.kind) && !now403) return false;
        state.consecutive += 1;
        if (err.kind === "rate_limited" || now403 || state.consecutive >= breakerThreshold) {
          state.tripped = err;
          internal.abort();
          return true;
        }
        return false;
      };
      const noteFatal = (err: unknown, projectId?: string, kind?: string): boolean => {
        if (err instanceof SyncError && (err.kind === "signed_out" || err.kind === "update_required")) {
          if (!state.fatal) state.fatal = err;
          report.issues.push({ projectId, kind, reason: err.kind, message: err.message });
          internal.abort();
          return true;
        }
        return false;
      };
      // lf-e7: what a step learned about classes, the epoch or a project's feed position; acted on after the pools, then one more run.
      const signals = { classChanged: false, epoch: null as string | null, resets: new Set<string>() };
      const noteSignal = (err: unknown): boolean => {
        if (!isClassSignal(err)) return false;
        if (err.replicaReason === "class_changed") signals.classChanged = true;
        else if (err.replicaReason === "epoch_changed") signals.epoch = err.epoch ?? signals.epoch;
        else if (err.projectId) signals.resets.add(err.projectId);
        if (retried) report.issues.push({ projectId: err.projectId, reason: err.replicaReason, message: err.message }); // twice in a row: say so
        return true;
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
      // lf-e7: a whole run also copies the ORGANISATION kinds the role may read, as one more "project" (ORG_PROJECT) with its own feed.
      const orgInRun = wholeRun && org.kinds.length > 0;
      const withFeed = new Set<string>();
      await pool(hasFeed ? (orgInRun ? [...targetProjects, ORG_PROJECT] : targetProjects) : [], async (projectId) => {
        try {
          if (await ensureChangeCursor(db!, projectId, internal.signal)) withFeed.add(projectId);
          noteTransport();
        } catch (err) {
          if (noteFatal(err, projectId)) return;
          if (noteSignal(err)) return;
          if (noteTransport(err)) return;
          if (err instanceof SyncError && err.kind === "aborted") return;
          // Without the position nothing could be pulled safely (a later read of the head would skip what changed meanwhile).
          failedProjects.add(projectId);
          issueFor(err, projectId);
        }
      });

      // 2. The full / incremental pulls.
      const pullable = targetProjects.filter((p) => !failedProjects.has(p));
      const pairs = pullable.flatMap((p) => targetKinds.map((k) => ({ projectId: p, kind: k })));
      if (orgInRun && !failedProjects.has(ORG_PROJECT)) for (const k of org.kinds) pairs.push({ projectId: ORG_PROJECT, kind: k });
      const remaining = new Map(pullable.map((p) => [p, targetKinds.length]));
      let pairsDone = 0;
      let projectsDone = failedProjects.size - (failedProjects.has(ORG_PROJECT) ? 1 : 0); // the organisation is not one of the person's projects
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
          const onFeed = withFeed.has(pair.projectId) && isFeedKind(pair.projectId, pair.kind);
          const covered = onFeed && (await feedCovered(pair.projectId, pair.kind));
          const fromScratch = !covered && ((await db!.getMeta<SyncCursor | null>(cursorKey(pair.projectId, pair.kind))) ?? null) === null;
          // COST (cost:COST-04): the server refused this pair outright (400 / 413) less than `refusedRetryMs` ago: it would say the
          // same again, so nothing is sent; the pair is reported, not retried in a loop.
          if (!covered) {
            const refused = await db!.getMeta<{ at: number; status: number } | null>(refusedKey(pair.projectId, pair.kind));
            if (refused && typeof refused.at === "number" && now() - refused.at < refusedRetryMs) {
              throw Object.assign(new Error(`The sync service refused this data (${refused.status}); it is asked again later.`), { replicaReason: "refused" as const, skipped: true });
            }
          }
          // COST: a feed-covered pair is brought up to date by step 4 (the feed), not by another keyset sweep.
          if (!covered) await pullPair(db!, orgId, pair.projectId, pair.kind, report, internal.signal);
          noteTransport();
          // 3. Repair deletes made before change tracking existed (never fatal, never a report issue). COST: only in a whole run,
          // at most `reconcileBudgetPerRun` id lists per run; a feed-covered pair at most weekly; a pair just copied from scratch
          // AFTER its feed position was taken cannot hold such a delete, so it is stamped without a call.
          try {
            let result = { removed: 0 };
            // AUDIT-100 B8: rows came from a PEER since the last reconcile: check the pair against the id list now (any run, at most hourly)
            const touched = hasIds ? await db!.getMeta<{ at: number } | null>(peerTouchedKey(pair.projectId, pair.kind)) : null;
            if (touched && repairsLeft > 0) {
              const r = await reconcilePair(db!, orgId, pair.projectId, pair.kind, internal.signal, false, peerReconcileEveryMs);
              if (!r.skipped) repairsLeft -= 1;
              result = r;
            } else if (hasIds && wholeRun) {
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
            if (noteTransport(err)) return;
            // not_found: an older service has no /ids -- stamp the day so it is not asked again; anything else: try again next sync.
            if (err instanceof SyncError && err.kind === "not_found") await db!.setMeta(reconcileKey(pair.projectId, pair.kind), { at: now() });
          }
        } catch (err) {
          failedProjects.add(pair.projectId);
          const syncKind = err instanceof SyncError ? err.kind : null;
          if (noteFatal(err, pair.projectId, pair.kind)) return;
          if (noteSignal(err)) return;
          if (noteTransport(err)) return;
          if (syncKind === "aborted") return;
          // 400 / 413: a refusal, not a passing failure -- remembered so the pair is not asked again tomorrow (cost:COST-04).
          if (err instanceof SyncError && err.kind === "bad_response" && (err.status === 400 || err.status === 413)) {
            await db!.setMeta(refusedKey(pair.projectId, pair.kind), { at: now(), status: err.status }).catch(() => {});
          }
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
        if (pair.projectId === ORG_PROJECT) { emitProgress(); return; } // the organisation's pairs are not a project's
        const left = (remaining.get(pair.projectId) ?? 1) - 1;
        remaining.set(pair.projectId, left);
        if (left === 0) {
          projectsDone += 1;
          if (!failedProjects.has(pair.projectId)) projectsClean += 1;
        }
        emitProgress();
      });

      // 4. What the change feed names: tombstones, and rows whose version moved without their timestamp.
      if (!state.fatal && !state.tripped && !internal.signal.aborted) {
        const kindSet = new Set(kinds);
        const orgKindSet = new Set(org.kinds);
        await pool([...withFeed].filter((p) => !failedProjects.has(p)), async (projectId) => {
          try {
            await applyChanges(db!, orgId, projectId, projectId === ORG_PROJECT ? orgKindSet : kindSet, report, internal.signal);
            feedCheckedAt.set(projectId, now());
            noteTransport();
            if (projectId === ORG_PROJECT) await db!.setMeta(ORG_CHECK_KEY, { at: now() });
          } catch (err) {
            if (noteFatal(err, projectId)) return;
            if (noteSignal(err)) return;
            if (noteTransport(err)) return;
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

      // 5. AUDIT-100 B8: rows a peer said were deleted, checked with the server (never deleted on the peer's word alone).
      if (hasFeed && !state.fatal && !state.tripped && !internal.signal.aborted) {
        const kindSet = new Set(kinds);
        const orgKindSet = new Set(org.kinds);
        const inScope = new Set(targetProjects.filter((p) => !failedProjects.has(p)));
        if (orgInRun && !failedProjects.has(ORG_PROJECT)) inScope.add(ORG_PROJECT);
        try {
          await verifySuspects(db, orgId, inScope, (p) => (p === ORG_PROJECT ? orgKindSet : kindSet), report, internal.signal);
          noteTransport();
        } catch (err) {
          if (!noteFatal(err) && !noteSignal(err) && !noteTransport(err) && !(err instanceof SyncError && (err.kind === "aborted" || err.kind === "not_found"))) {
            report.issues.push({ reason: err instanceof SyncError ? err.kind : "store", message: `Checking rows another laptop said were deleted failed: ${err instanceof Error ? err.message : String(err)}` });
          }
        }
      }

      // COST (cost:COST-04): the breaker stopped this run. The stop is stored, so nothing is asked until it ends.
      if (state.tripped && !state.fatal) {
        await startCooldown(state.tripped);
        report.projectsSynced = projectsClean;
        return finish(projectsClean > 0 || report.itemsStored > 0 ? "partial" : "error");
      }

      // lf-e7: a one-project run (the scheduler's round) also looks at the ORGANISATION, at most every `orgCheckEveryMs`: one /heads
      // (classes, epoch, the organisation feed's head) and a /changes only when that head moved. A screen's kind-scoped run never does.
      if (!wholeRun && !scope.kind && hasFeed && org.kinds.length > 0 && !state.fatal && !internal.signal.aborted) {
        try {
          await checkOrganisation({
            db, client, signal: internal.signal, now: now(), everyMs: orgCheckEveryMs, projectIds,
            applyOrgFeed: () => applyChanges(db!, orgId, ORG_PROJECT, new Set(org.kinds), report, internal.signal),
          });
        } catch (err) {
          if (!noteFatal(err, ORG_PROJECT) && !noteSignal(err) && !(err instanceof SyncError && err.kind === "aborted")) issueFor(err, ORG_PROJECT);
        }
      }

      if (stored && staleStoredManifest && !state.fatal) {
        // The stored manifest named a project the service no longer serves to this person: ask for the manifest and run again.
        signal?.removeEventListener("abort", onOuter);
        db.close();
        db = null;
        return run(scope, signal, progressCb, false, retried);
      }

      // lf-e7: what the steps learned, acted on once every step has stopped writing: a new epoch resets everything, reset_required one
      // project; a class change is applied by the fresh manifest of the next run (applyClasses). Then ONE more run brings it all back.
      // Dirty rows, the outbox and the drafts are never touched. A second run that learns the same again says so in the report instead.
      if (!state.fatal && !retried && (signals.epoch || signals.resets.size > 0 || signals.classChanged)) {
        const everyProject = [...new Set([...(previous?.projectIds ?? []), ...projectIds])];
        if (signals.epoch) {
          report.itemsRemoved += await resetEverything(db, orgId, everyProject, [...allProjectKinds, ...allOrgKinds], signals.epoch);
        } else {
          for (const p of signals.resets) report.itemsRemoved += await resetProject(db, orgId, p, p === ORG_PROJECT ? allOrgKinds : allProjectKinds);
        }
        // a one-project run brings back only its own project: the next scheduler round is a whole one for the rest
        if (!wholeRun && (signals.epoch || [...signals.resets].some((p) => p !== scope.projectId))) await db.setMeta(LAST_SYNC_KEY, null);
        signal?.removeEventListener("abort", onOuter);
        db.close();
        db = null;
        return run(scope, signal, progressCb, signals.classChanged ? false : allowStored, true);
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
      if (cooling) await db.setMeta(COOLDOWN_KEY, null); // a clean run ends the breaker's escalation
      return finish("done");
    } catch (err) {
      reportFault("replica:sync", err); // B57: the pull failed for a reason that is not "offline" / "signed out"
      if (err instanceof SyncError) {
        report.issues.push({ reason: err.kind, message: err.message });
        // The manifest itself failed (after the client's retries): the same stop as a tripped breaker (cost:COST-04).
        if (TRANSPORT_FAILURES.has(err.kind) || (err.kind === "bad_response" && err.status === 403)) await startCooldown(err).catch(() => {});
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

  function runLocked(key: string, scope: { projectId?: string; kind?: string; moved?: boolean }, signal?: AbortSignal, progressCb?: (p: ReplicaProgress) => void): Promise<SyncReport> {
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
      busy.issues.push({ reason: "store", message: SYNC_BUSY_MESSAGE });
      return busy;
    };
    const p = start().finally(() => { if (inFlight === p) { inFlight = null; inFlightKey = ""; } });
    inFlight = p;
    inFlightKey = key;
    return p;
  }

  return {
    sync: (signal, onProgress) => runLocked("all", {}, signal, onProgress),
    // A `moved` run never joins a plain one already in flight (that one may end on the "read a moment ago" shortcut).
    syncProject: (projectId, kind, signal, o) => runLocked(`p:${projectId}:${kind ?? "*"}${o?.moved ? ":moved" : ""}`, { projectId, kind, moved: o?.moved === true }, signal),
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
    noteFeedCurrent(projectId) { feedCheckedAt.set(projectId, now()); },
    getStatus: () => ({ status, report: lastReport }),
  };
}
