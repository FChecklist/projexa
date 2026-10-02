import { beforeEach, describe, expect, test } from "bun:test";
import { createFakeClock, settle, type FakeClock } from "./__fixtures__/fake-clock";
import { createFakeJobsServer, type FakeJobsServer } from "./__fixtures__/fake-jobs-server";
import { JobsError, type JobsApi } from "./jobs-api";
import { computeJob, type BoqRollupResult } from "./job-types";
import { createJobRunner } from "./runner";
import { createInProcessExecutor } from "./worker";
import { requestJob } from "./requester";

const ROWS = [{ id: "1", boqId: "b", amount: "5" }, { id: "2", boqId: "b", amount: "7.5" }];
let clock: FakeClock;
let server: FakeJobsServer;
const localAnswer = () => computeJob("boq_rollup", ROWS, {}) as Promise<BoqRollupResult>;
const isRollup = (r: unknown): r is BoqRollupResult => typeof r === "object" && r !== null && "lineCount" in r && "byCategory" in r;

beforeEach(() => {
  clock = createFakeClock();
  server = createFakeJobsServer(clock.now);
  server.addUser({ id: "alice", org: "A", viewClass: "money", projects: ["p1"] });
  server.addUser({ id: "bob", org: "A", viewClass: "money", projects: ["p1"] });
});

const base = (api: JobsApi, over: Record<string, unknown> = {}) => ({ api, type: "boq_rollup" as const, projectId: "p1", params: {}, fallback: localAnswer, accept: isRollup, now: clock.now, sleep: clock.sleep, timeoutMs: 8_000, pollMs: 1_500, ...over });

describe("requestJob", () => {
  test("uses a helper's answer when one comes back in time", async () => {
    const helper = createJobRunner({
      api: server.apiFor("alice"), executor: createInProcessExecutor(), env: { now: clock.now, isVisible: () => true, isOnline: () => true, isLowBattery: () => false, saveData: () => false, lastActivityAt: clock.now },
      timers: clock, deviceId: "device-alice-02", loadInput: async () => ({ rows: ROWS, params: {} }), hasProject: async () => true, loadOptOut: async () => false, saveOptOut: async () => undefined,
    });
    await helper.start();
    const p = requestJob(base(server.apiFor("alice"), { timeoutMs: 60_000 }));
    await clock.advance(30_000);
    const out = await p;
    expect(out.source).toBe("remote");
    expect(out.proposal).toBe(true);
    expect(out.result).toEqual(await localAnswer()); // offloaded and local answers agree
  });

  test("falls back to computing locally when nobody answers in time", async () => {
    const p = requestJob(base(server.apiFor("alice")));
    await clock.advance(20_000);
    const out = await p;
    expect(out).toMatchObject({ source: "local", fallbackReason: "timeout" });
    expect(out.result.total).toBe("12.50");
  });

  test("falls back at once when offline: no request is made", async () => {
    const out = await requestJob(base(server.apiFor("alice"), { isOnline: () => false }));
    expect(out).toMatchObject({ source: "local", fallbackReason: "offline" });
    expect(server.calls.length).toBe(0);
  });

  test("falls back on any API error (signed out, server down, rate limit)", async () => {
    for (const kind of ["signed_out", "server", "network", "rate_limited"] as const) {
      const api = { ...server.apiFor("alice"), enqueue: async () => { throw new JobsError(kind, kind); } } as JobsApi;
      expect(await requestJob(base(api))).toMatchObject({ source: "local", fallbackReason: kind });
    }
  });

  test("falls back when the helper reported failure, and when a result has the wrong shape", async () => {
    const failing = { ...server.apiFor("alice"), get: async () => ({ jobStatus: "failed" as const, attempts: 1, type: "boq_rollup", result: null, errorCode: "PROJECT_NOT_LOCAL", ranHere: false }) } as JobsApi;
    const p = requestJob(base(failing));
    await clock.advance(5_000);
    expect(await p).toMatchObject({ source: "local", fallbackReason: "PROJECT_NOT_LOCAL" });

    const weird = { ...server.apiFor("alice"), get: async () => ({ jobStatus: "done" as const, attempts: 1, type: "boq_rollup", result: { total: "999999" }, errorCode: null, ranHere: false }) } as JobsApi;
    const q = requestJob(base(weird));
    await clock.advance(5_000);
    const out = await q;
    expect(out).toMatchObject({ source: "local", fallbackReason: "bad_result" });
    expect(out.result.total).toBe("12.50");
  });

  test("an aborted request falls back instead of hanging", async () => {
    const ctl = new AbortController();
    const p = requestJob(base(server.apiFor("alice"), { signal: ctl.signal }));
    await settle();
    ctl.abort();
    await clock.advance(2_000);
    expect(await p).toMatchObject({ source: "local", fallbackReason: "aborted" });
  });

  test("only the requester's own devices by default; colleagues only when allowColleagues is set", async () => {
    const a = requestJob(base(server.apiFor("alice")));
    await clock.advance(1_000);
    expect(server.jobs[0].visibility).toBe("requester");
    const b = requestJob(base(server.apiFor("alice"), { allowColleagues: true }));
    await clock.advance(1_000);
    expect(server.jobs[1].visibility).toBe("project");
    await clock.advance(20_000);
    await a; await b;
  });
});
