// lf-e7: the role / class / epoch rules of replica-class.ts, one at a time, on a real (fake-indexeddb) local database.
// PLANTED-BUG FORM (PREAMBLE, role/isolation checks are never broken in place): set LF_E7_MUTANT to the absolute path of a copy of
// replica-class.ts with one check removed (under src/__mutants__/, deleted afterwards) and this file runs against that copy instead.
import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { changeCursorKey, localDbNameFor, openLocalDb, type LocalDb } from "./local-db";
import { ORG_PROJECT } from "./sync-client";

const mod: typeof import("./replica-class") = await import(process.env.LF_E7_MUTANT ?? "./replica-class");
const { applyClasses, assertPageClass, classKey, noteEpoch, resetEverything, EPOCH_KEY } = mod;

async function freshDb(): Promise<LocalDb> {
  return openLocalDb(new IDBFactory(), localDbNameFor("u1"));
}
const put = (db: LocalDb, projectId: string, kind: string, id: string, extra: Record<string, unknown> = {}) =>
  db.putRecord({ id: `${kind}:${id}`, type: kind, orgId: "org-a", projectId, data: { id }, serverVersion: 1, ...extra });

const plan = (over: Partial<Parameters<typeof applyClasses>[1]> = {}): Parameters<typeof applyClasses>[1] => ({
  orgId: "org-a", projects: ["p1", "p2"], viewClass: "v1", orgViewClass: "ov1", projectKinds: ["tasks"], orgKinds: ["vendors", "cost_visibility"],
  orgKindsNow: ["vendors", "cost_visibility"], orgKindsBefore: ["vendors", "cost_visibility"], now: 1, ...over,
});

describe("applyClasses", () => {
  test("first time: classes recorded, nothing dropped (a laptop updated to this build keeps its copy)", async () => {
    const db = await freshDb();
    await put(db, "p1", "tasks", "t1");
    const out = await applyClasses(db, plan());
    expect(out).toEqual({ reset: [], droppedKinds: [], removed: 0 });
    expect(await db.getMeta(classKey("p1"))).toMatchObject({ view: "v1" });
    expect(await db.getMeta(classKey(ORG_PROJECT))).toMatchObject({ view: "ov1" });
    expect(await db.getRecord("tasks", "t1")).toBeTruthy();
    db.close();
  });

  test("a different project class drops every clean row of every project and their positions; a dirty row stays", async () => {
    const db = await freshDb();
    await applyClasses(db, plan());
    await put(db, "p1", "tasks", "t1");
    await put(db, "p2", "tasks", "t2", { dirty: "op-1" });
    await db.setMeta("sync:cursor:p1:tasks", "c");
    await db.setMeta("sync:done:p1:tasks", { at: 1 });
    await db.setMeta(changeCursorKey("p1"), { seq: 5 });
    const out = await applyClasses(db, plan({ viewClass: "v2" }));
    expect(out.reset.sort()).toEqual(["p1", "p2"]);
    expect(await db.getRecord("tasks", "t1")).toBeUndefined();
    expect((await db.getRecord("tasks", "t2"))?.dirty).toBe("op-1");
    expect(await db.getMeta("sync:cursor:p1:tasks")).toBeNull();
    expect(await db.getMeta("sync:done:p1:tasks")).toBeNull();
    expect(await db.getMeta(changeCursorKey("p1"))).toBeNull();
    expect(await db.getMeta(classKey("p1"))).toMatchObject({ view: "v2" });
    db.close();
  });

  test("a different organisation class resets the organisation only", async () => {
    const db = await freshDb();
    await applyClasses(db, plan());
    await put(db, ORG_PROJECT, "vendors", "ven-1");
    await put(db, "p1", "tasks", "t1");
    const out = await applyClasses(db, plan({ orgViewClass: "ov2" }));
    expect(out.reset).toEqual([ORG_PROJECT]);
    expect(await db.getRecord("vendors", "ven-1")).toBeUndefined();
    expect(await db.getRecord("tasks", "t1")).toBeTruthy();
    db.close();
  });

  test("an organisation kind the role may no longer read leaves (clean rows and its positions), the rest stays", async () => {
    const db = await freshDb();
    await applyClasses(db, plan());
    await put(db, ORG_PROJECT, "vendors", "ven-1");
    await put(db, ORG_PROJECT, "vendors", "ven-2", { dirty: "op-2" });
    await put(db, ORG_PROJECT, "cost_visibility", "cv1");
    await db.setMeta("sync:done:__org__:vendors", { at: 1 });
    const out = await applyClasses(db, plan({ orgKindsNow: ["cost_visibility"] }));
    expect(out.droppedKinds).toEqual(["vendors"]);
    expect(await db.getRecord("vendors", "ven-1")).toBeUndefined();
    expect((await db.getRecord("vendors", "ven-2"))?.dirty).toBe("op-2");
    expect(await db.getRecord("cost_visibility", "cv1")).toBeTruthy();
    expect(await db.getMeta("sync:done:__org__:vendors")).toBeNull();
    db.close();
  });

  test("a service that names no class compares nothing and drops nothing", async () => {
    const db = await freshDb();
    await applyClasses(db, plan());
    await put(db, "p1", "tasks", "t1");
    expect((await applyClasses(db, plan({ viewClass: undefined, orgViewClass: null }))).reset).toEqual([]);
    expect(await db.getRecord("tasks", "t1")).toBeTruthy();
    db.close();
  });
});

describe("assertPageClass", () => {
  test("a page of the recorded class passes; a page of another class is refused before it is stored; org pages use org_view_class", async () => {
    const db = await freshDb();
    await applyClasses(db, plan());
    await assertPageClass(db, "p1", { view_class: "v1" });
    await assertPageClass(db, ORG_PROJECT, { org_view_class: "ov1", view_class: "anything" });
    await expect(assertPageClass(db, "p1", { view_class: "v-other" })).rejects.toMatchObject({ replicaReason: "class_changed", projectId: "p1" });
    await expect(assertPageClass(db, ORG_PROJECT, { org_view_class: "ov-other" })).rejects.toMatchObject({ replicaReason: "class_changed" });
    await assertPageClass(db, "p1", {}); // the service does not say: nothing to compare
    db.close();
  });
});

describe("epoch", () => {
  test("first sight is stored; the same is same; another is changed and is NOT stored until the reset", async () => {
    const db = await freshDb();
    expect(await noteEpoch(db, null)).toBe("unknown");
    expect(await noteEpoch(db, "e1")).toBe("first");
    expect(await noteEpoch(db, "e1")).toBe("same");
    expect(await noteEpoch(db, "e2")).toBe("changed");
    expect(await db.getMeta(EPOCH_KEY)).toBe("e1");
    db.close();
  });

  test("resetEverything drops every clean row of every project and the organisation, keeps dirty rows, ops and drafts, records the epoch", async () => {
    const db = await freshDb();
    await put(db, "p1", "tasks", "t1");
    await put(db, ORG_PROJECT, "vendors", "ven-1");
    await put(db, "p1", "tasks", "t2", { dirty: "op-1" });
    await db.transact(async (tx) => {
      await tx.putOp({ opId: "op-1", functionId: "f", projectId: "p1", params: {}, clientAt: "x", status: "pending", attempts: 0, nextAttemptAt: 0 });
      await tx.putDraft({ opId: "op-0", functionId: "f", projectId: "p1", params: { a: 1 }, message: "m", at: 1 });
    });
    const removed = await resetEverything(db, "org-a", ["p1"], ["tasks", "vendors"], "e2");
    expect(removed).toBe(2);
    expect(await db.getRecord("tasks", "t1")).toBeUndefined();
    expect(await db.getRecord("vendors", "ven-1")).toBeUndefined();
    expect((await db.getRecord("tasks", "t2"))?.dirty).toBe("op-1");
    expect((await db.listOps()).length).toBe(1);
    expect((await db.listDrafts()).length).toBe(1);
    expect(await db.getMeta(EPOCH_KEY)).toBe("e2");
    db.close();
  });
});
