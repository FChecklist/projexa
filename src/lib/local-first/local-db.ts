// LOCAL-FIRST slice 1 (owner directive 2026-10-02): the user's own laptop holds a
// working copy of their projects and organisation in a database inside the
// browser (IndexedDB), so screens open from the laptop's memory instead of a
// server. This file is only the small, dependency-free storage layer; the
// sync between laptops (slice 2) and Supabase (the durable backup/relay) builds
// on it. Nothing here talks to the network.
//
// Every record carries `orgId` so a laptop can never mix two organisations, and
// `updatedAt`/`rev` so the sync layer can merge changes later.
//
// SCHEMA 3 (docs/local-first/CONTRACT.md section 0): a record now also remembers the version the BACKEND
// holds for it, so update history is kept on the server and versions drive sync in both directions.
//   serverVersion / serverUpdatedAt / sig / kid   what the server said about the row the last time it spoke
//   dirty                                          the op_id of the person's pending local edit (null = clean)
//   serverCopy                                     only on a dirty row: the freshest server row we know of,
//                                                  parked here because a dirty row is NEVER overwritten
// A new `outbox` store holds the edits that have not reached the server yet (see outbox.ts). Its order is a
// number we assign (`seq`, kept in meta) because an IndexedDB store cannot have a string key path AND an
// auto-increment key at once.
//
// The one rule this file enforces on its own, so no caller can forget it: a write that comes FROM THE SERVER
// (`{ fromServer: true }`: a pull, a tombstone, a reconcile) never overwrites or deletes a dirty row. It
// parks the news in `serverCopy` instead, so the person's edit survives and a later revert / "keep theirs"
// still has the freshest server row to go back to.

/** The freshest row the server is known to hold for a record that has a pending local edit. */
export type ServerCopy = {
  data: unknown;
  version: number | null;
  updatedAt: string | null;
  sig?: string;
  kid?: string;
  /** The server removed the row while the local edit was waiting. */
  deleted?: boolean;
};

export type LocalRecord = {
  /** `${type}:${id}` -- unique across record types. */
  id: string;
  type: string;
  orgId: string;
  /** Project the record belongs to, when it belongs to one. */
  projectId: string | null;
  data: unknown;
  /** Milliseconds since epoch, set by the writer. */
  updatedAt: number;
  /** Monotonic per-record revision, bumped on every local write. */
  rev: number;
  /** The version the backend holds (the row's version when we last heard from it). Absent: never versioned (older server). */
  serverVersion?: number;
  serverUpdatedAt?: string;
  /** ES256 signature of the server row (base64url) and the key id that made it. Absent = unsigned: never hand to a peer. */
  sig?: string;
  kid?: string;
  /** The op_id of the pending local edit. Null/absent = clean. A dirty row is never overwritten, deleted or shared. */
  dirty?: string | null;
  serverCopy?: ServerCopy;
};

export type MetaEntry = { key: string; value: unknown };

/** A server row as the push endpoint returns it (conflict, applied). Kept here as plain data so this file imports nothing. */
export type StoredServerRow = {
  kind: string;
  id: string;
  version: number;
  updated_at: string;
  data: unknown;
  sig?: string;
  kid?: string;
};

export type OutboxOpStatus = "pending" | "conflict" | "blocked";

/** One edit waiting to reach the server. The op_id never changes, so a retry is always the same op. */
export type OutboxOp = {
  opId: string;
  /** Order of entry. Assigned by the store. */
  seq: number;
  functionId: string;
  projectId: string;
  params: Record<string, unknown>;
  /** The row this edit changes and the server version it was based on (conflict detection). */
  record?: { kind: string; id: string; baseVersion: number };
  /** Set by "keep mine": the server is told to apply this edit over a newer version. */
  resolution?: "overwrite";
  /** A row that exists only on this laptop until the op is applied (its kind and temporary id). */
  creates?: { kind: string; id: string };
  /** Plain words for the person ("New RFI"), used when the change has to be undone. */
  label?: string;
  clientAt: string;
  status: OutboxOpStatus;
  attempts: number;
  /** ms since epoch; the op is not sent before this. 0 = now. */
  nextAttemptAt: number;
  lastError?: string;
  /** The server's row when status is "conflict", kept so a reload still shows both sides. */
  conflictServer?: StoredServerRow;
};

export type NewOutboxOp = Omit<OutboxOp, "seq"> & { seq?: number };

export const LOCAL_DB_NAME = "projexa-local";
// v2 adds the byOrgTypeProject index (slice 2: reading one project's rows of one kind without scanning the organisation).
// v3 adds record versions, the byDirty index and the outbox store (CONTRACT.md: the "schema" number of X-Px-Client).
export const LOCAL_DB_VERSION = 3;

/**
 * Database name for one signed-in person. Two people on one laptop get two separate databases, so
 * their replicas can never mix. The slice-1 name (LOCAL_DB_NAME) stays the default of openLocalDb.
 */
export function localDbNameFor(userId: string): string {
  if (!userId) throw new Error("A local database name needs the signed-in user id");
  return `${LOCAL_DB_NAME}:${userId}`;
}

// ─── meta keys ───────────────────────────────────────────────────────────────────────────────────────
/** The position in a project's change feed up to which everything is stored: `{ seq: number }`. */
export const changeCursorKey = (projectId: string) => `sync:changes:${projectId}`;
/** When a (project, kind) last had its deletes reconciled against the server's id list: `{ at: number }`. */
export const reconcileKey = (projectId: string, kind: string) => `sync:reconcile:${projectId}:${kind}`;
/** The last outbox sequence number handed out. */
export const OUTBOX_SEQ_KEY = "outbox:seq";
/** Plain-words messages about edits that were turned down, until the person dismisses them. */
export const OUTBOX_NOTICES_KEY = "outbox:notices";

const STORE_META = "meta";
const STORE_RECORDS = "records";
const STORE_OUTBOX = "outbox";

/** A row that has a valid server signature and no pending local edit may be handed to another laptop. Nothing else may. */
export function isShareable(record: Pick<LocalRecord, "sig" | "kid" | "dirty">): boolean {
  return !!record.sig && !!record.kid && !record.dirty;
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export type PutInput = Omit<LocalRecord, "id" | "rev" | "updatedAt"> & { id: string; updatedAt?: number };

/** What a caller may change on an existing row without rewriting it: everything except its identity and revision. */
export type RecordPatch = Partial<Omit<LocalRecord, "id" | "type" | "orgId" | "rev">>;

export type WriteOptions = {
  /**
   * The write comes from the server (a pull page, a change-feed fetch, a tombstone). A dirty row is then left
   * exactly as it is and the news is parked in its `serverCopy`; a row the server shows at an OLDER version than
   * the one already stored is left alone.
   */
  fromServer?: boolean;
};

/** The same operations, inside ONE open transaction. Used by transact(); every call must be awaited before the callback ends. */
export type LocalTx = {
  getRecord(type: string, id: string): Promise<LocalRecord | undefined>;
  /** One project's rows of one kind (an optimistic change often needs to look at its neighbours). */
  listByProject(orgId: string, type: string, projectId: string): Promise<LocalRecord[]>;
  listByOrg(orgId: string, type?: string): Promise<LocalRecord[]>;
  putRecord(record: PutInput): Promise<LocalRecord>;
  /** Merges fields into an existing row (no revision bump). Returns undefined when there is no such row. */
  patchRecord(type: string, id: string, patch: RecordPatch): Promise<LocalRecord | undefined>;
  deleteRecord(type: string, id: string): Promise<boolean>;
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  getOp(opId: string): Promise<OutboxOp | undefined>;
  putOp(op: NewOutboxOp): Promise<OutboxOp>;
  updateOp(opId: string, patch: Partial<Omit<OutboxOp, "opId" | "seq">>): Promise<OutboxOp | undefined>;
  deleteOp(opId: string): Promise<boolean>;
  listOps(): Promise<OutboxOp[]>;
};

export type LocalDb = {
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  putRecord(record: PutInput): Promise<LocalRecord>;
  /**
   * Writes many records in ONE transaction: all of them are stored or none (a record that belongs to a
   * different organisation aborts the whole batch). Used by the sync engine, one page chunk at a time.
   * Returns how many were actually written (a dirty row that was parked, or a stale version, is not counted).
   */
  putRecords(records: PutInput[], options?: WriteOptions): Promise<number>;
  /** Removes records by their full id (`${type}:${id}`). Missing ids are fine. Returns how many were removed. */
  deleteRecords(ids: string[], options?: WriteOptions): Promise<number>;
  /** Removes every record of one project (the person lost access to it). Returns how many were removed. */
  deleteByProject(orgId: string, projectId: string): Promise<number>;
  getRecord(type: string, id: string): Promise<LocalRecord | undefined>;
  /** Several records by their full id (`${type}:${id}`) in one transaction. Missing ids are simply absent from the map. */
  getRecordsByIds(ids: string[]): Promise<Map<string, LocalRecord>>;
  listByOrg(orgId: string, type?: string): Promise<LocalRecord[]>;
  listByProject(orgId: string, type: string, projectId: string): Promise<LocalRecord[]>;
  /** Rows with a pending local edit (never overwritten by a pull, never deleted by a reconcile, never shared). */
  listDirty(orgId?: string): Promise<LocalRecord[]>;
  countRecords(orgId?: string): Promise<number>;
  // ── the outbox ──
  putOp(op: NewOutboxOp): Promise<OutboxOp>;
  getOp(opId: string): Promise<OutboxOp | undefined>;
  /** Every op in the order they were made. */
  listOps(): Promise<OutboxOp[]>;
  updateOp(opId: string, patch: Partial<Omit<OutboxOp, "opId" | "seq">>): Promise<OutboxOp | undefined>;
  deleteOp(opId: string): Promise<boolean>;
  /**
   * Runs `fn` inside ONE read-write transaction over records, meta and the outbox: everything it writes is stored
   * or none of it (a throw aborts). The callback may only await calls on the `tx` it is given (and plain
   * synchronous work): awaiting anything else lets the browser commit the transaction early.
   */
  transact<T>(fn: (tx: LocalTx) => Promise<T>): Promise<T>;
  close(): void;
};

function buildRecord(input: PutInput, existing: LocalRecord | undefined): LocalRecord {
  const next: LocalRecord = {
    id: input.id,
    type: input.type,
    orgId: input.orgId,
    projectId: input.projectId,
    data: input.data,
    updatedAt: input.updatedAt ?? Date.now(),
    rev: (existing?.rev ?? 0) + 1,
  };
  if (input.serverVersion !== undefined) next.serverVersion = input.serverVersion;
  if (input.serverUpdatedAt !== undefined) next.serverUpdatedAt = input.serverUpdatedAt;
  if (input.sig !== undefined) next.sig = input.sig;
  if (input.kid !== undefined) next.kid = input.kid;
  if (input.dirty) next.dirty = input.dirty;
  if (input.serverCopy !== undefined) next.serverCopy = input.serverCopy;
  return next;
}

const REFUSE_FOREIGN = "Refusing to overwrite a record that belongs to a different organisation.";

/** Parks a server row in a dirty record's serverCopy (only when it is not older than what is already parked). */
function parkServerRow(existing: LocalRecord, input: PutInput): LocalRecord {
  const known = existing.serverCopy?.version ?? existing.serverVersion ?? null;
  const incoming = input.serverVersion ?? null;
  if (incoming !== null && known !== null && incoming < known) return existing; // older news than what we already hold
  return {
    ...existing,
    serverCopy: {
      data: input.data,
      version: incoming,
      updatedAt: input.serverUpdatedAt ?? null,
      ...(input.sig ? { sig: input.sig } : {}),
      ...(input.kid ? { kid: input.kid } : {}),
    },
  };
}

/** True when the server shows this row at an older version than the one stored (a late, out-of-order delivery). */
function isStale(existing: LocalRecord, input: PutInput): boolean {
  return input.serverVersion !== undefined && existing.serverVersion !== undefined && input.serverVersion < existing.serverVersion;
}

/** The record + meta + outbox operations on one open IDBTransaction. */
function txApi(tx: IDBTransaction): LocalTx {
  const records = () => tx.objectStore(STORE_RECORDS);
  const meta = () => tx.objectStore(STORE_META);
  const outbox = () => tx.objectStore(STORE_OUTBOX);

  const api: LocalTx = {
    async getRecord(type, id) {
      return (await req(records().get(`${type}:${id}`))) as LocalRecord | undefined;
    },
    async listByProject(orgId, type, projectId) {
      return (await req(records().index("byOrgTypeProject").getAll([orgId, type, projectId]))) as LocalRecord[];
    },
    async listByOrg(orgId, type) {
      const store = records();
      return (await req(type ? store.index("byOrgType").getAll([orgId, type]) : store.index("byOrg").getAll(orgId))) as LocalRecord[];
    },
    async putRecord(input) {
      const store = records();
      const existing = (await req(store.get(input.id))) as LocalRecord | undefined;
      if (existing && existing.orgId !== input.orgId) throw new Error(REFUSE_FOREIGN);
      const next = buildRecord(input, existing);
      store.put(next);
      return next;
    },
    async patchRecord(type, id, patch) {
      const store = records();
      const existing = (await req(store.get(`${type}:${id}`))) as LocalRecord | undefined;
      if (!existing) return undefined;
      const next: LocalRecord = { ...existing, ...patch };
      // An explicit undefined means "remove this field", which a plain spread would keep as an own key.
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as Record<string, unknown>)[k];
      if (!next.dirty) delete next.dirty;
      store.put(next);
      return next;
    },
    async deleteRecord(type, id) {
      const store = records();
      const key = `${type}:${id}`;
      if ((await req(store.getKey(key))) === undefined) return false;
      store.delete(key);
      return true;
    },
    async getMeta<T = unknown>(key: string) {
      const row = (await req(meta().get(key))) as MetaEntry | undefined;
      return row?.value as T | undefined;
    },
    async setMeta(key, value) {
      meta().put({ key, value } satisfies MetaEntry);
    },
    async getOp(opId) {
      return (await req(outbox().get(opId))) as OutboxOp | undefined;
    },
    async putOp(op) {
      const store = outbox();
      const existing = (await req(store.get(op.opId))) as OutboxOp | undefined;
      let seq = op.seq ?? existing?.seq;
      if (seq === undefined) {
        const last = ((await req(meta().get(OUTBOX_SEQ_KEY))) as MetaEntry | undefined)?.value;
        seq = (typeof last === "number" ? last : 0) + 1;
        meta().put({ key: OUTBOX_SEQ_KEY, value: seq } satisfies MetaEntry);
      }
      const next: OutboxOp = { ...op, seq };
      store.put(next);
      return next;
    },
    async updateOp(opId, patch) {
      const store = outbox();
      const existing = (await req(store.get(opId))) as OutboxOp | undefined;
      if (!existing) return undefined;
      const next: OutboxOp = { ...existing, ...patch };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as Record<string, unknown>)[k];
      store.put(next);
      return next;
    },
    async deleteOp(opId) {
      const store = outbox();
      if ((await req(store.getKey(opId))) === undefined) return false;
      store.delete(opId);
      return true;
    },
    async listOps() {
      return (await req(outbox().index("bySeq").getAll())) as OutboxOp[];
    },
  };
  return api;
}

/**
 * Opens (and on first use creates) the laptop's local database. `idb` is
 * injectable so tests can pass fake-indexeddb; the browser default is the real one.
 */
export async function openLocalDb(idb: IDBFactory = globalThis.indexedDB, name = LOCAL_DB_NAME): Promise<LocalDb> {
  if (!idb) throw new Error("This browser has no IndexedDB, so a local workspace cannot be created.");

  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const open = idb.open(name, LOCAL_DB_VERSION);
    open.onupgradeneeded = () => {
      const upgrade = open.result;
      if (!upgrade.objectStoreNames.contains(STORE_META)) upgrade.createObjectStore(STORE_META, { keyPath: "key" });
      const store = upgrade.objectStoreNames.contains(STORE_RECORDS)
        ? open.transaction!.objectStore(STORE_RECORDS)
        : upgrade.createObjectStore(STORE_RECORDS, { keyPath: "id" });
      if (!store.indexNames.contains("byOrg")) store.createIndex("byOrg", "orgId");
      if (!store.indexNames.contains("byOrgType")) store.createIndex("byOrgType", ["orgId", "type"]);
      if (!store.indexNames.contains("byOrgTypeProject")) store.createIndex("byOrgTypeProject", ["orgId", "type", "projectId"]);
      if (!store.indexNames.contains("byOrgProject")) store.createIndex("byOrgProject", ["orgId", "projectId"]);
      // v3: only rows with a pending local edit have a `dirty` key, so this index IS the list of dirty rows.
      if (!store.indexNames.contains("byDirty")) store.createIndex("byDirty", "dirty");
      // v3: the edits waiting to reach the server.
      const ops = upgrade.objectStoreNames.contains(STORE_OUTBOX)
        ? open.transaction!.objectStore(STORE_OUTBOX)
        : upgrade.createObjectStore(STORE_OUTBOX, { keyPath: "opId" });
      if (!ops.indexNames.contains("bySeq")) ops.createIndex("bySeq", "seq", { unique: true });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("Could not open the local database"));
  });
  // A newer version of the app in another tab must be able to upgrade this database: step aside when asked.
  db.onversionchange = () => db.close();

  const transact = async <T,>(fn: (tx: LocalTx) => Promise<T>): Promise<T> => {
    const tx = db.transaction([STORE_RECORDS, STORE_META, STORE_OUTBOX], "readwrite");
    const finished = done(tx);
    finished.catch(() => {}); // an abort is reported through the thrown error, not twice
    let result: T;
    try {
      result = await fn(txApi(tx));
    } catch (err) {
      try { tx.abort(); } catch { /* already finished */ }
      throw err;
    }
    await finished;
    return result;
  };

  return {
    async getMeta<T = unknown>(key: string) {
      const row = (await req(db.transaction(STORE_META).objectStore(STORE_META).get(key))) as MetaEntry | undefined;
      return row?.value as T | undefined;
    },
    async setMeta(key: string, value: unknown) {
      const tx = db.transaction(STORE_META, "readwrite");
      tx.objectStore(STORE_META).put({ key, value } satisfies MetaEntry);
      await done(tx);
    },
    async putRecord(input) {
      const tx = db.transaction(STORE_RECORDS, "readwrite");
      const store = tx.objectStore(STORE_RECORDS);
      const existing = (await req(store.get(input.id))) as LocalRecord | undefined;
      // A record id is `${type}:${id}` and belongs to exactly one organisation: refuse to
      // overwrite another organisation's record rather than silently mixing tenants.
      if (existing && existing.orgId !== input.orgId) {
        tx.abort();
        throw new Error(REFUSE_FOREIGN);
      }
      const next = buildRecord(input, existing);
      store.put(next);
      await done(tx);
      return next;
    },
    async putRecords(inputs, options) {
      if (inputs.length === 0) return 0;
      const fromServer = options?.fromServer === true;
      const tx = db.transaction(STORE_RECORDS, "readwrite");
      const store = tx.objectStore(STORE_RECORDS);
      const finished = done(tx);
      finished.catch(() => {}); // the abort below is reported through the thrown error, not twice
      let written = 0;
      try {
        for (const input of inputs) {
          const existing = (await req(store.get(input.id))) as LocalRecord | undefined;
          if (existing && existing.orgId !== input.orgId) throw new Error(REFUSE_FOREIGN);
          if (fromServer && existing) {
            if (existing.dirty) {
              const parked = parkServerRow(existing, input);
              if (parked !== existing) store.put(parked);
              continue;
            }
            if (isStale(existing, input)) continue;
          }
          store.put(buildRecord(input, existing));
          written += 1;
        }
      } catch (err) {
        try { tx.abort(); } catch { /* already finished */ }
        throw err;
      }
      await finished;
      return written;
    },
    async deleteRecords(ids, options) {
      if (ids.length === 0) return 0;
      const fromServer = options?.fromServer === true;
      const tx = db.transaction(STORE_RECORDS, "readwrite");
      const store = tx.objectStore(STORE_RECORDS);
      let removed = 0;
      for (const id of ids) {
        if (fromServer) {
          const existing = (await req(store.get(id))) as LocalRecord | undefined;
          if (!existing) continue;
          if (existing.dirty) {
            // The person's edit survives a tombstone; what the server did is remembered for revert / keep-theirs.
            store.put({ ...existing, serverCopy: { ...(existing.serverCopy ?? { data: existing.data, version: existing.serverVersion ?? null, updatedAt: existing.serverUpdatedAt ?? null }), deleted: true } } satisfies LocalRecord);
            continue;
          }
          store.delete(id);
          removed += 1;
        } else if ((await req(store.getKey(id))) !== undefined) {
          store.delete(id);
          removed += 1;
        }
      }
      await done(tx);
      return removed;
    },
    async deleteByProject(orgId, projectId) {
      const tx = db.transaction(STORE_RECORDS, "readwrite");
      const store = tx.objectStore(STORE_RECORDS);
      const keys = (await req(store.index("byOrgProject").getAllKeys([orgId, projectId]))) as IDBValidKey[];
      for (const key of keys) store.delete(key);
      await done(tx);
      return keys.length;
    },
    async listByProject(orgId, type, projectId) {
      const store = db.transaction(STORE_RECORDS).objectStore(STORE_RECORDS);
      return (await req(store.index("byOrgTypeProject").getAll([orgId, type, projectId]))) as LocalRecord[];
    },
    async getRecord(type, id) {
      return (await req(db.transaction(STORE_RECORDS).objectStore(STORE_RECORDS).get(`${type}:${id}`))) as LocalRecord | undefined;
    },
    async getRecordsByIds(ids) {
      const out = new Map<string, LocalRecord>();
      if (ids.length === 0) return out;
      const store = db.transaction(STORE_RECORDS).objectStore(STORE_RECORDS);
      for (const id of ids) {
        const row = (await req(store.get(id))) as LocalRecord | undefined;
        if (row) out.set(id, row);
      }
      return out;
    },
    async listByOrg(orgId, type) {
      const store = db.transaction(STORE_RECORDS).objectStore(STORE_RECORDS);
      const range = type
        ? await req(store.index("byOrgType").getAll([orgId, type]))
        : await req(store.index("byOrg").getAll(orgId));
      return range as LocalRecord[];
    },
    async listDirty(orgId) {
      const store = db.transaction(STORE_RECORDS).objectStore(STORE_RECORDS);
      const rows = (await req(store.index("byDirty").getAll())) as LocalRecord[];
      return orgId ? rows.filter((r) => r.orgId === orgId) : rows;
    },
    async countRecords(orgId) {
      const store = db.transaction(STORE_RECORDS).objectStore(STORE_RECORDS);
      return orgId ? req(store.index("byOrg").count(orgId)) : req(store.count());
    },
    async putOp(op) {
      return transact((tx) => tx.putOp(op));
    },
    async getOp(opId) {
      return (await req(db.transaction(STORE_OUTBOX).objectStore(STORE_OUTBOX).get(opId))) as OutboxOp | undefined;
    },
    async listOps() {
      return (await req(db.transaction(STORE_OUTBOX).objectStore(STORE_OUTBOX).index("bySeq").getAll())) as OutboxOp[];
    },
    async updateOp(opId, patch) {
      return transact((tx) => tx.updateOp(opId, patch));
    },
    async deleteOp(opId) {
      return transact((tx) => tx.deleteOp(opId));
    },
    transact,
    close() {
      db.close();
    },
  };
}
