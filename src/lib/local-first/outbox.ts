// LOCAL-FIRST: the OUTBOX -- how a person's edit made on this laptop reaches the server (CONTRACT.md section 2).
//
//   enqueue({functionId, projectId, params, record?, creates?, optimistic?})
//        ONE IndexedDB transaction writes (a) the op into the `outbox` store and (b) the optimistic local change, and
//        marks the touched row dirty with the op's id. The screen shows the row at once; the op waits to be sent.
//   flush()
//        sends due ops in order (<= 50 per request, <= 256 KB), then settles every answer:
//          applied / duplicate  the dirty row is replaced by the server's row at its new version, the op is deleted;
//          conflict             nothing was written; both sides are kept (getConflicts()) until the person chooses
//                               resolve(opId, 'keep_theirs') or resolve(opId, 'keep_mine') (resend with overwrite);
//          rejected             a permanent no: the op is dropped, the optimistic change is undone, and a notice in
//                               plain words says why (state.notices);
//          failed               transient: kept, retried with the SAME op_id after an exponential back-off;
//          needs_server         the function cannot run on the edge: kept and listed by getBlocked().
//
// WHY THE OP_ID IS THE WHOLE SAFETY STORY. It is a UUID made once, when the person acts, and stored with the op. A
// request that times out, a response that is lost, a tab that is closed mid-send, a laptop that is switched off: in
// every case the op is still in the outbox and is sent again with the SAME op_id, and the server's ledger answers
// "duplicate" instead of doing it twice. Nothing here ever invents a second op_id for the same edit.
//
// ORDER AND DEPENDENCIES. Ops go out in the order they were made. Two ops on the SAME row never travel together: the
// later one waits until the earlier is settled and is then rebased onto the version the earlier produced (it was
// written on top of it), so a person's own two quick edits do not conflict with each other. An op whose row has an
// earlier unresolved op (a conflict, a needs_server) waits behind it.
//
// SAFETY RULES (each has a test in outbox.test.ts)
//   * a dirty row is never overwritten by a pull and never dropped by a delete (local-db.ts); the outbox is the only
//     thing that ever settles it;
//   * an op whose project the manifest no longer lists is never sent: it is dropped as rejected, with words;
//   * a row the server hands back that names another organisation is refused;
//   * one flusher at a time across tabs (navigator.locks; without it, a single in-process flusher);
//   * a 426 pauses sending (nothing is lost) until resume(); a 401 stops the pass and keeps everything;
//   * nothing is ever sent without the person having acted: the outbox only proposes, the server decides.

import {
  OUTBOX_NOTICES_KEY, localDbNameFor, openLocalDb,
  type LocalDb, type LocalRecord, type LocalTx, type OutboxOp, type PutInput, type RecordPatch, type ServerCopy, type StoredServerRow,
} from "./local-db";
import { MANIFEST_KEY, foreignOrg, type StoredManifest } from "./replica";
import { SyncError, type PushOp, type PushResult, type SyncClient, type SyncServerRow, type UpdateRequiredDetails } from "./sync-client";
import { asTaskErrorCode, resolveTaskError, sanitiseBackendMessage } from "@/lib/task-errors";

// ─── public types ────────────────────────────────────────────────────────────────────────────────────────────

export type EnqueueInput = {
  /** A function of the AI work link registry (the ids the PROJEXA pills use): "create_rfi", "update_task", ... */
  functionId: string;
  projectId: string;
  /** The person's intent. The server recomputes anything that matters (money, approvals); nothing computed here is trusted. */
  params: Record<string, unknown>;
  /** The row this edit CHANGES, and the server version it was based on (conflict detection). */
  record?: { kind: string; id: string; baseVersion: number };
  /** A row this edit CREATES on this laptop: it exists only here until the op is applied (kind + temporary id). */
  creates?: { kind: string; id: string };
  /** Words for the person ("New RFI"): used if the change has to be undone. */
  label?: string;
  /**
   * The optimistic local change, applied in the SAME transaction as the op is stored. It receives the open transaction:
   * await only calls on it (awaiting anything else lets the browser commit early). A throw stores nothing at all.
   */
  optimistic?: (tx: LocalTx) => Promise<void>;
};

export type OutboxStatus = "idle" | "flushing" | "offline" | "signed_out" | "update_required";

export type OutboxConflict = {
  opId: string;
  functionId: string;
  projectId: string;
  label?: string;
  record: { kind: string; id: string };
  /** What this laptop holds now (the person's edit). */
  local: unknown;
  /** What the server holds now. */
  server: StoredServerRow;
};

export type OutboxBlocked = { opId: string; functionId: string; projectId: string; label?: string; message: string };

/** A change that was turned down, in plain words, until the person dismisses it. */
export type OutboxNotice = { opId: string; functionId: string; message: string; at: number };

export type OutboxState = {
  /** Edits not yet applied on the server (every status). Zero means everything this laptop did is on the server. */
  pending: number;
  /** Of those, how many have been tried and are waiting to be tried again. */
  retrying: number;
  conflicts: OutboxConflict[];
  blocked: OutboxBlocked[];
  notices: OutboxNotice[];
  status: OutboxStatus;
  updateRequired: UpdateRequiredDetails | null;
};

export type OutboxEvent =
  | { type: "changed" }
  | { type: "applied"; opId: string; functionId: string; projectId: string; kind: string | null; recordId: string | null; created: boolean }
  | { type: "conflict"; opId: string; functionId: string; projectId: string }
  | { type: "rejected"; opId: string; functionId: string; projectId: string; message: string }
  | { type: "blocked"; opId: string; functionId: string; projectId: string }
  | { type: "update_required"; update: UpdateRequiredDetails }
  | { type: "signed_out" };

export type FlushReport = {
  sent: number;
  applied: number;
  duplicates: number;
  conflicts: number;
  rejected: number;
  failed: number;
  blocked: number;
  /** Ops still in the outbox when the pass ended. */
  remaining: number;
  /** When the earliest waiting retry is due (ms since epoch), or null. */
  nextDueAt: number | null;
  status: OutboxStatus;
  /** "busy": another tab holds the flusher. "paused": a 426 paused sending. */
  skipped?: "busy" | "paused";
  error?: string;
};

export type OutboxOptions = {
  userId: string;
  client: Pick<SyncClient, "push" | "pullIds">;
  /** Identifies this laptop in every push (stable per browser). */
  deviceId: string;
  idb?: IDBFactory;
  now?: () => number;
  /** Waits before a scheduled flush. Injected so tests never really wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Makes an op id. Defaults to crypto.randomUUID(). */
  newOpId?: () => string;
  /** false: never schedule a flush by itself (tests, and callers that flush on their own triggers). Default true. */
  autoFlush?: boolean;
  /** Op and byte ceilings of one push request. */
  maxBatchOps?: number;
  maxBatchBytes?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** navigator.locks, or null to force the in-process fallback. Defaults to the browser's. */
  locks?: LockManager | null;
};

export type Outbox = {
  enqueue(input: EnqueueInput): Promise<{ opId: string }>;
  /** Sends what is due and settles every answer. Never throws; concurrent calls share one pass. */
  flush(): Promise<FlushReport>;
  getConflicts(): Promise<OutboxConflict[]>;
  getBlocked(): Promise<OutboxBlocked[]>;
  /** Settles a conflict. keep_theirs: drop my edit, take the server's row. keep_mine: resend it over the server's version. */
  resolve(opId: string, choice: "keep_theirs" | "keep_mine"): Promise<void>;
  /** Gives up on a blocked op (needs_server) and undoes its local effect. */
  discard(opId: string): Promise<void>;
  /** Ops still waiting, of every status. Reads the database. */
  pendingCount(): Promise<number>;
  dismissNotice(opId: string): Promise<void>;
  /** The latest snapshot, for useSyncExternalStore. A new object every time something changed. */
  getState(): OutboxState;
  /** Re-reads the database (another tab may have changed it) and notifies subscribers. */
  refresh(): Promise<OutboxState>;
  subscribe(listener: (event: OutboxEvent) => void): () => void;
  /** Lifts the pause a 426 put on sending (call it once the app has been updated). */
  resume(): void;
  /** Stops scheduling (sign-out, tests). Does not touch stored ops. */
  dispose(): void;
};

// ─── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────

const recordKey = (o: Pick<OutboxOp, "record">) => (o.record ? `${o.record.kind}:${o.record.id}` : null);

function toStoredRow(r: SyncServerRow): StoredServerRow {
  return { kind: r.kind, id: r.id, version: r.version, updated_at: r.updated_at, data: r.data, ...(r.sig ? { sig: r.sig } : {}), ...(r.kid ? { kid: r.kid } : {}) };
}
function serverCopyOf(r: StoredServerRow): ServerCopy {
  return { data: r.data, version: r.version, updatedAt: r.updated_at, ...(r.sig ? { sig: r.sig } : {}), ...(r.kid ? { kid: r.kid } : {}) };
}
function rowInputFrom(r: StoredServerRow, orgId: string, projectId: string | null, fallbackAt: number): PutInput {
  return {
    id: `${r.kind}:${r.id}`, type: r.kind, orgId, projectId, data: r.data,
    updatedAt: Date.parse(r.updated_at) || fallbackAt,
    serverVersion: r.version, serverUpdatedAt: r.updated_at,
    ...(r.sig ? { sig: r.sig } : {}), ...(r.kid ? { kid: r.kid } : {}),
  };
}

function toWire(op: OutboxOp): PushOp {
  return {
    op_id: op.opId, function_id: op.functionId, project_id: op.projectId, params: op.params,
    ...(op.record ? { record: { kind: op.record.kind, id: op.record.id, base_version: op.record.baseVersion } } : {}),
    ...(op.resolution ? { resolution: op.resolution } : {}),
    client_at: op.clientAt,
  };
}

const encoder = new TextEncoder();
const bytesOf = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
/** Room kept in a request for its envelope ({"device_id":"...","ops":[...]}). */
const ENVELOPE_BYTES = 512;

/** The words a person reads when a change was turned down. Never an id, a host or a parameter name. */
export function rejectionMessage(op: Pick<OutboxOp, "functionId" | "label">, error?: PushResult["error"] | null): string {
  const code = asTaskErrorCode(error?.code);
  let sentence: string;
  if (code) sentence = resolveTaskError({ code, missing: error?.missing ?? null, functionId: op.functionId }).sentence;
  else if (error?.message) sentence = sanitiseBackendMessage(error.message);
  else sentence = "The server did not accept it";
  const lead = op.label ? `${op.label} was not saved.` : "A change you made on this laptop was not saved.";
  const end = /[.!?]$/.test(sentence) ? "" : ".";
  return `${lead} ${sentence}${end} It was undone on this laptop.`;
}

// ─── the engine ────────────────────────────────────────────────────────────────────────────────────────────────

export function createOutbox(options: OutboxOptions): Outbox {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const newOpId = options.newOpId ?? (() => crypto.randomUUID());
  const autoFlush = options.autoFlush !== false;
  const maxOps = Math.max(1, options.maxBatchOps ?? 50);
  const maxBytes = options.maxBatchBytes ?? 256 * 1024;
  const backoffBase = options.backoffBaseMs ?? 2_000;
  const backoffMax = options.backoffMaxMs ?? 5 * 60_000;
  const userId = options.userId;

  let state: OutboxState = { pending: 0, retrying: 0, conflicts: [], blocked: [], notices: [], status: "idle", updateRequired: null };
  const listeners = new Set<(event: OutboxEvent) => void>();
  let flushing: Promise<FlushReport> | null = null;
  let rerun = false;
  let paused: UpdateRequiredDetails | null = null;
  let disposed = false;
  let scheduleToken = 0;

  const emit = (event: OutboxEvent) => {
    for (const listener of [...listeners]) {
      try { listener(event); } catch { /* a listener must not break the engine */ }
    }
  };

  async function withDb<T>(fn: (db: LocalDb) => Promise<T>): Promise<T> {
    const db = await openLocalDb(options.idb ?? globalThis.indexedDB, localDbNameFor(userId));
    try {
      return await fn(db);
    } finally {
      db.close();
    }
  }

  const backoff = (attempts: number) => Math.min(backoffMax, backoffBase * 2 ** Math.max(0, attempts - 1));

  // ── state ──

  async function loadState(db: LocalDb, status: OutboxStatus): Promise<OutboxState> {
    const ops = await db.listOps();
    const conflicts: OutboxConflict[] = [];
    const blocked: OutboxBlocked[] = [];
    for (const op of ops) {
      if (op.status === "conflict" && op.record && op.conflictServer) {
        const row = await db.getRecord(op.record.kind, op.record.id);
        conflicts.push({ opId: op.opId, functionId: op.functionId, projectId: op.projectId, label: op.label, record: { kind: op.record.kind, id: op.record.id }, local: row?.data, server: op.conflictServer });
      } else if (op.status === "blocked") {
        blocked.push({ opId: op.opId, functionId: op.functionId, projectId: op.projectId, label: op.label, message: op.label ? `${op.label} needs the online screen: this laptop cannot send it by itself.` : "A change needs the online screen: this laptop cannot send it by itself." });
      }
    }
    const notices = (await db.getMeta<OutboxNotice[]>(OUTBOX_NOTICES_KEY)) ?? [];
    return {
      pending: ops.length,
      retrying: ops.filter((o) => o.status === "pending" && o.attempts > 0).length,
      conflicts, blocked, notices, status, updateRequired: paused,
    };
  }

  async function refreshState(status: OutboxStatus = state.status): Promise<OutboxState> {
    try {
      state = await withDb((db) => loadState(db, status));
    } catch {
      state = { ...state, status };
    }
    emit({ type: "changed" });
    return state;
  }

  const setStatus = (status: OutboxStatus) => {
    if (state.status === status && state.updateRequired === paused) return;
    state = { ...state, status, updateRequired: paused };
    emit({ type: "changed" });
  };

  // ── scheduling ──

  function schedule(delayMs: number) {
    if (!autoFlush || disposed || paused) return;
    const token = ++scheduleToken;
    void sleep(Math.max(0, delayMs)).then(() => {
      if (token === scheduleToken && !disposed) void flush();
    });
  }

  // ── row settling (all inside one transaction with the op) ──

  /** The ops made AFTER `op` on the same row, oldest first. */
  const laterOnSameRecord = (all: OutboxOp[], op: OutboxOp) => {
    const key = recordKey(op);
    return key ? all.filter((o) => o.opId !== op.opId && o.seq > op.seq && recordKey(o) === key) : [];
  };

  /** Puts a row back the way the server last had it (or removes it if it only ever existed here). */
  async function revertRow(tx: LocalTx, op: OutboxOp, later: OutboxOp[]) {
    if (op.creates) {
      await tx.deleteRecord(op.creates.kind, op.creates.id);
      return;
    }
    if (!op.record) return;
    const row = await tx.getRecord(op.record.kind, op.record.id);
    if (!row) return;
    const copy = row.serverCopy;
    if (!copy || copy.deleted) {
      // Either the row only ever existed on this laptop, or the server removed it while the edit waited.
      await tx.deleteRecord(row.type, row.id.slice(row.type.length + 1));
      return;
    }
    const latest = later.length ? later[later.length - 1]!.opId : null;
    await tx.putRecord({
      id: row.id, type: row.type, orgId: row.orgId, projectId: row.projectId, data: copy.data,
      updatedAt: (copy.updatedAt && Date.parse(copy.updatedAt)) || row.updatedAt,
      ...(copy.version !== null ? { serverVersion: copy.version } : {}),
      ...(copy.updatedAt ? { serverUpdatedAt: copy.updatedAt } : {}),
      ...(copy.sig ? { sig: copy.sig } : {}), ...(copy.kid ? { kid: copy.kid } : {}),
      ...(latest ? { dirty: latest, serverCopy: copy } : {}),
    });
  }

  async function addNotice(tx: LocalTx, notice: OutboxNotice) {
    const existing = (await tx.getMeta<OutboxNotice[]>(OUTBOX_NOTICES_KEY)) ?? [];
    await tx.setMeta(OUTBOX_NOTICES_KEY, [...existing, notice].slice(-20));
  }

  /** Drops the op, undoes its local effect, and leaves a notice in words. */
  async function rejectOp(db: LocalDb, op: OutboxOp, message: string): Promise<boolean> {
    const done = await db.transact(async (tx) => {
      if (!(await tx.getOp(op.opId))) return false; // settled elsewhere (another tab)
      const later = laterOnSameRecord(await tx.listOps(), op);
      await tx.deleteOp(op.opId);
      await revertRow(tx, op, later);
      await addNotice(tx, { opId: op.opId, functionId: op.functionId, message, at: now() });
      return true;
    });
    if (done) emit({ type: "rejected", opId: op.opId, functionId: op.functionId, projectId: op.projectId, message });
    return done;
  }

  type Refetch = { projectId: string; kind: string; id: string; orgId: string };

  async function settleApplied(db: LocalDb, op: OutboxOp, result: PushResult, orgId: string | null): Promise<Refetch | null> {
    const server = result.server ? toStoredRow(result.server) : null;
    const version = result.version ?? server?.version;
    let refetch: Refetch | null = null;
    let kind: string | null = op.record?.kind ?? op.creates?.kind ?? null;
    let recordId: string | null = null;
    const done = await db.transact(async (tx) => {
      if (!(await tx.getOp(op.opId))) return false;
      const later = laterOnSameRecord(await tx.listOps(), op);
      await tx.deleteOp(op.opId);

      if (op.creates) {
        const temp = await tx.getRecord(op.creates.kind, op.creates.id);
        if (temp) await tx.deleteRecord(op.creates.kind, op.creates.id);
        recordId = result.record_id ?? server?.id ?? null;
        kind = server?.kind ?? op.creates.kind;
        const org = temp?.orgId ?? orgId;
        if (recordId && org) {
          if (server) await tx.putRecord(rowInputFrom(server, org, temp?.projectId ?? op.projectId, now()));
          else refetch = { projectId: op.projectId, kind, id: recordId, orgId: org };
        }
        return true;
      }

      if (!op.record) return true;
      recordId = op.record.id;
      const row = await tx.getRecord(op.record.kind, op.record.id);
      if (!row) return true;
      if (later.length === 0) {
        if (server) {
          await tx.putRecord(rowInputFrom(server, row.orgId, row.projectId, now())); // clean, at the server's version
        } else {
          // The server did not send the row back: keep what the person sees, mark it clean, and say it is BEHIND the
          // head (version - 1) so the next change-feed pass -- or the fetch just below -- replaces it.
          await tx.putRecord({
            id: row.id, type: row.type, orgId: row.orgId, projectId: row.projectId, data: row.data, updatedAt: row.updatedAt,
            ...(version !== undefined ? { serverVersion: Math.max(0, version - 1) } : row.serverVersion !== undefined ? { serverVersion: row.serverVersion } : {}),
            ...(row.serverUpdatedAt ? { serverUpdatedAt: row.serverUpdatedAt } : {}),
          });
          refetch = { projectId: op.projectId, kind: op.record.kind, id: op.record.id, orgId: row.orgId };
        }
      } else {
        // Later edits of this row are still waiting: it stays dirty (for the latest of them), now based on the new version.
        const patch: RecordPatch = {
          dirty: later[later.length - 1]!.opId,
          ...(version !== undefined ? { serverVersion: version } : {}),
          ...(server ? { serverUpdatedAt: server.updated_at, serverCopy: serverCopyOf(server) } : {}),
        };
        await tx.patchRecord(row.type, op.record.id, patch);
        if (version !== undefined) {
          // They were written on top of this one: re-base them so the server does not call them a conflict with it.
          for (const next of later) {
            await tx.updateOp(next.opId, { record: { ...next.record!, baseVersion: Math.max(next.record!.baseVersion, version) } });
          }
        }
      }
      return true;
    });
    if (done) emit({ type: "applied", opId: op.opId, functionId: op.functionId, projectId: op.projectId, kind, recordId, created: !!op.creates });
    return done ? refetch : null;
  }

  async function settleConflict(db: LocalDb, op: OutboxOp, result: PushResult): Promise<boolean> {
    const server = result.server ? toStoredRow(result.server) : null;
    if (!server || !op.record) return false;
    const done = await db.transact(async (tx) => {
      if (!(await tx.getOp(op.opId))) return false;
      await tx.updateOp(op.opId, { status: "conflict", conflictServer: server, lastError: undefined });
      const row = await tx.getRecord(op.record!.kind, op.record!.id);
      if (row?.dirty) await tx.patchRecord(row.type, op.record!.id, { serverCopy: serverCopyOf(server) });
      return true;
    });
    if (done) emit({ type: "conflict", opId: op.opId, functionId: op.functionId, projectId: op.projectId });
    return done;
  }

  async function settleFailed(db: LocalDb, op: OutboxOp, code: string) {
    const attempts = op.attempts + 1;
    await db.updateOp(op.opId, { attempts, nextAttemptAt: now() + backoff(attempts), lastError: code });
  }

  async function settleBlocked(db: LocalDb, op: OutboxOp) {
    const changed = await db.updateOp(op.opId, { status: "blocked", lastError: "NEEDS_SERVER" });
    if (changed) emit({ type: "blocked", opId: op.opId, functionId: op.functionId, projectId: op.projectId });
  }

  /** Best effort: bring rows the server did not send back into the local copy. The change feed is the safety net. */
  async function refetchRows(db: LocalDb, items: Refetch[]) {
    const groups = new Map<string, Refetch[]>();
    for (const item of items) {
      const key = `${item.projectId}\u0000${item.kind}\u0000${item.orgId}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const group of groups.values()) {
      const first = group[0]!;
      try {
        const page = await options.client.pullIds({ projectId: first.projectId, kind: first.kind, ids: group.map((g) => g.id) });
        const rows: PutInput[] = page.items
          .filter((i) => !i.deleted && !foreignOrg(i.data, first.orgId))
          .map((i) => ({
            id: `${first.kind}:${i.id}`, type: first.kind, orgId: first.orgId, projectId: first.projectId, data: i.data,
            updatedAt: Date.parse(i.updated_at) || now(), serverUpdatedAt: i.updated_at,
            ...(i.version !== undefined ? { serverVersion: i.version } : {}),
            ...(i.sig ? { sig: i.sig } : {}), ...(i.sig && page.kid ? { kid: page.kid } : {}),
          }));
        if (rows.length) await db.putRecords(rows, { fromServer: true });
      } catch {
        /* the next change-feed pass picks it up */
      }
    }
  }

  // ── one pass ──

  function emptyReport(status: OutboxStatus): FlushReport {
    return { sent: 0, applied: 0, duplicates: 0, conflicts: 0, rejected: 0, failed: 0, blocked: 0, remaining: 0, nextDueAt: null, status };
  }

  /** The ops that may go out now: pending, due, and not held back by an earlier unresolved op on the same row. */
  function eligible(ops: OutboxOp[], at: number): OutboxOp[] {
    const held = new Set<string>();
    const out: OutboxOp[] = [];
    for (const op of ops) {
      const key = recordKey(op);
      if (op.status === "pending" && op.nextAttemptAt <= at && !(key && held.has(key))) out.push(op);
      if (key) held.add(key); // ANY earlier op on this row (sent now or not) holds back the later ones
    }
    return out;
  }

  /** Records how many ops are left and when the earliest waiting retry is due (so the caller can schedule it). */
  async function noteWaiting(db: LocalDb, report: FlushReport) {
    const ops = await db.listOps();
    report.remaining = ops.length;
    const waits = ops.filter((o) => o.status === "pending" && o.nextAttemptAt > now()).map((o) => o.nextAttemptAt);
    report.nextDueAt = waits.length ? Math.min(...waits) : null;
  }

  async function onePass(report: FlushReport): Promise<void> {
    await withDb(async (db) => {
      for (let guard = 0; guard < 10_000; guard += 1) {
        const ops = await db.listOps();
        const manifest = await db.getMeta<StoredManifest>(MANIFEST_KEY);

        // An op whose project the person can no longer read is never sent.
        let dropped = false;
        if (manifest) {
          for (const op of ops) {
            if (!manifest.projectIds.includes(op.projectId)) {
              const label = op.label ? `${op.label} was` : "A change you made was";
              if (await rejectOp(db, op, `${label} not saved: you no longer have access to that project. It was undone on this laptop.`)) { report.rejected += 1; dropped = true; }
            }
          }
        }
        if (dropped) continue;

        const due = eligible(ops, now());
        if (due.length === 0) {
          await noteWaiting(db, report);
          return;
        }

        // Fill one request: in order, at most maxOps, at most maxBytes (an op too big for any request can never be sent).
        const batch: OutboxOp[] = [];
        let size = ENVELOPE_BYTES;
        let tooBig: OutboxOp | null = null;
        for (const op of due) {
          const opBytes = bytesOf(toWire(op)) + 1;
          if (ENVELOPE_BYTES + opBytes > maxBytes) { tooBig = op; break; }
          if (batch.length >= maxOps || size + opBytes > maxBytes) break;
          batch.push(op);
          size += opBytes;
        }
        if (tooBig && batch.length === 0) {
          const label = tooBig.label ? `${tooBig.label} is` : "A change you made is";
          if (await rejectOp(db, tooBig, `${label} too large to send. It was undone on this laptop.`)) report.rejected += 1;
          continue;
        }

        let response: { results: PushResult[] };
        report.sent += batch.length;
        try {
          response = await options.client.push({ deviceId: options.deviceId, ops: batch.map(toWire) });
        } catch (err) {
          const kind = err instanceof SyncError ? err.kind : null;
          if (kind === "signed_out") { setStatus("signed_out"); emit({ type: "signed_out" }); report.sent -= batch.length; await noteWaiting(db, report); return; }
          if (kind === "update_required") {
            paused = (err as SyncError).update ?? { current: null, minCompatible: null };
            setStatus("update_required");
            emit({ type: "update_required", update: paused });
            report.sent -= batch.length;
            await noteWaiting(db, report);
            return;
          }
          if (kind === "aborted") { report.sent -= batch.length; return; }
          // Anything else: nothing is known about what the server did. Keep every op, same op_id, try again later.
          for (const op of batch) await settleFailed(db, op, kind ?? "UNKNOWN").catch(() => {});
          report.failed += batch.length;
          await noteWaiting(db, report);
          setStatus(kind === "network" || kind === "timeout" || kind === "server" || kind === "rate_limited" ? "offline" : "idle");
          return;
        }

        const byId = new Map(response.results.map((r) => [r.op_id, r]));
        const refetches: Refetch[] = [];
        for (const op of batch) {
          const result = byId.get(op.opId);
          // The server named this op in no result: unknown outcome, so retry with the same op_id.
          if (!result) { await settleFailed(db, op, "NO_RESULT"); report.failed += 1; continue; }

          // A row the server hands back must be this organisation's: anything else is refused, and the op stays to be retried.
          const orgId = manifest?.orgId ?? null;
          if (result.server && orgId && foreignOrg(result.server.data, orgId)) {
            await settleFailed(db, op, "FOREIGN_ORGANISATION");
            report.failed += 1;
            continue;
          }

          switch (result.status) {
            case "applied":
            case "duplicate": {
              const refetch = await settleApplied(db, op, result, orgId);
              if (refetch) refetches.push(refetch);
              if (result.status === "applied") report.applied += 1; else report.duplicates += 1;
              break;
            }
            case "conflict":
              if (await settleConflict(db, op, result)) report.conflicts += 1;
              else { await settleFailed(db, op, "CONFLICT_WITHOUT_ROW"); report.failed += 1; }
              break;
            case "rejected":
              if (await rejectOp(db, op, rejectionMessage(op, result.error))) report.rejected += 1;
              break;
            case "needs_server":
              await settleBlocked(db, op);
              report.blocked += 1;
              break;
            default: // "failed", and anything unknown (the client maps unknown statuses to "failed")
              await settleFailed(db, op, result.error?.code ?? "FAILED");
              report.failed += 1;
          }
        }
        if (refetches.length) await refetchRows(db, refetches);
        setStatus("idle");
        await refreshState("flushing");
      }
    });
  }

  // ── flushing, one at a time ──

  async function withFlushLock<T>(run: () => Promise<T>, busy: () => T): Promise<T> {
    const locks = options.locks !== undefined ? options.locks : typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks ?? null : null;
    if (!locks?.request) return run();
    let result: T | undefined;
    let ran = false;
    await locks.request(`px-outbox:${userId}`, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      ran = true;
      result = await run();
    });
    return ran ? (result as T) : busy();
  }

  function flush(): Promise<FlushReport> {
    if (paused) return Promise.resolve({ ...emptyReport("update_required"), remaining: state.pending, skipped: "paused" });
    // Joins the pass in flight. The pass looks at the outbox again after every request, so an edit made while it runs is
    // normally sent by it; `rerun` covers the one window that look cannot (the pass is already ending): see finally below.
    if (flushing) { rerun = true; return flushing; }
    const p: Promise<FlushReport> = withFlushLock(async () => {
      const total = emptyReport("flushing");
      setStatus("flushing");
      try {
        await onePass(total);
      } catch (err) {
        total.error = err instanceof Error ? err.message : String(err);
      }
      await refreshState(state.status === "flushing" ? "idle" : state.status);
      total.status = state.status;
      if (total.nextDueAt !== null) schedule(total.nextDueAt - now());
      return total;
    }, () => ({ ...emptyReport("idle"), skipped: "busy" as const })).finally(() => {
      if (flushing === p) flushing = null;
      // Someone asked for a flush while this one was ending: they joined it, but it was already past looking. Go again.
      if (rerun && !paused) { rerun = false; void flush(); } else rerun = false;
    });
    flushing = p;
    return p;
  }

  // ── the public API ──

  const outbox: Outbox = {
    async enqueue(input) {
      if (!input.projectId) throw new Error("An edit needs the project it belongs to.");
      if (input.record && !Number.isFinite(input.record.baseVersion)) throw new Error("An edit of an existing row needs the version it was based on.");
      const opId = newOpId();
      await withDb((db) =>
        db.transact(async (tx) => {
          const target = input.record ?? input.creates ?? null;
          const before: LocalRecord | undefined = target ? await tx.getRecord(target.kind, target.id) : undefined;
          await input.optimistic?.(tx);

          if (target) {
            const row = await tx.getRecord(target.kind, target.id);
            if (row) {
              const patch: RecordPatch = { dirty: opId };
              if (input.record && before) {
                // The row's server side is remembered ONCE, from the first edit, so a revert goes back to the server's row.
                patch.serverCopy = before.dirty
                  ? before.serverCopy
                  : { data: before.data, version: before.serverVersion ?? input.record.baseVersion, updatedAt: before.serverUpdatedAt ?? null, ...(before.sig ? { sig: before.sig } : {}), ...(before.kid ? { kid: before.kid } : {}) };
                patch.serverVersion = before.serverVersion ?? input.record.baseVersion;
                patch.serverUpdatedAt = before.serverUpdatedAt;
                // The signature belongs to the server's data, which this row no longer holds.
                patch.sig = undefined;
                patch.kid = undefined;
              }
              await tx.patchRecord(target.kind, target.id, patch);
            }
          }

          await tx.putOp({
            opId, functionId: input.functionId, projectId: input.projectId, params: input.params,
            ...(input.record ? { record: { kind: input.record.kind, id: input.record.id, baseVersion: input.record.baseVersion } } : {}),
            ...(input.creates ? { creates: { kind: input.creates.kind, id: input.creates.id } } : {}),
            ...(input.label ? { label: input.label } : {}),
            clientAt: new Date(now()).toISOString(),
            status: "pending", attempts: 0, nextAttemptAt: 0,
          });
        })
      );
      await refreshState();
      schedule(0);
      return { opId };
    },

    flush,

    async getConflicts() {
      return withDb(async (db) => (await loadState(db, state.status)).conflicts);
    },
    async getBlocked() {
      return withDb(async (db) => (await loadState(db, state.status)).blocked);
    },
    async pendingCount() {
      return withDb(async (db) => (await db.listOps()).length);
    },

    async resolve(opId, choice) {
      await withDb((db) =>
        db.transact(async (tx) => {
          const op = await tx.getOp(opId);
          if (!op || op.status !== "conflict" || !op.record || !op.conflictServer) throw new Error("There is no conflict to settle for that change.");
          const server = op.conflictServer;
          const later = laterOnSameRecord(await tx.listOps(), op);
          const row = await tx.getRecord(op.record.kind, op.record.id);
          if (choice === "keep_theirs") {
            await tx.deleteOp(opId);
            if (row) {
              if (later.length === 0) await tx.putRecord(rowInputFrom(server, row.orgId, row.projectId, now()));
              else {
                await tx.patchRecord(row.type, op.record.id, {
                  serverVersion: server.version, serverUpdatedAt: server.updated_at, sig: undefined, kid: undefined,
                  serverCopy: serverCopyOf(server), dirty: later[later.length - 1]!.opId,
                });
              }
            }
            // Edits made on top of mine now sit on top of THEIRS.
            for (const next of later) await tx.updateOp(next.opId, { record: { ...next.record!, baseVersion: server.version } });
          } else {
            await tx.updateOp(opId, {
              status: "pending", resolution: "overwrite", record: { ...op.record, baseVersion: server.version },
              conflictServer: undefined, attempts: 0, nextAttemptAt: 0, lastError: undefined,
            });
            if (row) await tx.patchRecord(row.type, op.record.id, { serverVersion: server.version, serverUpdatedAt: server.updated_at, serverCopy: serverCopyOf(server) });
          }
        })
      );
      await refreshState();
      if (choice === "keep_mine") schedule(0);
    },

    async discard(opId) {
      await withDb((db) =>
        db.transact(async (tx) => {
          const op = await tx.getOp(opId);
          if (!op || op.status !== "blocked") throw new Error("That change is not waiting for the online screen.");
          const later = laterOnSameRecord(await tx.listOps(), op);
          await tx.deleteOp(opId);
          await revertRow(tx, op, later);
        })
      );
      await refreshState();
    },

    async dismissNotice(opId) {
      await withDb((db) =>
        db.transact(async (tx) => {
          const existing = (await tx.getMeta<OutboxNotice[]>(OUTBOX_NOTICES_KEY)) ?? [];
          await tx.setMeta(OUTBOX_NOTICES_KEY, existing.filter((n) => n.opId !== opId));
        })
      );
      await refreshState();
    },

    getState: () => state,
    refresh: () => refreshState(),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    resume() {
      paused = null;
      setStatus("idle");
      schedule(0);
    },
    dispose() {
      disposed = true;
      scheduleToken += 1;
      listeners.clear();
    },
  };
  return outbox;
}
