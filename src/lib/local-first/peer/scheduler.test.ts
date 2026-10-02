import { describe, expect, test } from "bun:test";
import { createSyncScheduler, type SchedulerClock, type StepResult } from "./scheduler";

// The auto-sync timing (R3/R14) under a fake clock: no tight loop, back-off when idle, nothing in a long-hidden tab without peers.

const MIN = 60_000;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: SchedulerClock = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: (h) => { timers.delete(h as number); },
  };
  return {
    clock,
    pending: () => timers.size,
    /** Moves time forward, firing due timers in order (and letting their async work settle). */
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

function setup(o: { visible?: boolean; peers?: number; changed?: boolean; online?: boolean } = {}) {
  const fc = fakeClock();
  const env = { visible: o.visible ?? true, peers: o.peers ?? 0, online: o.online ?? true, changed: o.changed ?? false };
  const calls = { server: 0, peer: 0, at: [] as number[] };
  const s = createSyncScheduler({
    clock: fc.clock, locks: null,
    isVisible: () => env.visible, isOnline: () => env.online, peersConnected: () => env.peers,
    serverStep: async (): Promise<StepResult> => { calls.server++; calls.at.push(fc.clock.now()); return { changed: env.changed }; },
    peerStep: async (): Promise<StepResult> => { calls.peer++; return { changed: false }; },
  });
  return { fc, env, calls, s };
}

describe("auto-sync scheduler", () => {
  test("runs on open with no user action, then every 5 minutes while things change", async () => {
    const { fc, calls, s } = setup({ changed: true });
    s.start();
    await flush();
    expect(calls.server).toBe(1);
    await fc.advance(15 * MIN);
    expect(calls.at).toEqual([0, 5 * MIN, 10 * MIN, 15 * MIN]);
    s.stop();
  });

  test("backs off when idle: 5, 10, 20, then capped at 30 minutes", async () => {
    const { fc, calls, s } = setup({ changed: false });
    s.start();
    await flush();
    await fc.advance(120 * MIN);
    expect(calls.at.slice(0, 6)).toEqual([0, 5 * MIN, 15 * MIN, 35 * MIN, 65 * MIN, 95 * MIN]);
    s.stop();
  });

  test("never a storm: 50 triggers at once are one run, and triggers inside the minimum gap do nothing", async () => {
    const { fc, calls, s } = setup();
    s.start();
    await Promise.all(Array.from({ length: 50 }, () => s.trigger("online")));
    await flush();
    expect(calls.server).toBe(1);
    await fc.advance(10_000);
    await s.trigger("peer");
    expect(calls.server).toBe(1);
    await fc.advance(30_000);
    await s.trigger("peer");
    expect(calls.server).toBe(2);
    expect(fc.pending()).toBe(1); // exactly one timer, never a pile
    s.stop();
  });

  test("a hidden tab syncs every 30 minutes, and once hidden for long with no peer it stops entirely", async () => {
    const { fc, env, calls, s } = setup({ changed: true });
    s.start();
    await flush();
    env.visible = false;
    s.visibilityChanged();
    await fc.advance(4 * 60 * MIN);
    // one run at 30 min (hidden, not yet long), then nothing more
    expect(calls.at).toEqual([0, 30 * MIN]);
    expect(s.nextRunAt()).toBeNull();
    // coming back runs at once
    env.visible = true;
    s.visibilityChanged();
    await flush();
    expect(calls.server).toBe(3);
    s.stop();
  });

  test("a long-hidden tab keeps syncing while a peer is connected", async () => {
    const { fc, env, calls, s } = setup({ changed: true, peers: 1 });
    s.start();
    await flush();
    env.visible = false;
    s.visibilityChanged();
    await fc.advance(2 * 60 * MIN);
    expect(calls.at).toEqual([0, 30 * MIN, 60 * MIN, 90 * MIN, 120 * MIN]);
    expect(calls.peer).toBe(5);
    s.stop();
  });

  test("server and peers run in parallel; offline skips the server but still talks to peers; a failing step never escapes", async () => {
    const fc = fakeClock();
    let release!: () => void;
    const order: string[] = [];
    const s = createSyncScheduler({
      clock: fc.clock, locks: null, isVisible: () => true, isOnline: () => false, peersConnected: () => 1,
      serverStep: async () => { order.push("server"); return { changed: false }; },
      peerStep: async () => { order.push("peer:start"); await new Promise<void>((r) => (release = r)); order.push("peer:end"); throw new Error("peer gone"); },
    });
    s.start();
    await flush();
    expect(order).toEqual(["peer:start"]);
    release();
    await flush();
    expect(order).toEqual(["peer:start", "peer:end"]);
    expect(s.nextRunAt()).not.toBeNull();
    s.stop();
  });

  test("one flight in a tab: a timer that fires while a run is still going joins it instead of starting a second", async () => {
    const fc = fakeClock();
    let calls = 0;
    let release!: () => void;
    const s = createSyncScheduler({
      clock: fc.clock, locks: null, isVisible: () => true, isOnline: () => true, peersConnected: () => 0,
      serverStep: async () => { calls++; await new Promise<void>((r) => (release = r)); }, peerStep: async () => {},
    });
    s.start();
    await flush();
    const late = [s.trigger("timer"), s.trigger("timer")];
    await flush();
    expect(calls).toBe(1);
    release();
    await Promise.all(late);
    expect(calls).toBe(1);
    s.stop();
  });

  test("one flight across tabs: when another tab holds the lock this one skips", async () => {
    const fc = fakeClock();
    let calls = 0;
    const locks = { request: async (_n: string, _o: unknown, cb: (l: unknown) => Promise<void>) => cb(null) } as unknown as LockManager;
    const s = createSyncScheduler({ clock: fc.clock, locks, isVisible: () => true, isOnline: () => true, peersConnected: () => 0, serverStep: async () => { calls++; }, peerStep: async () => {} });
    s.start();
    await flush();
    expect(calls).toBe(0);
    expect(s.nextRunAt()).not.toBeNull(); // still scheduled: it tries again later, it does not spin
    s.stop();
  });
});
