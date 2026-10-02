import { describe, expect, test } from "bun:test";
import { changeCursorKey } from "../local-db";
import { createSyncScheduler, type SchedulerClock, type StepResult } from "../peer/scheduler";
import { createServerStep, type StepReport } from "../peer/server-step";
import { LAST_SYNC_KEY, MANIFEST_KEY } from "../replica";
import type { MetaStore } from "../peer/verify";

// COST (package lf-e6, R14): the two timing decisions that dominate a laptop's day -- which projects the server step reads on a
// run (project mode, server-step.ts) and whether the server is asked at all while a peer is connected (scheduler.ts).

const MIN = 60_000;
const HOUR = 60 * MIN;

function memMeta(init: Record<string, unknown> = {}): MetaStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(init));
  return { data, async getMeta<T>(k: string) { return data.get(k) as T | undefined; }, async setMeta(k, v) { data.set(k, v); } };
}

function projectMode(o: { projects?: string[]; lastSyncAgo?: number | null; active?: string | null; report?: StepReport } = {}) {
  let t = 10 * HOUR;
  const projects = o.projects ?? ["p1", "p2", "p3"];
  const init: Record<string, unknown> = { [MANIFEST_KEY]: { projectIds: projects } };
  for (const p of projects) init[changeCursorKey(p)] = { seq: 1 };
  if (o.lastSyncAgo !== null) init[LAST_SYNC_KEY] = { at: t - (o.lastSyncAgo ?? 10 * MIN) };
  const meta = memMeta(init);
  const calls = { heads: 0, whole: 0, project: [] as string[] };
  let report: StepReport = o.report ?? { status: "done", changesApplied: 0 };
  const step = createServerStep({
    meta, now: () => t,
    changes: async () => { calls.heads += 1; return { head_seq: 1 }; },
    sync: async () => { calls.whole += 1; meta.data.set(LAST_SYNC_KEY, { at: t }); return { status: "done" }; },
    syncProject: async (p) => { calls.project.push(p); return report; },
    activeProject: () => (o.active === undefined ? "p2" : o.active),
  });
  return { step, calls, meta, advance: (ms: number) => { t += ms; }, setReport: (r: StepReport) => { report = r; } };
}

describe("server step, project mode: the open project every run, the others hourly, a whole sync every six hours", () => {
  test("first run reads every project once; later runs read only the open one until an hour has passed; no head checks at all", async () => {
    const r = projectMode();
    expect(await r.step()).toEqual({ changed: false });
    expect(r.calls.project).toEqual(["p1", "p2", "p3"]);
    r.calls.project.length = 0;
    for (let i = 0; i < 6; i += 1) { r.advance(5 * MIN); await r.step(); }
    expect(r.calls.project).toEqual(["p2", "p2", "p2", "p2", "p2", "p2"]);
    r.calls.project.length = 0;
    r.advance(35 * MIN); // 65 minutes after the first run
    await r.step();
    expect(r.calls.project.sort()).toEqual(["p1", "p2", "p3"]);
    expect(r.calls.heads).toBe(0);
    expect(r.calls.whole).toBe(0);
  });

  test("with no open project, every project is read at most hourly", async () => {
    const r = projectMode({ active: null });
    await r.step();
    r.calls.project.length = 0;
    for (let i = 0; i < 11; i += 1) { r.advance(5 * MIN); await r.step(); }
    expect(r.calls.project).toEqual([]);
  });

  test("a whole sync when none is recorded, when the last one is six hours old, or when a project has no feed position", async () => {
    const never = projectMode({ lastSyncAgo: null });
    await never.step();
    expect(never.calls.whole).toBe(1);
    expect(never.calls.project).toEqual([]);

    const old = projectMode({ lastSyncAgo: 6 * HOUR });
    await old.step();
    expect(old.calls.whole).toBe(1);

    const fresh = projectMode();
    fresh.meta.data.delete(changeCursorKey("p3"));
    await fresh.step();
    expect(fresh.calls.whole).toBe(1);
  });

  test("changed only when something arrived; a failing run throws so the scheduler counts it as failed", async () => {
    const r = projectMode({ report: { status: "done", changesApplied: 2 } });
    expect(await r.step()).toEqual({ changed: true });
    r.setReport({ status: "error" });
    r.advance(5 * MIN);
    await expect(r.step()).rejects.toThrow("sync error");
  });
});

function schedulerRig(peers: number) {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: SchedulerClock = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: (h) => { timers.delete(h as number); },
  };
  const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
  const advance = async (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      t = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await flush();
    }
    t = end;
    await flush();
  };
  const calls = { server: [] as number[], peer: 0 };
  const s = createSyncScheduler({
    clock, locks: null, isVisible: () => true, isOnline: () => true, peersConnected: () => peers,
    serverStep: async (): Promise<StepResult> => { calls.server.push(t); return { changed: true }; },
    peerStep: async (): Promise<StepResult> => { calls.peer += 1; return { changed: true }; },
  });
  return { s, calls, advance, flush };
}

describe("scheduler: peers first", () => {
  test("with a peer connected, the server is asked on open and then at most every 30 minutes; the peer every run", async () => {
    const r = schedulerRig(1);
    r.s.start();
    await r.flush();
    await r.advance(60 * MIN);
    expect(r.calls.server).toEqual([0, 30 * MIN, 60 * MIN]);
    expect(r.calls.peer).toBe(13); // every 5 minutes, things keep changing
    r.s.stop();
  });

  test("coming back online always asks the server, peer or not", async () => {
    const r = schedulerRig(1);
    r.s.start();
    await r.flush();
    await r.advance(12 * MIN); // timer runs at 5 and 10 minutes went to the peer only
    await r.s.trigger("online");
    expect(r.calls.server).toEqual([0, 12 * MIN]);
    r.s.stop();
  });

  test("with no peer, the server is asked on every run (unchanged)", async () => {
    const r = schedulerRig(0);
    r.s.start();
    await r.flush();
    await r.advance(30 * MIN);
    expect(r.calls.server).toEqual([0, 5 * MIN, 10 * MIN, 15 * MIN, 20 * MIN, 25 * MIN, 30 * MIN]);
    r.s.stop();
  });
});
