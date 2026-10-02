import { beforeEach, describe, expect, test } from "bun:test";
import { createFakeClock, settle, type FakeClock } from "./__fixtures__/fake-clock";
import { createFakeJobsServer, type FakeJobsServer } from "./__fixtures__/fake-jobs-server";
import { ACTIVE_POLL_MS, IDLE_POLL_MS, createJobRunner, type JobRunner, type RunnerEnv } from "./runner";
import { JobsError, type ClaimedJob, type JobsApi } from "./jobs-api";
import { JobExecutionError, createInProcessExecutor, type JobExecutor } from "./worker";

const ROWS = [{ id: "1", boqId: "b", amount: "5", category: "Civil" }, { id: "2", boqId: "b", amount: "7.5", category: "Civil" }];

type Env = RunnerEnv & { visible: boolean; online: boolean; battery: boolean; save: boolean; activity: number };
let clock: FakeClock;
let server: FakeJobsServer;
let env: Env;

function makeEnv(): Env {
  const e = {
    visible: true, online: true, battery: false, save: false, activity: clock.now(),
    now: () => clock.now(), isVisible: () => e.visible, isOnline: () => e.online, isLowBattery: () => e.battery, saveData: () => e.save, lastActivityAt: () => e.activity,
  };
  return e;
}

type Harness = { runner: JobRunner; executed: Array<{ type: string }>; store: { optOut: boolean } };
function makeRunner(userId: string, over: Partial<Parameters<typeof createJobRunner>[0]> & { executor?: JobExecutor; api?: JobsApi; localProjects?: string[] } = {}): Harness {
  const executed: Array<{ type: string }> = [];
  const store = { optOut: false };
  const inner = createInProcessExecutor();
  const executor: JobExecutor = over.executor ?? (async (type, rows, params, signal) => { executed.push({ type }); return inner(type, rows, params, signal); });
  const runner = createJobRunner({
    api: over.api ?? server.apiFor(userId), executor, env, timers: clock, deviceId: `device-${userId}-01`,
    loadInput: async () => ({ rows: ROWS, params: {} }),
    hasProject: async (p) => (over.localProjects ?? ["p1"]).includes(p),
    loadOptOut: async () => store.optOut,
    saveOptOut: async (v) => { store.optOut = v; },
    heartbeatMs: over.heartbeatMs,
  });
  return { runner, executed, store };
}

beforeEach(() => {
  clock = createFakeClock();
  server = createFakeJobsServer(clock.now);
  env = makeEnv();
  server.addUser({ id: "alice", org: "A", viewClass: "money", projects: ["p1", "p2"] });
  server.addUser({ id: "bob", org: "A", viewClass: "money", projects: ["p1"] });
  server.addUser({ id: "dave", org: "A", viewClass: "nomoney", projects: ["p1"] });
  server.addUser({ id: "carol", org: "B", viewClass: "money", projects: ["p1"] });
});

describe("cost rule: no request unless this laptop is visible, online, idle and willing", () => {
  test("nothing is sent while hidden, offline, low on battery, in data-saver, opted out, or signed out; polling resumes on refresh", async () => {
    const h = makeRunner("alice");
    env.visible = false;
    await h.runner.start();
    await clock.advance(30 * 60_000);
    expect(server.callsBy("claim").length).toBe(0);
    expect(h.runner.getIndicator()).toMatchObject({ state: "paused", reason: "hidden" });

    env.visible = true; env.online = false; h.runner.refresh();
    await clock.advance(30 * 60_000);
    expect(server.callsBy("claim").length).toBe(0);
    expect(h.runner.getIndicator().reason).toBe("offline");

    env.online = true; env.battery = true; h.runner.refresh();
    await clock.advance(30 * 60_000);
    expect(server.callsBy("claim").length).toBe(0);
    expect(h.runner.getIndicator().reason).toBe("low_battery");

    env.battery = false; env.save = true; h.runner.refresh();
    await clock.advance(30 * 60_000);
    expect(server.callsBy("claim").length).toBe(0);
    expect(h.runner.getIndicator().reason).toBe("data_saver");

    env.save = false; await h.runner.setOptedOut(true);
    await clock.advance(30 * 60_000);
    expect(server.callsBy("claim").length).toBe(0);
    expect(h.runner.getIndicator()).toMatchObject({ state: "off", reason: "opted_out" });
    expect(clock.pending()).toBe(0); // not even a timer is armed

    await h.runner.setOptedOut(false);
    await clock.advance(IDLE_POLL_MS + ACTIVE_POLL_MS);
    expect(server.callsBy("claim").length).toBeGreaterThan(0);
  });

  test("a tab that goes hidden mid-wait sends nothing when the timer would have fired", async () => {
    const h = makeRunner("alice");
    await h.runner.start();
    await clock.advance(5_000);
    env.visible = false; // no refresh(): the poll itself must re-check
    await clock.advance(60_000);
    expect(server.callsBy("claim").length).toBe(0);
  });

  test("pollOnce itself refuses to call the server while paused", async () => {
    const h = makeRunner("alice");
    await h.runner.start();
    env.visible = false;
    expect(await h.runner.pollOnce()).toBe("paused");
    expect(server.callsBy("claim").length).toBe(0);
  });

  test("adaptive interval: 20 s with recent activity, 120 s once quiet; one tiny request each", async () => {
    const h = makeRunner("alice");
    await h.runner.start();
    await clock.advance(10 * 60_000);
    const at = server.callsBy("claim").map((c) => c.at);
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    expect(gaps[0]).toBe(ACTIVE_POLL_MS);
    expect(gaps[gaps.length - 1]).toBe(IDLE_POLL_MS);
    expect(gaps.filter((g) => g === ACTIVE_POLL_MS).length).toBeGreaterThan(5);
    // 10 minutes: ~15 fast polls for the first 5 minutes, then ~3 slow ones. Never one per second.
    expect(at.length).toBeLessThan(25);
  });

  test("errors back off instead of hammering the server; a signed-out session stops polling", async () => {
    let calls = 0;
    const api = { ...server.apiFor("alice"), claim: async () => { calls += 1; throw new JobsError("server", "boom", 500); } } as JobsApi;
    const h = makeRunner("alice", { api });
    await h.runner.start();
    await clock.advance(10 * 60_000);
    expect(calls).toBeLessThan(15);

    let signedOut = 0;
    const api2 = { ...server.apiFor("alice"), claim: async () => { signedOut += 1; throw new JobsError("signed_out", "no", 401); } } as JobsApi;
    const h2 = makeRunner("alice", { api: api2 });
    await h2.runner.start();
    await clock.advance(60 * 60_000);
    expect(signedOut).toBe(1);
    expect(h2.runner.getIndicator()).toMatchObject({ state: "paused", reason: "signed_out" });
  });
});

describe("running a job", () => {
  test("claims the requester's own job, runs it, submits, and the requester reads the result; indicator shows helping then waiting", async () => {
    const alice = server.apiFor("alice");
    const { jobId } = await alice.enqueue({ projectId: "p1", type: "boq_rollup", params: {} });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const inner = createInProcessExecutor();
    const h = makeRunner("alice", { executor: async (t, r, p, s) => { await gate; return inner(t, r, p, s); } });
    const seen: string[] = [];
    h.runner.subscribe((i) => seen.push(`${i.state}:${i.forYou}`));
    await h.runner.start();
    await clock.advance(ACTIVE_POLL_MS);
    expect(h.runner.getIndicator()).toMatchObject({ state: "helping", jobType: "boq_rollup", forYou: true });
    release();
    await settle();
    expect(h.runner.getIndicator()).toMatchObject({ state: "waiting", helped: 1 });
    const got = await alice.get({ jobId });
    expect(got.jobStatus).toBe("done");
    expect((got.result as { total: string }).total).toBe("12.50");
    expect(got.ranHere).toBe(true);
    expect(seen).toContain("helping:true");
  });

  test("a job the server hands over with an UNKNOWN type is never run; the server is told UNKNOWN_TYPE", async () => {
    const results: Array<{ ok: boolean; error?: string }> = [];
    const evil: ClaimedJob = { job_id: "j9", type: "wire_money", project_id: "p1", params: {}, lease_id: "l9", lease_expires_at: new Date(clock.now() + 60_000).toISOString(), attempt: 1, requested_by_you: false };
    const api: JobsApi = { ...server.apiFor("alice"), claim: async () => ({ job: evil, serverTime: new Date(clock.now()).toISOString() }), result: async (r) => { results.push(r); return { outcome: "accepted", jobStatus: "failed" }; } };
    const h = makeRunner("alice", { api });
    await h.runner.start();
    expect(await h.runner.pollOnce()).toBe("refused");
    expect(h.executed.length).toBe(0);
    expect(results).toEqual([{ jobId: "j9", leaseId: "l9", ok: false, error: "UNKNOWN_TYPE" }]);
  });

  test("a job for a project that is not in the local manifest is never run", async () => {
    const alice = server.apiFor("alice");
    const { jobId } = await alice.enqueue({ projectId: "p2", type: "boq_rollup", params: {} });
    const h = makeRunner("alice", { localProjects: ["p1"] });
    await h.runner.start();
    expect(await h.runner.pollOnce()).toBe("refused");
    expect(h.executed.length).toBe(0);
    expect(await alice.get({ jobId })).toMatchObject({ jobStatus: "failed", errorCode: "PROJECT_NOT_LOCAL" });
  });

  test("the loop asks for the four known types only", async () => {
    let asked: string[] = [];
    const api = { ...server.apiFor("alice"), claim: async (r: { types: string[] }) => { asked = r.types; return { job: null, serverTime: null }; } } as JobsApi;
    const h = makeRunner("alice", { api });
    await h.runner.start();
    await h.runner.pollOnce();
    expect(asked).toEqual(["boq_rollup", "csv_export", "report_preview", "search_index"]);
  });

  test("a failing job is reported failed with a short code; an oversized result is refused before sending", async () => {
    const alice = server.apiFor("alice");
    const a = await alice.enqueue({ projectId: "p1", type: "boq_rollup", params: {} });
    const h = makeRunner("alice", { executor: async () => { throw new Error("secret detail"); } });
    await h.runner.start();
    expect(await h.runner.pollOnce()).toBe("failed");
    expect(await alice.get({ jobId: a.jobId })).toMatchObject({ jobStatus: "failed", errorCode: "RUN_FAILED" });

    const b = await alice.enqueue({ projectId: "p1", type: "csv_export", params: { kind: "k" } });
    const big = makeRunner("alice", { executor: async () => ({ csv: "x".repeat(300_000) }) });
    await big.runner.start();
    expect(await big.runner.pollOnce()).toBe("failed");
    expect(await alice.get({ jobId: b.jobId })).toMatchObject({ jobStatus: "failed", errorCode: "RESULT_TOO_LARGE" });
  });

  test("never claims a second job while one is running", async () => {
    const alice = server.apiFor("alice");
    await alice.enqueue({ projectId: "p1", type: "boq_rollup", params: {} });
    await alice.enqueue({ projectId: "p1", type: "boq_rollup", params: {} });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = makeRunner("alice", { executor: async () => { await gate; return { ok: 1 }; } });
    await h.runner.start();
    await clock.advance(ACTIVE_POLL_MS);
    expect(server.callsBy("claim").length).toBe(1);
    expect(await h.runner.pollOnce()).toBe("busy");
    expect(server.callsBy("claim").length).toBe(1);
    release();
    await settle();
  });
});

describe("leases", () => {
  const slowExecutor = (clk: () => FakeClock, ms: number): JobExecutor => async (_t, _r, _p, signal) => {
    await new Promise<void>((resolve, reject) => {
      clk().setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => reject(new JobExecutionError("CANCELLED")), { once: true });
    });
    return { done: true };
  };

  test("heartbeats keep a long job alive past the 60 s lease and its result is accepted", async () => {
    const alice = server.apiFor("alice");
    const { jobId } = await alice.enqueue({ projectId: "p1", type: "boq_rollup", params: {} });
    const h = makeRunner("alice", { executor: slowExecutor(() => clock, 150_000) });
    await h.runner.start();
    await clock.advance(ACTIVE_POLL_MS);
    await clock.advance(160_000);
    expect(server.callsBy("heartbeat").length).toBeGreaterThanOrEqual(6);
    expect((await alice.get({ jobId })).jobStatus).toBe("done");
    expect(h.runner.getIndicator().helped).toBe(1);
  });

  test("a lease that runs out (heartbeats lost): the work is stopped and NOTHING is submitted", async () => {
    const alice = server.apiFor("alice");
    const { jobId } = await alice.enqueue({ projectId: "p1", type: "boq_rollup", params: {} });
    const api: JobsApi = { ...server.apiFor("alice"), heartbeat: async () => { throw new JobsError("network", "down"); } };
    const h = makeRunner("alice", { api, executor: slowExecutor(() => clock, 150_000) });
    await h.runner.start();
    await clock.advance(ACTIVE_POLL_MS);
    await clock.advance(200_000);
    expect(server.callsBy("result").length).toBe(0);
    expect(h.runner.getIndicator().helped).toBe(0);
    expect((await alice.get({ jobId })).jobStatus).not.toBe("done");
  });

  test("the server says lease_expired on a heartbeat: the run is cancelled, no result is sent", async () => {
    await server.apiFor("alice").enqueue({ projectId: "p1", type: "boq_rollup", params: {} });
    const h = makeRunner("alice", { heartbeatMs: 90_000, executor: slowExecutor(() => clock, 150_000) }); // first heartbeat comes after the 60 s lease is gone
    await h.runner.start();
    await clock.advance(ACTIVE_POLL_MS);
    await clock.advance(200_000);
    expect(server.callsBy("heartbeat")[0]).toBeDefined();
    expect(server.callsBy("result").length).toBe(0);
    expect(h.runner.getIndicator().helped).toBe(0);
  });

  test("an executor that ignores cancellation and finishes after expiry is still not submitted", async () => {
    await server.apiFor("alice").enqueue({ projectId: "p1", type: "boq_rollup", params: {} });
    const stubborn: JobExecutor = async () => { await clock.sleep(100_000); return { done: true }; };
    const api: JobsApi = { ...server.apiFor("alice"), heartbeat: async () => { throw new JobsError("network", "down"); } };
    const h = makeRunner("alice", { api, executor: stubborn });
    await h.runner.start();
    await clock.advance(ACTIVE_POLL_MS);
    await clock.advance(120_000);
    expect(server.callsBy("result").length).toBe(0);
    expect(h.runner.getIndicator().helped).toBe(0);
  });

  test("the server answering lease_expired to a submitted result is not counted as success", async () => {
    await server.apiFor("alice").enqueue({ projectId: "p1", type: "boq_rollup", params: {} });
    const api: JobsApi = { ...server.apiFor("alice"), result: async () => ({ outcome: "lease_expired", jobStatus: null }) };
    const h = makeRunner("alice", { api });
    await h.runner.start();
    expect(await h.runner.pollOnce()).toBe("lost");
    expect(h.runner.getIndicator().helped).toBe(0);
  });

  test("a lost lease means the job is offered again and another laptop finishes it", async () => {
    const alice = server.apiFor("alice");
    const { jobId } = await alice.enqueue({ projectId: "p1", type: "boq_rollup", params: {} });
    const deadApi: JobsApi = { ...server.apiFor("alice"), heartbeat: async () => { throw new JobsError("network", "down"); } };
    const first = makeRunner("alice", { api: deadApi, executor: slowExecutor(() => clock, 500_000) });
    await first.runner.start();
    await clock.advance(ACTIVE_POLL_MS + 90_000);
    first.runner.stop();
    const second = makeRunner("alice");
    await second.runner.start();
    await clock.advance(IDLE_POLL_MS);
    const got = await alice.get({ jobId });
    expect(got.jobStatus).toBe("done");
    expect(got.attempts).toBeGreaterThanOrEqual(2); // the first laptop may have retried once more before it was stopped
  });
});

describe("opt-out and who may help", () => {
  test("opting out is stored and a new runner honours it without a single request", async () => {
    const h = makeRunner("alice");
    await h.runner.start();
    await h.runner.setOptedOut(true);
    expect(h.store.optOut).toBe(true);
    const again = makeRunner("alice");
    again.store.optOut = true;
    await again.runner.start();
    await clock.advance(30 * 60_000);
    expect(server.callsBy("claim").length).toBe(0);
  });

  test("opting out while a job runs stops it and submits nothing", async () => {
    await server.apiFor("alice").enqueue({ projectId: "p1", type: "boq_rollup", params: {} });
    const exec: JobExecutor = (_t, _r, _p, signal) => new Promise((_res, rej) => signal?.addEventListener("abort", () => rej(new JobExecutionError("CANCELLED")), { once: true }));
    const h = makeRunner("alice", { executor: exec });
    await h.runner.start();
    await clock.advance(ACTIVE_POLL_MS);
    expect(h.runner.getIndicator().state).toBe("helping");
    await h.runner.setOptedOut(true);
    await clock.advance(5_000);
    expect(server.callsBy("result").length).toBe(0);
    expect(h.runner.getIndicator().state).toBe("off");
  });

  test("by default only the requester's own devices run a job; a colleague runs it only after the requester opted in, with the same view class and organisation", async () => {
    const alice = server.apiFor("alice");
    await alice.enqueue({ projectId: "p1", type: "boq_rollup", params: {} });
    const bob = makeRunner("bob");
    await bob.runner.start();
    expect(await bob.runner.pollOnce()).toBe("no_job");
    const other = makeRunner("alice");
    await other.runner.start();
    expect(await other.runner.pollOnce()).toBe("ran");

    await alice.enqueue({ projectId: "p1", type: "boq_rollup", params: {}, visibility: "project" });
    for (const stranger of ["dave", "carol"]) {
      const h = makeRunner(stranger);
      await h.runner.start();
      expect(await h.runner.pollOnce()).toBe("no_job");
    }
    expect(await bob.runner.pollOnce()).toBe("ran");
    expect(bob.runner.getIndicator()).toMatchObject({ helped: 1 });
  });
});
