import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "./__fixtures__/fake-sync-server";
import { changeCursorKey, localDbNameFor, openLocalDb, reconcileKey } from "./local-db";
import { MANIFEST_KEY, cursorKey, createReplica, doneKey } from "./replica";
import { SyncError, type SyncClient } from "./sync-client";

// The version-aware half of the replica (CONTRACT.md sections 0-1), measured against the shared fake server:
// versions and signatures stored, the change feed (tombstones, version bumps), delete reconcile, dirty rows
// that no pull / tombstone / reconcile may touch, and the 426 pause.

const noYield = async () => {};
const DAY = 24 * 60 * 60 * 1000;
const rfi = (id: string, subject = "S", extra: Record<string, unknown> = {}) => ({ kind: "rfis", projectId: "p1", id, data: { subject, ...extra } });
const progress = (id: string, percent: number, touch?: boolean) => ({ kind: "progress", projectId: "p1", id, data: { percent }, touch });

function setup(opts: Parameters<typeof createFakeSyncServer>[0] = {}, replicaOpts: { now?: () => number; client?: SyncClient } = {}) {
  const idb = new IDBFactory();
  const server = createFakeSyncServer(opts);
  const replica = createReplica({ userId: "u1", client: replicaOpts.client ?? server.client, idb, yieldFn: noYield, now: replicaOpts.now });
  const open = () => openLocalDb(idb, localDbNameFor("u1"));
  return { idb, server, replica, open };
}

async function markDirty(open: () => Promise<Awaited<ReturnType<typeof openLocalDb>>>, kind: string, id: string, data: Record<string, unknown>, opId = "op-mine") {
  const db = await open();
  await db.transact(async (tx) => {
    const row = (await tx.getRecord(kind, id))!;
    await tx.putRecord({ id: `${kind}:${id}`, type: kind, orgId: row.orgId, projectId: row.projectId, data, dirty: opId, serverVersion: row.serverVersion, serverUpdatedAt: row.serverUpdatedAt, sig: row.sig, kid: row.kid });
  });
  db.close();
}

describe("versions and signatures are stored with every pulled row", () => {
  test("(i) a row pulled at version 3 is stored with serverVersion 3, its server timestamp, its signature and key id -- and the signature verifies", async () => {
    const { server, replica, open } = setup();
    server.upsert(rfi("a", "v1"));
    server.upsert(rfi("a", "v2"));
    const v3 = server.upsert(rfi("a", "v3"));
    expect(v3.version).toBe(3);

    const report = await replica.sync();
    expect(report.status).toBe("done");
    const db = await open();
    const row = (await db.getRecord("rfis", "a"))!;
    expect(row.serverVersion).toBe(3);
    expect(row.serverUpdatedAt).toBe(v3.updatedAt);
    expect(row.kid).toBe("fake-key-1");
    expect(typeof row.sig).toBe("string");
    expect(row.dirty).toBeUndefined();
    expect(await server.verifyRow({ project: "p1", kind: "rfis", id: "a", version: 3, updated_at: row.serverUpdatedAt!, data: row.data, sig: row.sig! })).toBe(true);
    db.close();
  });

  test("a service that sends no versions (an older one) is stored as before, without them", async () => {
    const { replica, open } = setup({}, {
      client: {
        manifest: async () => ({ user: { id: "u1", org_id: "orgA" }, projects: [{ id: "p1" }], kinds: [{ kind: "rfis" }] }),
        pull: async () => ({ items: [{ id: "a", updated_at: "2026-10-02T10:00:00Z", data: { subject: "old server" } }], next_cursor: 1, has_more: false, hidden_fields: [], redacted: false }),
      } as unknown as SyncClient,
    });
    expect((await replica.sync()).status).toBe("done");
    const db = await open();
    const row = (await db.getRecord("rfis", "a"))!;
    expect(row.data).toEqual({ subject: "old server" });
    expect(row.serverVersion).toBeUndefined();
    expect(row.sig).toBeUndefined();
    db.close();
  });
});

describe("the change feed", () => {
  test("its position is read BEFORE the first full pull, so a change made during the pull is not missed", async () => {
    const { server, idb } = setup();
    for (const id of ["a", "b", "c"]) server.upsert(progress(id, 10)); // a table without updated_at: the page cursor can never see a row change
    let progressPages = 0;
    const hooked: SyncClient = {
      ...server.client,
      pull: async (req, signal) => {
        const page = await server.client.pull(req, signal);
        if (req.kind === "progress") {
          progressPages += 1;
          if (progressPages === 1) server.upsert(progress("a", 99, false)); // "a" was just delivered; now it changes behind the pull
        }
        return page;
      },
    };
    const replica = createReplica({ userId: "u1", client: hooked, idb, yieldFn: noYield, pageLimit: 1 });
    expect((await replica.sync()).status).toBe("done");
    expect(progressPages).toBe(3);

    const first = server.requests.findIndex((r) => r.path === "/changes" && r.body.after_seq === null);
    const firstPull = server.requests.findIndex((r) => r.path === "/pull");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(firstPull);

    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((await db.getRecord("progress", "a"))).toMatchObject({ data: { id: "a", percent: 99 }, serverVersion: 2 });
    expect(await db.getMeta(changeCursorKey("p1"))).toEqual({ seq: server.headSeq() });
    db.close();
  });

  test("(iii) a tombstone removes the local row; a row of a table WITHOUT updated_at that changed on the server (version up, timestamp the same) is refreshed", async () => {
    const { server, replica, open } = setup();
    server.upsert(rfi("keep"));
    server.upsert(rfi("doomed"));
    const p = server.upsert(progress("x1", 10));
    await replica.sync();
    let db = await open();
    expect(await db.getRecord("rfis", "doomed")).toBeDefined();
    expect((await db.getRecord("progress", "x1"))!.serverVersion).toBe(1);
    db.close();

    server.remove({ kind: "rfis", projectId: "p1", id: "doomed" }); // a tombstone in the feed
    const same = server.upsert(progress("x1", 80, false)); // version 2, SAME updated_at: the keyset pull cannot see it
    expect(same.updatedAt).toBe(p.updatedAt);

    const report = await replica.sync();
    expect(report.status).toBe("done");
    expect(report.changesApplied).toBe(2);
    db = await open();
    expect(await db.getRecord("rfis", "doomed")).toBeUndefined();
    expect(await db.getRecord("rfis", "keep")).toBeDefined();
    const refreshed = (await db.getRecord("progress", "x1"))!;
    expect(refreshed.data).toEqual({ id: "x1", percent: 80 });
    expect(refreshed.serverVersion).toBe(2);
    db.close();
  });

  test("a row whose version has not moved is not fetched again", async () => {
    const { server, replica } = setup();
    server.upsert(progress("x1", 10));
    await replica.sync();
    const before = server.requests.filter((r) => r.path === "/pull" && Array.isArray(r.body.ids)).length;
    await replica.sync();
    expect(server.requests.filter((r) => r.path === "/pull" && Array.isArray(r.body.ids)).length).toBe(before);
  });

  test("the feed position moves only after the page's effects are stored: a failed fetch keeps it, and the next sync still applies the change", async () => {
    const { server, idb, open } = setup();
    server.upsert(progress("x1", 10));
    const healthy = createReplica({ userId: "u1", client: server.client, idb, yieldFn: noYield });
    await healthy.sync();
    const db = await open();
    const afterFirst = await db.getMeta<{ seq: number }>(changeCursorKey("p1"));
    db.close();

    server.upsert(progress("x1", 55, false));
    const broken: SyncClient = { ...server.client, pullIds: async () => { throw new SyncError("network", "offline"); } };
    const failing = await createReplica({ userId: "u1", client: broken, idb, yieldFn: noYield }).sync();
    expect(failing.status).toBe("error");
    const db2 = await open();
    expect(await db2.getMeta(changeCursorKey("p1"))).toEqual(afterFirst); // did not move
    expect((await db2.getRecord("progress", "x1"))!.data).toEqual({ id: "x1", percent: 10 });
    db2.close();

    const recovered = await healthy.sync();
    expect(recovered.status).toBe("done");
    const db3 = await open();
    expect((await db3.getRecord("progress", "x1"))!.data).toEqual({ id: "x1", percent: 55 });
    expect(await db3.getMeta(changeCursorKey("p1"))).toEqual({ seq: server.headSeq() });
    db3.close();
  });

  test("a service without the feed (404 on /changes) still syncs by the page cursor, and no position is stored", async () => {
    const { server, idb, open } = setup();
    server.upsert(rfi("a"));
    const client: SyncClient = { ...server.client, changes: async () => { throw new SyncError("not_found", "no such route", 404); } };
    const report = await createReplica({ userId: "u1", client, idb, yieldFn: noYield }).sync();
    expect(report.status).toBe("done");
    const db = await open();
    expect(await db.getRecord("rfis", "a")).toBeDefined();
    expect(await db.getMeta(changeCursorKey("p1"))).toBeUndefined();
    db.close();
  });

  test("a project the person loses takes its feed position with it", async () => {
    const { server, replica, open } = setup({ projects: ["p1", "p2"] });
    server.upsert(rfi("a"));
    server.upsert({ kind: "rfis", projectId: "p2", id: "z", data: {} });
    await replica.sync();
    let db = await open();
    expect(await db.getMeta(changeCursorKey("p2"))).toBeDefined();
    db.close();
    server.projects = ["p1"];
    await replica.sync();
    db = await open();
    expect(await db.getRecord("rfis", "z")).toBeUndefined();
    expect(await db.getMeta(changeCursorKey("p2"))).toBeNull();
    db.close();
  });
});

describe("(ii) a dirty row survives a pull, a tombstone and a reconcile", () => {
  async function withDirtyRow() {
    const t = setup({}, { now: () => 1_000_000 });
    t.server.upsert(rfi("mine", "server v1"));
    t.server.upsert(rfi("other", "untouched"));
    await t.replica.sync();
    await markDirty(t.open, "rfis", "mine", { id: "mine", subject: "MY LOCAL EDIT" });
    return t;
  }

  test("a pull that brings a newer server row leaves the edit exactly as it is and parks the server's row beside it", async () => {
    const { server, replica, open } = await withDirtyRow();
    const theirs = server.upsert(rfi("mine", "server v2"));
    expect((await replica.sync()).status).toBe("done");
    const db = await open();
    const row = (await db.getRecord("rfis", "mine"))!;
    expect(row.data).toEqual({ id: "mine", subject: "MY LOCAL EDIT" });
    expect(row.dirty).toBe("op-mine");
    expect(row.serverVersion).toBe(1); // what my edit is based on
    expect(row.serverCopy).toMatchObject({ version: 2, data: { subject: "server v2" }, updatedAt: theirs.updatedAt, kid: "fake-key-1" });
    db.close();
  });

  test("a tombstone does not delete it either; it only remembers the row is gone", async () => {
    const { server, replica, open } = await withDirtyRow();
    server.remove({ kind: "rfis", projectId: "p1", id: "mine" });
    expect((await replica.sync()).status).toBe("done");
    const db = await open();
    const row = (await db.getRecord("rfis", "mine"))!;
    expect(row.data).toEqual({ id: "mine", subject: "MY LOCAL EDIT" });
    expect(row.dirty).toBe("op-mine");
    expect(row.serverCopy?.deleted).toBe(true);
    db.close();
  });

  test("a reconcile that finds the row missing from the server's list does not drop it, while a clean row that is missing IS dropped", async () => {
    const { server, replica, open } = await withDirtyRow();
    server.remove({ kind: "rfis", projectId: "p1", id: "mine", silent: true });
    server.remove({ kind: "rfis", projectId: "p1", id: "other", silent: true });
    const result = await replica.reconcileDeletes("p1", "rfis", { force: true });
    expect(result).toEqual({ removed: 1, skipped: false });
    const db = await open();
    expect(await db.getRecord("rfis", "other")).toBeUndefined();
    expect((await db.getRecord("rfis", "mine"))?.dirty).toBe("op-mine");
    db.close();
  });
});

describe("reconcile deletes (the repair path for deletes made before change tracking)", () => {
  // A service whose feed does NOT carry deletes (manifest deletes_supported: false). Where the feed does carry them, the repair
  // is weekly and spread (package lf-e6, see "cost: the change feed replaces the sweep" below).
  test("runs after a pair was pulled to the end, at most once a day per pair", async () => {
    let clock = 5_000_000;
    const { server, replica, open } = setup({ trackDeletes: false }, { now: () => clock });
    server.upsert(rfi("a"));
    server.upsert(rfi("b"));
    await replica.sync(); // first sync: nothing local before the pull... but after it there are rows
    const idsCalls = () => server.requests.filter((r) => r.path === "/ids").length;
    const afterFirst = idsCalls();
    expect(afterFirst).toBeGreaterThanOrEqual(1); // rfis was reconciled once (it has rows)

    server.remove({ kind: "rfis", projectId: "p1", id: "b", silent: true }); // no tombstone
    await replica.sync(); // the same day: not asked again
    expect(idsCalls()).toBe(afterFirst);
    let db = await open();
    expect(await db.getRecord("rfis", "b")).toBeDefined(); // still here: nothing told the laptop yet
    db.close();

    clock += DAY + 1;
    const report = await replica.sync(); // a day later: it is
    expect(idsCalls()).toBeGreaterThan(afterFirst);
    expect(report.reconciledRemoved).toBe(1);
    expect(report.itemsRemoved).toBeGreaterThanOrEqual(1);
    db = await open();
    expect(await db.getRecord("rfis", "b")).toBeUndefined();
    expect(await db.getRecord("rfis", "a")).toBeDefined();
    expect(await db.getMeta(reconcileKey("p1", "rfis"))).toEqual({ at: clock });
    db.close();
  });

  test("a (project, kind) with no local rows spends no call but is stamped", async () => {
    const { server, replica, open } = setup({ trackDeletes: false });
    server.upsert(rfi("a")); // only rfis has rows; tasks, boq_lines and progress are empty
    await replica.sync();
    const idsKinds = server.requests.filter((r) => r.path === "/ids").map((r) => r.body.kind);
    expect(idsKinds).toEqual(["rfis"]);
    const db = await open();
    expect(await db.getMeta(reconcileKey("p1", "tasks"))).toBeDefined();
    db.close();
  });

  test("a failing id list deletes nothing and is tried again next time (it is not stamped)", async () => {
    const { server, idb, open } = setup();
    server.upsert(rfi("a"));
    server.upsert(rfi("b"));
    await createReplica({ userId: "u1", client: server.client, idb, yieldFn: noYield }).sync();
    server.remove({ kind: "rfis", projectId: "p1", id: "b", silent: true });
    const broken: SyncClient = { ...server.client, ids: async () => { throw new SyncError("network", "offline"); } };
    const replica = createReplica({ userId: "u1", client: broken, idb, yieldFn: noYield });
    await expect(replica.reconcileDeletes("p1", "rfis", { force: true })).rejects.toMatchObject({ kind: "network" });
    const db = await open();
    expect(await db.getRecord("rfis", "b")).toBeDefined();
    db.close();
  });

  test("a row that arrives while the id list is being read is never mistaken for a deleted one", async () => {
    const { server, idb, open } = setup();
    server.upsert(rfi("old"));
    await createReplica({ userId: "u1", client: server.client, idb, yieldFn: noYield }).sync();
    const racing: SyncClient = {
      ...server.client,
      ids: async (req, signal) => {
        const page = await server.client.ids(req, signal);
        // after the server answered with its list, a new row is written locally by a concurrent path (a screen's own refresh)
        const db = await open();
        await db.putRecord({ id: "rfis:late", type: "rfis", orgId: "orgA", projectId: "p1", data: { id: "late" }, serverVersion: 1 });
        db.close();
        return page;
      },
    };
    const replica = createReplica({ userId: "u1", client: racing, idb, yieldFn: noYield });
    await replica.reconcileDeletes("p1", "rfis", { force: true });
    const db = await open();
    expect(await db.getRecord("rfis", "late")).toBeDefined();
    db.close();
  });
});

describe("(vii) 426: this release is too old", () => {
  test("stops with status update_required and the details, stores nothing, and pauses: no further call leaves the replica until resume()", async () => {
    const { server, replica, open } = setup();
    server.upsert(rfi("a"));
    server.requireUpdate({ current: "2026.10.09-001", minCompatible: "2026.10.05-001" });
    const report = await replica.sync();
    expect(report.status).toBe("update_required");
    expect(report.updateRequired).toEqual({ current: "2026.10.09-001", minCompatible: "2026.10.05-001" });
    expect(report.syncedAt).toBeNull();
    expect(replica.getStatus().status).toBe("update_required");
    const db = await open();
    expect(await db.countRecords("orgA")).toBe(0);
    db.close();

    const calls = server.requests.length;
    const again = await replica.sync();
    const project = await replica.syncProject("p1", "rfis");
    expect(again.status).toBe("update_required");
    expect(project.status).toBe("update_required");
    expect(server.requests.length).toBe(calls); // paused: nothing was sent

    server.requireUpdate(null);
    replica.resume();
    expect((await replica.sync()).status).toBe("done");
    const db2 = await open();
    expect(await db2.getRecord("rfis", "a")).toBeDefined();
    db2.close();
  });

  test("a 426 in the middle of a run stops the rest of it, keeps what was already stored, and reports update_required", async () => {
    const { server, idb, open } = setup();
    for (const id of ["a", "b", "c"]) server.upsert(rfi(id));
    let rfiPages = 0;
    const client: SyncClient = {
      ...server.client,
      pull: async (req, signal) => {
        if (req.kind === "rfis") {
          rfiPages += 1;
          if (rfiPages === 2) throw new SyncError("update_required", "update", 426, { current: "9", minCompatible: "8" });
        }
        return server.client.pull(req, signal);
      },
    };
    const replica = createReplica({ userId: "u1", client, idb, yieldFn: noYield, pageLimit: 1, concurrency: 1 });
    const report = await replica.sync();
    expect(report.status).toBe("update_required");
    expect(report.updateRequired).toEqual({ current: "9", minCompatible: "8" });
    const db = await open();
    expect((await db.listByProject("orgA", "rfis", "p1")).map((r) => r.id)).toEqual(["rfis:a"]); // the first page was kept
    expect(await db.getMeta(doneKey("p1", "rfis"))).toBeFalsy();
    db.close();
  });
});

describe("(ix) another organisation's record is still refused", () => {
  test("a pulled row that names another organisation inside its data is not stored", async () => {
    const { server, replica, open } = setup();
    server.upsert(rfi("fine"));
    server.upsert(rfi("evil", "S", { org_id: "orgB" }));
    const report = await replica.sync();
    expect(report.status).not.toBe("done");
    expect(report.issues.some((i) => i.reason === "org_mismatch")).toBe(true);
    const db = await open();
    expect(await db.getRecord("rfis", "evil")).toBeUndefined();
    db.close();
  });

  test("the same refusal holds for a row fetched because the change feed named it, and the feed position does not move past it", async () => {
    const { server, idb, open } = setup();
    server.upsert(progress("ok", 1));
    const replica = createReplica({ userId: "u1", client: server.client, idb, yieldFn: noYield });
    await replica.sync();
    const db0 = await open();
    const position = await db0.getMeta(changeCursorKey("p1"));
    db0.close();

    server.upsert({ kind: "progress", projectId: "p1", id: "ok", data: { percent: 2, org_id: "orgB" }, touch: false });
    const report = await replica.sync();
    expect(report.issues.some((i) => i.reason === "org_mismatch")).toBe(true);
    const db = await open();
    expect((await db.getRecord("progress", "ok"))!.data).toEqual({ id: "ok", percent: 1 });
    expect(await db.getMeta(changeCursorKey("p1"))).toEqual(position);
    db.close();
  });

  test("a manifest for a different organisation than the one on this laptop is still refused", async () => {
    const { idb } = setup();
    const a = createFakeSyncServer({ orgId: "orgA" });
    a.upsert(rfi("a"));
    await createReplica({ userId: "u1", client: a.client, idb, yieldFn: noYield }).sync();
    const b = createFakeSyncServer({ orgId: "orgB" });
    b.upsert(rfi("b"));
    const report = await createReplica({ userId: "u1", client: b.client, idb, yieldFn: noYield }).sync();
    expect(report.status).toBe("error");
    expect(report.issues[0]!.reason).toBe("org_mismatch");
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect(await db.getRecord("rfis", "b")).toBeUndefined();
    expect((await db.getMeta<{ orgId: string }>(MANIFEST_KEY))?.orgId).toBe("orgA");
    db.close();
  });
});

describe("what the earlier guarantees look like through the new fake (regression guard)", () => {
  // (a service whose feed carries no deletes; with one that does, the second sync sends no keyset pull at all -- see the cost tests)
  test("page cursors and the done marker are still written, and a second sync with nothing changed pulls only from the stored cursor", async () => {
    const { server, replica, open } = setup({ trackDeletes: false });
    for (const id of ["a", "b", "c"]) server.upsert(rfi(id));
    await replica.sync();
    const db = await open();
    expect(await db.getMeta(doneKey("p1", "rfis"))).toMatchObject({ redacted: false });
    const cursor = await db.getMeta(cursorKey("p1", "rfis"));
    expect(cursor).toBeTruthy();
    db.close();
    server.requests.length = 0;
    await replica.sync();
    const pull = server.requests.find((r) => r.path === "/pull" && r.body.kind === "rfis")!;
    expect(pull.body.after).toBe(cursor);
  });
});
