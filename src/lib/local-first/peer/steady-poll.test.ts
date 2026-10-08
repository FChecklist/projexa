/// <reference types="bun-types" />
// FRESHNESS (2026-10-08, ai-os/audit37/SYNC_FRESHNESS_2026-10-08.md): the steady ~5-minute /heads poll, end to end between the real
// scheduler (steady mode) and the real server step (heads mode), with a fake clock and a fake service that counts every request.
// Run: bun test --isolate src/lib/local-first/peer/steady-poll.test.ts
import { describe, expect, test } from "bun:test";
import { changeCursorKey } from "../local-db";
import { LAST_SYNC_KEY, MANIFEST_KEY } from "../replica";
import { SyncError, type HeadsAnswer } from "../sync-client";
import { createSyncScheduler, type SchedulerClock } from "./scheduler";
import { createServerStep, HEADS_KEY } from "./server-step";

const MIN = 60_000;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function fakeClock() {
  let t = 1_000_000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: SchedulerClock = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: (h) => { timers.delete(h as number); },
  };
  return {
    clock,
    async advance(ms: number) {
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
    },
  };
}

type Setup = { random?: () => number; visible?: boolean };

function setup(o: Setup = {}) {
  const fc = fakeClock();
  const env = { visible: o.visible ?? true, headsFail: false };
  const server = { heads: { p1: 5, p2: 7, __org__: 0 } as Record<string, number> };
  const log: string[] = [];
  const stamps: number[] = [];
  const store = new Map<string, unknown>();
  store.set(MANIFEST_KEY, { projectIds: ["p1", "p2"] });
  store.set(LAST_SYNC_KEY, { at: fc.clock.now() });
  store.set(changeCursorKey("p1"), { seq: 5 });
  store.set(changeCursorKey("p2"), { seq: 7 });
  store.set(HEADS_KEY, { etag: "e1", viewClass: "v", orgViewClass: null, epoch: "x", at: fc.clock.now() });
  const meta = {
    getMeta: async <T,>(k: string) => store.get(k) as T | undefined,
    setMeta: async (k: string, v: unknown) => { store.set(k, v); },
  };
  const step = createServerStep({
    meta: meta as never,
    changes: async () => { throw new Error("head mode must not be used"); },
    sync: async () => { log.push("whole"); return { status: "done" }; },
    syncProject: async (p) => {
      log.push(`project ${p}`);
      store.set(changeCursorKey(p), { seq: server.heads[p]! }); // the one-project run catches the cursor up
      return { status: "done", changesApplied: 1 };
    },
    heads: async (): Promise<HeadsAnswer> => {
      log.push("heads");
      stamps.push(fc.clock.now());
      if (env.headsFail) throw new SyncError("network", "down");
      return { heads: { ...server.heads }, projects_etag: "e1", view_class: "v", org_view_class: null, epoch: "x" };
    },
    activeProject: () => "p1",
    now: fc.clock.now,
  });
  const sched = createSyncScheduler({
    clock: fc.clock, locks: null, steady: true, random: o.random ?? (() => 0.5),
    isVisible: () => env.visible, isOnline: () => true, peersConnected: () => 0,
    serverStep: step, peerStep: async () => undefined,
  });
  return { fc, env, server, log, stamps, sched };
}

describe("steady /heads poll", () => {
  test("heads unchanged => each poll is exactly ONE request, and no project is pulled", async () => {
    const s = setup();
    s.sched.start();
    await flush();
    await s.fc.advance(20 * MIN);
    expect(s.log.length).toBeGreaterThanOrEqual(4);
    expect(s.log.every((x) => x === "heads")).toBe(true);
    // a quiet laptop is NOT backed off: still every 5 minutes
    expect(s.stamps.slice(1).map((t, i) => t - s.stamps[i]!)).toEqual(Array(s.stamps.length - 1).fill(5 * MIN));
    s.sched.stop();
  });

  test("one project moved => only that project is pulled, even though it is not the open one", async () => {
    const s = setup();
    s.sched.start();
    await flush();
    s.log.length = 0;
    s.server.heads.p2 = 9; // p1 is open, p2 is not
    await s.fc.advance(5 * MIN);
    expect(s.log).toEqual(["heads", "project p2"]);
    s.log.length = 0;
    await s.fc.advance(5 * MIN);
    expect(s.log).toEqual(["heads"]); // caught up: back to one request
    s.server.heads.p2 = 10; // moved AGAIN, 5 minutes after it was last read: still read at once, no hourly wait
    s.log.length = 0;
    await s.fc.advance(5 * MIN);
    expect(s.log).toEqual(["heads", "project p2"]);
    s.sched.stop();
  });

  test("error => backoff 5 -> 10 -> 20 -> 30 minutes, then the first success returns to 5", async () => {
    const s = setup();
    s.env.headsFail = true;
    s.sched.start();
    await flush();
    await s.fc.advance(100 * MIN);
    expect(s.stamps.slice(1, 5).map((t, i) => t - s.stamps[i]!)).toEqual([10 * MIN, 20 * MIN, 30 * MIN, 30 * MIN]);
    s.env.headsFail = false;
    s.stamps.length = 0;
    await s.fc.advance(65 * MIN);
    const gaps = s.stamps.slice(1).map((t, i) => t - s.stamps[i]!);
    expect(gaps[gaps.length - 1]).toBe(5 * MIN);
    s.sched.stop();
  });

  test("hidden tab => polling continues for 15 minutes, then pauses; coming back polls at once", async () => {
    const s = setup();
    s.sched.start();
    await flush();
    s.env.visible = false;
    s.sched.visibilityChanged();
    const before = s.stamps.length;
    await s.fc.advance(14 * MIN);
    expect(s.stamps.length - before).toBe(2); // still polling at +5 and +10
    await s.fc.advance(2 * 60 * MIN);
    const paused = s.stamps.length;
    expect(paused - before).toBeLessThanOrEqual(3); // the +15 timer may fire once, then nothing for two hours
    await s.fc.advance(60 * MIN);
    expect(s.stamps.length).toBe(paused);
    s.env.visible = true;
    s.sched.visibilityChanged();
    await flush();
    expect(s.stamps.length).toBe(paused + 1);
    s.sched.stop();
  });

  test("jitter: the delay stays within 10% of five minutes and follows the random source", async () => {
    const lo = setup({ random: () => 0 });
    lo.sched.start();
    await flush();
    await lo.fc.advance(30 * MIN);
    expect(lo.stamps[1]! - lo.stamps[0]!).toBe(Math.round(5 * MIN * 0.9));
    lo.sched.stop();
    const hi = setup({ random: () => 1 });
    hi.sched.start();
    await flush();
    await hi.fc.advance(30 * MIN);
    expect(hi.stamps[1]! - hi.stamps[0]!).toBe(Math.round(5 * MIN * 1.1));
    hi.sched.stop();
  });
});
