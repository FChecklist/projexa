import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "./__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb, type LocalTx } from "./local-db";
import { createOutbox, type Outbox, type OutboxOptions } from "./outbox";
import { createReplica } from "./replica";
import type { PushResult, SyncClient } from "./sync-client";

// AUDIT-100 (outbox single send). A CI run of e2e/lf-documents-conflict.spec.ts case 3 once saw laptop B's money edit reach the sync
// service TWICE (["conflict", "conflict"]) after the network came back. This file pins the client half of "sent exactly once":
//
//   1. IN ONE TAB, every trigger that asks for a flush -- the browser `online` event (outbox-shared.ts, connectivityBack), the shell's
//      online/focus nudge (shell-outbox.ts), the outbox's own scheduled retry (autoFlush + the injected clock), an edit made mid-pass --
//      fired in seeded-random orders and tick spacings while the FIRST push is slow, sends each op_id exactly once. The guard is
//      outbox.ts flush(): `if (flushing) { rerun = true; return flushing; }` (one pass in flight per engine, set synchronously).
//   2. ACROSS TABS (two engines over one IndexedDB), the same, with a lock manager that has navigator.locks' real `ifAvailable`
//      semantics. The guard is outbox.ts withFlushLock(): `locks.request("px-outbox:<user>", { ifAvailable: true }, ...)` + `if (!lock) return`.
//   3. A money conflict met under those triggers goes to the card ONCE and is never merged and re-sent.
//   4. What the CI run actually saw: the page was NAVIGATED away (the spec's openLocal right after online) while the push was in flight;
//      the server had answered, the page never settled the answer, and the next page re-sent the SAME op_id. That is the outbox's
//      designed at-least-once delivery (outbox.ts header, "a tab that is closed mid-send"), made safe by the server's per-op_id ledger
//      (compliance-tracker drizzle/0681: applied -> `duplicate`, a conflict writes nothing). The last test pins that: same op_id, the
//      server's row changed once or not at all.

// ─── a seeded RNG and a fake clock ─────────────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeClock() {
  const clock = { now: 1_800_000_000_000 };
  const timers: { at: number; resolve: () => void }[] = [];
  return {
    clock,
    now: () => clock.now,
    sleep: (ms: number) => new Promise<void>((resolve) => { timers.push({ at: clock.now + ms, resolve }); }),
    /** Moves the clock and fires every timer now due (an interval tick). */
    advance(ms: number) {
      clock.now += ms;
      for (let i = timers.length - 1; i >= 0; i -= 1) {
        if (timers[i]!.at <= clock.now) { timers[i]!.resolve(); timers.splice(i, 1); }
      }
    },
  };
}

/** navigator.locks' exclusive `ifAvailable` behaviour, in memory: a held name hands the callback `null` at once. */
function fakeLockManager() {
  const held = new Set<string>();
  const locks = {
    request: async (name: string, options: { ifAvailable?: boolean }, cb: (lock: unknown) => Promise<unknown>) => {
      if (held.has(name)) {
        if (options.ifAvailable) return cb(null);
        throw new Error("this fake only models ifAvailable requests");
      }
      held.add(name);
      try { return await cb({ name, mode: "exclusive" }); } finally { held.delete(name); }
    },
  };
  return locks as unknown as LockManager;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ─── the rig ───────────────────────────────────────────────────────────────────────────────────────

type Sent = { op_id: string; base_version: number | null };

async function rig(seedServer?: (s: FakeSyncServer) => void) {
  const idb = new IDBFactory();
  const server = createFakeSyncServer({ includeServerOnApplied: true });
  seedServer?.(server);
  const time = fakeClock();
  const sent: Sent[] = [];
  /** The first push waits here until released (the slow first answer). */
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let pushes = 0;
  /** Extra macrotask ticks each later answer takes (seeded per scenario). */
  let laterDelay = () => 0;
  const client: Pick<SyncClient, "push" | "pullIds"> = {
    pullIds: (req, signal) => server.client.pullIds(req, signal),
    push: async (req, signal) => {
      for (const op of req.ops) sent.push({ op_id: op.op_id, base_version: (op as { record?: { base_version: number } }).record?.base_version ?? null });
      pushes += 1;
      if (pushes === 1) await firstGate;
      else for (let i = laterDelay(); i > 0; i -= 1) await tick();
      return server.client.push(req, signal);
    },
  };
  let n = 0;
  const make = (extra: Partial<OutboxOptions> = {}) =>
    createOutbox({
      userId: "u1", client: client as SyncClient, deviceId: "dev-1", idb, now: time.now, sleep: time.sleep,
      newOpId: () => `op-${++n}`, locks: null, backoffBaseMs: 1_000, ...extra,
    });
  await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  return {
    idb, server, time, sent, make, releaseFirst,
    setLaterDelay(fn: () => number) { laterDelay = fn; },
    open: () => openLocalDb(idb, localDbNameFor("u1")),
  };
}

const patchRow = (kind: string, id: string, patch: Record<string, unknown>) => async (tx: LocalTx) => {
  const row = (await tx.getRecord(kind, id))!;
  await tx.patchRecord(kind, id, { data: { ...(row.data as object), ...patch } });
};

const editTask = (o: Outbox, id: string, patch: Record<string, unknown>, baseVersion = 1) =>
  o.enqueue({
    functionId: "update_task", projectId: "p1", params: { issueId: id, ...patch }, label: "Task change",
    record: { kind: "tasks", id, baseVersion }, optimistic: patchRow("tasks", id, patch),
  });

const createRfi = (o: Outbox, subject: string, tempId: string) =>
  o.enqueue({
    functionId: "create_rfi", projectId: "p1", params: { projectId: "p1", subject, question: "Q?" }, label: "New RFI",
    creates: { kind: "rfis", id: tempId },
    optimistic: async (tx) => { await tx.putRecord({ id: `rfis:${tempId}`, type: "rfis", orgId: "orgA", projectId: "p1", data: { id: tempId, subject, status: "open" } }); },
  });

const seedTasks = (s: FakeSyncServer) => {
  s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old 1", statusId: "s1" } });
  s.upsert({ kind: "tasks", projectId: "p1", id: "t2", data: { title: "Old 2", statusId: "s1" } });
};

/** How often each op_id reached the push endpoint. */
const countsOf = (sent: Sent[]) => {
  const out: Record<string, number> = {};
  for (const s of sent) out[s.op_id] = (out[s.op_id] ?? 0) + 1;
  return out;
};

type Trigger = "online" | "nudge" | "focus" | "interval" | "edit" | "release" | "microtask" | "macrotask";
const TRIGGERS: Trigger[] = ["online", "nudge", "focus", "interval", "edit", "release", "microtask", "macrotask"];

/**
 * Fires a seeded-random storm of flush triggers at `engines` (one per tab) while the first push is held, then lets everything settle.
 * Returns the op ids the scenario created.
 */
async function storm(r: Awaited<ReturnType<typeof rig>>, engines: Outbox[], seed: number, opts: { edits: boolean }) {
  const rand = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  r.setLaterDelay(() => Math.floor(rand() * 3));
  const inflight: Promise<unknown>[] = [];
  const created: string[] = [];
  let released = false;
  let made = 0;
  const steps = 6 + Math.floor(rand() * 10);
  for (let i = 0; i < steps; i += 1) {
    const which = pick(TRIGGERS);
    const tab = pick(engines);
    switch (which) {
      case "online": inflight.push(tab.flush({ connectivityBack: true })); break; // outbox-shared.ts window `online`
      case "nudge": inflight.push(tab.flush()); break; // shell-outbox.ts nudge() on `online`
      case "focus": inflight.push(tab.flush()); break; // shell-outbox.ts nudge() on visibility/focus
      case "interval": r.time.advance(30_000); break; // the outbox's own scheduled flush (autoFlush) comes due
      case "edit":
        if (opts.edits && made < 2) { made += 1; created.push((await createRfi(tab, `Mid-pass ${made}`, `local-mid-${seed}-${made}`)).opId); }
        break;
      case "release": if (!released) { released = true; r.releaseFirst(); } break;
      case "microtask": await Promise.resolve(); break;
      case "macrotask": await tick(); break;
    }
    // the triggers of one step land in the same tick or a few ticks apart
    for (let k = Math.floor(rand() * 3); k > 0; k -= 1) await (rand() < 0.5 ? Promise.resolve() : tick());
  }
  r.releaseFirst();
  await Promise.all(inflight);
  // let the rerun/scheduled passes finish, then make sure everything that waits is delivered (liveness, not only safety)
  let quiet = 0;
  for (let i = 0; i < 50 && quiet < 3; i += 1) {
    const before = r.sent.length;
    r.time.advance(60_000);
    await Promise.all(engines.map((e) => e.flush()));
    await tick();
    if ((await engines[0]!.pendingCount()) === 0) break;
    quiet = r.sent.length === before ? quiet + 1 : 0; // what is left waits for the person (a conflict card): nothing more goes out
  }
  return created;
}

// ─── 1 + 2: every op_id exactly once, under 50 seeded interleavings ─────────────────────────────────

describe("an op is sent exactly once, whatever asks for the flush and in whatever order", () => {
  test("ONE tab (no navigator.locks, the in-process single flusher): 50 seeded orderings of online / nudge / focus / interval / mid-pass edits with a slow first push", async () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const r = await rig(seedTasks);
      const tab = r.make();
      const base = [
        (await editTask(tab, "t1", { title: "Mine 1" })).opId,
        (await editTask(tab, "t2", { title: "Mine 2" })).opId,
        (await createRfi(tab, "Offline RFI", `local-${seed}`)).opId,
      ];
      const mid = await storm(r, [tab], seed, { edits: true });
      const all = [...base, ...mid];
      expect({ seed, counts: countsOf(r.sent) }).toEqual({ seed, counts: Object.fromEntries(all.map((id) => [id, 1])) });
      expect({ seed, pending: await tab.pendingCount() }).toEqual({ seed, pending: 0 });
      expect(r.server.getRow("tasks", "t1")).toMatchObject({ version: 2, data: { title: "Mine 1" } });
      expect(r.server.getRow("tasks", "t2")).toMatchObject({ version: 2, data: { title: "Mine 2" } });
      expect(r.server.ledger.size).toBe(all.length);
      tab.dispose();
    }
  }, 60_000);

  test("TWO tabs over one IndexedDB (navigator.locks with ifAvailable): 50 seeded orderings, each op_id still sent once", async () => {
    for (let seed = 101; seed <= 150; seed += 1) {
      const r = await rig(seedTasks);
      const locks = fakeLockManager();
      const tabA = r.make({ locks });
      const tabB = r.make({ locks });
      const base = [
        (await editTask(tabA, "t1", { title: "Mine 1" })).opId,
        (await editTask(tabB, "t2", { title: "Mine 2" })).opId,
        (await createRfi(tabA, "Offline RFI", `local-${seed}`)).opId,
      ];
      const mid = await storm(r, [tabA, tabB], seed, { edits: true });
      const all = [...base, ...mid];
      expect({ seed, counts: countsOf(r.sent) }).toEqual({ seed, counts: Object.fromEntries(all.map((id) => [id, 1])) });
      expect({ seed, pending: await tabA.pendingCount() }).toEqual({ seed, pending: 0 });
      expect(r.server.ledger.size).toBe(all.length);
      tabA.dispose();
      tabB.dispose();
    }
  }, 60_000);
});

// ─── 3: the money conflict of lf-documents-conflict case 3 ──────────────────────────────────────────

describe("a money conflict under the same storm", () => {
  test("is sent ONCE, goes to the card, is never merged and re-sent, and the server's figure stands (50 seeded orderings, one and two tabs)", async () => {
    for (let seed = 201; seed <= 250; seed += 1) {
      const r = await rig((s) => s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old", amount: 100 } }));
      r.server.registerFunction("update_task", ({ params, target }) => ({ ok: true, kind: "tasks", id: target!.id, data: { ...target!.data, ...params } }));
      const locks = seed % 2 === 0 ? fakeLockManager() : null;
      const engines = locks ? [r.make({ locks }), r.make({ locks })] : [r.make()];
      const { opId } = await engines[0]!.enqueue({
        functionId: "update_task", projectId: "p1", params: { issueId: "t1", title: "Mine", amount: 250 }, label: "Cost change",
        record: { kind: "tasks", id: "t1", baseVersion: 1 }, optimistic: patchRow("tasks", "t1", { title: "Mine", amount: 250 }),
      });
      // someone else changed the row (and its money) while this laptop was offline: version 2
      r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs", amount: 200 } });
      await storm(r, engines, seed, { edits: false });
      expect({ seed, sent: r.sent }).toEqual({ seed, sent: [{ op_id: opId, base_version: 1 }] });
      expect(r.server.getRow("tasks", "t1")).toMatchObject({ version: 2, data: { title: "Theirs", amount: 200 } });
      const db = await r.open();
      expect(await db.getOp(opId)).toMatchObject({ status: "conflict" });
      db.close();
      expect((await engines[0]!.refresh()).conflicts).toHaveLength(1);
      for (const e of engines) e.dispose();
    }
  }, 60_000);
});

// ─── 4: what the CI run saw -- the page went away with the push in flight ───────────────────────────

describe("the page is navigated away while its push is in flight", () => {
  async function abandoned(seedServer: (s: FakeSyncServer) => void, edit: (o: Outbox) => Promise<{ opId: string }>, after?: (r: Awaited<ReturnType<typeof rig>>) => void) {
    const r = await rig(seedServer);
    const sent: Sent[] = [];
    let unloaded = false;
    // the server receives and answers, but the old page is gone before the answer is settled (the fetch is cancelled by the navigation)
    const pageClient: Pick<SyncClient, "push" | "pullIds"> = {
      pullIds: (req, signal) => r.server.client.pullIds(req, signal),
      push: async (req, signal) => {
        for (const op of req.ops) sent.push({ op_id: op.op_id, base_version: (op as { record?: { base_version: number } }).record?.base_version ?? null });
        const answer = await r.server.client.push(req, signal);
        if (unloaded) return answer;
        unloaded = true;
        return new Promise<{ results: PushResult[] }>(() => {}); // never settles on the old page
      },
    };
    const oldPage = r.make({ client: pageClient as SyncClient, autoFlush: false });
    const { opId } = await edit(oldPage);
    after?.(r);
    void oldPage.flush({ connectivityBack: true });
    for (let i = 0; i < 100 && !unloaded; i += 1) await tick();
    expect(unloaded).toBe(true);
    oldPage.dispose();
    // the new page (same IndexedDB) resumes what waits, as outbox-shared.ts does on creation: refresh, then flush
    const newPage = r.make({ client: pageClient as SyncClient, autoFlush: false });
    await newPage.refresh();
    const report = await newPage.flush();
    return { r, sent, opId, report, newPage };
  }

  test("an applied edit is re-sent with the SAME op_id, the server answers 'duplicate', and the row changed ONCE", async () => {
    const { r, sent, opId, report } = await abandoned(seedTasks, (o) => editTask(o, "t1", { title: "Mine" }));
    expect(sent).toEqual([{ op_id: opId, base_version: 1 }, { op_id: opId, base_version: 1 }]);
    expect(report).toMatchObject({ duplicates: 1, applied: 0, remaining: 0 });
    expect(r.server.getRow("tasks", "t1")).toMatchObject({ version: 2, data: { title: "Mine" } });
    expect(r.server.ledger.size).toBe(1);
  });

  test("a money conflict is re-sent with the SAME op_id and base version, the server writes nothing, and it lands on the card (the CI symptom, harmless)", async () => {
    const { r, sent, opId, report } = await abandoned(
      (s) => s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old", amount: 100 } }),
      (o) => o.enqueue({
        functionId: "update_task", projectId: "p1", params: { issueId: "t1", amount: 250 }, label: "Cost change",
        record: { kind: "tasks", id: "t1", baseVersion: 1 }, optimistic: patchRow("tasks", "t1", { amount: 250 }),
      }),
      (r) => {
        r.server.registerFunction("update_task", ({ params, target }) => ({ ok: true, kind: "tasks", id: target!.id, data: { ...target!.data, ...params } }));
        r.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old", amount: 200 } });
      },
    );
    expect(sent).toEqual([{ op_id: opId, base_version: 1 }, { op_id: opId, base_version: 1 }]); // ["conflict", "conflict"], same op
    expect(report).toMatchObject({ conflicts: 1, merged: 0, applied: 0 });
    expect(r.server.getRow("tasks", "t1")).toMatchObject({ version: 2, data: { amount: 200 } });
    expect(r.server.ledger.size).toBe(0);
  });
});
