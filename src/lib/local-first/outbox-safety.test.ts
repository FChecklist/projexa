import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeServerOptions, type FakeSyncServer } from "./__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb, type LocalTx } from "./local-db";
import { OutboxRefusal, createOutbox, type Outbox, type OutboxOptions } from "./outbox";
import { createReplica } from "./replica";
import { SyncError, type PushResult, type SyncClient } from "./sync-client";

// FB: the outbox never loses what a person typed, every op state ENDS and is VISIBLE, conflicts merge by themselves where
// only one side changed a field (R12), and it sends the right thing. Against the shared fake server, with a push hook to
// play the real backend's answers the fake cannot produce (a conflict with server:null, EXECUTION_UNCERTAIN, a 403).

type PushHook = (ops: { op_id: string }[], real: () => Promise<{ results: PushResult[] }>) => Promise<{ results: PushResult[] }>;

type Rig = {
  idb: IDBFactory;
  server: FakeSyncServer;
  outbox: Outbox;
  clock: { now: number };
  hook: { push: PushHook | null };
  open: () => ReturnType<typeof openLocalDb>;
  reload: (extra?: Partial<OutboxOptions>) => Outbox;
  pushes: () => Record<string, unknown>[][];
  sync: () => Promise<unknown>;
};

async function rig(opts: { server?: FakeServerOptions; outbox?: Partial<OutboxOptions>; seed?: (s: FakeSyncServer) => void } = {}): Promise<Rig> {
  const idb = new IDBFactory();
  const server = createFakeSyncServer(opts.server);
  opts.seed?.(server);
  const clock = { now: 1_800_000_000_000 };
  const hook: Rig["hook"] = { push: null };
  const sent: Record<string, unknown>[][] = []; // every push request the outbox made, whoever answered it
  const client: Pick<SyncClient, "push" | "pullIds"> = {
    pullIds: (req, signal) => server.client.pullIds(req, signal),
    push: (req, signal) => {
      sent.push(req.ops as unknown as Record<string, unknown>[]);
      return hook.push ? hook.push(req.ops, () => server.client.push(req, signal)) : server.client.push(req, signal);
    },
  };
  let n = 0;
  const make = (extra: Partial<OutboxOptions> = {}) =>
    createOutbox({ userId: "u1", client, deviceId: "dev-1", idb, now: () => clock.now, sleep: async () => {}, autoFlush: false, newOpId: () => `op-${++n}`, locks: null, ...opts.outbox, ...extra });
  const sync = () => createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  await sync();
  return {
    idb, server, outbox: make(), clock, hook, sync,
    open: () => openLocalDb(idb, localDbNameFor("u1")),
    reload: (extra) => make(extra),
    pushes: () => sent,
  };
}

const seedTask = (data: Record<string, unknown> = {}) => (s: FakeSyncServer) =>
  s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old", statusId: "s1", description: "d0", startDate: "2026-10-05", ...data } });

const patchRow = (kind: string, id: string, patch: Record<string, unknown>) => async (tx: LocalTx) => {
  const row = (await tx.getRecord(kind, id))!;
  await tx.patchRecord(kind, id, { data: { ...(row.data as object), ...patch } });
};

const editTask = (o: Outbox, patch: Record<string, unknown>, baseVersion = 1) =>
  o.enqueue({
    functionId: "update_task", projectId: "p1", params: { projectId: "p1", issueId: "t1", ...patch }, label: "Your change to this task",
    record: { kind: "tasks", id: "t1", baseVersion }, optimistic: patchRow("tasks", "t1", patch),
  });

/** The real backend's answer for a row deleted by someone else (handler.ts: conflict, server null). */
const conflictWithoutRow: PushHook = async (ops) => ({ results: ops.map((o) => ({ op_id: o.op_id, status: "conflict" as const })) });
const uncertain: PushHook = async (ops) => ({ results: ops.map((o) => ({ op_id: o.op_id, status: "failed" as const, error: { code: "EXECUTION_UNCERTAIN" } })) });
const status = (code: number, kind: SyncError["kind"]): PushHook => async () => { throw new SyncError(kind, `answered ${code}`, code); };

// ─── 1. nothing the person typed is ever lost ─────────────────────────────────────────────────────────────────

describe("(data:F4) a refused edit keeps what the person typed as a draft", () => {
  test("rejected: the op goes, the row is undone, and a draft holds EXACTLY the parameters, until discarded; it survives a reload", async () => {
    const r = await rig({ seed: seedTask() });
    const typed = "  A long answer, typed with care.\nSecond line.  ";
    await editTask(r.outbox, { title: " ", description: typed }); // the fake refuses an empty title
    const rep = await r.outbox.flush();
    expect(rep.rejected).toBe(1);

    const state = await r.outbox.refresh();
    expect(state.pending).toBe(0);
    expect(state.drafts).toHaveLength(1);
    expect(state.drafts[0]).toMatchObject({ opId: "op-1", functionId: "update_task", projectId: "p1", record: { kind: "tasks", id: "t1" }, code: "TITLE_REQUIRED", label: "Your change to this task" });
    expect(state.drafts[0]!.params).toEqual({ projectId: "p1", issueId: "t1", title: " ", description: typed });
    expect(state.drafts[0]!.message).toContain("was not saved");
    const db = await r.open();
    expect((await db.getRecord("tasks", "t1"))!.data).toMatchObject({ title: "Old", description: "d0" }); // undone here
    db.close();

    const reloaded = r.reload();
    expect((await reloaded.getDraft("op-1"))!.params.description).toBe(typed);
    await reloaded.discardDraft("op-1");
    const after = await reloaded.refresh();
    expect(after.drafts).toEqual([]);
    expect(after.notices).toEqual([]); // its notice goes with it
  });

  test("a text longer than the server takes is refused BEFORE it is queued: nothing stored, the refusal names the field and the limit", async () => {
    const r = await rig({ seed: seedTask() });
    const err = await editTask(r.outbox, { description: "d".repeat(2001) }).catch((e) => e);
    expect(err).toBeInstanceOf(OutboxRefusal);
    expect(err).toMatchObject({ code: "TEXT_TOO_LONG", field: "description" });
    expect(err.message).toContain("2,000");
    expect(await r.outbox.pendingCount()).toBe(0);
    const db = await r.open();
    expect((await db.getRecord("tasks", "t1"))!).toMatchObject({ data: { description: "d0" } });
    expect((await db.getRecord("tasks", "t1"))!.dirty ?? null).toBeNull();
    db.close();
    // exactly 2,000 is fine
    await editTask(r.outbox, { description: "d".repeat(2000) });
    expect(await r.outbox.pendingCount()).toBe(1);
  });

  test("(wire:F12) an op above the server's 64 KB per-op ceiling is refused before it is queued; one already stored is stopped at send time with words and kept as a draft", async () => {
    const r = await rig({ seed: seedTask() });
    const huge = { projectId: "p1", subject: "S", question: "Q", attachmentManifest: "z".repeat(70_000) };
    const err = await r.outbox.enqueue({ functionId: "create_rfi", projectId: "p1", params: huge, label: "New RFI", creates: { kind: "rfis", id: "local-1" } }).catch((e) => e);
    expect(err).toBeInstanceOf(OutboxRefusal);
    expect(err.code).toBe("TOO_LARGE");
    expect(await r.outbox.pendingCount()).toBe(0);

    // an op that got in before this rule (an older app): the request is never made, the person is told, the text kept
    const db = await r.open();
    await db.putOp({ opId: "old-1", functionId: "create_rfi", projectId: "p1", params: huge, label: "New RFI", clientAt: "x", status: "pending", attempts: 0, nextAttemptAt: 0 });
    db.close();
    const rep = await r.outbox.flush();
    expect(rep).toMatchObject({ rejected: 1, sent: 0 });
    expect(r.pushes()).toHaveLength(0);
    const state = await r.outbox.refresh();
    expect(state.notices[0]!.message).toContain("too large");
    expect(state.drafts[0]!.params.attachmentManifest).toBe(huge.attachmentManifest);
  });

  test("an op whose project the person lost is dropped, and its text is kept", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: "Mine" });
    r.server.projects.splice(0, r.server.projects.length);
    await r.sync();
    await r.outbox.flush();
    const state = await r.outbox.refresh();
    expect(state.drafts.map((d) => [d.opId, d.code, d.params.title])).toEqual([["op-1", "PROJECT_NOT_READABLE", "Mine"]]);
  });
});

// ─── 2. every op state ends and is visible ────────────────────────────────────────────────────────────────────

describe("(data:F6, wire:F06) the row was deleted by someone else: a first-class conflict, never an endless retry", () => {
  test("a conflict answer without a row becomes a 'deleted' card; the op is not retried and later edits of the row wait behind it", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: "Mine on a deleted task" });
    await editTask(r.outbox, { description: "second edit" });
    r.hook.push = conflictWithoutRow;
    const rep = await r.outbox.flush();
    expect(rep).toMatchObject({ conflicts: 1, failed: 0, sent: 1 });
    const state = await r.outbox.refresh();
    expect(state.conflicts).toHaveLength(1);
    expect(state.conflicts[0]).toMatchObject({ opId: "op-1", kind: "deleted", server: null, canRecreate: true });

    // nothing is re-sent on its own, however long it waits
    for (let i = 0; i < 4; i += 1) { r.clock.now += 10 * 60_000; await r.outbox.flush(); }
    expect(r.pushes()).toHaveLength(1);
  });

  test("'Keep my text': the edit and the row go from the laptop, the text is kept as a draft, and the later edit is no longer held", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: "Mine" });
    r.hook.push = conflictWithoutRow;
    await r.outbox.flush();
    await r.outbox.resolve("op-1", "keep_text");
    const state = await r.outbox.refresh();
    expect(state.pending).toBe(0);
    expect(state.conflicts).toEqual([]);
    expect(state.drafts[0]).toMatchObject({ opId: "op-1", code: "RECORD_DELETED", params: { title: "Mine" } });
    expect(state.drafts[0]!.message).toContain("deleted by someone else");
    const db = await r.open();
    expect(await db.getRecord("tasks", "t1")).toBeUndefined();
    db.close();
  });

  test("'Keep my version as a new one': a NEW create op (new op id) carries my version, names the kind it creates, and applies", async () => {
    const r = await rig({ seed: seedTask() });
    r.server.registerFunction("create_schedule_task", ({ params, projectId }) => ({ ok: true, kind: "tasks", id: "t-new", data: { id: "t-new", projectId, title: params.title, startDate: params.startDate, description: params.description ?? null } }));
    await editTask(r.outbox, { title: "Mine" });
    r.hook.push = conflictWithoutRow;
    await r.outbox.flush();
    r.hook.push = null;
    await r.outbox.resolve("op-1", "keep_as_new");
    const rep = await r.outbox.flush();
    expect(rep.applied).toBe(1);
    const wire = r.pushes().at(-1)![0]!;
    expect(wire).toMatchObject({ function_id: "create_schedule_task", record_kind: "tasks", params: { projectId: "p1", title: "Mine", startDate: "2026-10-05", description: "d0" } });
    expect(wire.op_id).not.toBe("op-1");
    expect(r.server.getRow("tasks", "t-new")!.data).toMatchObject({ title: "Mine" });
    expect((await r.outbox.refresh()).pending).toBe(0);
  });

  test("without what a create needs (no start date), 'keep as new' is not offered; 'discard' drops it and keeps no draft", async () => {
    const r = await rig({ seed: seedTask({ startDate: null }) });
    await editTask(r.outbox, { title: "Mine" });
    r.hook.push = conflictWithoutRow;
    await r.outbox.flush();
    expect((await r.outbox.refresh()).conflicts[0]!.canRecreate).toBe(false);
    await expect(r.outbox.resolve("op-1", "keep_as_new")).rejects.toThrow(/Keep your text/);
    await r.outbox.resolve("op-1", "discard");
    const state = await r.outbox.refresh();
    expect(state).toMatchObject({ pending: 0, drafts: [], conflicts: [] });
  });
});

describe("(data:F7, wire:W22) an outcome the server could not confirm: 'checking', bounded, then the person decides", () => {
  test("EXECUTION_UNCERTAIN is re-sent with the SAME op_id, shown as checking, and after 5 tries it stops and needs the person", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: "After a lost answer" });
    r.hook.push = uncertain;
    let state = await r.outbox.refresh();
    for (let i = 0; i < 4; i += 1) {
      await r.outbox.flush();
      r.clock.now += 10 * 60_000;
      state = await r.outbox.refresh();
      expect(state.checking).toHaveLength(1);
      expect(state.checking[0]).toMatchObject({ opId: "op-1", attempts: i + 1, maxAttempts: 5 });
    }
    const last = await r.outbox.flush();
    expect(last.attention).toBe(1);
    state = await r.outbox.refresh();
    expect(state.checking).toEqual([]);
    expect(state.attention).toEqual([expect.objectContaining({ opId: "op-1", reason: "uncertain" })]);
    expect(state.attention[0]!.message).toContain("could not confirm");
    // it is NOT re-sent any more on its own
    for (let i = 0; i < 3; i += 1) { r.clock.now += 10 * 60_000; await r.outbox.flush(); }
    expect(r.pushes()).toHaveLength(5);
    expect(new Set(r.pushes().map((b) => b[0]!.op_id))).toEqual(new Set(["op-1"]));
  });

  test("'Send again' re-sends the SAME op_id, and a 'duplicate' answer means it is already in", async () => {
    const r = await rig({ seed: seedTask() }, );
    await editTask(r.outbox, { title: "Exactly once" });
    // the server DID it, but every answer says it cannot confirm
    r.hook.push = async (ops, real) => { await real(); return uncertain(ops, real); };
    for (let i = 0; i < 5; i += 1) { await r.outbox.flush(); r.clock.now += 10 * 60_000; }
    expect((await r.outbox.refresh()).attention).toHaveLength(1);
    r.hook.push = null;
    await r.outbox.retry("op-1");
    const rep = await r.outbox.flush();
    expect(rep).toMatchObject({ duplicates: 1, remaining: 0 });
    expect(r.pushes().at(-1)![0]!.op_id).toBe("op-1");
    const db = await r.open();
    const row = (await db.getRecord("tasks", "t1"))!;
    expect(row.dirty ?? null).toBeNull();
    expect(row.data).toMatchObject({ title: "Exactly once" });
    db.close();
  });

  test("'Stop and keep my text' undoes it here and keeps a draft", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: "Unsure" });
    r.hook.push = uncertain;
    for (let i = 0; i < 5; i += 1) { await r.outbox.flush(); r.clock.now += 10 * 60_000; }
    await r.outbox.discard("op-1");
    const state = await r.outbox.refresh();
    expect(state).toMatchObject({ pending: 0, attention: [] });
    expect(state.drafts[0]).toMatchObject({ opId: "op-1", code: "EXECUTION_UNCERTAIN", params: { title: "Unsure" } });
  });

  test("a re-send answered 'conflict' whose server row already holds my change (conflict by effect) counts as already in", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: "Went in" });
    // first answer lost after the server applied it; the next is a conflict against the row MY edit produced
    r.hook.push = async (ops, real) => { await real(); return uncertain(ops, real); };
    await r.outbox.flush();
    r.clock.now += 10 * 60_000;
    r.hook.push = null;
    // the ledger forgot (say), so the real server answers with a conflict on base_version 1 < head 2
    r.server.ledger.clear();
    const rep = await r.outbox.flush();
    expect(rep).toMatchObject({ merged: 1, conflicts: 0, remaining: 0 });
    const db = await r.open();
    const row = (await db.getRecord("tasks", "t1"))!;
    expect(row.dirty ?? null).toBeNull();
    expect(row.serverVersion).toBe(2);
    db.close();
    expect(r.server.getRow("tasks", "t1")!.version).toBe(2); // not applied twice
  });
});

describe("(wire:F14, W32) a whole request refused because the sign-in is not linked (403)", () => {
  test("pauses the outbox with ONE state, does not count against any op, sends nothing more until resume, then sends", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: "While deactivated" });
    r.hook.push = status(403, "bad_response");
    const rep = await r.outbox.flush();
    expect(rep.status).toBe("not_linked");
    const state = await r.outbox.refresh();
    expect(state.status).toBe("not_linked");
    const op = (await r.outbox.listPending())[0]!;
    expect(op).toMatchObject({ status: "pending", attempts: 0 });
    for (let i = 0; i < 3; i += 1) { r.clock.now += 10 * 60_000; expect((await r.outbox.flush()).skipped).toBe("paused"); }
    expect(r.pushes()).toHaveLength(1); // the one request that was refused; nothing after it
    r.hook.push = null;
    r.outbox.resume();
    expect(await r.outbox.flush()).toMatchObject({ applied: 1, remaining: 0 });
  });
});

describe("(cost:COST-07) other whole-request refusals are not retried for ever", () => {
  for (const [code, kind] of [[400, "bad_response"], [413, "bad_response"], [404, "not_found"]] as const) {
    test(`${code}: tried 3 times, then the op needs the person (refused), and it is not sent again on its own`, async () => {
      const r = await rig({ seed: seedTask() });
      await editTask(r.outbox, { title: "x" });
      let requests = 0;
      r.hook.push = async (ops, real) => { requests += 1; return status(code, kind)(ops, real); };
      for (let i = 0; i < 6; i += 1) { await r.outbox.flush(); r.clock.now += 10 * 60_000; }
      expect(requests).toBe(3);
      const state = await r.outbox.refresh();
      expect(state.attention).toEqual([expect.objectContaining({ opId: "op-1", reason: "refused" })]);
      expect(state.pending).toBe(1); // kept on the laptop, nothing lost
    });
  }

  test("a network outage is NOT capped: that is 'offline', retried with back-off for as long as it takes", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: "x" });
    r.hook.push = status(0, "network");
    for (let i = 0; i < 8; i += 1) { await r.outbox.flush(); r.clock.now += 10 * 60_000; }
    const state = await r.outbox.refresh();
    expect(state.attention).toEqual([]);
    expect(state.status).toBe("offline");
  });
});

// ─── 3. R12: the automatic merge ──────────────────────────────────────────────────────────────────────────────

describe("(R12) field-level three-way merge", () => {
  test("they changed ANOTHER field: merged silently, re-sent against their version, and the server ends with both changes", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: "Mine" });
    r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old", statusId: "s2", description: "d0", startDate: "2026-10-05" } });
    const rep = await r.outbox.flush();
    expect(rep).toMatchObject({ merged: 1, conflicts: 0, applied: 1, remaining: 0 });
    expect(r.server.getRow("tasks", "t1")!.data).toMatchObject({ title: "Mine", statusId: "s2" });
    const resent = r.pushes().at(-1)![0]! as { params: Record<string, unknown>; record: { base_version: number }; resolution?: string };
    expect(resent.record.base_version).toBe(2); // based on THEIR row, not an overwrite
    expect(resent.resolution).toBeUndefined();
    expect(resent.params).toEqual({ projectId: "p1", issueId: "t1", title: "Mine" }); // only my field travels
    expect((await r.outbox.refresh()).conflicts).toEqual([]);
  });

  test("they changed the SAME field to something else: a card naming only that field; nothing is sent", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: "Mine", description: "my notes" });
    r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs", statusId: "s1", description: "d0", startDate: "2026-10-05" } });
    const rep = await r.outbox.flush();
    expect(rep).toMatchObject({ conflicts: 1, merged: 0 });
    const state = await r.outbox.refresh();
    expect(state.conflicts[0]).toMatchObject({ kind: "changed", fields: ["title"], server: { version: 2, data: { title: "Theirs" } } });
    expect(r.pushes()).toHaveLength(1);
  });

  test("'Keep theirs' on the disagreeing field still sends my OTHER field, against their version", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: "Mine", description: "my notes" });
    r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs", statusId: "s1", description: "d0", startDate: "2026-10-05" } });
    await r.outbox.flush();
    await r.outbox.resolve("op-1", "keep_theirs");
    const rep = await r.outbox.flush();
    expect(rep.applied).toBe(1);
    expect(r.server.getRow("tasks", "t1")!.data).toMatchObject({ title: "Theirs", description: "my notes" });
    expect(r.pushes().at(-1)![0]!.params).toEqual({ projectId: "p1", issueId: "t1", description: "my notes" });
  });

  test("(data:F8) 'Keep theirs' restores the NEWEST server row the laptop knows, not the snapshot taken when the conflict was seen", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: "Mine" });
    r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs v2", statusId: "s1", description: "d0", startDate: "2026-10-05" } });
    await r.outbox.flush(); // conflict against v2
    r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs v3 (newest)", statusId: "s1", description: "d0", startDate: "2026-10-05" } });
    await r.sync(); // parks v3 in the dirty row's serverCopy
    expect((await r.outbox.refresh()).conflicts[0]!.server).toMatchObject({ version: 3, data: { title: "Theirs v3 (newest)" } });
    await r.outbox.resolve("op-1", "keep_theirs");
    const db = await r.open();
    const row = (await db.getRecord("tasks", "t1"))!;
    expect(row).toMatchObject({ serverVersion: 3, data: { title: "Theirs v3 (newest)" } });
    expect(row.dirty ?? null).toBeNull();
    db.close();
  });

  test("'Keep mine' is sent over the NEWEST version too", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: "Mine" });
    r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs v2", statusId: "s1" } });
    await r.outbox.flush();
    r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs v3", statusId: "s1" } });
    await r.sync();
    await r.outbox.resolve("op-1", "keep_mine");
    expect(await r.outbox.flush()).toMatchObject({ applied: 1 });
    expect(r.pushes().at(-1)![0]).toMatchObject({ resolution: "overwrite", record: { base_version: 3 } });
  });

  test("a money or approval field is never merged on the laptop: always the card", async () => {
    const r = await rig({ seed: (s) => s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old", amount: 100 } }) });
    r.server.registerFunction("update_task", ({ params, target }) => ({ ok: true, kind: "tasks", id: target!.id, data: { ...target!.data, ...params } }));
    await r.outbox.enqueue({ functionId: "update_task", projectId: "p1", params: { issueId: "t1", amount: 250 }, record: { kind: "tasks", id: "t1", baseVersion: 1 }, optimistic: patchRow("tasks", "t1", { amount: 250 }) });
    r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Renamed by them", amount: 100 } });
    expect(await r.outbox.flush()).toMatchObject({ conflicts: 1, merged: 0 });
    expect((await r.outbox.refresh()).conflicts[0]).toMatchObject({ kind: "changed", fields: ["amount"] });
  });
});

// ─── 4. reverts with later edits, the create hint, persistent storage ─────────────────────────────────────────

describe("(data:F10) edit A refused while a later edit B of the same row waits", () => {
  test("the row shows the server's copy WITH B laid on top, still dirty for B, and B then applies cleanly", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: " " }); // A: refused (empty title)
    await editTask(r.outbox, { description: "B's description" }); // B
    // only A goes in the first request (B waits behind it); A is refused
    expect(await r.outbox.flush()).toMatchObject({ rejected: 1, applied: 1 });
    const db = await r.open();
    const row = (await db.getRecord("tasks", "t1"))!;
    expect(row.data).toMatchObject({ title: "Old", description: "B's description" });
    expect(row.dirty ?? null).toBeNull();
    db.close();
    expect(r.server.getRow("tasks", "t1")!.data).toMatchObject({ title: "Old", description: "B's description" });
  });

  test("between the refusal and B's answer, the laptop shows B (not a bare revert)", async () => {
    const r = await rig({ seed: seedTask() });
    await editTask(r.outbox, { title: " " });
    await editTask(r.outbox, { description: "B" });
    r.hook.push = async (ops, real) => (ops[0]!.op_id === "op-1" ? real() : new Promise(() => {}) as never);
    // first request only: stop the pass after A is settled by making B's request never answer
    void r.outbox.flush();
    for (let i = 0; i < 50; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const db = await r.open();
      const row = await db.getRecord("tasks", "t1");
      db.close();
      if (row?.dirty === "op-2") {
        expect(row.data).toMatchObject({ title: "Old", description: "B" });
        return;
      }
    }
    throw new Error("A was never settled");
  });
});

describe("(wire:F10, cost:COST-08) a create names the kind it makes", () => {
  test("record_kind travels with a create (and only with a create), so the answer can carry the row", async () => {
    const r = await rig({ seed: seedTask(), server: { includeServerOnApplied: true } });
    await r.outbox.enqueue({
      functionId: "create_rfi", projectId: "p1", params: { projectId: "p1", subject: "S", question: "Q?" }, label: "New RFI", creates: { kind: "rfis", id: "local-1" },
      optimistic: async (tx) => { await tx.putRecord({ id: "rfis:local-1", type: "rfis", orgId: "orgA", projectId: "p1", data: { id: "local-1" } }); },
    });
    await editTask(r.outbox, { title: "T" });
    const pullsBefore = r.server.requests.filter((q) => q.path === "/pull").length;
    await r.outbox.flush();
    const [create, update] = r.pushes()[0]!;
    expect(create).toMatchObject({ function_id: "create_rfi", record_kind: "rfis" });
    expect(update!.record_kind).toBeUndefined();
    expect(r.server.requests.filter((q) => q.path === "/pull").length).toBe(pullsBefore); // settled from the answer itself
  });
});

describe("(data:F13) persistent storage is asked for before the first op is stored", () => {
  test("asked ONCE, before the op exists; a refusal raises a warning in the state", async () => {
    let calls = 0;
    let opsWhenAsked = -1;
    const holder: { r?: Rig } = {};
    const r = await rig({
      seed: seedTask(),
      outbox: {
        requestPersistence: async () => {
          calls += 1;
          const db = await holder.r!.open();
          opsWhenAsked = (await db.listOps()).length;
          db.close();
          return "denied";
        },
      },
    });
    holder.r = r;
    await editTask(r.outbox, { title: "a" });
    await editTask(r.outbox, { title: "b" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(1);
    expect(opsWhenAsked).toBe(0);
    expect(r.outbox.getState().storageWarning).toBe(true);
  });
});
