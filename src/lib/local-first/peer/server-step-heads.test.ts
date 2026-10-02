import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "../__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "../local-db";
import { LAST_SYNC_KEY, createReplica } from "../replica";
import type { HeadsAnswer } from "../sync-client";
import { resetLocalCopy } from "./reset-copy";
import { HEADS_KEY, createServerStep } from "./server-step";

// COST (package FC, review cost:COST-03 / wire:F07): the auto-sync server step's ONE-call poll, GET /heads (backend drizzle/0686).
// The REAL replica and sync client against the shared fake server, which answers /heads like handler.ts heads(). What is asserted is
// the request log: with nothing changed a run costs exactly one request; a moved project costs a feed read of THAT project only.

const noYield = async () => {};
const PROJECTS = ["p1", "p2", "p3"];

async function setup(o: { heads?: boolean; projectFreshMs?: number } = {}) {
  const idb = new IDBFactory();
  const server = createFakeSyncServer({ projects: [...PROJECTS], heads: o.heads });
  for (const p of PROJECTS) for (let i = 0; i < 3; i += 1) server.upsert({ kind: "tasks", projectId: p, id: `${p}-t${i}`, data: { title: `Task ${i}` } });
  // The replica's real defaults, including its 2-minute "read a moment ago" shortcut: the first copy just read every feed, so a
  // heads-mode run right after it MUST get past that shortcut for a project /heads says moved.
  const replica = createReplica({ userId: "u1", client: server.client, idb, yieldFn: noYield, pacer: null, ...(o.projectFreshMs !== undefined ? { projectFreshMs: o.projectFreshMs } : {}) });
  expect((await replica.sync()).status).toBe("done"); // the first copy (WorkspacePrepare)
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  const resets: number[] = [];
  const step = createServerStep({
    meta: db,
    changes: (r) => server.client.changes(r),
    sync: () => replica.sync(),
    syncProject: (p, opts) => replica.syncProject(p, undefined, undefined, opts),
    activeProject: () => "p1",
    heads: () => server.client.heads!(),
    resetCopy: async () => { resets.push((await resetLocalCopy(db)).removed); },
  });
  const mark = () => server.requests.length;
  const since = (from: number) => server.requests.slice(from).map((r) => `${r.path}${r.path === "/changes" || r.path === "/pull" ? ` ${(r.body as { project_id?: string }).project_id}` : ""}`);
  return { idb, server, replica, db, step, resets, mark, since };
}

describe("heads mode: one request per round when nothing changed", () => {
  test("nothing changed anywhere: every run is exactly ONE request (GET /heads), not one per project", async () => {
    const s = await setup();
    for (let run = 0; run < 3; run += 1) {
      const at = s.mark();
      expect(await s.step()).toEqual({ changed: false });
      expect(s.since(at)).toEqual(["/heads"]);
    }
    expect(await s.db.getMeta(HEADS_KEY)).toMatchObject({ viewClass: s.server.viewClass, epoch: s.server.epoch });
    s.db.close();
  });

  test("a colleague changed a row in p2: /heads, then p2's feed and a pull of that one row -- p1 and p3 cost nothing", async () => {
    const s = await setup();
    await s.step(); // baseline
    s.server.upsert({ kind: "tasks", projectId: "p2", id: "p2-t1", data: { title: "Changed by a colleague" } });
    const at = s.mark();
    expect(await s.step()).toEqual({ changed: true });
    expect(s.since(at)).toEqual(["/heads", "/changes p2", "/pull p2"]);
    expect((await s.db.getRecord("tasks", "p2-t1"))!.data).toMatchObject({ title: "Changed by a colleague" });
    // and the next round is back to one request
    const again = s.mark();
    await s.step();
    expect(s.since(again)).toEqual(["/heads"]);
    s.db.close();
  });
});

describe("heads mode: what the answer's other fields trigger", () => {
  test("a project given to the person (projects_etag moved): a whole sync, and the new project arrives", async () => {
    const s = await setup();
    await s.step();
    s.server.projects.push("p4");
    s.server.upsert({ kind: "tasks", projectId: "p4", id: "p4-t0", data: { title: "New project's task" } });
    const at = s.mark();
    await s.step();
    expect(s.since(at)).toContain("/manifest");
    expect(await s.db.getRecord("tasks", "p4-t0")).toBeDefined();
    s.db.close();
  });

  for (const what of ["view_class", "epoch"] as const) {
    test(`${what} changed: the copy is reset (pending edits kept) and rebuilt by a whole sync`, async () => {
      const s = await setup();
      await s.step();
      // a pending local edit on p1-t0 must survive the reset
      await s.db.transact(async (tx) => {
        const row = (await tx.getRecord("tasks", "p1-t0"))!;
        await tx.putRecord({ ...row, data: { ...(row.data as object), title: "Mine, not sent yet" }, dirty: "op-1" });
      });
      if (what === "view_class") s.server.viewClass = "fedcba9876543210";
      else s.server.epoch = "epoch-2";
      const at = s.mark();
      expect(await s.step()).toEqual({ changed: true });
      expect(s.resets).toHaveLength(1);
      expect(s.resets[0]).toBe(PROJECTS.length * 3 - 1); // every non-dirty task row was dropped ...
      const log = s.since(at);
      expect(log[0]).toBe("/heads");
      expect(log).toContain("/manifest");
      expect(log.filter((r) => r.startsWith("/pull")).length).toBeGreaterThanOrEqual(PROJECTS.length); // ... and copied again from scratch
      expect(await s.db.getRecord("tasks", "p3-t2")).toBeDefined();
      expect((await s.db.getRecord("tasks", "p1-t0"))!.data).toMatchObject({ title: "Mine, not sent yet" });
      expect(await s.db.getMeta(HEADS_KEY)).toMatchObject(what === "view_class" ? { viewClass: "fedcba9876543210" } : { epoch: "epoch-2" });
      // settled: the next round is one request again
      const again = s.mark();
      await s.step();
      expect(s.since(again)).toEqual(["/heads"]);
      s.db.close();
    });
  }

  test("the daily delete repair: a whole sync when the last one is older than a day", async () => {
    const s = await setup();
    await s.step();
    await s.db.setMeta(LAST_SYNC_KEY, { at: Date.now() - 25 * 60 * 60_000 });
    const at = s.mark();
    await s.step();
    expect(s.since(at)).toContain("/manifest");
    s.db.close();
  });
});

describe("heads mode: an older service, an unreachable one", () => {
  test("an older service without /heads (404): project mode (the open project's feed), and /heads is not asked again for a day", async () => {
    const s = await setup({ heads: false, projectFreshMs: 0 }); // 0: the open project's feed is really read (project mode as before)
    const at = s.mark();
    await s.step();
    // lf-e6's project mode: a first run reads every project's feed once, then only the open one (others hourly)
    expect(s.since(at)).toEqual(["/heads", "/changes p1", "/changes p2", "/changes p3"]);
    const again = s.mark();
    await s.step();
    expect(s.since(again)).toEqual(["/changes p1"]);
    s.db.close();
  });

  test("/heads unreachable (500): the step throws, so the scheduler counts the server as unreachable, and nothing else is sent", async () => {
    const s = await setup();
    await s.step();
    s.server.failNext({ status: 500, path: "/heads", times: 10 });
    const at = s.mark();
    await expect(s.step()).rejects.toThrow();
    expect(s.since(at)).toEqual(["/heads"]);
    s.db.close();
  });
});

describe("the organisation feed: an extension point for package E7, not acted on here", () => {
  test("the '__org__' head and an org_view_class change are handed to the hooks; nothing else is sent for them", async () => {
    const meta = new Map<string, unknown>();
    const store = { async getMeta<T>(k: string) { return meta.get(k) as T | undefined; }, async setMeta(k: string, v: unknown) { meta.set(k, v); } };
    meta.set("sync:manifest", { projectIds: ["p1"], userId: "u1", orgId: "o", kinds: [], at: 0 });
    meta.set(LAST_SYNC_KEY, { at: Date.now() });
    meta.set("sync:changes:p1", { seq: 5 });
    let answer: HeadsAnswer = { heads: { p1: 5, __org__: 40 }, projects_etag: "e", role: "pm", view_class: "v", org_view_class: "ov1", epoch: "x" };
    const orgHeads: number[] = [];
    const orgClasses: (string | null)[] = [];
    let projectRuns = 0;
    const step = createServerStep({
      meta: store, changes: async () => ({ head_seq: 0 }), sync: async () => ({ status: "done" }), syncProject: async () => { projectRuns += 1; return { status: "done" }; },
      heads: async () => answer, onOrgHead: (h) => { orgHeads.push(h); }, onOrgClassChanged: (c) => { orgClasses.push(c); },
    });
    await step();
    answer = { ...answer, heads: { p1: 5, __org__: 41 }, org_view_class: "ov2" };
    await step();
    expect(orgHeads).toEqual([40, 41]);
    expect(orgClasses).toEqual(["ov2"]);
    expect(projectRuns).toBe(0);
  });
});
