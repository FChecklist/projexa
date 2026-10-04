import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "./__fixtures__/fake-sync-server";
import { LOCAL_FIRST_FLAG } from "./local-reader";
import { localDbNameFor, openLocalDb } from "./local-db";
import { answerRfiLocally, createRfiLocally, updateTaskLocally, type LocalWriteAccess } from "./local-writes";
import { createOutbox, type Outbox } from "./outbox";
import { createReplica } from "./replica";

// The three real writes (create_rfi, answer_rfi, update_task) on top of the outbox, against the shared fake server.
// They return null whenever the local path does not apply, so the screens carry on with their normal online request.

function installStorage(flag: boolean) {
  const map = new Map<string, string>(flag ? [[LOCAL_FIRST_FLAG, "1"]] : []);
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null, get length() { return map.size; },
  };
}

type Rig = { idb: IDBFactory; server: FakeSyncServer; outbox: Outbox; access: LocalWriteAccess; enqueued: () => number };

async function rig(opts: { sync?: boolean; seed?: (s: FakeSyncServer) => void; outboxOverride?: Partial<Outbox> } = {}): Promise<Rig> {
  const idb = new IDBFactory();
  const server = createFakeSyncServer();
  opts.seed?.(server);
  if (opts.sync !== false) await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  let n = 0;
  const real = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-1", idb, autoFlush: false, locks: null, sleep: async () => {}, newOpId: () => `op-${++n}` });
  let enqueued = 0;
  const outbox: Outbox = { ...real, enqueue: async (input) => { enqueued += 1; return real.enqueue(input); }, ...opts.outboxOverride };
  return { idb, server, outbox, access: { userId: "u1", idb, outbox }, enqueued: () => enqueued };
}

const seedTaskAndRfi = (s: FakeSyncServer) => {
  s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old", statusId: "s1", priority: "medium", completionPercentage: 10 } });
  s.upsert({ kind: "rfis", projectId: "p1", id: "r1", data: { subject: "Door", question: "Which?", status: "open", answer: null } });
};

beforeEach(() => installStorage(true));
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

describe("when the local path does NOT apply, the writers return null and enqueue nothing", () => {
  test("flag off", async () => {
    installStorage(false);
    const r = await rig({ seed: seedTaskAndRfi });
    expect(await createRfiLocally({ projectId: "p1", subject: "S", question: "Q" }, r.access)).toBeNull();
    expect(await answerRfiLocally({ projectId: "p1", rfiId: "r1", answer: "A" }, r.access)).toBeNull();
    expect(await updateTaskLocally({ projectId: "p1", taskId: "t1", patch: { title: "T" } }, r.access)).toBeNull();
    expect(r.enqueued()).toBe(0);
  });

  test("a flag that is anything but the exact text 1", async () => {
    (globalThis.localStorage as unknown as Storage).setItem(LOCAL_FIRST_FLAG, "true");
    const r = await rig({ seed: seedTaskAndRfi });
    expect(await createRfiLocally({ projectId: "p1", subject: "S", question: "Q" }, r.access)).toBeNull();
    expect(r.enqueued()).toBe(0);
  });

  test("nobody signed in", async () => {
    const r = await rig({ seed: seedTaskAndRfi });
    // no userId injected and no active local user known
    expect(await createRfiLocally({ projectId: "p1", subject: "S", question: "Q" }, { idb: r.idb, outbox: r.outbox })).toBeNull();
    expect(r.enqueued()).toBe(0);
  });

  test("this laptop has never copied the workspace (no manifest), or does not know that project", async () => {
    const never = await rig({ sync: false });
    expect(await createRfiLocally({ projectId: "p1", subject: "S", question: "Q" }, never.access)).toBeNull();
    const synced = await rig({ seed: seedTaskAndRfi });
    expect(await createRfiLocally({ projectId: "some-other-project", subject: "S", question: "Q" }, synced.access)).toBeNull();
    expect(never.enqueued() + synced.enqueued()).toBe(0);
  });

  test("an edit of a row the laptop does not hold (or holds without a server version) falls back to the online path", async () => {
    const r = await rig({ seed: seedTaskAndRfi });
    expect(await updateTaskLocally({ projectId: "p1", taskId: "never-seen", patch: { title: "T" } }, r.access)).toBeNull();
    expect(await answerRfiLocally({ projectId: "p1", rfiId: "never-seen", answer: "A" }, r.access)).toBeNull();
    // a row from an older service has no version: nothing to base the edit on
    const db = await openLocalDb(r.idb, localDbNameFor("u1"));
    await db.putRecord({ id: "tasks:unversioned", type: "tasks", orgId: "orgA", projectId: "p1", data: { title: "x" } });
    db.close();
    expect(await updateTaskLocally({ projectId: "p1", taskId: "unversioned", patch: { title: "T" } }, r.access)).toBeNull();
    // a row of the right id under another project
    expect(await updateTaskLocally({ projectId: "p2", taskId: "t1", patch: { title: "T" } }, r.access)).toBeNull();
    // a row that belongs to ANOTHER organisation is never edited from this workspace
    const foreign = await openLocalDb(r.idb, localDbNameFor("u1"));
    await foreign.putRecord({ id: "tasks:foreign", type: "tasks", orgId: "orgB", projectId: "p1", data: { title: "not ours" }, serverVersion: 1 });
    foreign.close();
    expect(await updateTaskLocally({ projectId: "p1", taskId: "foreign", patch: { title: "T" } }, r.access)).toBeNull();
    expect(r.enqueued()).toBe(0);
  });

  test("if the outbox itself fails, the writer answers null (the person's input is never lost to a local fault)", async () => {
    const r = await rig({ seed: seedTaskAndRfi, outboxOverride: { enqueue: async () => { throw new Error("quota exceeded"); } } });
    expect(await createRfiLocally({ projectId: "p1", subject: "S", question: "Q" }, r.access)).toBeNull();
    expect(await updateTaskLocally({ projectId: "p1", taskId: "t1", patch: { title: "T" } }, r.access)).toBeNull();
  });
});

describe("create_rfi", () => {
  test("queues the RFI with an optimistic row at once, sends the registry's params, and the real row replaces it when applied", async () => {
    const r = await rig();
    const queued = await createRfiLocally({ projectId: "p1", subject: "Beam depth", question: "What depth at grid B?", dueDate: "2026-10-20" }, r.access);
    expect(queued).toMatchObject({ queued: true, opId: "op-1" });
    expect(queued!.tempId.startsWith("local-")).toBe(true);

    let db = await openLocalDb(r.idb, localDbNameFor("u1"));
    const temp = (await db.getRecord("rfis", queued!.tempId))!;
    expect(temp.dirty).toBe("op-1");
    expect(temp.data).toMatchObject({ subject: "Beam depth", question: "What depth at grid B?", status: "open", dueDate: "2026-10-20", number: null });
    db.close();

    await r.outbox.flush();
    const sent = r.server.requests.find((q) => q.path === "/push")!.body;
    expect(sent.ops[0]).toMatchObject({
      op_id: "op-1", function_id: "create_rfi", project_id: "p1",
      params: { projectId: "p1", subject: "Beam depth", question: "What depth at grid B?", dueDate: "2026-10-20" },
    });
    expect(sent.ops[0].record).toBeUndefined(); // a create has no base version
    db = await openLocalDb(r.idb, localDbNameFor("u1"));
    expect(await db.getRecord("rfis", queued!.tempId)).toBeUndefined();
    const rows = await db.listByProject("orgA", "rfis", "p1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ data: { subject: "Beam depth", status: "open" }, serverVersion: 1 });
    db.close();
  });

  test("an empty due date is not sent", async () => {
    const r = await rig();
    await createRfiLocally({ projectId: "p1", subject: "S", question: "Q", dueDate: "" }, r.access);
    await r.outbox.flush();
    expect(r.server.requests.find((q) => q.path === "/push")!.body.ops[0].params).toEqual({ projectId: "p1", subject: "S", question: "Q" });
  });
});

describe("answer_rfi", () => {
  test("queues the answer based on the version the laptop holds; the row shows 'answered' at once; the server applies it", async () => {
    const r = await rig({ seed: seedTaskAndRfi });
    const queued = await answerRfiLocally({ projectId: "p1", rfiId: "r1", answer: "Use 450 mm" }, r.access);
    expect(queued).toMatchObject({ queued: true, opId: "op-1" });
    let db = await openLocalDb(r.idb, localDbNameFor("u1"));
    expect((await db.getRecord("rfis", "r1"))).toMatchObject({ dirty: "op-1", data: { answer: "Use 450 mm", status: "answered", subject: "Door" } });
    db.close();

    await r.outbox.flush();
    const op = r.server.requests.find((q) => q.path === "/push")!.body.ops[0];
    expect(op).toMatchObject({ function_id: "answer_rfi", params: { projectId: "p1", rfiId: "r1", answer: "Use 450 mm" }, record: { kind: "rfis", id: "r1", base_version: 1 } });
    expect(r.server.getRow("rfis", "r1")).toMatchObject({ version: 2, data: { answer: "Use 450 mm", status: "answered" } });
    db = await openLocalDb(r.idb, localDbNameFor("u1"));
    expect((await db.getRecord("rfis", "r1"))).toMatchObject({ serverVersion: 2 });
    expect((await db.getRecord("rfis", "r1"))!.dirty).toBeUndefined();
    db.close();
  });

  test("somebody else answered first: the push is a conflict and both answers are kept for the person to choose", async () => {
    const r = await rig({ seed: seedTaskAndRfi });
    await answerRfiLocally({ projectId: "p1", rfiId: "r1", answer: "Mine" }, r.access);
    r.server.upsert({ kind: "rfis", projectId: "p1", id: "r1", data: { subject: "Door", question: "Which?", status: "answered", answer: "Theirs" } });
    await r.outbox.flush();
    const conflicts = await r.outbox.getConflicts();
    expect(conflicts[0]).toMatchObject({ functionId: "answer_rfi", local: { answer: "Mine" }, server: { data: { answer: "Theirs" } } });
  });
});

describe("update_task", () => {
  test("queues a task edit with the registry's parameter names, shows it at once, and the server applies it", async () => {
    const r = await rig({ seed: seedTaskAndRfi });
    const patch = { title: "Shuttering L2", statusId: "s2", priority: "high", startDate: "2026-10-05", dueDate: null, completionPercentage: 40 };
    expect(await updateTaskLocally({ projectId: "p1", taskId: "t1", patch }, r.access)).toMatchObject({ queued: true, opId: "op-1" });
    let db = await openLocalDb(r.idb, localDbNameFor("u1"));
    expect((await db.getRecord("tasks", "t1"))).toMatchObject({ dirty: "op-1", serverVersion: 1, data: { title: "Shuttering L2", statusId: "s2", priority: "high", dueDate: null, completionPercentage: 40 } });
    db.close();

    await r.outbox.flush();
    const op = r.server.requests.find((q) => q.path === "/push")!.body.ops[0];
    expect(op).toMatchObject({ function_id: "update_task", project_id: "p1", record: { kind: "tasks", id: "t1", base_version: 1 }, params: { projectId: "p1", issueId: "t1", ...patch } });
    expect(r.server.getRow("tasks", "t1")).toMatchObject({ version: 2, data: { title: "Shuttering L2", statusId: "s2" } });
    db = await openLocalDb(r.idb, localDbNameFor("u1"));
    expect((await db.getRecord("tasks", "t1"))!.dirty).toBeUndefined();
    db.close();
  });

  test("a title the server refuses (empty) is undone on this laptop and explained in words", async () => {
    const r = await rig({ seed: seedTaskAndRfi });
    await updateTaskLocally({ projectId: "p1", taskId: "t1", patch: { title: " " } }, r.access);
    await r.outbox.flush();
    const db = await openLocalDb(r.idb, localDbNameFor("u1"));
    expect((await db.getRecord("tasks", "t1"))!.data).toMatchObject({ title: "Old" });
    db.close();
    expect(r.outbox.getState().notices[0]!.message).toBe("Your change to this task was not saved. Type a title. It was undone on this laptop.");
  });
});
