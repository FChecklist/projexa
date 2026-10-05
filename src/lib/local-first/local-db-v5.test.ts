import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { LOCAL_DB_VERSION, TOMBSTONE_MAX, TOMBSTONE_TTL_MS, openLocalDb } from "./local-db";

// Schema 5 of the laptop's database (AUDIT-100 B8): the `tombstones` store -- the laptop's memory that the SERVER deleted a record, so an
// older copy of it (a stale peer's signed row, a late page) is never stored again. Bounded by age and count.

const DAY = 24 * 60 * 60 * 1000;
const row = (id: string, version: number, extra: Record<string, unknown> = {}) => ({
  id: `meetings:${id}`, type: "meetings", orgId: "orgA", projectId: "p1", data: { id, title: `M ${id}` }, serverVersion: version, ...extra,
});
const serverDelete = { orgId: "orgA", projectId: "p1" };

/** A database exactly as schema 4 left it (records, outbox, drafts, meta), with data in it. */
async function makeV4Database(idb: IDBFactory, name: string) {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const open = idb.open(name, 4);
    open.onupgradeneeded = () => {
      const u = open.result;
      u.createObjectStore("meta", { keyPath: "key" });
      const store = u.createObjectStore("records", { keyPath: "id" });
      store.createIndex("byOrg", "orgId");
      store.createIndex("byOrgType", ["orgId", "type"]);
      store.createIndex("byOrgTypeProject", ["orgId", "type", "projectId"]);
      store.createIndex("byOrgProject", ["orgId", "projectId"]);
      store.createIndex("byDirty", "dirty");
      u.createObjectStore("outbox", { keyPath: "opId" }).createIndex("bySeq", "seq", { unique: true });
      u.createObjectStore("drafts", { keyPath: "opId" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["meta", "records", "outbox", "drafts"], "readwrite");
    tx.objectStore("meta").put({ key: "sync:changes:p1", value: { seq: 42 } });
    tx.objectStore("records").put({ id: "meetings:m1", type: "meetings", orgId: "orgA", projectId: "p1", data: { title: "kept" }, updatedAt: 5, rev: 1, serverVersion: 3 });
    tx.objectStore("outbox").put({ opId: "op-1", seq: 1, functionId: "update_meeting", projectId: "p1", params: {}, clientAt: "2026-10-05T10:00:00Z", status: "pending", attempts: 0, nextAttemptAt: 0 });
    tx.objectStore("drafts").put({ opId: "op-0", functionId: "update_meeting", projectId: "p1", params: { title: "typed" }, message: "not saved", at: 1 });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe("schema 5: tombstones", () => {
  test("the version is 5 and an upgrade from 4 keeps every record, meta value, op and draft (it only ADDS the store)", async () => {
    expect(LOCAL_DB_VERSION).toBe(5);
    const idb = new IDBFactory();
    await makeV4Database(idb, "v4");
    const db = await openLocalDb(idb, "v4");
    expect((await db.getRecord("meetings", "m1"))?.data).toEqual({ title: "kept" });
    expect(await db.getMeta("sync:changes:p1")).toEqual({ seq: 42 });
    expect((await db.listOps()).map((o) => o.opId)).toEqual(["op-1"]);
    expect((await db.listDrafts()).map((d) => d.opId)).toEqual(["op-0"]);
    expect(await db.countTombstones()).toBe(0);
    db.close();
  });

  test("a server delete leaves a tombstone; a copy at that version or older is never stored again, a NEWER one replaces the tombstone", async () => {
    const db = await openLocalDb(new IDBFactory(), "t");
    await db.putRecords([row("m1", 1)], { fromServer: true });
    expect(await db.deleteRecords(["meetings:m1"], { fromServer: true, tombstone: { ...serverDelete, versions: { "meetings:m1": 2 } } })).toBe(1);
    expect((await db.getTombstones(["meetings:m1"])).get("meetings:m1")).toMatchObject({ version: 2, orgId: "orgA", projectId: "p1", type: "meetings", source: "server" });

    // a stale copy (a peer's v1, a late v2): refused, and nothing changes
    expect(await db.putRecords([row("m1", 1)], { fromServer: true })).toBe(0);
    expect(await db.putRecords([row("m1", 2)], { fromServer: true })).toBe(0);
    expect(await db.getRecord("meetings", "m1")).toBeUndefined();
    // the server really brought it back (a restore at v3): stored, tombstone gone
    expect(await db.putRecords([row("m1", 3)], { fromServer: true })).toBe(1);
    expect((await db.getRecord("meetings", "m1"))?.serverVersion).toBe(3);
    expect(await db.countTombstones()).toBe(0);
    db.close();
  });

  test("a delete of a row this laptop never held still leaves a tombstone (a peer may offer it later); a later delete never LOWERS one", async () => {
    const db = await openLocalDb(new IDBFactory(), "t");
    await db.deleteRecords(["meetings:never"], { fromServer: true, tombstone: { ...serverDelete, versions: { "meetings:never": 5 } } });
    await db.deleteRecords(["meetings:never"], { fromServer: true, tombstone: { ...serverDelete, versions: { "meetings:never": 3 } } });
    expect((await db.getTombstones(["meetings:never"])).get("meetings:never")?.version).toBe(5);
    expect(await db.putRecords([row("never", 4)], { fromServer: true })).toBe(0);
    db.close();
  });

  test("only a SERVER delete leaves one: a plain delete (lost access, a dropped kind) does not, and a local write opts out", async () => {
    const db = await openLocalDb(new IDBFactory(), "t");
    await db.putRecords([row("a", 1), row("b", 1)], { fromServer: true });
    await db.deleteRecords(["meetings:a"]);
    expect(await db.countTombstones()).toBe(0);
    await db.deleteRecords(["meetings:b"], { fromServer: true, tombstone: serverDelete });
    expect((await db.getTombstones(["meetings:b"])).get("meetings:b")?.version).toBe(1); // the version this laptop held
    expect(await db.putRecords([row("b", 1)], { local: true })).toBe(1); // a repair tool says so explicitly
    db.close();
  });

  test("bounded: a tombstone expires after TOMBSTONE_TTL_MS, and at most TOMBSTONE_MAX are kept (oldest first)", async () => {
    const db = await openLocalDb(new IDBFactory(), "t");
    await db.deleteRecords(["meetings:old"], { fromServer: true, tombstone: serverDelete });
    expect(await db.pruneTombstones(Date.now() + TOMBSTONE_TTL_MS - DAY)).toBe(0); // not yet
    expect(await db.pruneTombstones(Date.now() + TOMBSTONE_TTL_MS + DAY)).toBe(1); // expired
    expect(await db.countTombstones()).toBe(0);

    const ids = Array.from({ length: TOMBSTONE_MAX + 25 }, (_, i) => `meetings:x${String(i).padStart(5, "0")}`);
    await db.deleteRecords(ids.slice(0, 30), { fromServer: true, tombstone: serverDelete }); // the oldest batch
    await new Promise((r) => setTimeout(r, 5));
    await db.deleteRecords(ids.slice(30), { fromServer: true, tombstone: serverDelete });
    expect(await db.countTombstones()).toBe(TOMBSTONE_MAX);
    // what went is (part of) the OLDEST batch; the newest batch is complete
    const kept = await db.getTombstones(ids);
    expect(ids.slice(30).every((id) => kept.has(id))).toBe(true);
    expect(ids.slice(0, 30).filter((id) => kept.has(id)).length).toBe(5);
    db.close();
  });

  test("a project leaving the laptop (lost access, a reset, a new epoch) takes its tombstones with it", async () => {
    const db = await openLocalDb(new IDBFactory(), "t");
    await db.deleteRecords(["meetings:a"], { fromServer: true, tombstone: serverDelete });
    await db.deleteRecords(["meetings:z"], { fromServer: true, tombstone: { orgId: "orgA", projectId: "p2" } });
    await db.deleteByProject("orgA", "p1");
    expect([...(await db.getTombstones(["meetings:a", "meetings:z"])).keys()]).toEqual(["meetings:z"]);
    db.close();
  });
});
