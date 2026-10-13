import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { createOutbox, type Outbox } from "../../outbox";
import { createReplica } from "../../replica";
import type { ShellData } from "../context";
import { createMilestoneOffline, refusalText, updateMilestoneOffline } from "./delivery-writes";
import { findFunction } from "../../ai/registry";

// R-94 (a milestone is its own record, not a task): create_milestone and update_milestone kept on the laptop, sent with the registry's
// parameter names, and replaced by the server's row. Real replica and outbox against the shared fake sync server. Every refusal
// enqueues nothing. A milestone made here and not yet sent cannot be edited (it has no server version to build the edit on).

type Rig = { idb: IDBFactory; server: FakeSyncServer; outbox: Outbox; data: ShellData; enqueued: () => number; access: { outbox: Outbox; newId: () => string } };

async function rig(opts: { sync?: boolean } = {}): Promise<Rig> {
  const idb = new IDBFactory();
  const server = createFakeSyncServer({ kinds: [{ kind: "milestones" }] });
  server.upsert({ kind: "milestones", projectId: "p1", id: "ms1", data: { id: "ms1", name: "Handover", description: null, status: "planned", target_date: "2026-12-01" } });
  let n = 0;
  server.registerFunction("create_milestone", ({ params }) => {
    n += 1;
    return { ok: true, kind: "milestones", id: `srv-ms-${n}`, data: { id: `srv-ms-${n}`, name: params.title, description: params.description ?? null, status: "planned", target_date: params.targetDate ?? null } };
  });
  server.registerFunction("update_milestone", ({ params }) => ({
    ok: true, kind: "milestones", id: String(params.milestoneId),
    data: { id: String(params.milestoneId), name: params.title ?? "Handover", description: null, status: params.status ?? "planned", target_date: params.targetDate ?? "2026-12-01" },
  }));
  if (opts.sync !== false) await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  let op = 0;
  const real = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-1", idb, autoFlush: false, locks: null, sleep: async () => {}, newOpId: () => `op-${++op}` });
  let enqueued = 0;
  const outbox: Outbox = { ...real, enqueue: async (input) => { enqueued += 1; return real.enqueue(input); } };
  let tid = 0;
  const data: ShellData = { userId: "u1", name: "Asha", email: null, role: "site_engineer", orgId: "orgA", idb, projects: [{ id: "p1", name: "Cedar" }] };
  return { idb, server, outbox, data, enqueued: () => enqueued, access: { outbox, newId: () => `t${++tid}` } };
}

const pushed = (r: Rig) => r.server.requests.filter((q) => q.path === "/push").flatMap((q) => q.body.ops as Array<Record<string, unknown>>);

async function rowsOf(r: Rig) {
  const db = await openLocalDb(r.idb, localDbNameFor("u1"));
  try {
    return await db.listByProject("orgA", "milestones", "p1");
  } finally {
    db.close();
  }
}

describe("the registry copy names exactly what the laptop sends", () => {
  test("create_milestone and update_milestone declare the parameters this writer uses", () => {
    expect(findFunction("create_milestone")?.declared_params).toEqual(["description", "projectId", "targetDate", "title"]);
    expect(findFunction("update_milestone")?.declared_params).toEqual(["description", "milestoneId", "projectId", "status", "targetDate", "title"]);
  });
});

describe("create_milestone", () => {
  test("kept at once as a pending row (named by the laptop's `name` column), sent with the registry's names, replaced by the server's row", async () => {
    const r = await rig();
    const res = await createMilestoneOffline(r.data, { projectId: "p1", title: "  Slab cast L2 ", targetDate: "2026-11-15", description: "Pour" }, r.access);
    expect(res).toEqual({ queued: true, opId: "op-1", tempId: "local-t1" });
    const temp = (await rowsOf(r)).find((x) => x.id === "milestones:local-t1")!;
    expect(temp.dirty).toBe("op-1");
    expect(temp.data).toEqual({ id: "local-t1", name: "Slab cast L2", description: "Pour", target_date: "2026-11-15", status: null });

    await r.outbox.flush();
    expect(pushed(r)[0]).toMatchObject({ function_id: "create_milestone", project_id: "p1", params: { projectId: "p1", title: "Slab cast L2", targetDate: "2026-11-15", description: "Pour" } });
    const after = await rowsOf(r);
    expect(after.map((x) => x.id).sort()).toEqual(["milestones:ms1", "milestones:srv-ms-1"]);
    expect((after.find((x) => x.id === "milestones:srv-ms-1")!.data as { name: string }).name).toBe("Slab cast L2");
  });

  test("the date and the description are optional and are not sent when empty", async () => {
    const r = await rig();
    expect((await createMilestoneOffline(r.data, { projectId: "p1", title: "Roof on", targetDate: "", description: "  " }, r.access)).queued).toBe(true);
    await r.outbox.flush();
    expect(pushed(r)[0]!.params).toEqual({ projectId: "p1", title: "Roof on" });
  });

  test("an empty title, a title over 300 letters or a date that is not a day: refused with nothing kept or enqueued", async () => {
    const r = await rig();
    for (const bad of [{ title: "   " }, { title: "x".repeat(301) }, { title: "ok", targetDate: "2026-02-30" }, { title: "ok", targetDate: "15/11/2026" }]) {
      expect(await createMilestoneOffline(r.data, { projectId: "p1", ...bad }, r.access)).toEqual({ queued: false, reason: "invalid" });
    }
    expect(r.enqueued()).toBe(0);
    expect((await rowsOf(r)).map((x) => x.id)).toEqual(["milestones:ms1"]);
    expect(refusalText("invalid")).toContain("check the values");
  });

  test("a project the laptop does not hold, or never copied at all: not_on_laptop", async () => {
    const r = await rig();
    expect(await createMilestoneOffline(r.data, { projectId: "p9", title: "x" }, r.access)).toEqual({ queued: false, reason: "not_on_laptop" });
    const never = await rig({ sync: false });
    expect(await createMilestoneOffline(never.data, { projectId: "p1", title: "x" }, never.access)).toEqual({ queued: false, reason: "not_on_laptop" });
  });
});

describe("update_milestone", () => {
  test("only what changed is sent; the row on the laptop shows the change at once and the server's row replaces it", async () => {
    const r = await rig();
    const res = await updateMilestoneOffline(r.data, { projectId: "p1", milestoneId: "ms1", status: "in_progress", targetDate: "2026-12-10" }, r.access);
    expect(res.queued).toBe(true);
    const mid = (await rowsOf(r)).find((x) => x.id === "milestones:ms1")!;
    expect(mid.dirty).toBe("op-1");
    expect(mid.data).toMatchObject({ name: "Handover", status: "in_progress", target_date: "2026-12-10" });

    await r.outbox.flush();
    expect(pushed(r)[0]).toMatchObject({ function_id: "update_milestone", params: { projectId: "p1", milestoneId: "ms1", status: "in_progress", targetDate: "2026-12-10" } });
    expect(Object.keys(pushed(r)[0]!.params as object).sort()).toEqual(["milestoneId", "projectId", "status", "targetDate"]);
    expect((pushed(r)[0] as { base_version?: number }).base_version ?? (pushed(r)[0] as { record?: { base_version?: number } }).record?.base_version).toBeDefined();
    expect((await rowsOf(r)).find((x) => x.id === "milestones:ms1")!.dirty).toBeFalsy();
  });

  test("nothing changed, a bad status, a bad date or an empty title: refused, nothing enqueued", async () => {
    const r = await rig();
    for (const bad of [{}, { status: "done" }, { targetDate: "2026-13-01" }, { title: "   " }]) {
      expect(await updateMilestoneOffline(r.data, { projectId: "p1", milestoneId: "ms1", ...bad }, r.access)).toEqual({ queued: false, reason: "invalid" });
    }
    expect(r.enqueued()).toBe(0);
  });

  test("a milestone that is not on this project is unknown; one made on this laptop and not yet sent is not_confirmed", async () => {
    const r = await rig();
    expect(await updateMilestoneOffline(r.data, { projectId: "p1", milestoneId: "nope", status: "completed" }, r.access)).toEqual({ queued: false, reason: "unknown_record" });
    await createMilestoneOffline(r.data, { projectId: "p1", title: "Fresh" }, r.access);
    const before = r.enqueued();
    expect(await updateMilestoneOffline(r.data, { projectId: "p1", milestoneId: "local-t1", status: "completed" }, r.access)).toEqual({ queued: false, reason: "not_confirmed" });
    expect(r.enqueued()).toBe(before);
    expect(refusalText("not_confirmed")).toContain("cannot be changed");
  });
});
