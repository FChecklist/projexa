// COST (package lf-fc, review cost:COST-04 / wire:F07): the replica's circuit breaker, measured against the shared fake sync server
// (real HTTP Responses, the REAL sync client with its retries). Before: one failed run at P=10 was 851 requests (/pull answering 500 or
// 429 for every pair, each pair retried) and every new tab repeated it; the daily-quota 429 was retried 3x per pair.
import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "../__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "../local-db";
import { createRequestPacer } from "../rate-pacer";
import { COOLDOWN_KEY, createReplica, refusedKey, type Cooldown } from "../replica";
import { BACKEND_KINDS } from "./harness";

const T0 = Date.parse("2026-10-05T08:00:00Z");

function world(o: { projects?: number; perMinute?: number } = {}) {
  const clock = { t: T0 };
  const projects = Array.from({ length: o.projects ?? 10 }, (_, i) => `p${i + 1}`);
  const server = createFakeSyncServer({ projects, kinds: BACKEND_KINDS, now: () => clock.t, requestsPerMinute: o.perMinute ?? Number.MAX_SAFE_INTEGER });
  for (const p of projects) for (const k of BACKEND_KINDS) server.upsert({ kind: k.kind, projectId: p, id: `${p}-${k.kind}`, data: { n: 1 } });
  const idb = new IDBFactory();
  // the app's shared replica uses maxRetries 2 (replica-shared.ts)
  const client = server.clientWith({ maxRetries: 2 });
  const replica = (extra: Record<string, unknown> = {}) =>
    createReplica({ userId: server.userId, client, idb, yieldFn: async () => {}, now: () => clock.t, pacer: null, ...extra });
  return { clock, server, idb, replica, projects };
}

async function cooldownOf(server: FakeSyncServer, idb: IDBFactory): Promise<Cooldown | null> {
  const db = await openLocalDb(idb, localDbNameFor(server.userId));
  try { return (await db.getMeta<Cooldown | null>(COOLDOWN_KEY)) ?? null; } finally { db.close(); }
}

describe("the circuit breaker (cost:COST-04)", () => {
  test("STORM A, every /pull answers 500 (P=10): the run stops after 3 failures in a row -- at most 30 requests, not 851", async () => {
    const w = world();
    w.server.failNext({ status: 500, times: 1e9, path: "/pull" });
    const r = await w.replica().sync();
    console.log(`[breaker] STORM A (P=10, /pull 500): ${w.server.requests.length} requests, status ${r.status}`);
    expect(w.server.requests.length).toBeLessThanOrEqual(30);
    expect(r.status).toBe("error");
    expect((await cooldownOf(w.server, w.idb))?.until).toBeGreaterThan(w.clock.t);
  });

  test("the stop holds for the next run, a screen's syncProject AND another tab (another replica on the same database): zero requests", async () => {
    const w = world();
    w.server.failNext({ status: 500, times: 1e9, path: "/pull" });
    await w.replica().sync();
    const before = w.server.requests.length;
    const again = await w.replica().sync();
    const screen = await w.replica().syncProject("p1", "tasks");
    expect(w.server.requests.length).toBe(before);
    expect(again.issues[0]?.reason).toBe("cooling_down");
    expect(screen.status).toBe("error");
  });

  test("after the stop it resumes by itself; a clean run clears it; a second failure in a row waits LONGER (exponential)", async () => {
    const w = world({ projects: 2 });
    w.server.failNext({ status: 503, times: 1e9, path: "/pull" });
    await w.replica().sync();
    const first = (await cooldownOf(w.server, w.idb))!;
    w.clock.t = first.until; // the stop is over, the service is still failing
    await w.replica().sync();
    const second = (await cooldownOf(w.server, w.idb))!;
    expect(second.trips).toBe(2);
    expect(second.until - w.clock.t).toBeGreaterThan(first.until - T0);
    // the service recovers; after the stop the run completes and the stop is gone
    w.server.failNext({ status: 503, times: 0, path: "/pull" });
    w.clock.t = second.until;
    const ok = await w.replica().sync();
    expect(ok.status).toBe("done");
    expect(await cooldownOf(w.server, w.idb)).toBeNull();
  });

  test("STORM C, the per-minute cap (429 + Retry-After: 60): the run stops at the FIRST 429, the stop lasts the minute, the pacer holds every request", async () => {
    const w = world({ perMinute: 40 }); // the fake's real limiter on the test clock, at 40 a minute
    let waited = 0;
    const pacer = createRequestPacer({ now: () => w.clock.t, sleep: async (ms) => { waited += ms; w.clock.t += ms; } });
    const r = await w.replica({ pacer }).sync();
    const limited = w.server.requests.filter((q) => q.status === 429).length;
    console.log(`[breaker] STORM C (cap 40/min): ${w.server.requests.length} requests, ${limited} answered 429, status ${r.status}`);
    // the two workers in flight at most, each with its client's own (1 + 2) attempts -- after that the run is stopped
    expect(limited).toBeLessThanOrEqual(6);
    expect(w.server.requests.length).toBeLessThanOrEqual(45);
    const cd = (await cooldownOf(w.server, w.idb))!;
    expect(cd.reason).toBe("rate_limited");
    expect(cd.until - w.clock.t).toBeGreaterThanOrEqual(60_000);
    // the pacer was told: the next request through it waits for the Retry-After
    await pacer.take();
    expect(waited).toBeGreaterThanOrEqual(60_000);
  });

  test("the DAILY quota (429 with NO Retry-After): not retried, the run stops at once and stays stopped for at least an hour", async () => {
    const w = world();
    w.server.failNext({ status: 429, times: 1e9, path: "/pull" });
    const r = await w.replica().sync();
    const pulls = w.server.requests.filter((q) => q.path === "/pull").length;
    expect(pulls).toBeLessThanOrEqual(2); // one per worker in flight, none retried
    expect(r.status).toBe("error");
    const cd = (await cooldownOf(w.server, w.idb))!;
    expect(cd.until - w.clock.t).toBeGreaterThanOrEqual(60 * 60_000);
  });

  test("a failed MANIFEST (the service down) also stops the next runs instead of asking again on every screen", async () => {
    const w = world({ projects: 2 });
    w.server.failNext({ status: 500, times: 1e9, path: "/manifest" });
    await w.replica().sync();
    const before = w.server.requests.length;
    expect(before).toBe(3); // the manifest and its 2 retries
    await w.replica().sync();
    await w.replica().syncProject("p1", "tasks");
    expect(w.server.requests.length).toBe(before);
  });

  test("a (project, kind) the server REFUSES (400) is reported and not asked again for a day; the rest of the run goes on", async () => {
    const w = world({ projects: 1 });
    w.server.failNext({ status: 400, times: 1, path: "/pull" });
    const r = await w.replica().sync();
    expect(r.status).toBe("partial");
    const refusedPair = r.issues.find((i) => i.kind)!;
    const db = await openLocalDb(w.idb, localDbNameFor(w.server.userId));
    expect(await db.getMeta(refusedKey(refusedPair.projectId!, refusedPair.kind!))).toMatchObject({ status: 400 });
    db.close();
    const before = w.server.requests.length;
    const again = await w.replica().sync();
    const askedAgain = w.server.requests.slice(before).filter((q) => q.path === "/pull" && q.body?.kind === refusedPair.kind && !Array.isArray(q.body?.ids));
    expect(askedAgain).toEqual([]);
    expect(again.issues.map((i) => i.reason)).toContain("refused");
    // a day later it is asked again (and now answers)
    w.clock.t += 24 * 60 * 60_000 + 1;
    const later = await w.replica().sync();
    expect(later.status).toBe("done");
  });

  test("a single passing failure does not stop the run: the next success resets the count", async () => {
    const w = world({ projects: 3 });
    w.server.failNext({ status: 500, times: 3, path: "/pull" }); // one pull's 3 attempts fail, then the service is fine
    const r = await w.replica().sync();
    expect(await cooldownOf(w.server, w.idb)).toBeNull();
    expect(r.projectsSynced).toBe(2); // only the project of the one failed pair is incomplete
  });
});
