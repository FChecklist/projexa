import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import {
  LOCAL_DB_VERSION, changeCursorKey, isShareable, openLocalDb, reconcileKey, type NewOutboxOp,
} from "./local-db";

// Schema 3 of the laptop's database (CONTRACT.md section 0): record versions, the dirty marker, the outbox store.

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id: `rfis:${id}`, type: "rfis", orgId: "orgA", projectId: "p1", data: { id }, ...extra,
});

const op = (opId: string, extra: Partial<NewOutboxOp> = {}): NewOutboxOp => ({
  opId, functionId: "create_rfi", projectId: "p1", params: { subject: opId }, clientAt: "2026-10-02T10:00:00Z",
  status: "pending", attempts: 0, nextAttemptAt: 0, ...extra,
});

/** Builds a database exactly the way schema 2 (the version before this one) did, with real rows in it. */
async function makeV2Database(idb: IDBFactory, name: string) {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const open = idb.open(name, 2);
    open.onupgradeneeded = () => {
      const upgrade = open.result;
      upgrade.createObjectStore("meta", { keyPath: "key" });
      const store = upgrade.createObjectStore("records", { keyPath: "id" });
      store.createIndex("byOrg", "orgId");
      store.createIndex("byOrgType", ["orgId", "type"]);
      store.createIndex("byOrgTypeProject", ["orgId", "type", "projectId"]);
      store.createIndex("byOrgProject", ["orgId", "projectId"]);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["meta", "records"], "readwrite");
    tx.objectStore("meta").put({ key: "sync:manifest", value: { userId: "u1", orgId: "orgA", projectIds: ["p1"], kinds: ["rfis"], at: 1 } });
    tx.objectStore("meta").put({ key: "sync:cursor:p1:rfis", value: 42 });
    tx.objectStore("records").put({ id: "rfis:old1", type: "rfis", orgId: "orgA", projectId: "p1", data: { id: "old1", subject: "from v2" }, updatedAt: 5, rev: 3 });
    tx.objectStore("records").put({ id: "rfis:old2", type: "rfis", orgId: "orgA", projectId: "p1", data: { id: "old2" }, updatedAt: 6, rev: 1 });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe("local database schema 3", () => {
  test("is version 3, and a database made by schema 2 keeps every record and meta value through the upgrade", async () => {
    expect(LOCAL_DB_VERSION).toBeGreaterThanOrEqual(3); // schema 4 (local-db-v4.test.ts) keeps every v3 guarantee
    const idb = new IDBFactory();
    await makeV2Database(idb, "px-upgrade");

    const db = await openLocalDb(idb, "px-upgrade");
    expect((await db.getRecord("rfis", "old1"))).toMatchObject({ data: { id: "old1", subject: "from v2" }, rev: 3, orgId: "orgA", projectId: "p1" });
    expect(await db.countRecords("orgA")).toBe(2);
    expect((await db.listByProject("orgA", "rfis", "p1")).length).toBe(2);
    expect(await db.getMeta("sync:cursor:p1:rfis")).toBe(42);
    expect(await db.getMeta("sync:manifest")).toMatchObject({ orgId: "orgA" });
    // ...and the new parts work on the upgraded database
    expect(await db.listDirty()).toEqual([]);
    expect(await db.listOps()).toEqual([]);
    await db.putOp(op("after-upgrade"));
    expect((await db.listOps()).map((o) => o.opId)).toEqual(["after-upgrade"]);
    // An old row has no version: reading it must not invent one.
    expect((await db.getRecord("rfis", "old1"))!.serverVersion).toBeUndefined();
    db.close();
  });

  test("a record round-trips its server version, timestamp, signature and key id (single and batch writes)", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-fields");
    const one = await db.putRecord(row("a", { serverVersion: 3, serverUpdatedAt: "2026-10-02T10:00:03Z", sig: "SIG-A", kid: "k1" }));
    expect(one).toMatchObject({ serverVersion: 3, serverUpdatedAt: "2026-10-02T10:00:03Z", sig: "SIG-A", kid: "k1" });
    await db.putRecords([row("b", { serverVersion: 7, sig: "SIG-B", kid: "k1" })]);
    expect(await db.getRecord("rfis", "a")).toMatchObject({ serverVersion: 3, sig: "SIG-A", kid: "k1" });
    expect(await db.getRecord("rfis", "b")).toMatchObject({ serverVersion: 7, sig: "SIG-B" });
    // a row written without them (an older service) simply has none
    await db.putRecord(row("c"));
    expect((await db.getRecord("rfis", "c"))!.serverVersion).toBeUndefined();
    expect((await db.getRecord("rfis", "c"))!.sig).toBeUndefined();
    db.close();
  });

  test("listDirty returns exactly the rows with a pending edit, per organisation, and clearing the marker removes the row from it", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-dirty");
    await db.putRecord(row("clean"));
    await db.putRecord(row("edited", { dirty: "op-1" }));
    await db.putRecord({ ...row("other-org", { dirty: "op-2" }), orgId: "orgB" });
    expect((await db.listDirty()).map((r) => r.id).sort()).toEqual(["rfis:edited", "rfis:other-org"]);
    expect((await db.listDirty("orgA")).map((r) => r.id)).toEqual(["rfis:edited"]);
    await db.transact(async (tx) => { await tx.patchRecord("rfis", "edited", { dirty: null }); });
    expect(await db.listDirty("orgA")).toEqual([]);
    expect((await db.getRecord("rfis", "edited"))!.dirty).toBeUndefined();
    db.close();
  });

  test("the outbox keeps ops in the order they were made, survives a reopen, and the order number never repeats", async () => {
    const idb = new IDBFactory();
    let db = await openLocalDb(idb, "px-outbox");
    const a = await db.putOp(op("op-a"));
    const b = await db.putOp(op("op-b"));
    expect(b.seq).toBeGreaterThan(a.seq);
    await db.deleteOp("op-a");
    const c = await db.putOp(op("op-c"));
    expect(c.seq).toBeGreaterThan(b.seq); // a deleted op's number is not handed out again
    db.close();

    db = await openLocalDb(idb, "px-outbox");
    expect((await db.listOps()).map((o) => o.opId)).toEqual(["op-b", "op-c"]);
    expect((await db.getOp("op-b"))?.params).toEqual({ subject: "op-b" });
    // the same op written again keeps its place
    const again = await db.putOp(op("op-b", { attempts: 2 }));
    expect(again.seq).toBe(b.seq);
    expect((await db.listOps()).map((o) => o.opId)).toEqual(["op-b", "op-c"]);
    db.close();
  });

  test("updateOp merges fields, and an explicit undefined removes one", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-updop");
    await db.putOp(op("op-1", { lastError: "boom", status: "conflict" }));
    const next = await db.updateOp("op-1", { attempts: 3, lastError: undefined, status: "pending" });
    expect(next).toMatchObject({ attempts: 3, status: "pending" });
    expect("lastError" in next!).toBe(false);
    expect(await db.updateOp("missing", { attempts: 1 })).toBeUndefined();
    db.close();
  });

  test("transact stores the record change and the op together, or neither (a throw rolls both back)", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-tx");
    await db.transact(async (tx) => {
      await tx.putRecord(row("kept", { dirty: "op-ok" }));
      await tx.putOp(op("op-ok"));
    });
    expect((await db.getRecord("rfis", "kept"))?.dirty).toBe("op-ok");
    expect((await db.listOps()).map((o) => o.opId)).toEqual(["op-ok"]);

    await expect(
      db.transact(async (tx) => {
        await tx.putRecord(row("rolled-back", { dirty: "op-bad" }));
        await tx.putOp(op("op-bad"));
        await tx.setMeta("touched", true);
        throw new Error("the optimistic step failed");
      })
    ).rejects.toThrow("the optimistic step failed");
    expect(await db.getRecord("rfis", "rolled-back")).toBeUndefined();
    expect((await db.listOps()).map((o) => o.opId)).toEqual(["op-ok"]);
    expect(await db.getMeta("touched")).toBeUndefined();
    db.close();
  });

  test("inside a transaction an optimistic change can look at its neighbours, and sees its own earlier writes", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-tx-reads");
    await db.putRecords([row("a"), row("b")]);
    await db.transact(async (tx) => {
      await tx.putRecord(row("c"));
      expect((await tx.listByProject("orgA", "rfis", "p1")).map((r) => r.id).sort()).toEqual(["rfis:a", "rfis:b", "rfis:c"]);
      expect(await tx.listByProject("orgA", "rfis", "other")).toEqual([]);
      expect((await tx.listByOrg("orgA")).length).toBe(3);
      expect((await tx.listByOrg("orgA", "tasks")).length).toBe(0);
      expect((await tx.listByOrg("orgB")).length).toBe(0);
    });
    db.close();
  });

  test("a write FROM THE SERVER never overwrites a dirty row: it parks the news in serverCopy", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-park");
    await db.putRecord(row("r", { data: { id: "r", subject: "my edit" }, serverVersion: 2, dirty: "op-1" }));

    const written = await db.putRecords([row("r", { data: { id: "r", subject: "theirs" }, serverVersion: 5, serverUpdatedAt: "T5", sig: "S5", kid: "k" })], { fromServer: true });
    expect(written).toBe(0); // nothing overwritten
    const kept = (await db.getRecord("rfis", "r"))!;
    expect(kept.data).toEqual({ id: "r", subject: "my edit" });
    expect(kept.dirty).toBe("op-1");
    expect(kept.serverVersion).toBe(2); // the version my edit is BASED on does not move
    expect(kept.serverCopy).toMatchObject({ data: { subject: "theirs" }, version: 5, updatedAt: "T5", sig: "S5", kid: "k" });

    // older news than what is already parked is ignored
    await db.putRecords([row("r", { data: { id: "r", subject: "stale" }, serverVersion: 3 })], { fromServer: true });
    expect((await db.getRecord("rfis", "r"))!.serverCopy).toMatchObject({ version: 5, data: { subject: "theirs" } });
    db.close();
  });

  test("a delete FROM THE SERVER never removes a dirty row (it remembers the row is gone) but does remove a clean one", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-tomb");
    await db.putRecord(row("clean", { serverVersion: 1 }));
    await db.putRecord(row("mine", { serverVersion: 1, dirty: "op-9" }));
    const removed = await db.deleteRecords(["rfis:clean", "rfis:mine", "rfis:never-existed"], { fromServer: true });
    expect(removed).toBe(1);
    expect(await db.getRecord("rfis", "clean")).toBeUndefined();
    const mine = (await db.getRecord("rfis", "mine"))!;
    expect(mine.dirty).toBe("op-9");
    expect(mine.serverCopy?.deleted).toBe(true);
    // schema 4 (data:F9): without the flag the dirty row is STILL kept; only the explicit local opt-out removes it
    expect(await db.deleteRecords(["rfis:mine"])).toBe(0);
    expect(await db.deleteRecords(["rfis:mine"], { local: true })).toBe(1);
    db.close();
  });

  test("a server row at an OLDER version than the one stored does not replace it; the same or a newer version does", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-stale");
    await db.putRecord(row("r", { data: { v: 5 }, serverVersion: 5 }));
    expect(await db.putRecords([row("r", { data: { v: 4 }, serverVersion: 4 })], { fromServer: true })).toBe(0);
    expect((await db.getRecord("rfis", "r"))!.data).toEqual({ v: 5 });
    expect(await db.putRecords([row("r", { data: { v: 6 }, serverVersion: 6 })], { fromServer: true })).toBe(1);
    expect((await db.getRecord("rfis", "r"))!.data).toEqual({ v: 6 });
    // a row from an older service has no version: it is applied, as it always was
    expect(await db.putRecords([row("r", { data: { v: "unversioned" } })], { fromServer: true })).toBe(1);
    db.close();
  });

  test("a record of another organisation is refused by every write path and cannot overwrite", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-org");
    await db.putRecord(row("r", { data: { secret: true } }));
    const foreign = { ...row("r", { data: { stolen: true } }), orgId: "orgB" };
    await expect(db.putRecord(foreign)).rejects.toThrow(/different organisation/);
    await expect(db.putRecords([foreign], { fromServer: true })).rejects.toThrow(/different organisation/);
    await expect(db.transact((tx) => tx.putRecord(foreign))).rejects.toThrow(/different organisation/);
    expect((await db.getRecord("rfis", "r"))!.data).toEqual({ secret: true });
    db.close();
  });

  test("getRecordsByIds returns the present ones by full id", async () => {
    const db = await openLocalDb(new IDBFactory(), "px-many");
    await db.putRecords([row("a"), row("b")]);
    const found = await db.getRecordsByIds(["rfis:a", "rfis:b", "rfis:zzz"]);
    expect([...found.keys()].sort()).toEqual(["rfis:a", "rfis:b"]);
    db.close();
  });

  test("the change-feed and reconcile meta keys are per project (and per kind)", () => {
    expect(changeCursorKey("p1")).not.toBe(changeCursorKey("p2"));
    expect(reconcileKey("p1", "rfis")).not.toBe(reconcileKey("p1", "tasks"));
    expect(reconcileKey("p1", "rfis")).not.toBe(reconcileKey("p2", "rfis"));
  });

  test("only a signed, clean row may be shared with another laptop", () => {
    expect(isShareable({ sig: "s", kid: "k", dirty: null })).toBe(true);
    expect(isShareable({ sig: "s", kid: "k" })).toBe(true);
    expect(isShareable({ sig: "s", kid: "k", dirty: "op-1" })).toBe(false); // a pending local edit
    expect(isShareable({ sig: "s" })).toBe(false); // no key id
    expect(isShareable({ kid: "k" })).toBe(false); // no signature
    expect(isShareable({})).toBe(false);
  });
});
