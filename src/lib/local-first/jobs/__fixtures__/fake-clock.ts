// A fake clock with timers for the claim-loop tests: time only moves when the test says so.
export type FakeClock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(h: unknown): void;
  /** Moves time forward, firing due timers in order, letting promises settle after each. */
  advance(ms: number): Promise<void>;
  sleep(ms: number): Promise<void>;
  pending(): number;
};

export const settle = async () => { for (let i = 0; i < 12; i++) await new Promise<void>((r) => setImmediate(r)); };

export function createFakeClock(start = Date.parse("2026-10-02T09:00:00.000Z")): FakeClock {
  let t = start;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: FakeClock = {
    now: () => t,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: t + Math.max(0, ms), fn }); return id; },
    clearTimeout(h) { timers.delete(h as number); },
    async advance(ms) {
      const target = t + ms;
      await settle();
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | null = null;
        for (const e of timers) if (e[1].at <= target && (!next || e[1].at < next[1].at || (e[1].at === next[1].at && e[0] < next[0]))) next = e;
        if (!next) break;
        timers.delete(next[0]);
        t = Math.max(t, next[1].at);
        next[1].fn();
        await settle();
      }
      t = target;
      await settle();
    },
    sleep: (ms) => new Promise<void>((resolve) => { clock.setTimeout(resolve, ms); }),
    pending: () => timers.size,
  };
  return clock;
}
