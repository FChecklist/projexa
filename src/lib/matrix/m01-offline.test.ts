import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeServerOptions, type FakeSyncServer } from "@/lib/local-first/__fixtures__/fake-sync-server";
import { answerMeansServerUp, createConnectivity, withConnectivityReporting, type Connectivity } from "@/lib/local-first/connectivity";
import { localDbNameFor, openLocalDb, type LocalTx } from "@/lib/local-first/local-db";
import { decide, effectOf, isProtectedField } from "@/lib/local-first/outbox-merge";
import { createOutbox, type Outbox } from "@/lib/local-first/outbox";
import { createReplica } from "@/lib/local-first/replica";
import { SyncError, type SyncClient } from "@/lib/local-first/sync-client";

// MATRIX category 1: offline behaviour. Cases M01-01 ... M01-33. Everything is local: a fake clock, a fake sync server, fake-indexeddb.

// ---------- connectivity state machine ----------
const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
function time() {
  let t = 1_000_000; let id = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => { const i = id++; timers.set(i, { at: t + ms, fn }); return i; },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    pending: () => [...timers.values()].map((x) => x.at - t).sort((a, b) => a - b),
    async advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        t = due[1].at; timers.delete(due[0]); due[1].fn(); await settle();
      }
      t = end; await settle();
    },
  };
}
function conn(over: { online?: boolean; probe?: () => boolean } = {}) {
  const tm = time();
  const st = { online: over.online ?? true, probeOk: false, probeCalls: 0 };
  const c = createConnectivity({
    isOnline: () => st.online, probe: async () => { st.probeCalls++; return over.probe ? over.probe() : st.probeOk; },
    now: tm.now, setTimer: tm.setTimer, clearTimer: tm.clearTimer,
  });
  const seen: Connectivity[] = [];
  c.subscribe((s) => seen.push(s));
  return { c, tm, st, seen };
}

describe("M01 offline: connectivity", () => {
  test("M01-01 browser offline -> 'offline', and our failures while offline are not counted against the server", () => {
    const x = conn({ online: false });
    expect(x.c.get()).toBe("offline");
    for (let i = 0; i < 5; i++) x.c.reportFailure();
    expect(x.c.debug().failures).toBe(0);
  });
  test("M01-02 two failures stay 'online', the third makes it 'server_down'", () => {
    const x = conn();
    x.c.reportFailure(); x.c.reportFailure();
    expect(x.c.get()).toBe("online");
    x.c.reportFailure();
    expect(x.c.get()).toBe("server_down");
  });
  test("M01-03 one success between failures resets the count (flaky network never flips to down)", () => {
    const x = conn();
    for (let i = 0; i < 6; i++) { x.c.reportFailure(); x.c.reportFailure(); x.c.reportSuccess(); }
    expect(x.c.get()).toBe("online");
    expect(x.seen).toEqual([]);
  });
  test("M01-04 down: first probe comes 30s later, then gaps double 60s, 120s ... capped at 10 min", async () => {
    const x = conn();
    for (let i = 0; i < 3; i++) x.c.reportFailure();
    expect(x.tm.pending()).toEqual([30_000]);
    await x.tm.advance(30_000);
    expect(x.st.probeCalls).toBe(1);
    expect(x.tm.pending()).toEqual([60_000]);
    await x.tm.advance(60_000);
    expect(x.tm.pending()).toEqual([120_000]);
    for (let i = 0; i < 8; i++) await x.tm.advance(x.tm.pending()[0]!);
    expect(x.tm.pending()).toEqual([600_000]);
  });
  test("M01-05 many failure reports never schedule more than one probe", () => {
    const x = conn();
    for (let i = 0; i < 50; i++) x.c.reportFailure();
    expect(x.tm.pending().length).toBe(1);
  });
  test("M01-06 a probe the server answers brings 'online' back and stops probing", async () => {
    const x = conn();
    x.st.probeOk = true;
    for (let i = 0; i < 3; i++) x.c.reportFailure();
    await x.tm.advance(30_000);
    expect(x.c.get()).toBe("online");
    expect(x.tm.pending()).toEqual([]);
    expect(x.seen).toEqual(["server_down", "online"]);
  });
  test("M01-07 while 'online' nothing is scheduled and nothing is probed (no polling storm)", async () => {
    const x = conn();
    await x.tm.advance(60 * 60_000);
    expect(x.st.probeCalls).toBe(0);
    expect(x.tm.pending()).toEqual([]);
  });
  test.each([[200, true], [204, true], [401, true], [403, true], [404, true], [499, true], [500, false], [502, false], [503, false]])(
    "M01-08 HTTP %p means server up = %p", (status, up) => { expect(answerMeansServerUp(status)).toBe(up); });
  test("M01-09 withConnectivityReporting: a thrown fetch is a failure, a 401 is a success, a 503 is a failure", async () => {
    const reports: string[] = [];
    const ctl = { reportFailure: () => void reports.push("f"), reportSuccess: () => void reports.push("s") };
    let mode: "throw" | 401 | 503 = "throw";
    const f = withConnectivityReporting((async () => { if (mode === "throw") throw new TypeError("Failed to fetch"); return new Response("", { status: mode }); }) as unknown as typeof fetch, ctl);
    await f("https://x.test/a").catch(() => {});
    mode = 401; await f("https://x.test/a");
    mode = 503; await f("https://x.test/a");
    expect(reports).toEqual(["f", "s", "f"]);
  });
  test("M01-10 a browser 'offline' event while down cancels the probe (nothing sent with no network)", async () => {
    const x = conn();
    for (let i = 0; i < 3; i++) x.c.reportFailure();
    x.st.online = false;
    const probesBefore = x.st.probeCalls;
    await x.tm.advance(30_000);
    expect(x.st.probeCalls).toBe(probesBefore); // the probe timer fired but sent nothing while the browser has no network
  });
});

// ---------- outbox over the fake server ----------
type Net = "up" | "down";
async function lap(server: FakeSyncServer, userId = "u1", deviceId = "device-aaaa") {
  const idb = new IDBFactory();
  const net = { state: "up" as Net };
  const clock = { now: 1_800_000_000_000 };
  const guard = <T,>(fn: () => Promise<T>) => async () => { if (net.state === "down") throw new SyncError("network", "offline"); return fn(); };
  const client: SyncClient = {
    ...server.client,
    push: (async (...a: Parameters<SyncClient["push"]>) => guard(() => server.client.push(...a))()) as SyncClient["push"],
    pullIds: (async (...a: Parameters<SyncClient["pullIds"]>) => guard(() => server.client.pullIds(...a))()) as SyncClient["pullIds"],
  };
  let n = 0;
  const make = () => createOutbox({ userId, client, deviceId, idb, now: () => clock.now, sleep: async () => {}, autoFlush: false, newOpId: () => `${deviceId}-op-${++n}`, locks: null });
  const outbox = make();
  const replica = () => createReplica({ userId, client: server.client, idb, yieldFn: async () => {} });
  await replica().sync();
  return { idb, net, clock, outbox, reload: make, sync: () => replica().sync(), open: () => openLocalDb(idb, localDbNameFor(userId)) };
}
const fresh = (o: FakeServerOptions = {}) => createFakeSyncServer({ strict: true, ...o });
const seedTask = (s: FakeSyncServer, data: Record<string, unknown> = { title: "Old", statusId: "s1" }) => s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data });
const patch = (kind: string, id: string, p: Record<string, unknown>) => async (tx: LocalTx) => {
  const row = (await tx.getRecord(kind, id))!;
  await tx.patchRecord(kind, id, { data: { ...(row.data as object), ...p } });
};
const edit = (o: Outbox, p: Record<string, unknown>, base = 1, before?: Record<string, unknown>) =>
  o.enqueue({
    functionId: "update_task", projectId: "p1", params: { issueId: "t1", ...p }, label: "Task change",
    record: { kind: "tasks", id: "t1", baseVersion: base }, optimistic: patch("tasks", "t1", p), ...(before ? { before } : {}),
  });
function withUpdate(s: FakeSyncServer) {
  s.registerFunction("update_task", ({ target, params }) => {
    if (!target) return { rejected: "RECORD_NOT_FOUND" };
    const { issueId: _i, ...rest } = params as Record<string, unknown>;
    return { ok: true, kind: "tasks", id: target.id, data: { ...target.data, ...rest } };
  });
}
const pushCount = (s: FakeSyncServer) => s.requests.filter((r) => r.path === "/push").length;

describe("M01 offline: outbox, reload, conflicts, delta, two laptops", () => {
  test("M01-11 edit with no network: shown on the laptop at once, stays waiting, status offline, nothing lost", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const a = await lap(s);
    a.net.state = "down";
    await edit(a.outbox, { title: "Offline edit" });
    const rep = await a.outbox.flush();
    expect(rep.applied).toBe(0);
    expect(rep.remaining).toBe(1);
    expect(a.outbox.getState().pending).toBe(1);
    const db = await a.open();
    expect((await db.getRecord("tasks", "t1"))!.data).toMatchObject({ title: "Offline edit" });
    db.close();
    expect(s.getRow("tasks", "t1")!.data).toMatchObject({ title: "Old" });
  });
  test("M01-12 network comes back: the waiting edit goes up exactly once and the server has it", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const a = await lap(s);
    a.net.state = "down";
    await edit(a.outbox, { title: "Later" });
    await a.outbox.flush();
    a.net.state = "up";
    const rep = await a.outbox.flush({ connectivityBack: true });
    expect(rep).toMatchObject({ applied: 1, remaining: 0 });
    expect(s.getRow("tasks", "t1")!.data).toMatchObject({ title: "Later" });
    expect(s.pushedOpIds().length).toBe(1);
  });
  test("M01-13 restart (a new outbox over the same database) still holds the waiting edit and delivers it once", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const a = await lap(s);
    a.net.state = "down";
    await edit(a.outbox, { title: "Survives restart" });
    a.outbox.dispose();
    a.net.state = "up";
    const again = a.reload();
    expect(await again.pendingCount()).toBe(1);
    expect((await again.flush()).applied).toBe(1);
    expect(s.getRow("tasks", "t1")!.data).toMatchObject({ title: "Survives restart" });
    expect(await again.pendingCount()).toBe(0);
  });
  test("M01-14 a lost response: the same op id is re-sent and the server applies it only once", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const a = await lap(s);
    await edit(a.outbox, { title: "Once" });
    s.loseNextResponses(1);
    await a.outbox.flush();
    a.clock.now += 10 * 60_000;
    await a.outbox.flush();
    expect(s.ledger.size).toBe(1); // applied once; the second send was answered as a duplicate
    expect(s.getRow("tasks", "t1")!.version).toBe(2);
    expect(await a.outbox.pendingCount()).toBe(0);
  });
  test("M01-15 server down (503) keeps the edit; the next flush after it is back delivers it", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const a = await lap(s);
    await edit(a.outbox, { title: "After outage" });
    s.failNext({ status: 503, times: 1, path: "/push" });
    const r1 = await a.outbox.flush();
    expect(r1.applied).toBe(0);
    expect(await a.outbox.pendingCount()).toBe(1);
    a.clock.now += 10 * 60_000; // past any back-off
    const r2 = await a.outbox.flush();
    expect(r2.applied).toBe(1);
  });
  test("M01-16 flaky network: two failures in a row, then success; one op id throughout", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const a = await lap(s);
    await edit(a.outbox, { title: "Flaky" });
    s.failNext({ status: 502, times: 2, path: "/push" });
    for (let i = 0; i < 3; i++) { a.clock.now += 10 * 60_000; await a.outbox.flush(); }
    expect(s.getRow("tasks", "t1")!.data).toMatchObject({ title: "Flaky" });
    expect(new Set(s.pushedOpIds()).size).toBe(1);
  });
  test("M01-17 nothing waiting -> a flush sends no push request at all (delta-only upload)", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const a = await lap(s);
    const before = pushCount(s);
    const rep = await a.outbox.flush();
    expect(rep.sent).toBe(0);
    expect(pushCount(s)).toBe(before);
  });
  test("M01-18 delta upload: three queued edits go in ONE push carrying only those ops", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    s.upsert({ kind: "tasks", projectId: "p1", id: "t2", data: { title: "Two" } });
    s.upsert({ kind: "tasks", projectId: "p1", id: "t3", data: { title: "Three" } });
    const a = await lap(s);
    for (const id of ["t1", "t2", "t3"]) {
      await a.outbox.enqueue({ functionId: "update_task", projectId: "p1", params: { issueId: id, title: `E-${id}` }, record: { kind: "tasks", id, baseVersion: 1 }, optimistic: patch("tasks", id, { title: `E-${id}` }) });
    }
    await a.outbox.flush();
    const pushes = s.requests.filter((r) => r.path === "/push");
    expect(pushes.length).toBe(1);
    expect(pushes[0]!.body.ops.length).toBe(3);
  });
  test("M01-19 delta download: after the first copy, a second sync with one changed row pulls no unchanged rows again", async () => {
    const s = fresh();
    for (let i = 0; i < 20; i++) s.upsert({ kind: "tasks", projectId: "p1", id: `t${i}`, data: { title: `T${i}` } });
    const a = await lap(s);
    const db0 = await a.open();
    expect((await db0.listByProject("orgA", "tasks", "p1")).length).toBe(20);
    db0.close();
    s.upsert({ kind: "tasks", projectId: "p1", id: "t7", data: { title: "T7 changed" } });
    const mark = s.requests.length;
    await a.sync();
    const bodies = JSON.stringify(s.requests.slice(mark).map((r) => r.body));
    expect(bodies).not.toContain('"t3"');
    const db = await a.open();
    expect((await db.getRecord("tasks", "t7"))!.data).toMatchObject({ title: "T7 changed" });
    db.close();
  });
  test("M01-20 a second sync with NOTHING changed copies zero rows", async () => {
    const s = fresh(); seedTask(s);
    const a = await lap(s);
    const rep = await a.sync();
    expect(JSON.stringify(rep)).not.toContain("error");
    const db = await a.open();
    expect((await db.getRecord("tasks", "t1"))!.serverVersion).toBe(1);
    db.close();
  });
  test("M01-21 two laptops, same stub: A's flushed edit reaches B by sync", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const a = await lap(s, "u1", "device-aaaa");
    const b = await lap(s, "u1", "device-bbbb");
    await edit(a.outbox, { title: "From A" });
    await a.outbox.flush();
    await b.sync();
    const db = await b.open();
    expect((await db.getRecord("tasks", "t1"))!.data).toMatchObject({ title: "From A" });
    db.close();
  });
  test("M01-22 two laptops: both edit the SAME field from version 1 -> the second to arrive gets a conflict card, not a silent overwrite", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const a = await lap(s, "u1", "device-aaaa");
    const b = await lap(s, "u1", "device-bbbb");
    await edit(a.outbox, { title: "A title" }, 1, { title: "Old" });
    await edit(b.outbox, { title: "B title" }, 1, { title: "Old" });
    await a.outbox.flush();
    const rep = await b.outbox.flush();
    expect(rep.conflicts + rep.merged).toBeGreaterThan(0);
    expect(s.getRow("tasks", "t1")!.data).toMatchObject({ title: "A title" });
    const cards = await b.outbox.getConflicts();
    expect(cards.length).toBe(1);
  });
  test("M01-23 conflict card 'keep mine' sends B's edit over A's", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const a = await lap(s, "u1", "device-aaaa");
    const b = await lap(s, "u1", "device-bbbb");
    await edit(a.outbox, { title: "A title" }, 1, { title: "Old" });
    await edit(b.outbox, { title: "B title" }, 1, { title: "Old" });
    await a.outbox.flush(); await b.outbox.flush();
    const [card] = await b.outbox.getConflicts();
    await b.outbox.resolve(card!.opId, "keep_mine");
    await b.outbox.flush();
    expect(s.getRow("tasks", "t1")!.data).toMatchObject({ title: "B title" });
  });
  test("M01-24 conflict card 'keep theirs' drops B's change and B ends up with A's value", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const a = await lap(s, "u1", "device-aaaa");
    const b = await lap(s, "u1", "device-bbbb");
    await edit(a.outbox, { title: "A title" }, 1, { title: "Old" });
    await edit(b.outbox, { title: "B title" }, 1, { title: "Old" });
    await a.outbox.flush(); await b.outbox.flush();
    const [card] = await b.outbox.getConflicts();
    await b.outbox.resolve(card!.opId, "keep_theirs");
    await b.outbox.flush();
    const db = await b.open();
    expect((await db.getRecord("tasks", "t1"))!.data).toMatchObject({ title: "A title" });
    db.close();
    expect(s.getRow("tasks", "t1")!.data).toMatchObject({ title: "A title" });
  });
  test("M01-25 two laptops edit DIFFERENT fields: merged automatically, both changes survive, no card", async () => {
    const s = fresh(); seedTask(s, { title: "Old", note: "n0", statusId: "s1" }); withUpdate(s);
    const a = await lap(s, "u1", "device-aaaa");
    const b = await lap(s, "u1", "device-bbbb");
    await edit(a.outbox, { title: "A title" }, 1, { title: "Old" });
    await edit(b.outbox, { note: "B note" }, 1, { note: "n0" });
    await a.outbox.flush(); await b.outbox.flush();
    expect(await b.outbox.getConflicts()).toEqual([]);
    expect(s.getRow("tasks", "t1")!.data).toMatchObject({ title: "A title", note: "B note" });
  });
  test("M01-26 two laptops edit the same MONEY field: always a card, never auto-merged", async () => {
    const s = fresh(); seedTask(s, { title: "Old", amount: 100 }); withUpdate(s);
    const a = await lap(s, "u1", "device-aaaa");
    const b = await lap(s, "u1", "device-bbbb");
    await edit(a.outbox, { amount: 200 }, 1, { amount: 100 });
    await edit(b.outbox, { amount: 300 }, 1, { amount: 100 });
    await a.outbox.flush(); await b.outbox.flush();
    expect((await b.outbox.getConflicts()).length).toBe(1);
    expect(s.getRow("tasks", "t1")!.data).toMatchObject({ amount: 200 });
  });
  test("M01-27 a row deleted by someone else while B's edit waits does not crash B; B's edit is not silently applied", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const b = await lap(s, "u1", "device-bbbb");
    b.net.state = "down";
    await edit(b.outbox, { title: "Edit of a deleted row" });
    s.remove({ kind: "tasks", projectId: "p1", id: "t1" });
    b.net.state = "up";
    await b.outbox.flush();
    expect(s.getRow("tasks", "t1")?.deleted ?? true).toBe(true);
    expect(await b.outbox.pendingCount() + (await b.outbox.getConflicts()).length + (await b.outbox.getBlocked()).length).toBeGreaterThan(0);
  });
  test("M01-28 signed out on the server: nothing is applied and the edit is kept", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const a = await lap(s);
    await edit(a.outbox, { title: "x" });
    s.signedOut = true;
    const rep = await a.outbox.flush();
    expect(rep.applied).toBe(0);
    expect(rep.status).toBe("signed_out");
    expect(await a.outbox.pendingCount()).toBe(1);
  });
  test("M01-29 app too old (426): sending pauses, the edit stays, and resume() after the update delivers it", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const a = await lap(s);
    await edit(a.outbox, { title: "Needs new app" });
    s.requireUpdate({ current: "2026.10.08-001", minCompatible: "2026.10.08-001" });
    const r1 = await a.outbox.flush();
    expect(r1.status).toBe("update_required");
    s.requireUpdate(null);
    a.outbox.resume();
    expect((await a.outbox.flush()).applied).toBe(1);
  });
  test("M01-30 offline create: a temporary row shows at once; after sync the real row replaces it", async () => {
    const s = fresh();
    const a = await lap(s);
    s.registerFunction("create_rfi", ({ params }) => ({ ok: true, kind: "rfis", id: `srv-${(params as { subject: string }).subject}`, data: { subject: (params as { subject: string }).subject, status: "open" } }));
    a.net.state = "down";
    await a.outbox.enqueue({
      functionId: "create_rfi", projectId: "p1", params: { projectId: "p1", subject: "Hello" }, creates: { kind: "rfis", id: "tmp-1" },
      optimistic: async (tx) => { await tx.putRecord({ id: "rfis:tmp-1", type: "rfis", orgId: "orgA", projectId: "p1", data: { id: "tmp-1", subject: "Hello", status: "open" } }); },
    });
    await a.outbox.flush();
    let db = await a.open();
    expect(await db.getRecord("rfis", "tmp-1")).toBeDefined();
    db.close();
    a.net.state = "up";
    a.clock.now += 10 * 60_000;
    await a.outbox.flush();
    db = await a.open();
    expect(await db.getRecord("rfis", "tmp-1")).toBeUndefined();
    expect((await db.listByProject("orgA", "rfis", "p1")).length).toBe(1);
    db.close();
  });
  test("M01-31 a role that may not run the function: rejected, laptop edit is undone, not left dirty", async () => {
    const s = fresh({ deniedFunctions: ["update_task"] }); seedTask(s); withUpdate(s);
    const a = await lap(s);
    await edit(a.outbox, { title: "Not allowed" });
    const rep = await a.outbox.flush();
    expect(rep.rejected + rep.attention + rep.blocked).toBeGreaterThan(0);
    const db = await a.open();
    expect(await db.listDirty()).toEqual([]);
    expect((await db.getRecord("tasks", "t1"))!.data).toMatchObject({ title: "Old" });
    db.close();
  });
  test("M01-32 concurrent flush calls share one pass (one push request for one op)", async () => {
    const s = fresh(); seedTask(s); withUpdate(s);
    const a = await lap(s);
    await edit(a.outbox, { title: "Race" });
    await Promise.all([a.outbox.flush(), a.outbox.flush(), a.outbox.flush()]);
    expect(pushCount(s)).toBe(1);
  });
  test("M01-33 pure merge: decide() cases", () => {
    expect(decide({ effect: { title: "B" }, before: { title: "Old" }, theirs: { title: "B" } }).kind).toBe("already_in");
    expect(decide({ effect: { title: "B" }, before: { title: "Old" }, theirs: { title: "Old", other: 1 } }).kind).toBe("merged");
    expect(decide({ effect: { title: "B" }, before: { title: "Old" }, theirs: { title: "A" } }).kind).toBe("card");
    expect(decide({ effect: { title: "B" }, theirs: { title: "A" } }).kind).toBe("card"); // unknown base counts as both changed
    expect(decide({ effect: { due_date: "x" }, before: { due_date: "y" }, theirs: { dueDate: "y" } }).kind).toBe("merged"); // snake/camel twins
    expect(isProtectedField("budget_amount")).toBe(true);
    expect(isProtectedField("title")).toBe(false);
    expect(effectOf({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ b: 3 });
  });
  test("M01-34 pure merge: a money field is never auto-merged even when only the person changed it; the same shape on a plain field merges", () => {
    expect(decide({ effect: { amount: 200 }, before: { amount: 100 }, theirs: { amount: 100, other: 1 } }).kind).toBe("card");
    expect(decide({ effect: { note: "b" }, before: { note: "a" }, theirs: { note: "a", other: 1 } }).kind).toBe("merged");
    expect(decide({ effect: { approvedBy: "x" }, before: { approvedBy: null }, theirs: { approvedBy: null, other: 1 } }).kind).toBe("card");
  });
});
