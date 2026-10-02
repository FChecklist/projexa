import { describe, expect, test } from "bun:test";
import { PACE_PER_MINUTE, createRequestPacer } from "./rate-pacer";

// The pacer on a simulated clock: `sleep` advances the clock, so a test of a minute's worth of requests takes no real time.
function simulated() {
  let t = 1_000_000;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => { slept.push(ms); t += ms; },
    advance: (ms: number) => { t += ms; },
    slept,
  };
}

describe("request pacer", () => {
  test("lets PACE_PER_MINUTE requests through at once, then holds the next one until the oldest leaves the minute", async () => {
    const c = simulated();
    const pacer = createRequestPacer({ now: c.now, sleep: c.sleep });
    const start = c.now();
    for (let i = 0; i < PACE_PER_MINUTE; i += 1) await pacer.take();
    expect(c.slept).toEqual([]);
    expect(PACE_PER_MINUTE).toBeLessThan(120); // a margin under the server's 120/min cap
    await pacer.take();
    expect(c.now() - start).toBe(60_000);
  });

  test("never more than perMinute requests in ANY rolling minute, whatever the arrival pattern", async () => {
    const c = simulated();
    const pacer = createRequestPacer({ now: c.now, sleep: c.sleep, perMinute: 10 });
    const sent: number[] = [];
    for (let i = 0; i < 95; i += 1) {
      if (i % 7 === 0) c.advance(3_000);
      await pacer.take();
      sent.push(c.now());
    }
    for (const at of sent) expect(sent.filter((s) => s > at - 60_000 && s <= at).length).toBeLessThanOrEqual(10);
  });

  test("pauseUntil (a 429's Retry-After) holds every caller until then, and is never shortened", async () => {
    const c = simulated();
    const pacer = createRequestPacer({ now: c.now, sleep: c.sleep });
    pacer.pauseUntil(c.now() + 60_000);
    pacer.pauseUntil(c.now() + 5_000); // a shorter one does not shorten it
    const start = c.now();
    await pacer.take();
    expect(c.now() - start).toBe(60_000);
  });

  test("an aborted wait returns at once without counting", async () => {
    const pacer = createRequestPacer({ perMinute: 1, sleep: () => new Promise(() => {}) });
    await pacer.take();
    const controller = new AbortController();
    controller.abort();
    await pacer.take(controller.signal);
    expect(pacer.inWindow()).toBe(1);
  });
});
