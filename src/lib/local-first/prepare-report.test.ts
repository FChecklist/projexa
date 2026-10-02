import { describe, expect, test } from "bun:test";
import {
  HEARTBEAT_MS, MIN_GAP_MS, PENDING_KEY, classifyFailure, createPrepareReporter, stageOf, type PrepareReport,
} from "./prepare-report";
import type { PrepareProgress } from "./prepare-workspace";

// OUR side must know every laptop's preparation: where it is, that it is still alive, and why it stopped.

type St = "waiting" | "running" | "done" | "failed";
const steps = (w: St, a: St, d: St, p: St, perr?: string) => [
  { id: "worker" as const, label: "w", state: w },
  { id: "app" as const, label: "a", state: a },
  { id: "database" as const, label: "d", state: d },
  { id: "projects" as const, label: "p", state: p, ...(perr ? { error: perr } : {}) },
];
const prog = (percent: number, s: ReturnType<typeof steps>, o: Partial<PrepareProgress> = {}): PrepareProgress =>
  ({ percent, steps: s, elapsedMs: 0, remainingMs: 1, finished: false, timedOut: false, ...o }) as PrepareProgress;

function harness(sendOk = true) {
  const sent: PrepareReport[] = [];
  const beacons: PrepareReport[] = [];
  let clock = 1_000_000;
  const store = new Map<string, string>();
  let beat: (() => void) | null = null;
  let ok = sendOk;
  const reporter = createPrepareReporter({
    deviceId: "laptop-test-0001",
    release: () => "2026.10.02-865",
    send: async (r) => { if (ok) sent.push(r); return ok; },
    beacon: (r) => { beacons.push(r); },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); }, removeItem: (k) => { store.delete(k); } },
    now: () => clock,
    setInterval: (fn) => { beat = fn; return 1; },
    clearInterval: () => { beat = null; },
  });
  return {
    reporter, sent, beacons, store,
    tick: (ms: number) => { clock += ms; },
    heartbeat: () => beat?.(),
    setOk: (v: boolean) => { ok = v; },
    hasTimer: () => beat !== null,
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("stage and reason classes", () => {
  test("the stage is the first step that is not done; done only when everything is", () => {
    expect(stageOf(prog(5, steps("running", "waiting", "waiting", "waiting")))).toBe("worker");
    expect(stageOf(prog(40, steps("done", "running", "waiting", "waiting")))).toBe("app");
    expect(stageOf(prog(80, steps("done", "done", "done", "running")))).toBe("projects");
    expect(stageOf(prog(100, steps("done", "done", "done", "done"), { finished: true }))).toBe("done");
    expect(stageOf(prog(100, steps("done", "done", "done", "done"), { finished: true, timedOut: true }))).not.toBe("done");
  });
  test("failures get a reason class a person can act on", () => {
    expect(classifyFailure("projects", "The laptop copy service is not reachable yet, so your projects will open from the server for now.", false)).toBe("service_unreachable");
    expect(classifyFailure("projects", "You are signed out, so your projects could not be copied. Sign in again.", false)).toBe("signed_out");
    expect(classifyFailure("worker", "This browser cannot keep PROJEXA on the laptop (no service worker).", false)).toBe("no_service_worker");
    expect(classifyFailure("worker", "The laptop worker did not start.", false)).toBe("worker_failed");
    expect(classifyFailure("app", "x", false)).toBe("download_failed");
    expect(classifyFailure("database", "QuotaExceededError storage", false)).toBe("storage_blocked");
    expect(classifyFailure("projects", "anything", true)).toBe("timeout");
    expect(classifyFailure("projects", "weird", false)).toBe("other");
  });
});

describe("what we are told", () => {
  test("the first report goes at once, then percentage steps, and 100% with status done", async () => {
    const h = harness();
    h.reporter.start();
    h.reporter.progress(prog(0, steps("running", "waiting", "waiting", "waiting")));
    await settle();
    expect(h.sent.at(-1)).toMatchObject({ stage: "worker", percent: 0, status: "running", attempt: 1, device_id: "laptop-test-0001", release_version: "2026.10.02-865", error_class: null });
    h.tick(MIN_GAP_MS + 1);
    h.reporter.progress(prog(60, steps("done", "done", "done", "running")));
    await settle();
    expect(h.sent.at(-1)).toMatchObject({ stage: "projects", percent: 60 });
    h.reporter.progress(prog(100, steps("done", "done", "done", "done"), { finished: true }));
    await settle();
    expect(h.sent.at(-1)).toMatchObject({ stage: "done", percent: 100, status: "done", error_class: null });
  });

  test("a failure is sent at once with its reason, and a second line (this site's log) is told when the service cannot be reached", async () => {
    const h = harness(false);
    h.reporter.start();
    h.reporter.progress(prog(70, steps("done", "done", "done", "failed", "The laptop copy service is not reachable yet, so your projects will open from the server for now."), { finished: true }));
    await settle();
    expect(h.sent).toEqual([]); // the service did not take it ...
    expect(h.beacons.at(-1)).toMatchObject({ status: "failed", stage: "projects", error_class: "service_unreachable", percent: 70 }); // ... but we were still told
    expect(JSON.parse(h.store.get(PENDING_KEY)!)).toMatchObject({ status: "failed" }); // and it is kept to send later
  });

  test("a report that could not be sent is delivered by the next start, so a laptop that was offline still tells us afterwards", async () => {
    const h = harness(false);
    h.reporter.progress(prog(30, steps("done", "running", "waiting", "waiting"), {}));
    await settle();
    h.setOk(true);
    h.reporter.start();
    await settle();
    expect(h.sent.at(-1)).toMatchObject({ stage: "app", percent: 30 });
    expect(h.store.has(PENDING_KEY)).toBe(false);
  });

  test("a retry is reported as `retrying` with a higher attempt number", async () => {
    const h = harness();
    h.reporter.progress(prog(20, steps("done", "running", "waiting", "waiting")));
    await settle();
    h.reporter.retry();
    h.tick(MIN_GAP_MS + 1);
    h.reporter.progress(prog(5, steps("running", "waiting", "waiting", "waiting")));
    await settle();
    expect(h.sent.at(-1)).toMatchObject({ status: "retrying", attempt: 2 });
  });
});

describe("silence is the signal", () => {
  test("while the run is alive it reports every heartbeat; a stopped run reports nothing more", async () => {
    const h = harness();
    h.reporter.start();
    h.reporter.progress(prog(45, steps("done", "done", "running", "waiting")));
    await settle();
    const before = h.sent.length;
    h.heartbeat();
    await settle();
    expect(h.sent.length).toBe(before + 1);
    expect(h.sent.at(-1)).toMatchObject({ percent: 45, status: "running" });
    h.reporter.stop();
    expect(h.hasTimer()).toBe(false);
    h.heartbeat();
    await settle();
    expect(h.sent.length).toBe(before + 1);
    expect(HEARTBEAT_MS).toBeLessThanOrEqual(30_000); // well inside the server's 3-minute stall window
  });

  test("after 100% there is no more heartbeat (a finished laptop is not a stalled one)", async () => {
    const h = harness();
    h.reporter.start();
    h.reporter.progress(prog(100, steps("done", "done", "done", "done"), { finished: true }));
    await settle();
    const n = h.sent.length;
    h.heartbeat();
    await settle();
    expect(h.sent.length).toBe(n);
  });
});
