import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeServerOptions, type FakeSyncServer } from "./__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb, type LocalTx } from "./local-db";
import { createOutbox, rejectionMessage, type Outbox, type OutboxEvent, type OutboxOptions } from "./outbox";
import { createReplica } from "./replica";
import { SyncError, type SyncClient } from "./sync-client";

// The outbox against the shared fake server: every status of CONTRACT.md section 2, exactly-once delivery across a
// reload and a lost response, conflicts, undo of rejected edits, back-off, the 426 pause, and the single flusher.

type Rig = {
  idb: IDBFactory;
  server: FakeSyncServer;
  outbox: Outbox;
  /** Mutable clock. */
  clock: { now: number };
  events: OutboxEvent[];
  open: () => ReturnType<typeof openLocalDb>;
  /** A second engine over the SAME database (a reload). */
  reload: (extra?: Partial<OutboxOptions>) => Outbox;
  syncReplica: () => ReturnType<ReturnType<typeof createReplica>["sync"]>;
  pushes: () => { op_id: string; function_id: string; resolution?: string; record?: { base_version: number } }[][];
};

async function rig(opts: { server?: FakeServerOptions; outbox?: Partial<OutboxOptions>; seed?: (s: FakeSyncServer) => void; sync?: boolean } = {}): Promise<Rig> {
  const idb = new IDBFactory();
  const server = createFakeSyncServer(opts.server);
  opts.seed?.(server);
  const clock = { now: 1_800_000_000_000 };
  let n = 0;
  const make = (extra: Partial<OutboxOptions> = {}) =>
    createOutbox({
      userId: "u1", client: server.client, deviceId: "dev-1", idb, now: () => clock.now, sleep: async () => {},
      autoFlush: false, newOpId: () => `op-${++n}`, locks: null, ...opts.outbox, ...extra,
    });
  const outbox = make();
  const events: OutboxEvent[] = [];
  outbox.subscribe((e) => events.push(e));
  const syncReplica = () => createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  if (opts.sync !== false) await syncReplica();
  return {
    idb, server, outbox, clock, events, syncReplica,
    open: () => openLocalDb(idb, localDbNameFor("u1")),
    reload: (extra) => make(extra),
    pushes: () => server.requests.filter((r) => r.path === "/push").map((r) => r.body.ops),
  };
}

const seedTask = (s: FakeSyncServer) => s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old", statusId: "s1" } });

/** An optimistic change that merges `patch` into a row's data. */
const patchRow = (kind: string, id: string, patch: Record<string, unknown>) => async (tx: LocalTx) => {
  const row = (await tx.getRecord(kind, id))!;
  await tx.patchRecord(kind, id, { data: { ...(row.data as object), ...patch } });
};

const editTitle = (o: Outbox, title: string, baseVersion = 1) =>
  o.enqueue({
    functionId: "update_task", projectId: "p1", params: { issueId: "t1", title }, label: "Task change",
    record: { kind: "tasks", id: "t1", baseVersion }, optimistic: patchRow("tasks", "t1", { title }),
  });

const createRfi = (o: Outbox, subject = "Subject", tempId = "local-1", extra: Record<string, unknown> = {}) =>
  o.enqueue({
    functionId: "create_rfi", projectId: "p1", params: { projectId: "p1", subject, question: "Q?", ...extra }, label: "New RFI",
    creates: { kind: "rfis", id: tempId },
    optimistic: async (tx) => { await tx.putRecord({ id: `rfis:${tempId}`, type: "rfis", orgId: "orgA", projectId: "p1", data: { id: tempId, subject, status: "open" } }); },
  });

describe("enqueue", () => {
  test("stores the op and the optimistic change in ONE transaction, and marks the row dirty with the op id", async () => {
    const r = await rig({ seed: seedTask });
    const { opId } = await editTitle(r.outbox, "New title");
    expect(opId).toBe("op-1");

    const db = await r.open();
    const row = (await db.getRecord("tasks", "t1"))!;
    expect(row.data).toMatchObject({ title: "New title" }); // the screen sees it at once
    expect(row.dirty).toBe("op-1");
    expect(row.serverVersion).toBe(1);
    expect(row.serverCopy).toMatchObject({ version: 1, data: { title: "Old" } }); // the last server copy is remembered
    expect(row.sig).toBeUndefined(); // a signature for DIFFERENT data must not stay on an edited row
    const ops = await db.listOps();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ opId: "op-1", functionId: "update_task", projectId: "p1", status: "pending", attempts: 0, record: { kind: "tasks", id: "t1", baseVersion: 1 }, params: { issueId: "t1", title: "New title" } });
    expect(Date.parse(ops[0]!.clientAt)).toBe(r.clock.now);
    expect(r.outbox.getState().pending).toBe(1);
    db.close();
  });

  test("if the optimistic step throws, NOTHING is stored: no op, no half-changed row", async () => {
    const r = await rig({ seed: seedTask });
    await expect(
      r.outbox.enqueue({
        functionId: "update_task", projectId: "p1", params: { issueId: "t1" }, record: { kind: "tasks", id: "t1", baseVersion: 1 },
        optimistic: async (tx) => { await patchRow("tasks", "t1", { title: "half" })(tx); throw new Error("screen refused"); },
      })
    ).rejects.toThrow("screen refused");
    const db = await r.open();
    expect((await db.getRecord("tasks", "t1"))!.data).toMatchObject({ title: "Old" });
    expect((await db.getRecord("tasks", "t1"))!.dirty).toBeUndefined();
    expect(await db.listOps()).toEqual([]);
    db.close();
  });

  test("the op_id is a UUID made at enqueue time and never changes", async () => {
    const r = await rig({ seed: seedTask, outbox: { newOpId: undefined } });
    const { opId } = await editTitle(r.outbox, "x");
    expect(opId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await r.outbox.flush();
    expect(r.pushes()[0]![0]!.op_id).toBe(opId);
  });

  test("a second edit of a row that is already dirty keeps the ORIGINAL server copy, so a revert goes back to the server's row", async () => {
    const r = await rig({ seed: seedTask });
    await editTitle(r.outbox, "first");
    await editTitle(r.outbox, "second");
    const db = await r.open();
    const row = (await db.getRecord("tasks", "t1"))!;
    expect(row.dirty).toBe("op-2");
    expect(row.data).toMatchObject({ title: "second" });
    expect(row.serverCopy).toMatchObject({ version: 1, data: { title: "Old" } });
    db.close();
  });

  test("an edit needs its project and, for an existing row, the version it was based on", async () => {
    const r = await rig({ seed: seedTask });
    await expect(r.outbox.enqueue({ functionId: "update_task", projectId: "", params: {} })).rejects.toThrow(/project/);
    await expect(r.outbox.enqueue({ functionId: "update_task", projectId: "p1", params: {}, record: { kind: "tasks", id: "t1", baseVersion: Number.NaN } })).rejects.toThrow(/version/);
  });
});

describe("flush: applied and duplicate", () => {
  test("a create is applied: the temporary row goes, the real row arrives at version 1 (fetched by id), the op is deleted, 'applied' is announced", async () => {
    const r = await rig();
    await createRfi(r.outbox, "Hello");
    let db = await r.open();
    expect((await db.getRecord("rfis", "local-1"))!.dirty).toBe("op-1");
    db.close();

    const report = await r.outbox.flush();
    expect(report).toMatchObject({ sent: 1, applied: 1, remaining: 0, status: "idle" });
    db = await r.open();
    expect(await db.getRecord("rfis", "local-1")).toBeUndefined();
    const real = (await db.listByProject("orgA", "rfis", "p1"))[0]!;
    expect(real.id.startsWith("rfis:srv-rfi-")).toBe(true);
    expect(real.data).toMatchObject({ subject: "Hello", status: "open" });
    expect(real.serverVersion).toBe(1);
    expect(real.dirty).toBeUndefined();
    expect(typeof real.sig).toBe("string");
    expect(await db.listOps()).toEqual([]);
    db.close();
    expect(r.outbox.getState().pending).toBe(0);
    const applied = r.events.find((e) => e.type === "applied");
    expect(applied).toMatchObject({ type: "applied", opId: "op-1", kind: "rfis", created: true });
  });

  test("when the server sends the row back with its answer, no extra fetch is made", async () => {
    const r = await rig({ server: { includeServerOnApplied: true } });
    await createRfi(r.outbox, "Hello");
    await r.outbox.flush();
    expect(r.server.requests.some((q) => q.path === "/pull" && Array.isArray(q.body.ids))).toBe(false);
    const db = await r.open();
    expect((await db.listByProject("orgA", "rfis", "p1"))[0]!.data).toMatchObject({ subject: "Hello" });
    db.close();
  });

  test("an update is applied: the dirty row is replaced by the server's row at its new version, clean and signed", async () => {
    const r = await rig({ seed: seedTask, server: { includeServerOnApplied: true } });
    await editTitle(r.outbox, "Renamed");
    await r.outbox.flush();
    const db = await r.open();
    const row = (await db.getRecord("tasks", "t1"))!;
    expect(row.data).toMatchObject({ title: "Renamed", statusId: "s1" });
    expect(row.serverVersion).toBe(2);
    expect(row.dirty).toBeUndefined();
    expect(row.serverCopy).toBeUndefined();
    expect(await r.server.verifyRow({ project: "p1", kind: "tasks", id: "t1", version: 2, updated_at: row.serverUpdatedAt!, data: row.data, sig: row.sig! })).toBe(true);
    expect(await db.listDirty()).toEqual([]);
    db.close();
  });

  test("an update whose answer carries no row: the row is clean at once, known to be BEHIND the head, and the next change-feed pass completes it", async () => {
    // A table WITHOUT updated_at, so only the change feed (never the page cursor) can bring the server's row.
    const r = await rig({ seed: (s) => s.upsert({ kind: "progress", projectId: "p1", id: "x1", data: { percent: 10 } }) });
    r.server.registerFunction("update_progress", ({ target, params }) => (target ? { ok: true, kind: "progress", id: target.id, data: { ...target.data, percent: params.percent } } : { rejected: "RECORD_NOT_FOUND" }));
    // the by-id fetch fails right after the apply (offline again)
    const flaky: SyncClient = { ...r.server.client, pullIds: async () => { throw new SyncError("network", "offline"); } };
    const outbox = createOutbox({ userId: "u1", client: flaky, deviceId: "d", idb: r.idb, now: () => r.clock.now, autoFlush: false, locks: null, newOpId: () => "op-flaky" });
    await outbox.enqueue({
      functionId: "update_progress", projectId: "p1", params: { percent: 80 },
      record: { kind: "progress", id: "x1", baseVersion: 1 }, optimistic: patchRow("progress", "x1", { percent: 80 }),
    });
    await outbox.flush();
    let db = await r.open();
    let row = (await db.getRecord("progress", "x1"))!;
    expect(row.dirty).toBeUndefined(); // not dirty any more: the person's edit is on the server
    expect(row.data).toMatchObject({ percent: 80 });
    expect(row.serverVersion).toBe(1); // version 2 on the server, minus one: "behind the head"
    expect(row.sig).toBeUndefined(); // unsigned until the server's own row arrives: never handed to a peer meanwhile
    db.close();

    const report = await r.syncReplica(); // the feed names x1 at version 2
    expect(report.changesApplied).toBe(1);
    db = await r.open();
    row = (await db.getRecord("progress", "x1"))!;
    expect(row.serverVersion).toBe(2);
    expect(typeof row.sig).toBe("string");
    expect(row.data).toMatchObject({ percent: 80 });
    db.close();
  });

  test("two quick edits of ONE row do not conflict with each other: the second waits for the first and is re-based onto its version", async () => {
    const r = await rig({ seed: seedTask });
    await editTitle(r.outbox, "Title two", 1);
    await r.outbox.enqueue({
      functionId: "update_task", projectId: "p1", params: { issueId: "t1", statusId: "s2" },
      record: { kind: "tasks", id: "t1", baseVersion: 1 }, optimistic: patchRow("tasks", "t1", { statusId: "s2" }),
    });
    const report = await r.outbox.flush();
    expect(report).toMatchObject({ applied: 2, conflicts: 0, rejected: 0, remaining: 0 });

    const sent = r.pushes();
    expect(sent.map((batch) => batch.map((o) => o.op_id))).toEqual([["op-1"], ["op-2"]]); // never together
    expect(sent[1]![0]!.record!.base_version).toBe(2); // re-based
    expect(r.server.getRow("tasks", "t1")).toMatchObject({ version: 3, data: { title: "Title two", statusId: "s2" } });
    const db = await r.open();
    const row = (await db.getRecord("tasks", "t1"))!;
    expect(row).toMatchObject({ serverVersion: 3, data: { title: "Title two", statusId: "s2" } });
    expect(row.dirty).toBeUndefined();
    db.close();
  });

  test("ops are sent in batches of at most 50, in the order they were made", async () => {
    const r = await rig();
    for (let i = 0; i < 120; i += 1) await createRfi(r.outbox, `S${i}`, `local-${i}`);
    const report = await r.outbox.flush();
    expect(report).toMatchObject({ sent: 120, applied: 120, remaining: 0 });
    const batches = r.pushes();
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
    expect(batches.flat().map((o) => o.op_id)).toEqual(Array.from({ length: 120 }, (_, i) => `op-${i + 1}`));
  });

  test("a request never exceeds the byte ceiling, and an op too big for any request is dropped with words and undone", async () => {
    const r = await rig({ outbox: { maxBatchBytes: 2_000 } });
    const filler = "x".repeat(700);
    for (let i = 0; i < 4; i += 1) await createRfi(r.outbox, `S${i}`, `local-${i}`, { notes: filler });
    await createRfi(r.outbox, "HUGE", "local-huge", { notes: "y".repeat(5_000) });
    const report = await r.outbox.flush();
    expect(report.rejected).toBe(1);
    expect(report.applied).toBe(4);
    for (const body of r.server.requests.filter((q) => q.path === "/push")) expect(JSON.stringify(body.body).length).toBeLessThanOrEqual(2_000);
    expect(r.pushes().length).toBeGreaterThan(1);
    const db = await r.open();
    expect(await db.getRecord("rfis", "local-huge")).toBeUndefined();
    expect(r.outbox.getState().notices[0]!.message).toContain("too large");
    db.close();
  });

  test("an empty outbox sends nothing", async () => {
    const r = await rig();
    expect(await r.outbox.flush()).toMatchObject({ sent: 0, remaining: 0, nextDueAt: null });
    expect(r.pushes()).toEqual([]);
  });
});

describe("(iv) exactly once: a reload, and a lost response", () => {
  test("an op survives a simulated reload (a NEW engine over the same database) and is sent exactly once", async () => {
    const r = await rig();
    await createRfi(r.outbox, "Survives");
    // the tab is closed before anything was sent; the engine is gone, the database is not
    const reloaded = r.reload({ newOpId: () => "never-used" });
    expect(await reloaded.pendingCount()).toBe(1);
    await reloaded.refresh();
    expect(reloaded.getState().pending).toBe(1);

    const report = await reloaded.flush();
    expect(report).toMatchObject({ sent: 1, applied: 1, remaining: 0 });
    expect(r.pushes().flat().map((o) => o.op_id)).toEqual(["op-1"]);
    expect(r.server.ledger.size).toBe(1);
    expect((await r.outbox.pendingCount())).toBe(0);
  });

  test("the response is lost AFTER the server applied the op: the op stays, is retried with the SAME op_id, is answered 'duplicate', and exists on the server once", async () => {
    const r = await rig({ seed: seedTask, server: { includeServerOnApplied: true } });
    await editTitle(r.outbox, "Lost answer");
    r.server.loseNextResponses(1);

    const first = await r.outbox.flush();
    expect(first).toMatchObject({ sent: 1, applied: 0, failed: 1, remaining: 1, status: "offline" });
    expect(r.server.ledger.size).toBe(1); // the server DID apply it
    expect(first.nextDueAt).toBe(r.clock.now + 2_000);
    const db = await r.open();
    expect((await db.getOp("op-1"))).toMatchObject({ status: "pending", attempts: 1, lastError: "network" });
    expect((await db.getRecord("tasks", "t1"))!.dirty).toBe("op-1"); // still shown, still protected
    db.close();

    // before the back-off ends: nothing is sent
    expect((await r.outbox.flush()).sent).toBe(0);
    r.clock.now += 2_001;
    const second = await r.outbox.flush();
    expect(second).toMatchObject({ sent: 1, duplicates: 1, applied: 0, remaining: 0 });
    expect(r.pushes().flat().map((o) => o.op_id)).toEqual(["op-1", "op-1"]); // the same id, twice
    expect(r.server.getRow("tasks", "t1")).toMatchObject({ version: 2 }); // applied ONCE
    const db2 = await r.open();
    expect((await db2.getRecord("tasks", "t1"))).toMatchObject({ serverVersion: 2, data: { title: "Lost answer" } });
    expect((await db2.getRecord("tasks", "t1"))!.dirty).toBeUndefined();
    db2.close();
  });

  test("a create whose answer was lost does not make a second row", async () => {
    const r = await rig();
    await createRfi(r.outbox, "Once");
    r.server.loseNextResponses(1);
    await r.outbox.flush();
    r.clock.now += 3_000;
    await r.outbox.flush();
    expect((await r.server.client.ids({ projectId: "p1", kind: "rfis", afterId: null })).ids).toHaveLength(1);
    const db = await r.open();
    expect(await db.listByProject("orgA", "rfis", "p1")).toHaveLength(1);
    expect(await db.getRecord("rfis", "local-1")).toBeUndefined();
    db.close();
  });
});

describe("(v) conflict", () => {
  async function conflicted() {
    const r = await rig({ seed: seedTask });
    await editTitle(r.outbox, "MINE");
    r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "THEIRS", statusId: "s1" } }); // version 2, behind the laptop's back
    r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "THEIRS 2", statusId: "s1" } }); // version 3
    const report = await r.outbox.flush();
    expect(report).toMatchObject({ conflicts: 1, applied: 0, remaining: 1 });
    return r;
  }

  test("a conflict keeps the op and BOTH sides: nothing was written, my row is still shown, and it is not re-sent on its own", async () => {
    const r = await conflicted();
    const conflicts = await r.outbox.getConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ opId: "op-1", functionId: "update_task", record: { kind: "tasks", id: "t1" }, local: { title: "MINE" }, server: { version: 3, data: { title: "THEIRS 2" } } });
    expect(r.outbox.getState().conflicts).toHaveLength(1);
    expect(r.events.some((e) => e.type === "conflict")).toBe(true);
    expect(r.server.getRow("tasks", "t1")!.data.title).toBe("THEIRS 2");
    const db = await r.open();
    const row = (await db.getRecord("tasks", "t1"))!;
    expect(row.data).toMatchObject({ title: "MINE" });
    expect(row.dirty).toBe("op-1");
    expect(row.serverCopy).toMatchObject({ version: 3, data: { title: "THEIRS 2" } });
    db.close();
    const before = r.pushes().length;
    await r.outbox.flush();
    expect(r.pushes().length).toBe(before); // waits for the person
  });

  test("keep_mine resends the SAME op with resolution 'overwrite' and base_version = the server's version, and it applies", async () => {
    const r = await conflicted();
    await r.outbox.resolve("op-1", "keep_mine");
    expect(r.outbox.getState().conflicts).toHaveLength(0);
    const report = await r.outbox.flush();
    expect(report).toMatchObject({ applied: 1, remaining: 0 });
    const resent = r.pushes().at(-1)![0]!;
    expect(resent).toMatchObject({ op_id: "op-1", resolution: "overwrite", record: { base_version: 3 } });
    expect(r.server.getRow("tasks", "t1")).toMatchObject({ version: 4, data: { title: "MINE" } });
    const db = await r.open();
    expect((await db.getRecord("tasks", "t1"))).toMatchObject({ serverVersion: 4, data: { title: "MINE" } });
    expect((await db.getRecord("tasks", "t1"))!.dirty).toBeUndefined();
    db.close();
  });

  test("keep_theirs drops my op, replaces the row with the server's at its version, and nothing more is sent", async () => {
    const r = await conflicted();
    const sentBefore = r.pushes().length;
    await r.outbox.resolve("op-1", "keep_theirs");
    expect(await r.outbox.pendingCount()).toBe(0);
    expect(r.outbox.getState().conflicts).toHaveLength(0);
    const db = await r.open();
    const row = (await db.getRecord("tasks", "t1"))!;
    expect(row.data).toMatchObject({ title: "THEIRS 2" });
    expect(row.serverVersion).toBe(3);
    expect(row.dirty).toBeUndefined();
    expect(typeof row.sig).toBe("string");
    db.close();
    await r.outbox.flush();
    expect(r.pushes().length).toBe(sentBefore);
    expect(r.server.getRow("tasks", "t1")!.data.title).toBe("THEIRS 2"); // mine never reached the server
  });

  test("a conflict survives a reload: the new engine still shows both sides and can settle it", async () => {
    const r = await conflicted();
    const again = r.reload();
    const conflicts = await again.getConflicts();
    expect(conflicts[0]).toMatchObject({ opId: "op-1", local: { title: "MINE" }, server: { version: 3 } });
    await again.resolve("op-1", "keep_theirs");
    expect(await again.pendingCount()).toBe(0);
  });

  test("settling something that is not a conflict is refused", async () => {
    const r = await rig({ seed: seedTask });
    await editTitle(r.outbox, "x");
    await expect(r.outbox.resolve("op-1", "keep_mine")).rejects.toThrow(/no conflict/);
    await expect(r.outbox.resolve("nope", "keep_theirs")).rejects.toThrow(/no conflict/);
  });
});

describe("(vi) rejected: the optimistic change is undone, in words", () => {
  test("an update the server refuses is dropped, the row goes back to the server's last copy, and a notice says why", async () => {
    const r = await rig({ seed: seedTask });
    await r.outbox.enqueue({
      functionId: "update_task", projectId: "p1", params: { issueId: "t1", title: "  " }, label: "Your task change",
      record: { kind: "tasks", id: "t1", baseVersion: 1 }, optimistic: patchRow("tasks", "t1", { title: "  " }),
    });
    const report = await r.outbox.flush();
    expect(report).toMatchObject({ rejected: 1, remaining: 0 });

    const db = await r.open();
    const row = (await db.getRecord("tasks", "t1"))!;
    expect(row.data).toMatchObject({ title: "Old" });
    expect(row.serverVersion).toBe(1);
    expect(row.dirty).toBeUndefined();
    expect(row.serverCopy).toBeUndefined();
    expect(typeof row.sig).toBe("string"); // the server's own signed row is back
    expect(await db.listOps()).toEqual([]);
    db.close();

    const notice = r.outbox.getState().notices[0]!;
    expect(notice).toMatchObject({ opId: "op-1", functionId: "update_task" });
    expect(notice.message).toBe("Your task change was not saved. Type a title. It was undone on this laptop.");
    expect(notice.message).not.toMatch(/update_task|TITLE_REQUIRED|issueId/); // no ids, codes or parameter names
    const event = r.events.find((e) => e.type === "rejected");
    expect(event).toMatchObject({ type: "rejected", opId: "op-1", message: notice.message });
  });

  test("a create the server refuses removes the temporary row", async () => {
    const r = await rig();
    await r.outbox.enqueue({
      functionId: "create_rfi", projectId: "p1", params: { projectId: "p1", subject: "", question: "" }, label: "New RFI",
      creates: { kind: "rfis", id: "local-9" },
      optimistic: async (tx) => { await tx.putRecord({ id: "rfis:local-9", type: "rfis", orgId: "orgA", projectId: "p1", data: { id: "local-9", subject: "" } }); },
    });
    await r.outbox.flush();
    const db = await r.open();
    expect(await db.getRecord("rfis", "local-9")).toBeUndefined();
    expect(await db.listOps()).toEqual([]);
    db.close();
    expect(r.outbox.getState().notices[0]!.message).toContain("New RFI was not saved.");
  });

  test("a function the server does not know is rejected with the dictionary's sentence", async () => {
    const r = await rig();
    await r.outbox.enqueue({ functionId: "do_the_impossible", projectId: "p1", params: {}, label: "That change" });
    await r.outbox.flush();
    expect(r.outbox.getState().notices[0]!.message).toBe("That change was not saved. PROJEXA can't do that from the composer yet. It was undone on this laptop.");
  });

  test("a notice stays until dismissed, and survives a reload", async () => {
    const r = await rig();
    await r.outbox.enqueue({ functionId: "do_the_impossible", projectId: "p1", params: {} });
    await r.outbox.flush();
    const again = r.reload();
    await again.refresh();
    expect(again.getState().notices).toHaveLength(1);
    await again.dismissNotice("op-1");
    expect(again.getState().notices).toHaveLength(0);
    const third = r.reload();
    await third.refresh();
    expect(third.getState().notices).toHaveLength(0);
  });

  test("rejectionMessage never leaks a code a person cannot read (an unknown code with an unsafe message falls back to words)", () => {
    expect(rejectionMessage({ functionId: "f", label: "Edit" }, { code: "WEIRD_NEW_CODE", message: "failed at 10.0.0.1:5432 for itemCode" })).toBe("Edit was not saved. That didn't run. Nothing was saved. It was undone on this laptop.");
    expect(rejectionMessage({ functionId: "f" }, { code: "WEIRD_NEW_CODE", message: "Your account is read-only" })).toBe("A change you made on this laptop was not saved. Your account is read-only. It was undone on this laptop.");
    expect(rejectionMessage({ functionId: "f" }, null)).toContain("The server did not accept it.");
  });
});

describe("failed: kept and retried with the same op_id, with exponential back-off", () => {
  test("a transient failure keeps the op; it is not sent again before its time, then goes out with the SAME id", async () => {
    const r = await rig();
    let attempt = 0;
    r.server.registerFunction("flaky", () => (++attempt < 3 ? { failed: "EXECUTION_UNCERTAIN" } : { ok: true, kind: "rfis", id: "srv-ok", data: { id: "srv-ok", subject: "done" } }));
    await r.outbox.enqueue({ functionId: "flaky", projectId: "p1", params: {} });

    const t0 = r.clock.now;
    const first = await r.outbox.flush();
    expect(first).toMatchObject({ failed: 1, remaining: 1, nextDueAt: t0 + 2_000 });
    expect((await r.outbox.flush()).sent).toBe(0); // too early

    r.clock.now = t0 + 2_000;
    const second = await r.outbox.flush();
    expect(second).toMatchObject({ failed: 1, nextDueAt: t0 + 2_000 + 4_000 }); // doubled
    r.clock.now = t0 + 6_000;
    const third = await r.outbox.flush();
    expect(third).toMatchObject({ applied: 1, remaining: 0 });
    expect(r.pushes().flat().map((o) => o.op_id)).toEqual(["op-1", "op-1", "op-1"]);
  });

  test("the back-off doubles up to its ceiling", async () => {
    const r = await rig({ outbox: { backoffBaseMs: 1_000, backoffMaxMs: 5_000 } });
    r.server.registerFunction("always_fails", () => ({ failed: "EXECUTION_UNCERTAIN" }));
    await r.outbox.enqueue({ functionId: "always_fails", projectId: "p1", params: {} });
    const waits: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const rep = await r.outbox.flush();
      waits.push(rep.nextDueAt! - r.clock.now);
      r.clock.now = rep.nextDueAt!;
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 5_000, 5_000]);
  });

  test("a request that never got an answer (the service is down) keeps every op, reports 'offline', and says when to try again", async () => {
    const r = await rig();
    await createRfi(r.outbox, "A", "local-a");
    await createRfi(r.outbox, "B", "local-b");
    r.server.failNext({ status: 503, path: "/push" });
    const report = await r.outbox.flush();
    expect(report).toMatchObject({ failed: 2, remaining: 2, status: "offline", nextDueAt: r.clock.now + 2_000 });
    expect(r.outbox.getState()).toMatchObject({ pending: 2, retrying: 2, status: "offline" });
    r.clock.now += 2_001;
    expect(await r.outbox.flush()).toMatchObject({ applied: 2, remaining: 0, status: "idle" });
  });

  test("an answer that leaves an op out is an unknown outcome: the op is kept and retried, never assumed done", async () => {
    const r = await rig();
    await createRfi(r.outbox, "A");
    const silent: SyncClient = { ...r.server.client, push: async () => ({ results: [] }) };
    const outbox = createOutbox({ userId: "u1", client: silent, deviceId: "d", idb: r.idb, now: () => r.clock.now, autoFlush: false, locks: null });
    const report = await outbox.flush();
    expect(report).toMatchObject({ failed: 1, remaining: 1 });
  });
});

describe("needs_server", () => {
  test("the op is kept, not retried on its own, listed by getBlocked(), and can be given up (undoing its effect)", async () => {
    const r = await rig();
    r.server.registerFunction("edge_only", () => ({ needsServer: true }));
    await r.outbox.enqueue({
      functionId: "edge_only", projectId: "p1", params: {}, label: "Heavy report",
      creates: { kind: "rfis", id: "local-e" },
      optimistic: async (tx) => { await tx.putRecord({ id: "rfis:local-e", type: "rfis", orgId: "orgA", projectId: "p1", data: { id: "local-e" } }); },
    });
    const report = await r.outbox.flush();
    expect(report).toMatchObject({ blocked: 1, remaining: 1 });
    const blocked = await r.outbox.getBlocked();
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ opId: "op-1", functionId: "edge_only" });
    expect(blocked[0]!.message).toContain("Heavy report");
    expect(r.events.some((e) => e.type === "blocked")).toBe(true);

    const sent = r.pushes().length;
    await r.outbox.flush();
    expect(r.pushes().length).toBe(sent); // not retried by itself

    await r.outbox.discard("op-1");
    expect(await r.outbox.pendingCount()).toBe(0);
    const db = await r.open();
    expect(await db.getRecord("rfis", "local-e")).toBeUndefined();
    db.close();
    await expect(r.outbox.discard("op-1")).rejects.toThrow();
  });
});

describe("guards", () => {
  test("an op whose project the manifest no longer lists is NEVER sent: it is dropped as rejected, in words, and undone", async () => {
    const r = await rig({ server: { projects: ["p1", "p2"] } });
    await r.outbox.enqueue({
      functionId: "create_rfi", projectId: "p2", params: { projectId: "p2", subject: "S", question: "Q" }, label: "New RFI",
      creates: { kind: "rfis", id: "local-p2" },
      optimistic: async (tx) => { await tx.putRecord({ id: "rfis:local-p2", type: "rfis", orgId: "orgA", projectId: "p2", data: { id: "local-p2" } }); },
    });
    // the person loses project p2; the next sync records the new list
    r.server.projects = ["p1"];
    await r.syncReplica();

    const report = await r.outbox.flush();
    expect(report).toMatchObject({ sent: 0, rejected: 1, remaining: 0 });
    expect(r.pushes()).toEqual([]);
    const db = await r.open();
    expect(await db.getRecord("rfis", "local-p2")).toBeUndefined();
    db.close();
    expect(r.outbox.getState().notices[0]!.message).toBe("New RFI was not saved: you no longer have access to that project. It was undone on this laptop.");
  });

  test("(ix) a row the server hands back that names another organisation is refused: the op is kept for a retry and nothing local changes", async () => {
    const r = await rig({ seed: seedTask });
    await editTitle(r.outbox, "Mine");
    const lying: SyncClient = {
      ...r.server.client,
      push: async (req, signal) => {
        const res = await r.server.client.push(req, signal);
        return { results: res.results.map((x) => (x.server ? { ...x, server: { ...x.server, data: { ...(x.server.data as object), org_id: "orgB" } } } : x)) };
      },
    };
    r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs", statusId: "s1" } }); // makes the answer a conflict WITH a server row
    const outbox = createOutbox({ userId: "u1", client: lying, deviceId: "d", idb: r.idb, now: () => r.clock.now, autoFlush: false, locks: null, newOpId: () => "x" });
    const report = await outbox.flush();
    expect(report).toMatchObject({ failed: 1, conflicts: 0, remaining: 1 });
    const db = await r.open();
    const row = (await db.getRecord("tasks", "t1"))!;
    expect(row.data).toMatchObject({ title: "Mine" });
    expect(row.serverCopy).toMatchObject({ version: 1 }); // the foreign row was not parked either
    expect((await db.getOp("op-1"))).toMatchObject({ status: "pending", lastError: "FOREIGN_ORGANISATION" });
    db.close();
  });

  test("(vii) 426 pauses sending: ops are kept, nothing more is sent, 'update_required' is announced, and resume() sends again", async () => {
    const r = await rig();
    await createRfi(r.outbox, "Waits");
    r.server.requireUpdate({ current: "2026.10.09-1", minCompatible: "2026.10.05-1" });
    const report = await r.outbox.flush();
    expect(report).toMatchObject({ status: "update_required", applied: 0, sent: 0, remaining: 1 });
    expect(r.outbox.getState()).toMatchObject({ status: "update_required", pending: 1, updateRequired: { current: "2026.10.09-1", minCompatible: "2026.10.05-1" } });
    expect(r.events.find((e) => e.type === "update_required")).toMatchObject({ update: { minCompatible: "2026.10.05-1" } });

    const calls = r.server.requests.length;
    expect((await r.outbox.flush()).skipped).toBe("paused");
    expect(r.server.requests.length).toBe(calls);
    expect(await r.outbox.pendingCount()).toBe(1);

    r.server.requireUpdate(null);
    r.outbox.resume();
    expect(r.outbox.getState().status).toBe("idle");
    expect(await r.outbox.flush()).toMatchObject({ applied: 1, remaining: 0 });
  });

  test("a 401 stops the pass and keeps everything", async () => {
    const r = await rig();
    await createRfi(r.outbox, "Waits");
    r.server.signedOut = true;
    const report = await r.outbox.flush();
    expect(report).toMatchObject({ applied: 0, status: "signed_out" });
    expect(r.events.some((e) => e.type === "signed_out")).toBe(true);
    expect(await r.outbox.pendingCount()).toBe(1);
    r.server.signedOut = false;
    expect(await r.outbox.flush()).toMatchObject({ applied: 1 });
  });
});

describe("one flusher at a time", () => {
  const fakeLocks = (grant: boolean) => {
    const asked: { name: string; ifAvailable: boolean | undefined }[] = [];
    const locks = { request: async (name: string, options: { ifAvailable?: boolean }, cb: (lock: unknown) => Promise<unknown>) => { asked.push({ name, ifAvailable: options.ifAvailable }); return cb(grant ? { name } : null); } } as unknown as LockManager;
    return { asked, locks };
  };

  test("a flush takes the per-person lock; when another tab holds it, this one does nothing and says 'busy'", async () => {
    const held = fakeLocks(false);
    const r = await rig({ outbox: { locks: held.locks } });
    await createRfi(r.outbox, "A");
    expect(await r.outbox.flush()).toMatchObject({ skipped: "busy", sent: 0 });
    expect(held.asked).toEqual([{ name: "px-outbox:u1", ifAvailable: true }]);
    expect(r.pushes()).toEqual([]);

    const free = fakeLocks(true);
    const other = r.reload({ locks: free.locks });
    expect(await other.flush()).toMatchObject({ applied: 1 });
    expect(free.asked[0]!.name).toBe("px-outbox:u1");
  });

  test("without navigator.locks there is still only one flusher in a tab: simultaneous flush() calls share ONE pass", async () => {
    const r = await rig();
    await createRfi(r.outbox, "A");
    const [a, b, c] = await Promise.all([r.outbox.flush(), r.outbox.flush(), r.outbox.flush()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(r.pushes().flat().map((o) => o.op_id)).toEqual(["op-1"]);
  });

  test("an edit made while a pass is already running is picked up before that pass ends", async () => {
    const r = await rig();
    await createRfi(r.outbox, "First", "local-first");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let first = true;
    const slow: SyncClient = {
      ...r.server.client,
      push: async (req, signal) => {
        if (first) { first = false; await gate; }
        return r.server.client.push(req, signal);
      },
    };
    const outbox = createOutbox({ userId: "u1", client: slow, deviceId: "d", idb: r.idb, now: () => r.clock.now, autoFlush: false, locks: null, newOpId: (() => { let k = 0; return () => `s-${++k}`; })() });
    const running = outbox.flush();
    await new Promise((resolve) => setTimeout(resolve, 20)); // the first push is now in flight
    await createRfi(outbox, "Second", "local-second");
    const joined = outbox.flush(); // asks while running
    release();
    const report = await Promise.all([running, joined]).then(([a]) => a);
    expect(report.applied).toBe(2);
    expect(await outbox.pendingCount()).toBe(0);
  });
});

describe("a flush asked for while another is ending", () => {
  test("is not lost: it joined a pass that had already finished looking, so the outbox goes round again", async () => {
    // A lock manager that keeps the lock for a moment AFTER the pass body is done (the window the pass cannot see into).
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const locks = { request: async (_name: string, _o: unknown, cb: (lock: unknown) => Promise<unknown>) => { const out = await cb({ name: "x" }); await gate; return out; } } as unknown as LockManager;
    const r = await rig({ outbox: { locks } });
    await createRfi(r.outbox, "A", "local-a");
    const first = r.outbox.flush();
    for (let i = 0; i < 100 && (await r.outbox.pendingCount()) > 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5)); // A is applied; the pass body is over
    expect(r.pushes().flat().map((o) => o.op_id)).toEqual(["op-1"]);

    await createRfi(r.outbox, "B", "local-b"); // made after the last look...
    const joined = r.outbox.flush(); // ...and asked for while the first flush is still holding the lock
    release();
    await Promise.all([first, joined]);
    for (let i = 0; i < 100 && (await r.outbox.pendingCount()) > 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await r.outbox.pendingCount()).toBe(0);
    expect(r.pushes().flat().map((o) => o.op_id)).toEqual(["op-1", "op-2"]);
  });
});

describe("scheduling", () => {
  test("with auto-flush on, an enqueue schedules a flush at once, and a failed op schedules its retry for when it is due", async () => {
    const waits: number[] = [];
    let wake!: () => void;
    const r = await rig({ outbox: { autoFlush: true, sleep: (ms) => { waits.push(ms); return new Promise<void>((resolve) => { wake = resolve; }); } } });
    r.server.registerFunction("flaky", () => ({ failed: "EXECUTION_UNCERTAIN" }));
    await r.outbox.enqueue({ functionId: "flaky", projectId: "p1", params: {} });
    expect(waits).toEqual([0]); // asked to flush now
    wake();
    await new Promise((resolve) => setTimeout(resolve, 50)); // the scheduled flush ran and failed
    expect(waits).toEqual([0, 2_000]); // ... and scheduled its own retry for the back-off
    expect(r.pushes()).toHaveLength(1);
  });

  test("dispose stops anything scheduled", async () => {
    let wake!: () => void;
    const r = await rig({ outbox: { autoFlush: true, sleep: () => new Promise<void>((resolve) => { wake = resolve; }) } });
    await createRfi(r.outbox, "A");
    r.outbox.dispose();
    wake();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(r.pushes()).toEqual([]);
  });
});

describe("state for the screens", () => {
  test("subscribers hear every change, and pending/retrying/conflicts follow the database", async () => {
    const r = await rig({ seed: seedTask });
    const seen: number[] = [];
    r.outbox.subscribe((e) => { if (e.type === "changed") seen.push(r.outbox.getState().pending); });
    await editTitle(r.outbox, "a");
    await createRfi(r.outbox, "b");
    expect(r.outbox.getState()).toMatchObject({ pending: 2, retrying: 0, conflicts: [], blocked: [], notices: [], status: "idle" });
    await r.outbox.flush();
    expect(r.outbox.getState().pending).toBe(0);
    expect(seen).toContain(1);
    expect(seen).toContain(2);
    expect(seen.at(-1)).toBe(0);
  });

  test("unsubscribe stops notifications", async () => {
    const r = await rig();
    let heard = 0;
    const off = r.outbox.subscribe(() => { heard += 1; });
    await createRfi(r.outbox, "a", "local-a");
    const afterFirst = heard;
    off();
    await createRfi(r.outbox, "b", "local-b");
    expect(heard).toBe(afterFirst);
  });
});
