import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { LOCAL_DB_VERSION, openLocalDb, type LocalDb, type OutboxDraft } from "./local-db";

// Schema 4 of the laptop's database: the `drafts` store (what a person typed for an edit that did not reach the server,
// review finding data:F4) and the dirty-row rule enforced by DEFAULT on every record write path (data:F9).

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id: `tasks:${id}`, type: "tasks", orgId: "orgA", projectId: "p1", data: { id, title: `T ${id}` }, ...extra,
});

const draft = (opId: string, at: number, extra: Partial<OutboxDraft> = {}): OutboxDraft => ({
  opId, functionId: "answer_rfi", projectId: "p1", params: { projectId: "p1", rfiId: "r1", answer: `typed ${opId}` },
  record: { kind: "rfis", id: "r1" }, label: "Your answer", message: "was not saved", at, ...extra,
});

/** Builds a database exactly the way schema 3 did (records with versions, the outbox with an op, meta), with data in it. */
async function makeV3Database(idb: IDBFactory, name: string) {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const open = idb.open(name, 3);
    open.onupgradeneeded = () => {
      const upgrade = open.result;
      upgrade.createObjectStore("meta", { keyPath: "key" });
      const store = upgrade.createObjectStore("records", { keyPath: "id" });
      store.createIndex("byOrg", "orgId");
      store.createIndex("byOrgType", ["orgId", "type"]);
      store.createIndex("byOrgTypeProject", ["orgId", "type", "projectId"]);
      store.createIndex("byOrgProject", ["orgId", "projectId"]);
      store.createIndex("byDirty", "dirty");
      upgrade.createObjectStore("outbox", { keyPath: "opId" }).createIndex("bySeq", "seq", { unique: true });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["meta", "records", "outbox"], "readwrite");
    tx.objectStore("meta").put({ key: "outbox:seq", value: 7 });
    tx.objectStore("records").put({ id: "tasks:t1", type: "tasks", orgId: "orgA", projectId: "p1", data: { title: "mine" }, updatedAt: 5, rev: 2, serverVersion: 4, dirty: "op-7" });
    tx.objectStore("outbox").put({ opId: "op-7", seq: 7, functionId: "update_task", projectId: "p1", params: { title: "mine" }, record: { kind: "tasks", id: "t1", baseVersion: 4 }, clientAt: "2026-10-02T10:00:00Z", status: "pending", attempts: 0, nextAttemptAt: 0 });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * The dirty-row rule, asserted through the PUBLIC write paths with no options at all (a caller that "forgot the flag").
 * Throws (an expect failure) when any path overwrites or deletes the dirty row.
 */
async function expectDirtyRowsProtected(db: LocalDb) {
  await db.putRecord(row("t1", { data: { title: "my edit" }, serverVersion: 2, dirty: "op-1" }));
  await db.putRecord(row("t2", { serverVersion: 1 })); // clean

  await db.putRecords([row("t1", { data: { title: "theirs" }, serverVersion: 3 })]);
  await db.putRecord(row("t1", { data: { title: "theirs again" }, serverVersion: 4 }));
  expect(await db.deleteRecords(["tasks:t1"])).toBe(0);
  expect(await db.deleteByProject("orgA", "p1")).toBe(1); // only the clean row went

  const kept = (await db.getRecord("tasks", "t1"))!;
  expect(kept).toBeDefined();
  expect(kept.data).toEqual({ title: "my edit" });
  expect(kept.dirty).toBe("op-1");
  expect(kept.serverVersion).toBe(2); // the version my edit is based on does not move
  expect(kept.serverCopy).toMatchObject({ version: 4, data: { title: "theirs again" } }); // the news is parked, newest wins
  expect(await db.getRecord("tasks", "t2")).toBeUndefined();
}

/** A test double that has the record methods but WITHOUT the rule (what a careless future writer would do). */
function unguarded(db: LocalDb): LocalDb {
  return {
    ...db,
    putRecord: async (input) => { await db.putRecords([input], { local: true }); return (await db.getRecord(input.type, input.id.slice(input.type.length + 1)))!; },
    putRecords: (inputs) => db.putRecords(inputs, { local: true }),
    deleteRecords: (ids) => db.deleteRecords(ids, { local: true }),
    deleteByProject: async (orgId, projectId) => {
      const all = await db.listByOrg(orgId);
      return db.deleteRecords(all.filter((r) => r.projectId === projectId).map((r) => r.id), { local: true });
    },
  };
}

describe("local database schema 4", () => {
  test("is version 4, and a database made by schema 3 keeps every record, op and meta value through the upgrade", async () => {
    expect(LOCAL_DB_VERSION).toBeGreaterThanOrEqual(4); // schema 5 (local-db-v5.test.ts) only ADDS the tombstones store
    const idb = new IDBFactory();
    await makeV3Database(idb, "px-v3");
    const db = await openLocalDb(idb, "px-v3");
    expect(await db.getRecord("tasks", "t1")).toMatchObject({ data: { title: "mine" }, dirty: "op-7", serverVersion: 4, rev: 2 });
    expect((await db.listOps()).map((o) => o.opId)).toEqual(["op-7"]);
    expect(await db.getMeta("outbox:seq")).toBe(7);
    expect((await db.listDirty()).length).toBe(1);
    // ...and the new store works on the upgraded database
    expect(await db.listDrafts()).toEqual([]);
    await db.transact((tx) => tx.putDraft(draft("op-x", 1)));
    expect((await db.getDraft("op-x"))?.params).toMatchObject({ answer: "typed op-x" });
    db.close();
  });

  test("drafts: stored with exactly what was typed, listed oldest first, removed one at a time, and survive a reopen", async () => {
    const idb = new IDBFactory();
    const long = "a".repeat(5000) + "\u0007 keep me exactly";
    let db = await openLocalDb(idb, "px-drafts");
    await db.transact(async (tx) => {
      await tx.putDraft(draft("op-2", 20));
      await tx.putDraft(draft("op-1", 10, { params: { answer: long } }));
    });
    db.close();
    db = await openLocalDb(idb, "px-drafts");
    expect((await db.listDrafts()).map((d) => d.opId)).toEqual(["op-1", "op-2"]);
    expect((await db.getDraft("op-1"))!.params.answer).toBe(long); // never trimmed, never cleaned
    expect(await db.deleteDraft("op-1")).toBe(true);
    expect(await db.deleteDraft("op-1")).toBe(false);
    expect((await db.listDrafts()).map((d) => d.opId)).toEqual(["op-2"]);
    db.close();
  });

  test("a draft is written in the SAME transaction as the op it replaces: a throw keeps the op and stores no draft", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-drafts-tx");
    await db.putOp({ opId: "op-1", functionId: "update_task", projectId: "p1", params: {}, clientAt: "x", status: "pending", attempts: 0, nextAttemptAt: 0 });
    await expect(db.transact(async (tx) => {
      await tx.deleteOp("op-1");
      await tx.putDraft(draft("op-1", 1));
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await db.getOp("op-1")).toBeDefined();
    expect(await db.listDrafts()).toEqual([]);
    db.close();
  });

  test("(data:F9) the dirty-row rule holds on EVERY record write path with no flag at all: put, put many, delete, delete a project", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-guard");
    await expectDirtyRowsProtected(db);
    db.close();
  });

  test("(data:F9, planted-bug proof) the same assertions FAIL against a double whose write paths lack the rule", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-guard-mutant");
    await expect(expectDirtyRowsProtected(unguarded(db))).rejects.toThrow();
    db.close();
  });

  test("the explicit local opt-out is the only way to replace or remove a dirty row", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-optout");
    await db.putRecord(row("t1", { serverVersion: 2, dirty: "op-1" }));
    expect(await db.putRecords([row("t1", { data: { title: "repaired" }, serverVersion: 9 })], { local: true })).toBe(1);
    const repaired = (await db.getRecord("tasks", "t1"))!;
    expect(repaired.data).toEqual({ title: "repaired" });
    expect(repaired.dirty ?? null).toBeNull();
    await db.putRecord(row("t2", { serverVersion: 2, dirty: "op-2" }));
    expect(await db.deleteRecords(["tasks:t2"], { local: true })).toBe(1);
    db.close();
  });

  test("a write that carries the row's own dirty marker (the outbox's own seeding) is not parked", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-same-op");
    await db.putRecord(row("t1", { serverVersion: 2, dirty: "op-1" }));
    await db.putRecord(row("t1", { data: { title: "rebuilt" }, serverVersion: 2, dirty: "op-1" }));
    expect((await db.getRecord("tasks", "t1"))!.data).toEqual({ title: "rebuilt" });
    db.close();
  });
});
