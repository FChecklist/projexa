// LOCAL-FIRST slice 2 (owner directive 2026-10-02): the sync engine that copies the projects a person may
// already read into that laptop's own IndexedDB, so screens read from the laptop first.
//
// What it does, in order:
//   1. read the manifest (who the token belongs to, which projects, which kinds);
//   2. for every project x kind, pull pages until has_more is false, store each page, THEN advance the
//      stored cursor, so an interrupted sync resumes where it stopped and a later sync pulls only changes;
//   3. apply `deleted: true` as removal; drop projects the person no longer belongs to.
//
// Guarantees (each one has a test in replica.test.ts):
//   * the cursor moves only after its page is stored (a failing page keeps the earlier pages);
//   * a record of another organisation is never stored, and never overwrites one;
//   * one database per signed-in person (localDbNameFor), and a manifest for a different person is refused,
//     so two people on one laptop never mix;
//   * pages are processed one at a time and written in small chunks with a yield to the main thread between
//     them, so 10,000 rows never freeze the screen and are never all held in memory;
//   * at most two pulls are in flight; errors become a report/status, they are never thrown into the UI.
//
// Browser data is a cache and a proposal, never authority: money and approval figures are revalidated on
// the server (owner-approved safeguard). This file only reads.

import { localDbNameFor, openLocalDb, type LocalDb } from "./local-db";
import { SYNC_PAGE_LIMIT, SyncError, type SyncClient, type SyncCursor, type SyncErrorKind, type SyncItem, type SyncManifest } from "./sync-client";

export type ReplicaStatus = "idle" | "syncing" | "done" | "partial" | "signed_out" | "error";

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
  issues: ReplicaIssue[];
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
};

export type Replica = {
  /** Copies every readable project. Safe to call again: it resumes and only pulls changes. */
  sync(signal?: AbortSignal, onProgress?: (progress: ReplicaProgress) => void): Promise<SyncReport>;
  /** Brings one project (optionally one kind) up to date, e.g. in the background after a screen opened it. */
  syncProject(projectId: string, kind?: string, signal?: AbortSignal): Promise<SyncReport>;
  getStatus(): { status: ReplicaStatus; report: SyncReport | null };
};

// ─── meta keys (shared with local-reader.ts) ─────────────────────────────────────────────────────────

export const MANIFEST_KEY = "sync:manifest";
export const LAST_SYNC_KEY = "sync:last";
export const cursorKey = (projectId: string, kind: string) => `sync:cursor:${projectId}:${kind}`;
/** Written only when a (project, kind) has been pulled to the end at least once: the reader trusts this, not the cursor. */
export const doneKey = (projectId: string, kind: string) => `sync:done:${projectId}:${kind}`;

export type StoredManifest = { userId: string; orgId: string; projectIds: string[]; kinds: string[]; at: number };
export type DoneMarker = { at: number; redacted: boolean; hiddenFields: string[] };

const defaultYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function emptyReport(status: ReplicaStatus): SyncReport {
  return { status, projectsTotal: 0, projectsSynced: 0, itemsStored: 0, itemsRemoved: 0, issues: [], syncedAt: null };
}

function isProjectScoped(k: SyncManifest["kinds"][number]): boolean {
  return k.project_scoped !== false;
}

/** A row that names another organisation inside its own data is refused outright, whatever the manifest said. */
function foreignOrg(data: unknown, orgId: string): boolean {
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

  let status: ReplicaStatus = "idle";
  let lastReport: SyncReport | null = null;
  let inFlight: Promise<SyncReport> | null = null;
  let inFlightKey = "";

  const setStatus = (next: ReplicaStatus, report: SyncReport | null) => {
    status = next;
    if (report) lastReport = report;
    options.onStatus?.(next, report);
  };

  async function storePage(db: LocalDb, orgId: string, projectId: string, kind: string, items: SyncItem[], report: SyncReport) {
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
        else puts.push({ id, type: kind, orgId, projectId, data: item.data, updatedAt: Date.parse(item.updated_at) || now() });
      }
      options.onChunk?.(chunk.length);
      const stored = await db.putRecords(puts); // not `+= await`: that reads the old total before the await and loses a concurrent worker's update
      report.itemsStored += stored;
      const removed = await db.deleteRecords(dels);
      report.itemsRemoved += removed;
      await yieldFn();
    }
  }

  async function clearPair(db: LocalDb, orgId: string, projectId: string, kind: string, report: SyncReport) {
    const rows = await db.listByProject(orgId, kind, projectId);
    const removed = await db.deleteRecords(rows.map((r) => r.id));
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
      await storePage(db, orgId, projectId, kind, page.items, report);
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

  async function run(scope: { projectId?: string; kind?: string }, signal?: AbortSignal, progressCb?: (p: ReplicaProgress) => void): Promise<SyncReport> {
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

    try {
      db = await openLocalDb(options.idb ?? globalThis.indexedDB, localDbNameFor(options.userId));
      const manifest = await options.client.manifest(internal.signal);

      if (manifest.user.id !== options.userId) {
        report.issues.push({ reason: "user_mismatch", message: "The sign-in on this laptop does not match the person this workspace belongs to." });
        return finish("error");
      }
      const orgId = manifest.user.org_id;
      const previous = await db.getMeta<StoredManifest>(MANIFEST_KEY);
      if (previous && previous.orgId !== orgId) {
        report.issues.push({ reason: "org_mismatch", message: "This laptop's copy belongs to a different organisation, so nothing was synced." });
        return finish("error");
      }

      const kinds = manifest.kinds.filter(isProjectScoped).map((k) => k.kind);
      const projectIds = manifest.projects.map((p) => p.id);
      const wholeRun = scope.projectId === undefined;

      // Projects this person no longer belongs to leave the laptop (only on a full run: a partial one has no full list to compare).
      if (wholeRun && previous) {
        for (const gone of previous.projectIds.filter((id) => !projectIds.includes(id))) {
          const removed = await db.deleteByProject(orgId, gone);
          report.itemsRemoved += removed;
          for (const kind of new Set([...previous.kinds, ...kinds])) {
            await db.setMeta(cursorKey(gone, kind), null);
            await db.setMeta(doneKey(gone, kind), null);
          }
        }
      }

      const targetProjects = wholeRun ? projectIds : projectIds.filter((id) => id === scope.projectId);
      const targetKinds = scope.kind ? kinds.filter((k) => k === scope.kind) : kinds;
      if (!wholeRun && targetProjects.length === 0) {
        // Asked for a project the service does not list: the person cannot read it, so nothing of it may stay here.
        const removed = await db.deleteByProject(orgId, scope.projectId!);
        report.itemsRemoved += removed;
        report.issues.push({ projectId: scope.projectId, reason: "not_found", message: "That project is not available to you." });
        return finish("partial");
      }

      // Written before any pull, so a reader always knows the organisation of whatever a half-finished run stored.
      await db.setMeta(MANIFEST_KEY, {
        userId: options.userId, orgId,
        projectIds: wholeRun ? projectIds : [...new Set([...(previous?.projectIds ?? []), ...targetProjects])],
        kinds, at: now(),
      } satisfies StoredManifest);

      const pairs = targetProjects.flatMap((p) => targetKinds.map((k) => ({ projectId: p, kind: k })));
      report.projectsTotal = targetProjects.length;
      const remaining = new Map(targetProjects.map((p) => [p, targetKinds.length]));
      const failedProjects = new Set<string>();
      let pairsDone = 0;
      let projectsDone = 0;
      let projectsClean = 0;
      if (targetKinds.length === 0) { projectsDone = targetProjects.length; projectsClean = targetProjects.length; }
      let currentProject: string | null = null;

      const emitProgress = () =>
        (progressCb ?? options.onProgress)?.({
          projectsDone, projectsTotal: targetProjects.length, pairsDone, pairsTotal: pairs.length,
          itemsStored: report.itemsStored, currentProject,
        });
      emitProgress();

      let signedOut = false;
      let next = 0;
      const worker = async () => {
        while (!internal.signal.aborted) {
          const pair = pairs[next++];
          if (!pair) return;
          currentProject = pair.projectId;
          try {
            await pullPair(db!, orgId, pair.projectId, pair.kind, report, internal.signal);
          } catch (err) {
            failedProjects.add(pair.projectId);
            const syncKind = err instanceof SyncError ? err.kind : null;
            if (syncKind === "signed_out") {
              signedOut = true;
              report.issues.push({ projectId: pair.projectId, kind: pair.kind, reason: "signed_out", message: (err as SyncError).message });
              internal.abort();
              return;
            }
            if (syncKind === "aborted") return;
            if (syncKind === "not_found") {
              // No longer readable (or the kind was retired): what was copied for this pair must not stay.
              await clearPair(db!, orgId, pair.projectId, pair.kind, report).catch(() => {});
              report.issues.push({ projectId: pair.projectId, kind: pair.kind, reason: "not_found", message: "No longer available to you, so its local copy was removed." });
            } else {
              const reason = syncKind ?? (err as { replicaReason?: ReplicaIssue["reason"] }).replicaReason ?? "store";
              report.issues.push({ projectId: pair.projectId, kind: pair.kind, reason, message: err instanceof Error ? err.message : String(err) });
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
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, pairs.length)) }, worker));

      report.projectsSynced = projectsClean;
      if (signedOut) return finish("signed_out");
      if (signal?.aborted) return finish("partial");

      if (report.issues.length > 0) return finish(projectsClean > 0 || report.itemsStored > 0 ? "partial" : "error");
      if (wholeRun) await db.setMeta(LAST_SYNC_KEY, { at: now() });
      return finish("done");
    } catch (err) {
      if (err instanceof SyncError) {
        report.issues.push({ reason: err.kind, message: err.message });
        return finish(err.kind === "signed_out" ? "signed_out" : "error");
      }
      report.issues.push({ reason: "store", message: err instanceof Error ? err.message : String(err) });
      return finish("error");
    } finally {
      signal?.removeEventListener("abort", onOuter);
      db?.close();
    }
  }

  function runLocked(key: string, scope: { projectId?: string; kind?: string }, signal?: AbortSignal, progressCb?: (p: ReplicaProgress) => void): Promise<SyncReport> {
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
    getStatus: () => ({ status, report: lastReport }),
  };
}
