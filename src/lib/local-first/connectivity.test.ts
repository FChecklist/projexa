import { describe, expect, test } from "bun:test";
import {
  answerMeansServerUp,
  createConnectivity,
  createDefaultProbe,
  withConnectivityReporting,
  type Connectivity,
  type ConnectivityController,
} from "./connectivity";

// A fake clock with timers, so the back-off and the "no polling storm" rule are tested without real waiting.
function fakeTime() {
  let t = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => { const id = nextId++; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    pending: () => [...timers.values()].map((x) => x.at - t).sort((a, b) => a - b),
    /** Advances the clock, firing due timers in order, and lets async work settle. */
    async advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        t = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
        await settle();
      }
      t = end;
      await settle();
    },
  };
}
const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

function setup(over: { online?: boolean; probeResults?: boolean[]; threshold?: number } = {}) {
  const time = fakeTime();
  const browser = { online: over.online ?? true, notify: () => {} };
  const results = [...(over.probeResults ?? [])];
  const probeCalls: number[] = [];
  const c = createConnectivity({
    isOnline: () => browser.online,
    probe: async () => { probeCalls.push(time.now()); return results.length ? results.shift()! : false; },
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    listenToBrowser: (onChange) => { browser.notify = onChange; return () => { browser.notify = () => {}; }; },
    failureThreshold: over.threshold,
  });
  c.start();
  const seen: Connectivity[] = [];
  c.subscribe((s) => seen.push(s));
  const goOffline = () => { browser.online = false; browser.notify(); };
  const goOnline = () => { browser.online = true; browser.notify(); };
  return { c, time, seen, probeCalls, goOffline, goOnline, results };
}

describe("the three states", () => {
  test("starts online, with nothing scheduled and nothing sent", () => {
    const { c, time, probeCalls } = setup();
    expect(c.get()).toBe("online");
    expect(time.pending()).toEqual([]);
    expect(probeCalls).toEqual([]);
  });

  test("the browser going offline is 'offline' at once, and back online is 'online' again", () => {
    const { c, seen, goOffline, goOnline } = setup();
    goOffline();
    expect(c.get()).toBe("offline");
    goOnline();
    expect(c.get()).toBe("online");
    expect(seen).toEqual(["offline", "online"]);
  });

  test("N failures in a row while the browser is online -> 'server_down'; fewer than N changes nothing", () => {
    const { c, seen } = setup({ threshold: 3 });
    c.reportFailure();
    c.reportFailure();
    expect(c.get()).toBe("online");
    expect(seen).toEqual([]);
    c.reportFailure();
    expect(c.get()).toBe("server_down");
    expect(seen).toEqual(["server_down"]);
  });

  test("one answer from the server clears the run of failures", () => {
    const { c } = setup({ threshold: 3 });
    c.reportFailure();
    c.reportFailure();
    c.reportSuccess();
    c.reportFailure();
    c.reportFailure();
    expect(c.get()).toBe("online"); // 2 in a row, not 4
    c.reportFailure();
    expect(c.get()).toBe("server_down");
    c.reportSuccess();
    expect(c.get()).toBe("online");
  });

  test("offline wins: failures reported while offline are the browser's doing, never 'server_down', and no probe is ever sent", async () => {
    const { c, time, probeCalls, goOffline, goOnline } = setup({ threshold: 2 });
    goOffline();
    for (let i = 0; i < 10; i += 1) c.reportFailure();
    expect(c.get()).toBe("offline");
    expect(time.pending()).toEqual([]);
    await time.advance(60 * 60_000);
    expect(probeCalls).toEqual([]);
    goOnline();
    expect(c.get()).toBe("online"); // the ten failures were not counted against our server
    expect(c.debug().failures).toBe(0);
  });

  test("failures counted BEFORE the browser went offline still stand when it comes back", () => {
    const { c, goOffline, goOnline } = setup({ threshold: 2 });
    c.reportFailure();
    goOffline();
    goOnline();
    c.reportFailure();
    expect(c.get()).toBe("server_down");
  });

  test("listeners hear only CHANGES, and one listener throwing does not stop the rest", () => {
    const { c } = setup({ threshold: 1 });
    const heard: string[] = [];
    c.subscribe(() => { throw new Error("listener bug"); });
    c.subscribe((s) => heard.push(s));
    c.reportFailure();
    c.reportFailure();
    c.reportFailure();
    expect(heard).toEqual(["server_down"]);
    c.reportSuccess();
    expect(heard).toEqual(["server_down", "online"]);
  });

  test("an unsubscribed listener hears nothing more", () => {
    const { c } = setup({ threshold: 1 });
    const heard: string[] = [];
    const off = c.subscribe((s) => heard.push(s));
    off();
    c.reportFailure();
    expect(heard).toEqual([]);
  });
});

describe("probing while the server is down: no polling storm", () => {
  test("while 'online' and while 'offline' no timer exists at all, however long it runs", async () => {
    const { c, time, probeCalls, goOffline } = setup();
    await time.advance(24 * 60 * 60_000);
    goOffline();
    await time.advance(24 * 60 * 60_000);
    expect(probeCalls).toEqual([]);
    expect(time.pending()).toEqual([]);
    expect(c.debug().probes).toBe(0);
  });

  test("going down schedules exactly ONE probe, 30 s away", () => {
    const { c, time } = setup({ threshold: 2 });
    c.reportFailure();
    c.reportFailure();
    expect(time.pending()).toEqual([30_000]);
  });

  test("a flood of failure reports still leaves one pending probe", () => {
    const { c, time } = setup({ threshold: 2 });
    for (let i = 0; i < 500; i += 1) c.reportFailure();
    expect(time.pending()).toEqual([30_000]);
    expect(c.debug().probePending).toBe(true);
  });

  test("failed probes back off exponentially (30 s, 60 s, 120 s, 240 s ...) up to the cap, and never closer than 30 s", async () => {
    const { c, time, probeCalls } = setup({ threshold: 1 });
    c.reportFailure();
    await time.advance(30_000);
    await time.advance(60_000);
    await time.advance(120_000);
    await time.advance(240_000);
    await time.advance(480_000);
    await time.advance(600_000);
    await time.advance(600_000);
    const gaps = probeCalls.slice(1).map((t, i) => t - probeCalls[i]!);
    expect(gaps).toEqual([60_000, 120_000, 240_000, 480_000, 600_000, 600_000]); // capped at 10 minutes
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(30_000);
    expect(c.get()).toBe("server_down");
    expect(time.pending().length).toBe(1);
  });

  test("a successful probe brings it back online, clears the schedule, and the next outage starts the back-off from 30 s again", async () => {
    const { c, time, probeCalls, seen } = setup({ threshold: 1, probeResults: [false, false, true] });
    c.reportFailure();
    await time.advance(30_000);
    await time.advance(60_000);
    await time.advance(120_000);
    expect(c.get()).toBe("online");
    expect(seen).toEqual(["server_down", "online"]);
    expect(time.pending()).toEqual([]);
    expect(probeCalls.length).toBe(3);
    await time.advance(60 * 60_000);
    expect(probeCalls.length).toBe(3); // up again: silence
    c.reportFailure();
    expect(time.pending()).toEqual([30_000]); // back-off reset
  });

  test("the probe is given a timeout: a probe that never answers is aborted and counts as failed", async () => {
    const time = fakeTime();
    let aborted = false;
    const c = createConnectivity({
      isOnline: () => true,
      probe: (signal) => new Promise<boolean>((resolve) => signal.addEventListener("abort", () => { aborted = true; resolve(false); })),
      now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer, failureThreshold: 1, probeTimeoutMs: 5_000,
    });
    c.reportFailure();
    await time.advance(30_000 + 5_000);
    expect(aborted).toBe(true);
    expect(c.get()).toBe("server_down");
    expect(c.debug().nextDelayMs).toBe(60_000);
  });

  test("a probe that throws is just a failed probe", async () => {
    const time = fakeTime();
    const c = createConnectivity({ isOnline: () => true, probe: async () => { throw new Error("boom"); }, now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer, failureThreshold: 1 });
    c.reportFailure();
    await time.advance(30_000);
    expect(c.get()).toBe("server_down");
    expect(c.debug().nextDelayMs).toBe(60_000);
  });

  test("the browser going offline cancels the pending probe; coming back online probes again, never sooner than the gap since the last one", async () => {
    const { c, time, probeCalls, goOffline, goOnline } = setup({ threshold: 1 });
    c.reportFailure();
    await time.advance(30_000); // probe 1 fails; next in 60 s
    expect(probeCalls.length).toBe(1);
    goOffline();
    expect(time.pending()).toEqual([]);
    await time.advance(10_000);
    goOnline(); // 10 s after the last probe: must wait out the rest of the 60 s gap
    expect(time.pending()).toEqual([50_000]);
    await time.advance(50_000);
    expect(probeCalls.length).toBe(2);
    expect(probeCalls[1]! - probeCalls[0]!).toBe(60_000);
  });

  test("coming back online long after the last probe probes at once (once)", async () => {
    const { c, time, probeCalls, goOffline, goOnline } = setup({ threshold: 1 });
    c.reportFailure();
    await time.advance(30_000);
    goOffline();
    await time.advance(3 * 60 * 60_000);
    goOnline();
    await time.advance(0);
    expect(probeCalls.length).toBe(2);
  });

  test("stop() cancels everything", async () => {
    const { c, time, probeCalls } = setup({ threshold: 1 });
    c.reportFailure();
    c.stop();
    await time.advance(60 * 60_000);
    expect(probeCalls).toEqual([]);
  });
});

describe("the default probe and the reporting wrapper", () => {
  const controller = (): { c: Pick<ConnectivityController, "reportFailure" | "reportSuccess">; failures: number; successes: number } => {
    const state = { failures: 0, successes: 0 };
    return { c: { reportFailure: () => { state.failures += 1; }, reportSuccess: () => { state.successes += 1; } }, get failures() { return state.failures; }, get successes() { return state.successes; } };
  };

  test("a server that answered (even 401 or 404) is up; a 5xx or a thrown fetch is down", async () => {
    expect([200, 204, 301, 401, 404, 426, 429, 499].every(answerMeansServerUp)).toBe(true);
    expect([500, 502, 503, 504, 599].some(answerMeansServerUp)).toBe(false);
    for (const [status, up] of [[200, true], [401, true], [404, true], [500, false], [503, false]] as const) {
      const probe = createDefaultProbe({ baseUrl: "https://sync.test/x/", fetchImpl: (async () => new Response("", { status })) as typeof fetch });
      expect(`${status}: ${await probe(new AbortController().signal)}`).toBe(`${status}: ${up}`);
    }
    const throwing = createDefaultProbe({ fetchImpl: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch });
    expect(await throwing(new AbortController().signal)).toBe(false);
  });

  test("the probe is one cheap, credential-free GET of /release/current", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const probe = createDefaultProbe({ baseUrl: "https://sync.test/x/", fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => { seen.push({ url: String(url), init }); return new Response("", { status: 401 }); }) as typeof fetch });
    await probe(new AbortController().signal);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://sync.test/x/release/current");
    expect(seen[0]!.init).toMatchObject({ method: "GET", credentials: "omit", cache: "no-store" });
    expect((seen[0]!.init!.headers as unknown) ?? undefined).toBeUndefined(); // no Authorization, no custom header: nothing about the person
  });

  test("withConnectivityReporting reports an answer, a 5xx and a thrown fetch, and returns/throws exactly what the call did", async () => {
    const t = controller();
    const answers: (Response | Error)[] = [new Response("ok"), new Response("no", { status: 404 }), new Response("bad", { status: 503 }), new TypeError("Failed to fetch")];
    const wrapped = withConnectivityReporting((async () => { const a = answers.shift()!; if (a instanceof Error) throw a; return a; }) as typeof fetch, t.c);
    expect((await wrapped("https://x.test/a")).status).toBe(200);
    expect((await wrapped("https://x.test/a")).status).toBe(404);
    expect((await wrapped("https://x.test/a")).status).toBe(503);
    await expect(wrapped("https://x.test/a")).rejects.toThrow("Failed to fetch");
    expect([t.successes, t.failures]).toEqual([2, 2]);
  });
});
