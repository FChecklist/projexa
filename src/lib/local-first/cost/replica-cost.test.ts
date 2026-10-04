import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "../__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb, reconcileKey } from "../local-db";
import { MANIFEST_KEY, createReplica, type ReplicaOptions } from "../replica";
import type { SyncClient } from "../sync-client";

// COST (package lf-e6, R14): what one sync of the replica asks the server for, once the change feed covers a kind
// (manifest deletes_supported: true, every kind of the real backend). Each test names the calls it expects, so a change that
// brings back a per-(project x kind) sweep, a per-screen manifest, or a daily id list per pair fails here.

const DAY = 24 * 60 * 60 * 1000;
const noYield = async () => {};
const row = (kind: string, id: string, project = "p1") => ({ kind, projectId: project, id, data: { name: id } });

function setup(o: { projects?: string[]; replica?: Partial<ReplicaOptions>; client?: (c: SyncClient) => SyncClient } = {}) {
  const idb = new IDBFactory();
  const server = createFakeSyncServer({ projects: o.projects ?? ["p1"] });
  const clock = { now: 9_000_000_000 };
  const client = o.client ? o.client(server.client) : server.client;
  const replica = createReplica({ userId: "u1", client, idb, yieldFn: noYield, now: () => clock.now, ...o.replica });
  const calls = () => server.requests.map((r) => (r.path === "/pull" && Array.isArray(r.body?.ids) ? "/pull{ids}" : r.path));
  const reset = () => { server.requests.length = 0; };
  return { idb, server, clock, replica, calls, reset, open: () => openLocalDb(idb, localDbNameFor("u1")) };
}

describe("cost: the change feed replaces the per-(project x kind) sweep", () => {
  test("a second whole sync with nothing changed sends the manifest and one /changes per project -- no keyset pull, no id list", async () => {
    const r = setup({ projects: ["p1", "p2"] });
    for (const k of ["tasks", "boq_lines", "rfis", "progress"]) { r.server.upsert(row(k, `${k}-1`)); r.server.upsert(row(k, `${k}-2`, "p2")); }
    expect((await r.replica.sync()).status).toBe("done");
    r.reset();
    r.clock.now += 60 * 60_000;
    expect((await r.replica.sync()).status).toBe("done");
    expect(r.calls().sort()).toEqual(["/changes", "/changes", "/manifest"]);
  });

  test("a row changed on the server arrives through the feed: one /changes and one pull by ids, not a sweep", async () => {
    const r = setup();
    r.server.upsert(row("rfis", "a"));
    r.server.upsert(row("tasks", "t"));
    await r.replica.sync();
    r.server.upsert({ kind: "rfis", projectId: "p1", id: "a", data: { name: "changed" } });
    r.reset();
    const report = await r.replica.sync();
    expect(report.changesApplied).toBe(1);
    expect(r.calls()).toEqual(["/manifest", "/changes", "/pull{ids}"]);
    const db = await r.open();
    expect((await db.getRecord("rfis", "a"))?.data).toMatchObject({ name: "changed" });
    db.close();
  });

  test("a kind whose deletes the feed does not carry is still pulled from its cursor (only that kind)", async () => {
    const r = setup({
      client: (c) => ({
        ...c,
        manifest: async (s) => {
          const m = await c.manifest(s);
          return { ...m, kinds: m.kinds.map((k) => (k.kind === "progress" ? { ...k, deletes_supported: false } : k)) };
        },
      }),
    });
    r.server.upsert(row("rfis", "a"));
    await r.replica.sync();
    r.reset();
    await r.replica.sync();
    const pulls = r.server.requests.filter((q) => q.path === "/pull").map((q) => q.body.kind);
    expect(pulls).toEqual(["progress"]);
  });
});

describe("cost: the id-list repair is weekly, spread, and skipped right after a fresh copy", () => {
  test("a copy made from scratch after the feed position was taken is stamped without an id list; a silent delete is repaired a week later", async () => {
    const r = setup();
    r.server.upsert(row("rfis", "a"));
    r.server.upsert(row("rfis", "b"));
    await r.replica.sync();
    expect(r.calls()).not.toContain("/ids");
    let db = await r.open();
    expect(await db.getMeta(reconcileKey("p1", "rfis"))).toEqual({ at: r.clock.now });
    db.close();

    r.server.remove({ kind: "rfis", projectId: "p1", id: "b", silent: true }); // a delete that left no tombstone
    r.reset();
    r.clock.now += DAY + 1;
    await r.replica.sync();
    expect(r.calls()).not.toContain("/ids"); // a day is not enough any more

    r.clock.now += 7 * DAY;
    const report = await r.replica.sync();
    expect(r.calls()).toContain("/ids");
    expect(report.reconciledRemoved).toBe(1);
    db = await r.open();
    expect(await db.getRecord("rfis", "b")).toBeUndefined();
    expect(await db.getRecord("rfis", "a")).toBeDefined();
    db.close();
  });

  test("at most reconcileBudgetPerRun id lists in one sync; the rest wait for the next ones", async () => {
    const r = setup({ replica: { reconcileBudgetPerRun: 2 } });
    for (const k of ["tasks", "boq_lines", "rfis", "progress"]) r.server.upsert(row(k, `${k}-1`));
    await r.replica.sync();
    r.clock.now += 8 * DAY;
    const idsPer = async () => { r.reset(); await r.replica.sync(); return r.calls().filter((c) => c === "/ids").length; };
    expect(await idsPer()).toBe(2);
    expect(await idsPer()).toBe(2);
    expect(await idsPer()).toBe(0);
  });

  test("a one-project run never runs the repair", async () => {
    const r = setup();
    r.server.upsert(row("rfis", "a"));
    await r.replica.sync();
    r.clock.now += 30 * DAY;
    r.reset();
    await r.replica.syncProject("p1", "rfis");
    expect(r.calls()).not.toContain("/ids");
  });
});

describe("cost: a one-project run (a screen opened, the scheduler's check) is one /changes at most", () => {
  test("it reuses the stored manifest: just the project's feed", async () => {
    const r = setup();
    r.server.upsert(row("rfis", "a"));
    await r.replica.sync();
    r.reset();
    r.clock.now += 5 * 60_000;
    expect((await r.replica.syncProject("p1", "rfis")).status).toBe("done");
    expect(r.calls()).toEqual(["/changes"]);
  });

  test("the same project again within two minutes sends nothing; after that, one /changes; a change made meanwhile arrives", async () => {
    const r = setup();
    r.server.upsert(row("rfis", "a"));
    await r.replica.sync();
    r.clock.now += 3 * 60_000; // the whole sync itself read the feed: wait past the freshness window first
    r.reset();
    await r.replica.syncProject("p1", "rfis");
    await r.replica.syncProject("p1", "tasks");
    expect(r.calls()).toEqual(["/changes"]);
    r.server.upsert({ kind: "rfis", projectId: "p1", id: "a", data: { name: "later" } });
    r.clock.now += 2 * 60_000 + 1;
    r.reset();
    const report = await r.replica.syncProject("p1", "rfis");
    expect(report.changesApplied).toBe(1);
    expect(r.calls()).toEqual(["/changes", "/pull{ids}"]);
  });

  test("a stored manifest older than six hours is not trusted: the manifest is asked again", async () => {
    const r = setup();
    r.server.upsert(row("rfis", "a"));
    await r.replica.sync();
    r.clock.now += 6 * 60 * 60_000 + 1;
    r.reset();
    await r.replica.syncProject("p1", "rfis");
    expect(r.calls()[0]).toBe("/manifest");
  });

  test("a project the person lost while the stored manifest still names it: the 404 is noticed, the manifest asked, the rows leave the laptop", async () => {
    const r = setup({ projects: ["p1", "p2"] });
    r.server.upsert(row("rfis", "a"));
    r.server.upsert(row("rfis", "z", "p2"));
    await r.replica.sync();
    r.server.projects.splice(r.server.projects.indexOf("p1"), 1);
    r.reset();
    r.clock.now += 5 * 60_000;
    await r.replica.syncProject("p1", "rfis");
    expect(r.calls()).toContain("/manifest");
    const db = await r.open();
    expect(await db.getRecord("rfis", "a")).toBeUndefined();
    expect(await db.getRecord("rfis", "z")).toBeDefined();
    expect((await db.getMeta<{ projectIds: string[] }>(MANIFEST_KEY))?.projectIds).not.toContain("p1");
    db.close();
  });
});
