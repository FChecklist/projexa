// LOCAL-FIRST slice 1 (owner directive 2026-10-02): the user's own laptop holds a
// working copy of their projects and organisation in a database inside the
// browser (IndexedDB), so screens open from the laptop's memory instead of a
// server. This file is only the small, dependency-free storage layer; the
// sync between laptops (slice 2) and Supabase (the durable backup/relay) builds
// on it. Nothing here talks to the network.
//
// Every record carries `orgId` so a laptop can never mix two organisations, and
// `updatedAt`/`rev` so the sync layer can merge changes later.

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
};

export type MetaEntry = { key: string; value: unknown };

export const LOCAL_DB_NAME = "projexa-local";
export const LOCAL_DB_VERSION = 1;
const STORE_META = "meta";
const STORE_RECORDS = "records";

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

export type LocalDb = {
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  putRecord(record: Omit<LocalRecord, "id" | "rev" | "updatedAt"> & { id: string; updatedAt?: number }): Promise<LocalRecord>;
  getRecord(type: string, id: string): Promise<LocalRecord | undefined>;
  listByOrg(orgId: string, type?: string): Promise<LocalRecord[]>;
  countRecords(orgId?: string): Promise<number>;
  close(): void;
};

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
      if (!upgrade.objectStoreNames.contains(STORE_RECORDS)) {
        const store = upgrade.createObjectStore(STORE_RECORDS, { keyPath: "id" });
        store.createIndex("byOrg", "orgId");
        store.createIndex("byOrgType", ["orgId", "type"]);
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("Could not open the local database"));
  });

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
        throw new Error("Refusing to overwrite a record that belongs to a different organisation.");
      }
      const next: LocalRecord = {
        id: input.id,
        type: input.type,
        orgId: input.orgId,
        projectId: input.projectId,
        data: input.data,
        updatedAt: input.updatedAt ?? Date.now(),
        rev: (existing?.rev ?? 0) + 1,
      };
      store.put(next);
      await done(tx);
      return next;
    },
    async getRecord(type, id) {
      return (await req(db.transaction(STORE_RECORDS).objectStore(STORE_RECORDS).get(`${type}:${id}`))) as LocalRecord | undefined;
    },
    async listByOrg(orgId, type) {
      const store = db.transaction(STORE_RECORDS).objectStore(STORE_RECORDS);
      const range = type
        ? await req(store.index("byOrgType").getAll([orgId, type]))
        : await req(store.index("byOrg").getAll(orgId));
      return range as LocalRecord[];
    },
    async countRecords(orgId) {
      const store = db.transaction(STORE_RECORDS).objectStore(STORE_RECORDS);
      return orgId ? req(store.index("byOrg").count(orgId)) : req(store.count());
    },
    close() {
      db.close();
    },
  };
}
