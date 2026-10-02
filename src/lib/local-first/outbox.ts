// LOCAL-FIRST: the OUTBOX -- how a person's edit made on this laptop reaches the server (CONTRACT.md section 2).
//
//   enqueue({functionId, projectId, params, record?, creates?, optimistic?})
//        ONE IndexedDB transaction writes (a) the op into the `outbox` store and (b) the optimistic local change, and
//        marks the touched row dirty with the op's id. The screen shows the row at once; the op waits to be sent. A text
//        longer than the server takes, or an op above the server's per-op ceiling, is refused HERE (OutboxRefusal) before
//        anything is stored, so the screen still holds the person's text and can say what to change.
//   flush()
//        sends due ops in order (<= 50 per request, <= 256 KB, <= 64 KB per op), then settles every answer:
//          applied / duplicate  the dirty row is replaced by the server's row at its new version, the op is deleted;
//          conflict             the server's row moved. A FIELD-LEVEL THREE-WAY MERGE (outbox-merge.ts, R12) decides:
//                                 every field the edit changed already holds its value -> it is already in (applied);
//                                 no field both sides changed -> merged silently and re-sent against the new version;
//                                 a same-field disagreement (or a money/approval field) -> a conflict card: "Keep mine" /
//                                 "Keep theirs" (theirs = the NEWEST server row the laptop knows, data:F8);
//                               the row was DELETED by someone else (server: null) -> a "deleted" conflict card: "Keep my
//                               version as a new one" (where a create exists) or "Keep my text" / "Discard" (data:F6);
//          rejected             a permanent no: the op is dropped, the optimistic change is undone, a notice in plain words
//                               says why, and EVERYTHING THE PERSON TYPED is kept as a DRAFT until they re-send it ("Edit
//                               again") or discard it (data:F4). Nothing a person typed is ever lost silently;
//          failed               transient: kept, retried with the SAME op_id after an exponential back-off. An outcome the
//                               server could not confirm (EXECUTION_UNCERTAIN, IN_PROGRESS, no result) is shown as
//                               "checking" and re-sent a BOUNDED number of times (the server answers `duplicate` once it
//                               knows); then it needs the person ("Send again" / "Stop and keep my text") (data:F7);
//          needs_server         the function cannot run on the edge: kept and listed by getBlocked().
//        A whole request the server refuses as not linked (403) PAUSES the outbox with one card instead of retrying every op
//        for ever (wire:F14); other whole-request refusals (400/404/413) are tried a bounded number of times (cost:COST-07).
//
// WHY THE OP_ID IS THE WHOLE SAFETY STORY. It is a UUID made once, when the person acts, and stored with the op. A
// request that times out, a response that is lost, a tab that is closed mid-send, a laptop that is switched off: in
// every case the op is still in the outbox and is sent again with the SAME op_id, and the server's ledger answers
// "duplicate" instead of doing it twice. Nothing here ever invents a second op_id for the same edit ("Keep my version as
// a new one" is a NEW edit, made by the person's choice, of a row that no longer exists).
//
// ORDER AND DEPENDENCIES. Ops go out in the order they were made. Two ops on the SAME row never travel together: the
// later one waits until the earlier is settled and is then rebased onto the version the earlier produced (it was
// written on top of it), so a person's own two quick edits do not conflict with each other. An op whose row has an
// earlier unresolved op (a conflict, a needs_server, one that needs attention) waits behind it.
//
// SAFETY RULES (each has a test in outbox.test.ts / outbox-safety.test.ts)
//   * a dirty row is never overwritten by a pull and never dropped by a delete (local-db.ts, by default); the outbox is
//     the only thing that ever settles it;
//   * an op whose project the manifest no longer lists is never sent: it is dropped as rejected, with words, text kept;
//   * a row the server hands back that names another organisation is refused;
//   * one flusher at a time across tabs (navigator.locks; without it, a single in-process flusher);
//   * a 426 pauses sending (nothing is lost) until resume(); a 401 stops the pass and keeps everything; a 403 pauses;
//   * nothing is ever sent without the person having acted: the outbox only proposes, the server decides;
//   * money and approvals are never merged on the laptop.

import {
  OUTBOX_NOTICES_KEY, localDbNameFor, openLocalDb,
  type LocalDb, type LocalRecord, type LocalTx, type OutboxDraft, type OutboxOp, type PutInput, type RecordPatch, type ServerCopy, type StoredServerRow,
} from "./local-db";
import { MANIFEST_KEY, foreignOrg, type StoredManifest } from "./replica";
import { SyncError, type PushOp, type PushResult, type SyncClient, type SyncServerRow, type UpdateRequiredDetails } from "./sync-client";
import { asTaskErrorCode, resolveTaskError, sanitiseBackendMessage } from "@/lib/task-errors";
import { asData, beforeOf, decide, effectFromParams, effectOf, fieldValue, overlay, withoutFields, type Data } from "./outbox-merge";
import { opTooLarge, syncCodeSentence, textLimitProblem, textTooLongMessage } from "./outbox-words";

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
   * The edited fields as the FORM LOADED them (the version `record.baseVersion` names). The base of the three-way merge;
   * without it, the laptop row's values at enqueue are used (they are the same unless the row was refreshed meanwhile).
   */
  before?: Record<string, unknown>;
  /**
   * The optimistic local change, applied in the SAME transaction as the op is stored. It receives the open transaction:
   * await only calls on it (awaiting anything else lets the browser commit early). A throw stores nothing at all.
   */
  optimistic?: (tx: LocalTx) => Promise<void>;
};

/** An edit refused BEFORE it was stored (nothing was written): the screen keeps the person's text and shows `message`. */
export class OutboxRefusal extends Error {
  readonly code: "TEXT_TOO_LONG" | "TOO_LARGE";
  readonly field?: string;
  constructor(code: "TEXT_TOO_LONG" | "TOO_LARGE", message: string, field?: string) {
    super(message);
    this.name = "OutboxRefusal";
    this.code = code;
    if (field) this.field = field;
  }
}

export type OutboxStatus = "idle" | "flushing" | "offline" | "signed_out" | "update_required" | "not_linked";

export type OutboxConflict = {
  opId: string;
  functionId: string;
  projectId: string;
  label?: string;
  record: { kind: string; id: string };
  /** "changed": the server's row moved and some field disagrees. "deleted": someone else removed the row. */
  kind: "changed" | "deleted";
  /** What this laptop holds now (the person's edit). */
  local: unknown;
  /** What the server holds now (the newest row the laptop knows of); null when it was deleted. */
  server: StoredServerRow | null;
  /** "changed": the fields both sides changed to different values (the only ones to decide). */
  fields: string[];
  /** "deleted": the edit can be kept as a NEW record ("Keep my version as a new one"). */
  canRecreate: boolean;
};

export type OutboxBlocked = { opId: string; functionId: string; projectId: string; label?: string; message: string };

/** An edit whose outcome the server could not confirm yet: re-sent (same op_id) a bounded number of times. */
export type OutboxChecking = { opId: string; functionId: string; projectId: string; label?: string; attempts: number; maxAttempts: number; message: string };

/** An edit that stopped being re-sent and needs the person: "Send again" (same op_id) or "Stop and keep my text". */
export type OutboxAttentionItem = { opId: string; functionId: string; projectId: string; label?: string; reason: "uncertain" | "refused"; message: string };

/** A change that was turned down, in plain words, until the person dismisses it. */
export type OutboxNotice = { opId: string; functionId: string; message: string; at: number };

export type OutboxState = {
  /** Edits not yet applied on the server (every status). Zero means everything this laptop did is on the server. */
  pending: number;
  /** Of those, how many have been tried and are waiting to be tried again. */
  retrying: number;
  conflicts: OutboxConflict[];
  blocked: OutboxBlocked[];
  checking: OutboxChecking[];
  attention: OutboxAttentionItem[];
  /** What the person typed for edits that did not reach the server, until re-sent or discarded. */
  drafts: OutboxDraft[];
  notices: OutboxNotice[];
  status: OutboxStatus;
  updateRequired: UpdateRequiredDetails | null;
  /** The browser refused persistent storage: under storage pressure it may clear what waits here. */
  storageWarning: boolean;
};

export type OutboxEvent =
  | { type: "changed" }
  | { type: "applied"; opId: string; functionId: string; projectId: string; kind: string | null; recordId: string | null; created: boolean }
  | { type: "conflict"; opId: string; functionId: string; projectId: string }
  | { type: "rejected"; opId: string; functionId: string; projectId: string; message: string }
  | { type: "blocked"; opId: string; functionId: string; projectId: string }
  | { type: "attention"; opId: string; functionId: string; projectId: string }
  | { type: "update_required"; update: UpdateRequiredDetails }
  | { type: "not_linked" }
  | { type: "signed_out" };

export type FlushReport = {
  sent: number;
  applied: number;
  duplicates: number;
  conflicts: number;
  /** Conflicts settled by the automatic three-way merge (re-sent, or found already in). */
  merged: number;
  rejected: number;
  failed: number;
  blocked: number;
  /** Ops that stopped being re-sent this pass and now need the person. */
  attention: number;
  /** Ops still in the outbox when the pass ended. */
  remaining: number;
  /** When the earliest waiting retry is due (ms since epoch), or null. */
  nextDueAt: number | null;
  status: OutboxStatus;
  /** "busy": another tab holds the flusher. "paused": a 426 or a 403 paused sending. */
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
  /** How many times an outcome the server could not confirm is re-sent before the person is asked. Default 5. */
  maxChecks?: number;
  /** How many times a whole request the server refuses (400/404/413, a foreign row) is tried before the person is asked. Default 3. */
  maxRefusals?: number;
  /** navigator.locks, or null to force the in-process fallback. Defaults to the browser's. */
  locks?: LockManager | null;
  /** Asks the browser to keep this site's storage (data:F13). Called once, before the first op is stored. "denied" -> a warning. */
  requestPersistence?: () => Promise<string>;
};

export type ResolveChoice =
  /** changed: drop my change of the disagreeing fields and take the newest server row (other fields of mine still go). deleted: same as discard. */
  | "keep_theirs"
  /** changed: send my change over theirs. */
  | "keep_mine"
  /** deleted: make my version a NEW record (only when canRecreate). */
  | "keep_as_new"
  /** deleted (or any conflict): stop, undo here, and keep what I typed as a draft. */
  | "keep_text"
  /** deleted: drop my change; the row is gone. */
  | "discard";

export type Outbox = {
  enqueue(input: EnqueueInput): Promise<{ opId: string }>;
  /** Sends what is due and settles every answer. Never throws; concurrent calls share one pass. */
  flush(): Promise<FlushReport>;
  getConflicts(): Promise<OutboxConflict[]>;
  getBlocked(): Promise<OutboxBlocked[]>;
  /** Settles a conflict (see ResolveChoice). */
  resolve(opId: string, choice: ResolveChoice): Promise<void>;
  /** Gives up on a blocked op (needs_server) or one that needs attention: its local effect is undone, its text kept as a draft. */
  discard(opId: string): Promise<void>;
  /** An op that needs attention is sent again with the SAME op_id (the server answers `duplicate` if it is already in). */
  retry(opId: string): Promise<void>;
  /** Ops still waiting, of every status. Reads the database. */
  pendingCount(): Promise<number>;
  /** The waiting ops themselves, oldest first (a screen overlays their params on server data while they wait). */
  listPending(): Promise<OutboxOp[]>;
  dismissNotice(opId: string): Promise<void>;
  /** One draft (what the person typed), for "Edit again". */
  getDraft(opId: string): Promise<OutboxDraft | undefined>;
  /** Removes a draft (and its notice): the person discarded it, or saved it again. */
  discardDraft(opId: string): Promise<void>;
  /** The latest snapshot, for useSyncExternalStore. A new object every time something changed. */
  getState(): OutboxState;
  /** Re-reads the database (another tab may have changed it) and notifies subscribers. */
  refresh(): Promise<OutboxState>;
  subscribe(listener: (event: OutboxEvent) => void): () => void;
  /** Lifts the pause a 426 or a 403 put on sending (call it once the app has been updated / the person is linked again). */
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

/** The newest server row the laptop knows for a conflicted op: the conflict's snapshot, or a NEWER one a later pull parked (data:F8). */
function newestServerRow(op: OutboxOp, row: LocalRecord | undefined): StoredServerRow | null {
  const snap = op.conflictServer ?? null;
  const parked = row?.serverCopy;
  if (op.record && parked && !parked.deleted && parked.version !== null && (!snap || parked.version > snap.version)) {
    return {
      kind: op.record.kind, id: op.record.id, version: parked.version, updated_at: parked.updatedAt ?? snap?.updated_at ?? "", data: parked.data,
      ...(parked.sig ? { sig: parked.sig } : {}), ...(parked.kid ? { kid: parked.kid } : {}),
    };
  }
  return snap;
}

/** A push op on the wire. `record_kind` names the kind a CREATE makes, so the answer carries the row (wire:F10, cost:COST-08). */
export type WireOp = PushOp & { record_kind?: string };

export function toWire(op: Pick<OutboxOp, "opId" | "functionId" | "projectId" | "params" | "record" | "creates" | "resolution" | "clientAt">): WireOp {
  return {
    op_id: op.opId, function_id: op.functionId, project_id: op.projectId, params: op.params,
    ...(op.record ? { record: { kind: op.record.kind, id: op.record.id, base_version: op.record.baseVersion } } : {}),
    ...(op.creates ? { record_kind: op.creates.kind } : {}),
    ...(op.resolution ? { resolution: op.resolution } : {}),
    client_at: op.clientAt,
  };
}

const encoder = new TextEncoder();
const bytesOf = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
/** Room kept in a request for its envelope ({"device_id":"...","ops":[...]}). */
const ENVELOPE_BYTES = 512;

/** Codes that mean "the server does not know yet whether it was done": re-ask with the same op_id, a bounded number of times. */
const UNCERTAIN_CODES: ReadonlySet<string> = new Set(["EXECUTION_UNCERTAIN", "IN_PROGRESS", "NO_RESULT", "BAD_ANSWER"]);
/** Whole-request answers that will not change by themselves: counted, then the person is asked (COST-07). */
const REFUSAL_CODES: ReadonlySet<string> = new Set(["bad_response", "not_found", "FOREIGN_ORGANISATION"]);

/** The words a person reads when a change was turned down. Never an id, a host or a parameter name. */
export function rejectionMessage(op: Pick<OutboxOp, "functionId" | "label">, error?: PushResult["error"] | null): string {
  const code = asTaskErrorCode(error?.code);
  let sentence: string;
  const own = syncCodeSentence(error?.code);
  if (own) sentence = own;
  else if (code) sentence = resolveTaskError({ code, missing: error?.missing ?? null, functionId: op.functionId }).sentence;
  else if (error?.message) sentence = sanitiseBackendMessage(error.message);
  else sentence = "The server did not accept it";
  const lead = op.label ? `${op.label} was not saved.` : "A change you made on this laptop was not saved.";
  const end = /[.!?]$/.test(sentence) ? "" : ".";
  return `${lead} ${sentence}${end} It was undone on this laptop.`;
}

/** A deleted row's edit kept as a NEW record: the create that can carry it, from what the laptop row holds (mine on theirs). */
type Recreate = { functionId: string; params: Record<string, unknown>; kind: string; label: string };
const RECREATE: Record<string, (data: Data, projectId: string) => Recreate | null> = {
  // create_schedule_task requires projectId, title and startDate (registry required_params): without both, it is not offered.
  tasks: (d, projectId) => {
    const title = fieldValue(d, "title");
    const startDate = fieldValue(d, "startDate");
    if (typeof title !== "string" || !title.trim() || typeof startDate !== "string" || !startDate) return null;
    const params: Record<string, unknown> = { projectId, title, startDate };
    for (const k of ["description", "priority", "dueDate"]) {
      const v = fieldValue(d, k);
      if (typeof v === "string" && v) params[k] = v;
    }
    return { functionId: "create_schedule_task", params, kind: "tasks", label: "Your task, kept as a new one" };
  },
};
const recreateFor = (op: OutboxOp, data: unknown) => (op.record ? RECREATE[op.record.kind]?.(asData(data), op.projectId) ?? null : null);

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
  const maxChecks = Math.max(1, options.maxChecks ?? 5);
  const maxRefusals = Math.max(1, options.maxRefusals ?? 3);
  const userId = options.userId;

  let state: OutboxState = { pending: 0, retrying: 0, conflicts: [], blocked: [], checking: [], attention: [], drafts: [], notices: [], status: "idle", updateRequired: null, storageWarning: false };
  const listeners = new Set<(event: OutboxEvent) => void>();
  let flushing: Promise<FlushReport> | null = null;
  let rerun = false;
  let paused: UpdateRequiredDetails | null = null;
  let notLinked = false;
  let disposed = false;
  let scheduleToken = 0;
  let persistenceAsked = false;
  let storageWarning = false;

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

  function effectOfOp(op: OutboxOp): Data {
    return op.effect ?? effectFromParams(op.params, op.record?.id ?? null);
  }

  async function loadState(db: LocalDb, status: OutboxStatus): Promise<OutboxState> {
    const ops = await db.listOps();
    const conflicts: OutboxConflict[] = [];
    const blocked: OutboxBlocked[] = [];
    const checking: OutboxChecking[] = [];
    const attention: OutboxAttentionItem[] = [];
    for (const op of ops) {
      if (op.status === "conflict" && op.record) {
        const row = await db.getRecord(op.record.kind, op.record.id);
        const deleted = op.conflictKind === "deleted";
        if (!deleted && !op.conflictServer) continue;
        conflicts.push({
          opId: op.opId, functionId: op.functionId, projectId: op.projectId, label: op.label, record: { kind: op.record.kind, id: op.record.id },
          kind: deleted ? "deleted" : "changed", local: row?.data, server: deleted ? null : newestServerRow(op, row),
          fields: op.conflictFields ?? [], canRecreate: deleted && !!recreateFor(op, row?.data),
        });
      } else if (op.status === "blocked") {
        blocked.push({ opId: op.opId, functionId: op.functionId, projectId: op.projectId, label: op.label, message: op.label ? `${op.label} needs the online screen: this laptop cannot send it by itself.` : "A change needs the online screen: this laptop cannot send it by itself." });
      } else if (op.status === "attention") {
        const what = op.label ?? "A change you made on this laptop";
        attention.push({
          opId: op.opId, functionId: op.functionId, projectId: op.projectId, label: op.label, reason: op.attention ?? "uncertain",
          message: op.attention === "refused"
            ? `${what} could not be sent: the server kept turning the request down. It is still on this laptop.`
            : `${what}: the server could not confirm whether it was saved. It is still on this laptop.`,
        });
      } else if (op.status === "pending" && op.attempts > 0 && op.lastError && UNCERTAIN_CODES.has(op.lastError)) {
        checking.push({
          opId: op.opId, functionId: op.functionId, projectId: op.projectId, label: op.label, attempts: op.attempts, maxAttempts: maxChecks,
          message: `Checking whether ${op.label ? op.label.charAt(0).toLowerCase() + op.label.slice(1) : "a change you made"} reached the server (${op.attempts} of ${maxChecks}).`,
        });
      }
    }
    const notices = (await db.getMeta<OutboxNotice[]>(OUTBOX_NOTICES_KEY)) ?? [];
    const drafts = await db.listDrafts();
    return {
      pending: ops.length,
      retrying: ops.filter((o) => o.status === "pending" && o.attempts > 0).length,
      conflicts, blocked, checking, attention, drafts, notices, status, updateRequired: paused, storageWarning,
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
    if (!autoFlush || disposed || paused || notLinked) return;
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

  /**
   * Puts a row back the way the server last had it (or removes it if it only ever existed here). Edits made AFTER this
   * one that are still waiting are laid back on top, so the person keeps seeing them (data:F10).
   */
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
    let data: unknown = copy.data;
    for (const next of later) data = overlay(data, effectOfOp(next));
    await tx.putRecord({
      id: row.id, type: row.type, orgId: row.orgId, projectId: row.projectId, data,
      updatedAt: (copy.updatedAt && Date.parse(copy.updatedAt)) || row.updatedAt,
      ...(copy.version !== null ? { serverVersion: copy.version } : {}),
      ...(copy.updatedAt ? { serverUpdatedAt: copy.updatedAt } : {}),
      ...(!latest && copy.sig ? { sig: copy.sig } : {}), ...(!latest && copy.kid ? { kid: copy.kid } : {}),
      ...(latest ? { dirty: latest, serverCopy: copy } : {}),
    });
  }

  async function addNotice(tx: LocalTx, notice: OutboxNotice) {
    const existing = (await tx.getMeta<OutboxNotice[]>(OUTBOX_NOTICES_KEY)) ?? [];
    await tx.setMeta(OUTBOX_NOTICES_KEY, [...existing.filter((n) => n.opId !== notice.opId), notice].slice(-20));
  }

  /** Keeps what the person typed for an op that will not reach the server, until they re-send or discard it (data:F4). */
  async function keepDraft(tx: LocalTx, op: OutboxOp, message: string, code?: string) {
    await tx.putDraft({
      opId: op.opId, functionId: op.functionId, projectId: op.projectId, params: op.params,
      ...(op.record ? { record: { kind: op.record.kind, id: op.record.id } } : {}),
      ...(op.creates ? { creates: { kind: op.creates.kind, id: op.creates.id } } : {}),
      ...(op.label ? { label: op.label } : {}),
      message, ...(code ? { code } : {}), at: now(),
    });
  }

  /** Drops the op, undoes its local effect, leaves a notice in words, and keeps what was typed as a draft. */
  async function rejectOp(db: LocalDb, op: OutboxOp, message: string, code?: string): Promise<boolean> {
    const done = await db.transact(async (tx) => {
      if (!(await tx.getOp(op.opId))) return false; // settled elsewhere (another tab)
      const later = laterOnSameRecord(await tx.listOps(), op);
      await tx.deleteOp(op.opId);
      await revertRow(tx, op, later);
      await addNotice(tx, { opId: op.opId, functionId: op.functionId, message, at: now() });
      await keepDraft(tx, op, message, code);
      return true;
    });
    if (done) emit({ type: "rejected", opId: op.opId, functionId: op.functionId, projectId: op.projectId, message });
    return done;
  }

  type Refetch = { projectId: string; kind: string; id: string; orgId: string };

  async function settleApplied(db: LocalDb, op: OutboxOp, result: Pick<PushResult, "server" | "version" | "record_id">, orgId: string | null): Promise<Refetch | null> {
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

  type ConflictOutcome = "card" | "deleted" | "merged" | "already_in" | "gone";

  /**
   * A conflict answer. No server row (or the laptop already knows the row was deleted): the "deleted" card (data:F6). With a
   * row: the three-way merge decides between "already in", a silent merge + re-send, and the card (R12).
   */
  async function settleConflict(db: LocalDb, op: OutboxOp, result: PushResult, orgId: string | null, mergesThisPass: Map<string, number>): Promise<{ outcome: ConflictOutcome; refetch: Refetch | null }> {
    const server = result.server ? toStoredRow(result.server) : null;
    if (!op.record) return { outcome: "gone", refetch: null };
    if (!server) {
      const done = await db.transact(async (tx) => {
        if (!(await tx.getOp(op.opId))) return false;
        await tx.updateOp(op.opId, { status: "conflict", conflictKind: "deleted", conflictServer: undefined, conflictFields: undefined, lastError: "RECORD_DELETED" });
        const row = await tx.getRecord(op.record!.kind, op.record!.id);
        if (row?.dirty) await tx.patchRecord(row.type, op.record!.id, { serverCopy: { ...(row.serverCopy ?? { data: row.data, version: row.serverVersion ?? null, updatedAt: row.serverUpdatedAt ?? null }), deleted: true } });
        return true;
      });
      if (done) emit({ type: "conflict", opId: op.opId, functionId: op.functionId, projectId: op.projectId });
      return { outcome: done ? "deleted" : "gone", refetch: null };
    }

    const effect = effectOfOp(op);
    const merges = mergesThisPass.get(op.opId) ?? 0;
    const decision = decide({ effect, before: op.before, theirs: server.data });

    if (decision.kind === "already_in") {
      // Everything this edit set is already what the server holds (it went in through a lost answer, or someone made the
      // same change): settle it as applied with the server's row.
      const refetch = await settleApplied(db, op, { server: result.server, version: server.version }, orgId);
      return { outcome: "already_in", refetch };
    }

    if (decision.kind === "merged" && merges < 3) {
      mergesThisPass.set(op.opId, merges + 1);
      const done = await db.transact(async (tx) => {
        const live = await tx.getOp(op.opId);
        if (!live) return false;
        // The edit is now based on THEIR row: their fields stay, mine are laid on top, and the base of the next merge is theirs.
        await tx.updateOp(op.opId, {
          status: "pending", record: { ...op.record!, baseVersion: server.version }, nextAttemptAt: 0, lastError: undefined,
          before: Object.fromEntries(Object.keys(effect).map((k) => [k, fieldValue(asData(server.data), k) ?? null])),
          conflictServer: undefined, conflictKind: undefined, conflictFields: undefined,
        });
        const row = await tx.getRecord(op.record!.kind, op.record!.id);
        if (row?.dirty) {
          const later = laterOnSameRecord(await tx.listOps(), op);
          let data: unknown = decision.data;
          for (const next of later) data = overlay(data, effectOfOp(next));
          await tx.patchRecord(row.type, op.record!.id, { data, serverVersion: server.version, serverUpdatedAt: server.updated_at, serverCopy: serverCopyOf(server) });
        }
        return true;
      });
      return { outcome: done ? "merged" : "gone", refetch: null };
    }

    const fields = decision.kind === "card" ? decision.fields : Object.keys(effect);
    const done = await db.transact(async (tx) => {
      if (!(await tx.getOp(op.opId))) return false;
      await tx.updateOp(op.opId, { status: "conflict", conflictKind: "changed", conflictServer: server, conflictFields: fields, lastError: undefined });
      const row = await tx.getRecord(op.record!.kind, op.record!.id);
      if (row?.dirty) await tx.patchRecord(row.type, op.record!.id, { serverCopy: serverCopyOf(server) });
      return true;
    });
    if (done) emit({ type: "conflict", opId: op.opId, functionId: op.functionId, projectId: op.projectId });
    return { outcome: done ? "card" : "gone", refetch: null };
  }

  /** A transient failure: kept and retried later -- except that an unconfirmed outcome or a standing refusal is bounded. */
  async function settleFailed(db: LocalDb, op: OutboxOp, code: string): Promise<"retry" | "attention"> {
    const attempts = op.attempts + 1;
    const limit = UNCERTAIN_CODES.has(code) ? maxChecks : REFUSAL_CODES.has(code) ? maxRefusals : null;
    if (limit !== null && attempts >= limit) {
      const changed = await db.updateOp(op.opId, { status: "attention", attention: UNCERTAIN_CODES.has(code) ? "uncertain" : "refused", attempts, lastError: code });
      if (changed) emit({ type: "attention", opId: op.opId, functionId: op.functionId, projectId: op.projectId });
      return "attention";
    }
    await db.updateOp(op.opId, { attempts, nextAttemptAt: now() + backoff(attempts), lastError: code });
    return "retry";
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
    return { sent: 0, applied: 0, duplicates: 0, conflicts: 0, merged: 0, rejected: 0, failed: 0, blocked: 0, attention: 0, remaining: 0, nextDueAt: null, status };
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
    const mergesThisPass = new Map<string, number>();
    await withDb(async (db) => {
      for (let guard = 0; guard < 10_000; guard += 1) {
        const ops = await db.listOps();
        const manifest = await db.getMeta<StoredManifest>(MANIFEST_KEY);

        // An op whose project the person can no longer read is never sent (its text is kept as a draft).
        let dropped = false;
        if (manifest) {
          for (const op of ops) {
            if (!manifest.projectIds.includes(op.projectId)) {
              const label = op.label ? `${op.label} was` : "A change you made was";
              if (await rejectOp(db, op, `${label} not saved: you no longer have access to that project. It was undone on this laptop.`, "PROJECT_NOT_READABLE")) { report.rejected += 1; dropped = true; }
            }
          }
        }
        if (dropped) continue;

        const due = eligible(ops, now());
        if (due.length === 0) {
          await noteWaiting(db, report);
          return;
        }

        // Fill one request: in order, at most maxOps, at most maxBytes, and no op above the server's per-op ceiling (an op
        // too big for any request can never be sent: it is stopped with words and its text kept).
        const batch: OutboxOp[] = [];
        let size = ENVELOPE_BYTES;
        let tooBig: OutboxOp | null = null;
        for (const op of due) {
          const wire = toWire(op);
          const opBytes = bytesOf(wire) + 1;
          if (ENVELOPE_BYTES + opBytes > maxBytes || opTooLarge(wire)) { tooBig = op; break; }
          if (batch.length >= maxOps || size + opBytes > maxBytes) break;
          batch.push(op);
          size += opBytes;
        }
        if (tooBig && batch.length === 0) {
          const label = tooBig.label ? `${tooBig.label} is` : "A change you made is";
          if (await rejectOp(db, tooBig, `${label} too large to send. It was undone on this laptop.`, "TOO_LARGE")) report.rejected += 1;
          continue;
        }

        let response: { results: PushResult[] };
        report.sent += batch.length;
        try {
          response = await options.client.push({ deviceId: options.deviceId, ops: batch.map(toWire) });
        } catch (err) {
          const kind = err instanceof SyncError ? err.kind : null;
          const status = err instanceof SyncError ? err.status : 0;
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
          if (status === 403) {
            // The server no longer links this sign-in to a person (deactivated, unlinked): every op would get the same answer.
            // Pause with ONE card instead of retrying them all for ever; nothing is lost, nothing is counted against the ops.
            notLinked = true;
            setStatus("not_linked");
            emit({ type: "not_linked" });
            report.sent -= batch.length;
            await noteWaiting(db, report);
            return;
          }
          // Anything else: nothing is known about what the server did. Keep every op, same op_id, try again later
          // (a whole-request refusal that will not change by itself is counted, then the person is asked).
          for (const op of batch) {
            const outcome = await settleFailed(db, op, kind ?? "UNKNOWN").catch(() => "retry" as const);
            if (outcome === "attention") report.attention += 1;
          }
          report.failed += batch.length;
          await noteWaiting(db, report);
          setStatus(kind === "network" || kind === "timeout" || kind === "server" || kind === "rate_limited" ? "offline" : "idle");
          return;
        }

        const byId = new Map(response.results.map((r) => [r.op_id, r]));
        const refetches: Refetch[] = [];
        const fail = async (op: OutboxOp, code: string) => {
          report.failed += 1;
          if ((await settleFailed(db, op, code)) === "attention") report.attention += 1;
        };
        for (const op of batch) {
          const result = byId.get(op.opId);
          // The server named this op in no result: unknown outcome, so retry with the same op_id.
          if (!result) { await fail(op, "NO_RESULT"); continue; }

          // A row the server hands back must be this organisation's: anything else is refused, and the op stays to be retried.
          const orgId = manifest?.orgId ?? null;
          if (result.server && orgId && foreignOrg(result.server.data, orgId)) {
            await fail(op, "FOREIGN_ORGANISATION");
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
            case "conflict": {
              const settled = await settleConflict(db, op, result, orgId, mergesThisPass);
              if (settled.refetch) refetches.push(settled.refetch);
              if (settled.outcome === "card" || settled.outcome === "deleted") report.conflicts += 1;
              else if (settled.outcome === "merged" || settled.outcome === "already_in") report.merged += 1;
              break;
            }
            case "rejected":
              if (await rejectOp(db, op, rejectionMessage(op, result.error), result.error?.code)) report.rejected += 1;
              break;
            case "needs_server":
              await settleBlocked(db, op);
              report.blocked += 1;
              break;
            default: // "failed", and anything unknown (the client maps unknown statuses to "failed")
              await fail(op, result.error?.code ?? "FAILED");
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
    if (notLinked) return Promise.resolve({ ...emptyReport("not_linked"), remaining: state.pending, skipped: "paused" });
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
      if (rerun && !paused && !notLinked) { rerun = false; void flush(); } else rerun = false;
    });
    flushing = p;
    return p;
  }

  function askPersistenceOnce() {
    if (persistenceAsked || !options.requestPersistence) return;
    persistenceAsked = true;
    void options.requestPersistence().then((outcome) => {
      if (outcome === "denied") {
        storageWarning = true;
        state = { ...state, storageWarning };
        emit({ type: "changed" });
      }
    }).catch(() => {});
  }

  // ── the public API ──

  const outbox: Outbox = {
    async enqueue(input) {
      if (!input.projectId) throw new Error("An edit needs the project it belongs to.");
      if (input.record && !Number.isFinite(input.record.baseVersion)) throw new Error("An edit of an existing row needs the version it was based on.");
      // Refused HERE, before anything is stored, so the screen still holds the text and can say what to change (data:F4, wire:F12).
      const long = textLimitProblem(input.params);
      if (long) throw new OutboxRefusal("TEXT_TOO_LONG", textTooLongMessage(long), long.field);
      const opId = newOpId();
      const clientAt = new Date(now()).toISOString();
      if (opTooLarge(toWire({ opId, functionId: input.functionId, projectId: input.projectId, params: input.params, record: input.record, creates: input.creates, clientAt }))) {
        throw new OutboxRefusal("TOO_LARGE", `${input.label ?? "This change"} is too large to send from this laptop. Your text is kept: make it shorter and save again.`);
      }
      // Ask the browser to keep this site's storage BEFORE the first piece of work is stored only here (data:F13).
      askPersistenceOnce();
      await withDb((db) =>
        db.transact(async (tx) => {
          const target = input.record ?? input.creates ?? null;
          const before: LocalRecord | undefined = target ? await tx.getRecord(target.kind, target.id) : undefined;
          await input.optimistic?.(tx);

          let effect: Data | undefined;
          let beforeValues: Data | undefined;
          if (target) {
            const row = await tx.getRecord(target.kind, target.id);
            if (row) {
              const patch: RecordPatch = { dirty: opId };
              if (input.record && before) {
                // What this edit did to the row (for the three-way merge and for re-deriving the row after a revert).
                effect = effectOf(before.data, row.data);
                beforeValues = beforeOf(before.data, effect);
                if (input.before) {
                  for (const key of Object.keys(effect)) {
                    const loaded = fieldValue(input.before, key);
                    if (loaded !== undefined) beforeValues[key] = loaded;
                  }
                }
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
            ...(effect ? { effect, before: beforeValues } : {}),
            clientAt,
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
    async listPending() {
      return withDb((db) => db.listOps());
    },

    async resolve(opId, choice) {
      let resend = false;
      await withDb((db) =>
        db.transact(async (tx) => {
          const op = await tx.getOp(opId);
          if (!op || op.status !== "conflict" || !op.record) throw new Error("There is no conflict to settle for that change.");
          const later = laterOnSameRecord(await tx.listOps(), op);
          const row = await tx.getRecord(op.record.kind, op.record.id);
          const deleted = op.conflictKind === "deleted";

          if (choice === "keep_text" || (deleted && (choice === "discard" || choice === "keep_theirs"))) {
            // Stop: undo it here. "keep_text" keeps what was typed as a draft; "discard" is the person's explicit choice to drop it.
            await tx.deleteOp(opId);
            await revertRow(tx, op, later);
            if (choice === "keep_text") {
              await keepDraft(tx, op, deleted
                ? `${op.label ?? "Your change"} was not saved: it was deleted by someone else.`
                : `${op.label ?? "Your change"} was not sent: you kept it to look at again.`, deleted ? "RECORD_DELETED" : "KEPT");
            }
            return;
          }

          if (deleted) {
            if (choice !== "keep_as_new") throw new Error("That record was deleted: keep your version as a new one, keep your text, or discard it.");
            const recreate = recreateFor(op, row?.data);
            if (!recreate) throw new Error("This change cannot be kept as a new record here. Keep your text instead.");
            // A NEW edit, by the person's choice: a new op id, a temporary row, the old edit gone.
            await tx.deleteOp(opId);
            if (row) await tx.deleteRecord(row.type, row.id.slice(row.type.length + 1));
            const tempId = `local-${newOpId()}`;
            const newId = newOpId();
            await tx.putRecord({ id: `${recreate.kind}:${tempId}`, type: recreate.kind, orgId: row!.orgId, projectId: op.projectId, data: { ...asData(row?.data), id: tempId } });
            await tx.putOp({
              opId: newId, functionId: recreate.functionId, projectId: op.projectId, params: recreate.params, label: recreate.label,
              creates: { kind: recreate.kind, id: tempId }, clientAt: new Date(now()).toISOString(), status: "pending", attempts: 0, nextAttemptAt: 0,
            });
            resend = true;
            return;
          }

          const server = newestServerRow(op, row);
          if (!server) throw new Error("There is no conflict to settle for that change.");
          if (choice === "keep_theirs") {
            // Theirs wins for the fields that disagree. Any OTHER field I changed (one only I touched) still goes.
            const effect = effectOfOp(op);
            const fields = op.conflictFields?.length ? op.conflictFields : Object.keys(effect);
            const restEffect = Object.fromEntries(Object.entries(effect).filter(([k]) => !fields.includes(k)));
            const restParams = withoutFields(op.params, fields);
            const stillSends = Object.keys(restEffect).length > 0 && Object.keys(effectFromParams(restParams, op.record.id)).length > 0;
            if (!stillSends) {
              await tx.deleteOp(opId);
              if (row) {
                if (later.length === 0) await tx.putRecord(rowInputFrom(server, row.orgId, row.projectId, now()));
                else {
                  let data: unknown = server.data;
                  for (const next of later) data = overlay(data, effectOfOp(next));
                  await tx.patchRecord(row.type, op.record.id, {
                    data, serverVersion: server.version, serverUpdatedAt: server.updated_at, sig: undefined, kid: undefined,
                    serverCopy: serverCopyOf(server), dirty: later[later.length - 1]!.opId,
                  });
                }
              }
              // Edits made on top of mine now sit on top of THEIRS.
              for (const next of later) await tx.updateOp(next.opId, { record: { ...next.record!, baseVersion: server.version } });
            } else {
              await tx.updateOp(opId, {
                status: "pending", params: restParams, effect: restEffect,
                before: Object.fromEntries(Object.keys(restEffect).map((k) => [k, fieldValue(asData(server.data), k) ?? null])),
                record: { ...op.record, baseVersion: server.version },
                conflictServer: undefined, conflictKind: undefined, conflictFields: undefined, attempts: 0, nextAttemptAt: 0, lastError: undefined,
              });
              if (row) {
                let data: unknown = overlay(server.data, restEffect);
                for (const next of later) data = overlay(data, effectOfOp(next));
                await tx.patchRecord(row.type, op.record.id, { data, serverVersion: server.version, serverUpdatedAt: server.updated_at, serverCopy: serverCopyOf(server) });
              }
              resend = true;
            }
          } else if (choice === "keep_mine") {
            await tx.updateOp(opId, {
              status: "pending", resolution: "overwrite", record: { ...op.record, baseVersion: server.version },
              conflictServer: undefined, conflictKind: undefined, conflictFields: undefined, attempts: 0, nextAttemptAt: 0, lastError: undefined,
            });
            if (row) await tx.patchRecord(row.type, op.record.id, { serverVersion: server.version, serverUpdatedAt: server.updated_at, serverCopy: serverCopyOf(server) });
            resend = true;
          } else {
            throw new Error("That choice does not apply to this conflict.");
          }
        })
      );
      await refreshState();
      if (resend) schedule(0);
    },

    async discard(opId) {
      await withDb((db) =>
        db.transact(async (tx) => {
          const op = await tx.getOp(opId);
          if (!op || (op.status !== "blocked" && op.status !== "attention")) throw new Error("That change is not waiting for you.");
          const later = laterOnSameRecord(await tx.listOps(), op);
          await tx.deleteOp(opId);
          await revertRow(tx, op, later);
          await keepDraft(tx, op, op.status === "blocked"
            ? `${op.label ?? "Your change"} was not sent: it needs the online screen.`
            : `${op.label ?? "Your change"} was not sent: you stopped it. Check whether it reached the server before sending it again.`, op.status === "blocked" ? "NEEDS_SERVER" : op.lastError);
        })
      );
      await refreshState();
    },

    async retry(opId) {
      await withDb(async (db) => {
        const op = await db.getOp(opId);
        if (!op || op.status !== "attention") throw new Error("That change is not waiting for you.");
        await db.updateOp(opId, { status: "pending", attention: undefined, attempts: 0, nextAttemptAt: 0 });
      });
      await refreshState();
      schedule(0);
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

    async getDraft(opId) {
      return withDb((db) => db.getDraft(opId));
    },

    async discardDraft(opId) {
      await withDb((db) =>
        db.transact(async (tx) => {
          await tx.deleteDraft(opId);
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
      notLinked = false;
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
