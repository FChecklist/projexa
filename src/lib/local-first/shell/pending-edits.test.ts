import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../local-db";
import { FakeMeta } from "../release/__fixtures__/fakes";
import { EDITS_META_KEY, applyPendingEdits, createEditQueue, createFlushScheduler, type PendingEdit } from "./pending-edits";

const NOW = 1_760_000_000_000;

type Sent = { url: string; method: string; body: unknown };

function setup(answer: (req: Sent) => Response | Promise<Response> = () => new Response("{}", { status: 200 })) {
  const meta = new FakeMeta();
  const sent: Sent[] = [];
  let n = 0;
  let clock = NOW;
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const req: Sent = { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    sent.push(req);
    return answer(req);
  }) as typeof fetch;
  const writer = createEditQueue({ meta, fetchImpl, now: () => (clock += 1), newId: () => `edit-${++n}` });
  return { meta, sent, writer };
}

const edit = (lineId: string, category: string | null = "Civil") => ({ lineId, boqId: "boq1", projectId: "p1", patch: { category } });

describe("an edit is kept on the laptop at once", () => {
  test("enqueue stores it, shows it, and sends NOTHING by itself", async () => {
    const { writer, sent, meta } = setup();
    const e = await writer.enqueue(edit("l1"));
    expect(e).toMatchObject({ id: "edit-1", lineId: "l1", boqId: "boq1", projectId: "p1", patch: { category: "Civil" }, attempts: 0 });
    expect(await writer.list()).toHaveLength(1);
    expect((meta.data.get(EDITS_META_KEY) as unknown[]).length).toBe(1);
    expect(sent).toEqual([]);
  });

  test("a later edit of the same line replaces the earlier one, in place", async () => {
    const { writer } = setup();
    await writer.enqueue(edit("l1", "Civil"));
    await writer.enqueue(edit("l2", "Steel"));
    await writer.enqueue(edit("l1", "Finishes"));
    const edits = await writer.list();
    expect(edits.map((e) => [e.lineId, e.patch.category])).toEqual([["l1", "Finishes"], ["l2", "Steel"]]);
  });

  test("the edits survive in the real person database across a close and reopen", async () => {
    const idb = new IDBFactory();
    const open = async () => openLocalDb(idb, localDbNameFor("u1"));
    const a = await open();
    await createEditQueue({ meta: a }).enqueue(edit("l1"));
    a.close();
    const b = await open();
    expect(await createEditQueue({ meta: b }).list()).toHaveLength(1);
    b.close();
  });

  test("applyPendingEdits lays the edit over the row; other rows are untouched (same objects)", () => {
    const rows = [{ id: "l1", category: null as string | null, description: "a" }, { id: "l2", category: "Steel" as string | null, description: "b" }];
    const edits: PendingEdit[] = [{ id: "e1", lineId: "l1", boqId: "b", projectId: "p", patch: { category: "Civil" }, at: 1, attempts: 0 }];
    const out = applyPendingEdits(rows, edits);
    expect(out[0]).toEqual({ id: "l1", category: "Civil", description: "a" });
    expect(out[1]).toBe(rows[1]!);
    expect(rows[0]!.category).toBeNull(); // the input was not mutated
    expect(applyPendingEdits(rows, [])).toEqual(rows);
  });
});

describe("sending: through the route the online screen uses, and only the person's intent", () => {
  test("PATCH /api/scope/line-items/<id> with the category, then the edit is gone", async () => {
    const { writer, sent } = setup();
    await writer.enqueue(edit("line/with space", "Civil"));
    const result = await writer.flush();
    expect(sent).toEqual([{ url: "/api/scope/line-items/line%2Fwith%20space", method: "PATCH", body: { category: "Civil" } }]);
    expect(result).toEqual({ sent: 1, rejected: 0, kept: 0, stoppedBecause: "none" });
    expect(await writer.list()).toEqual([]);
  });

  test("edits go in the order they were made", async () => {
    const { writer, sent } = setup();
    await writer.enqueue(edit("a"));
    await writer.enqueue(edit("b"));
    await writer.enqueue(edit("c"));
    await writer.flush();
    expect(sent.map((s) => s.url.split("/").pop())).toEqual(["a", "b", "c"]);
  });

  test("no network: the edit and everything after it are kept, in order, and nothing is lost", async () => {
    const { writer } = setup(() => { throw new TypeError("Failed to fetch"); });
    await writer.enqueue(edit("a"));
    await writer.enqueue(edit("b"));
    expect(await writer.flush()).toEqual({ sent: 0, rejected: 0, kept: 2, stoppedBecause: "offline" });
    expect((await writer.list()).map((e) => e.lineId)).toEqual(["a", "b"]);
  });

  test("a 5xx / 429 / 408 keeps it (the server is struggling, not refusing) and counts the attempt; later edits wait their turn", async () => {
    for (const status of [500, 502, 503, 504, 429, 408]) {
      const { writer, sent } = setup(() => new Response("{}", { status }));
      await writer.enqueue(edit("a"));
      await writer.enqueue(edit("b"));
      expect(await writer.flush()).toMatchObject({ sent: 0, kept: 2, stoppedBecause: "server" });
      expect(sent).toHaveLength(1); // b was not tried before a
      expect((await writer.list())[0]!.attempts).toBe(1);
    }
  });

  test("a 401 means signed out: kept, not rejected", async () => {
    const { writer } = setup(() => new Response("{}", { status: 401 }));
    await writer.enqueue(edit("a"));
    expect(await writer.flush()).toMatchObject({ kept: 1, rejected: 0, stoppedBecause: "signed_out" });
  });

  test("a real refusal (403 role, 404 gone, 400/422 invalid, 409) drops the edit and tells the person in the server's own words; the rest still go", async () => {
    for (const status of [400, 403, 404, 409, 422]) {
      const { writer, sent } = setup((req) => (req.url.endsWith("/a") ? new Response(JSON.stringify({ error: "Forbidden: your role does not permit this action" }), { status }) : new Response("{}", { status: 200 })));
      await writer.enqueue(edit("a"));
      await writer.enqueue(edit("b"));
      const result = await writer.flush();
      expect(`${status}: ${JSON.stringify(result)}`).toBe(`${status}: ${JSON.stringify({ sent: 1, rejected: 1, kept: 0, stoppedBecause: "none" })}`);
      expect(sent).toHaveLength(2);
      const notices = await writer.notices();
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ lineId: "a", message: "Forbidden: your role does not permit this action" });
      await writer.dismissNotice(notices[0]!.id);
      expect(await writer.notices()).toEqual([]);
    }
  });

  test("a refusal with no JSON body still says something true", async () => {
    const { writer } = setup(() => new Response("<html>", { status: 403 }));
    await writer.enqueue(edit("a"));
    await writer.flush();
    expect((await writer.notices())[0]!.message).toContain("HTTP 403");
  });

  test("two flushes at once send each edit ONCE (the second shares the first's answer)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const { writer, sent } = setup(async () => { await gate; return new Response("{}", { status: 200 }); });
    await writer.enqueue(edit("a"));
    const first = writer.flush();
    const second = writer.flush();
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(sent).toHaveLength(1);
  });

  test("an edit made while a flush is running is not lost", async () => {
    let first = true;
    let enqueueLater: () => Promise<unknown> = async () => {};
    const { writer, sent } = setup(async () => {
      if (first) {
        first = false;
        await enqueueLater();
      }
      return new Response("{}", { status: 200 });
    });
    enqueueLater = () => writer.enqueue(edit("b"));
    await writer.enqueue(edit("a"));
    await writer.flush();
    expect(sent.map((s) => s.url.split("/").pop())).toEqual(["a"]);
    expect((await writer.list()).map((e) => e.lineId)).toEqual(["b"]);
  });
});

describe("when to try: no polling storm", () => {
  function scheduler(over: { online?: boolean } = {}) {
    const timers: { fn: () => void; ms: number; id: number }[] = [];
    let id = 0;
    const state = { online: over.online ?? true, pending: 0, flushes: 0, kept: 1 };
    const writer = {
      list: async () => Array.from({ length: state.pending }, () => ({}) as PendingEdit),
      flush: async () => { state.flushes += 1; return { sent: 0, rejected: 0, kept: state.kept, stoppedBecause: "server" as const }; },
    };
    const s = createFlushScheduler({
      writer, isOnline: () => state.online, retryMs: 60_000,
      setTimer: (fn, ms) => { timers.push({ fn, ms, id: ++id }); return id; },
      clearTimer: (h) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); },
    });
    return { s, timers, state, fire: async () => { const t = timers.shift(); t?.fn(); await new Promise((r) => setTimeout(r, 0)); } };
  }

  test("nothing waiting: a nudge flushes nothing and schedules nothing further", async () => {
    const { s, timers, state, fire } = scheduler();
    state.pending = 0;
    s.nudge();
    await fire();
    expect(state.flushes).toBe(0);
    expect(timers).toEqual([]);
  });

  test("offline: nothing is sent and nothing is scheduled", async () => {
    const { s, timers, state, fire } = scheduler({ online: false });
    state.pending = 3;
    s.nudge();
    await fire();
    expect(state.flushes).toBe(0);
    expect(timers).toEqual([]);
  });

  test("online with edits waiting: one flush, then at most one retry a minute while they still wait; many nudges make one timer", async () => {
    const { s, timers, state, fire } = scheduler();
    state.pending = 2;
    for (let i = 0; i < 50; i += 1) s.nudge();
    expect(timers.length).toBe(1);
    await fire();
    expect(state.flushes).toBe(1);
    expect(timers.map((t) => t.ms)).toEqual([60_000]);
    await fire();
    expect(state.flushes).toBe(2);
    expect(timers.map((t) => t.ms)).toEqual([60_000]);
    state.kept = 0; // the edits went through
    await fire();
    expect(timers).toEqual([]);
  });

  test("the laptop coming back online (or the tab coming into focus) tries NOW even while a retry is waiting; an ordinary nudge does not", async () => {
    const { s, timers, state, fire } = scheduler();
    state.pending = 1;
    s.nudge();
    await fire(); // fails: a one-minute retry is now waiting
    expect(timers.map((t) => t.ms)).toEqual([60_000]);
    s.nudge(); // a new edit: covered by the waiting retry
    expect(timers.map((t) => t.ms)).toEqual([60_000]);
    s.nudge({ immediate: true }); // online again / focus: now
    expect(timers.map((t) => t.ms)).toEqual([0]);
    await fire();
    expect(state.flushes).toBe(2);
  });

  test("stop() cancels the pending try", () => {
    const { s, timers, state } = scheduler();
    state.pending = 1;
    s.nudge();
    s.stop();
    expect(timers).toEqual([]);
    s.nudge();
    expect(timers).toEqual([]);
  });
});

// ─── G-14: two laptops edit the SAME field offline (measured 2026-10-06: the later write silently replaced the earlier one) ───────────
describe("G-14: an edit carries the value the person saw, and a changed field is a conflict the person decides, never a silent overwrite", () => {
  const withBase = (lineId: string, category: string | null, seen: string | null) => ({ ...edit(lineId, category), base: { category: seen } });
  const CONFLICT = () => new Response(JSON.stringify({ error: "This line was changed by someone else.", conflict: "EDIT_CONFLICT", current: { category: "CONF-A" } }), { status: 409 });

  test("the request carries expectedCategory = what the person saw (the OLD behaviour sent only the new value)", async () => {
    const { writer, sent } = setup();
    await writer.enqueue(withBase("l1", "CONF-B", null));
    await writer.flush();
    expect(sent[0]!.body).toEqual({ category: "CONF-B", expectedCategory: null });
  });

  test("an edit stored without a base (an older build) is still sent as before, without the check", async () => {
    const { writer, sent } = setup();
    await writer.enqueue(edit("l1", "Civil"));
    await writer.flush();
    expect(sent[0]!.body).toEqual({ category: "Civil" });
  });

  test("the first of several edits of a line keeps its base (what was SEEN before any of them)", async () => {
    const { writer } = setup();
    await writer.enqueue(withBase("l1", "X", "orig"));
    await writer.enqueue(withBase("l1", "Y", "X")); // the second edit saw the first's overlay: it must not replace the base
    expect((await writer.list())[0]).toMatchObject({ patch: { category: "Y" }, base: { category: "orig" } });
  });

  test("409 EDIT_CONFLICT keeps the edit, records what is stored now, leaves no refusal notice, and does NOT resend by itself", async () => {
    let calls = 0;
    const { writer, sent } = setup(() => { calls += 1; return CONFLICT(); });
    await writer.enqueue(withBase("l1", "CONF-B", null));
    const first = await writer.flush();
    expect(first).toMatchObject({ sent: 0, rejected: 0, conflicts: 1 });
    expect(await writer.notices()).toEqual([]);
    expect((await writer.list())[0]).toMatchObject({ patch: { category: "CONF-B" }, conflict: { theirs: "CONF-A" } });
    await writer.flush(); // the person has not chosen: nothing is sent again
    expect(calls).toBe(1);
    expect(sent).toHaveLength(1);
  });

  test("Keep mine: sent again as based on THEIR value, so it replaces it on purpose; the server accepts it", async () => {
    let first = true;
    const { writer, sent } = setup(() => { if (first) { first = false; return CONFLICT(); } return new Response("{}", { status: 200 }); });
    await writer.enqueue(withBase("l1", "CONF-B", null));
    await writer.flush();
    const [conflicted] = await writer.list();
    await writer.resolveConflict(conflicted!.id, "mine");
    expect((await writer.list())[0]).toMatchObject({ base: { category: "CONF-A" }, attempts: 0 });
    expect((await writer.list())[0]!.conflict).toBeUndefined();
    const again = await writer.flush();
    expect(again.sent).toBe(1);
    expect(sent[1]!.body).toEqual({ category: "CONF-B", expectedCategory: "CONF-A" });
    expect(await writer.list()).toEqual([]);
  });

  test("Keep theirs: the edit is dropped and nothing more is sent", async () => {
    const { writer, sent } = setup(() => CONFLICT());
    await writer.enqueue(withBase("l1", "CONF-B", null));
    await writer.flush();
    const [conflicted] = await writer.list();
    await writer.resolveConflict(conflicted!.id, "theirs");
    expect(await writer.list()).toEqual([]);
    await writer.flush();
    expect(sent).toHaveLength(1);
  });

  test("a 409 that is NOT an edit conflict is still a plain refusal (dropped, with its notice), as before", async () => {
    const { writer } = setup(() => new Response(JSON.stringify({ error: "BOQ is locked" }), { status: 409 }));
    await writer.enqueue(withBase("l1", "Z", null));
    const r = await writer.flush();
    expect(r.rejected).toBe(1);
    expect(await writer.list()).toEqual([]);
    expect((await writer.notices())[0]!.message).toBe("BOQ is locked");
  });
});
