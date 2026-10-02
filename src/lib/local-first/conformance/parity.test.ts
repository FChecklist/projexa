// @ts-nocheck -- test files are outside tsconfig (see tsconfig.json "exclude"); the backend is imported from another checkout at run time.
/// <reference types="bun-types" />
// PARITY: the fake sync server (../__fixtures__/fake-sync-server.ts) against the REAL one.
//
// The client's unit tests all run against the fake. That is only worth something if the fake answers what the real service answers, so
// the same scenarios run here against BOTH worlds -- the fake (always) and, when CT_ROOT points at a compliance-tracker checkout
// (feat/lf-sync-backend), the real projexa-sync handler on a real Postgres (PGlite), exactly as conformance/wire.integration.test.ts builds
// it -- and every scenario asserts the SAME expected observable client state in both: the laptop's rows (title, version, clean), the
// sync and outbox reports, the error the client turns an answer into. A scenario that is green against the fake and red against the real
// world is a fake that lies; fix the fake (the real handler is the truth).
//
// Scenarios (one laptop, one project, the `tasks` kind): first sync, an update made elsewhere, a delete (tombstone), a push applied, a
// push conflict, a push whose answer is lost (duplicate on re-send), 426 for a release below the floor, 429 with Retry-After.
//
// RUN: bun test --isolate src/lib/local-first/conformance/parity.test.ts                 (the fake only)
//      CT_ROOT=/path/to/compliance-tracker bun test --isolate ...parity.test.ts          (the fake AND the real handler)
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createSyncClient } from "../sync-client";
import { createReplica } from "../replica";
import { createOutbox } from "../outbox";
import { localDbNameFor, openLocalDb } from "../local-db";
import { updateTaskLocally } from "../local-writes";
import { createFakeSyncServer, FAKE_BASE_URL } from "../__fixtures__/fake-sync-server";

setDefaultTimeout(600_000);

const CT = process.env.CT_ROOT ? process.env.CT_ROOT.replace(/\/+$/, "") : null;
if (!CT) console.log("parity: the real-handler half is skipped (set CT_ROOT to a compliance-tracker checkout to run it); the fake half runs");

// The person: their SIGN-IN id (what the laptop knows) differs from their VERIDIAN id in both worlds.
const SUB = "11111111-1111-4111-8111-111111111111";
const ORG = "org-a";
const PROJECT = "proj-a";
const START = Date.parse("2026-10-02T10:00:00Z");

/** One world the client can talk to. Everything a scenario does to the server goes through here. */
type World = {
  name: string;
  /** A real sync client signed in as the person, against this world. */
  client(o?: { release?: string; maxRetries?: number; sleep?: (ms: number) => Promise<void>; perMinute?: number }): any;
  seedTasks(ids: string[]): Promise<void>;
  editElsewhere(id: string, title: string): Promise<void>;
  deleteElsewhere(id: string): Promise<void>;
  setReleaseFloor(current: string, minCompatible: string): Promise<void>;
  loseNextPushResponse(): void;
  serverTitle(id: string): Promise<string | undefined>;
  close(): Promise<void>;
};

// ─── the fake world ──────────────────────────────────────────────────────────────────────────────────────────
function fakeWorld(): World {
  let perMinuteNow = 1_000_000;
  const clock = { now: 0 };
  const server = createFakeSyncServer({ strict: true, userId: SUB, orgId: ORG, projects: [PROJECT], kinds: [{ kind: "tasks" }], now: () => clock.now, requestsPerMinute: 1_000_000 });
  const limited = new Map<number, ReturnType<typeof createFakeSyncServer>>();
  return {
    name: "fake",
    client(o = {}) {
      if (o.perMinute) {
        // a separate fake with that cap (the real world uses a separate limiter on the same database)
        const s = limited.get(o.perMinute) ?? createFakeSyncServer({ strict: true, userId: SUB, orgId: ORG, projects: [PROJECT], kinds: [{ kind: "tasks" }], requestsPerMinute: o.perMinute, now: () => perMinuteNow });
        limited.set(o.perMinute, s);
        return s.clientWith({ maxRetries: o.maxRetries ?? 0, sleep: o.sleep ?? (async () => {}), getReleaseVersion: () => o.release ?? "dev" });
      }
      return server.clientWith({ maxRetries: o.maxRetries ?? 0, sleep: o.sleep ?? (async () => {}), getReleaseVersion: () => o.release ?? "dev" });
    },
    async seedTasks(ids) {
      for (const id of ids) server.upsert({ kind: "tasks", projectId: PROJECT, id, data: { title: `Task ${id}` } });
    },
    async editElsewhere(id, title) {
      const row = server.getRow("tasks", id)!;
      server.upsert({ kind: "tasks", projectId: PROJECT, id, data: { ...row.data, title } });
    },
    async deleteElsewhere(id) {
      server.remove({ kind: "tasks", projectId: PROJECT, id });
    },
    async setReleaseFloor(current, minCompatible) {
      server.setRelease({ current, minCompatible });
    },
    loseNextPushResponse() {
      server.loseNextResponses(1);
    },
    async serverTitle(id) {
      const r = server.getRow("tasks", id);
      return r && !r.deleted ? (r.data.title as string) : undefined;
    },
    async close() {},
  };
}

// ─── the real world (only with CT_ROOT) ─────────────────────────────────────────────────────────────────────
async function realWorld(): Promise<World> {
  const handler = await import(`${CT}/supabase/functions/projexa-sync/handler`);
  const signMod = await import(`${CT}/supabase/functions/projexa-sync/sign`);
  const awl = await import(`${CT}/src/lib/services/__test-helpers__/awl-pglite`);
  const userLink = await import(`${CT}/src/lib/services/__test-helpers__/awl-user-link-db`);
  const recs = await import(`${CT}/src/lib/services/__test-helpers__/awl-records-v2-db`);
  const db = await userLink.createUserLinkDb();
  for (const m of ["0618_build001_projexa_gateway", "0677_projexa_sync_read", "0678_projexa_sync_keys_ids", "0679_projexa_record_versions", "0680_projexa_release_registry", "0681_projexa_sync_push", "0682_projexa_work_jobs", "0683_projexa_sync_more_kinds"]) await db.exec(awl.forwardSql(m));
  const rpc = recs.pgRpc(db);
  const key = await signMod.generateKeyRecord();
  await rpc("projexa_sync_key_put", { p_kid: key.kid, p_public: key.public_jwk, p_private: key.private_jwk });
  const signing = await signMod.createSigning(key);
  const session = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" });
  // the pipeline stand-in REALLY writes the business table (the record-version triggers and the change log are the real thing)
  const execRun = async (body) => {
    const p = body.params;
    const { org_id: org, project_id: project } = body.ctx;
    if (body.function_id === "update_task") {
      const r = await db.query(`update compliance.pms_issues set title = coalesce($1, title), updated_at = now() where id = $2 and org_id = $3 and project_id = $4 returning id`, [p.title ?? null, p.issueId, org, project]);
      if (!r.rows.length) return { kind: "failed", code: "TASK_NOT_FOUND", missing: [] };
      return { kind: "done", record: { id: String(p.issueId), route: `/schedule/${p.issueId}` }, submission_id: `sub-${body.op_id}` };
    }
    return { kind: "failed", code: "FUNCTION_NOT_AVAILABLE", missing: [] };
  };
  const deps = { rpc, session, signing: async () => signing, publicKeys: async () => [{ kid: key.kid, alg: "ES256", jwk: key.public_jwk, active: true }], execRun, limiter: new handler.RateLimiter(1_000_000) };
  let lose = 0;
  const BASE = "https://real.handler.test/functions/v1/projexa-sync";
  const fetchFor = (d) => async (input, init = {}) => {
    const res = await handler.handleSync(new Request(String(input), { method: init.method ?? "GET", headers: new Headers(init.headers), body: init.body }), d);
    if (lose > 0 && String(input).endsWith("/push")) {
      lose -= 1;
      throw new TypeError("network lost after the server applied the request");
    }
    return res;
  };
  const limiters = new Map();
  return {
    name: "real",
    client(o = {}) {
      let d = deps;
      if (o.perMinute) {
        d = limiters.get(o.perMinute) ?? { ...deps, limiter: new handler.RateLimiter(o.perMinute) };
        limiters.set(o.perMinute, d);
      }
      return createSyncClient({ getAccessToken: async () => `tok:${SUB}`, baseUrl: BASE, fetchImpl: fetchFor(d), sleep: o.sleep ?? (async () => {}), maxRetries: o.maxRetries ?? 0, getReleaseVersion: () => o.release ?? "dev" });
    },
    async seedTasks(ids) {
      await db.exec(recs.insert("pms_issues", ids.map((id, i) => ({ id, org_id: ORG, project_id: PROJECT, type_id: "ty", status_id: "st", number: 100 + i, title: `Task ${id}`, updated_at: "2026-09-01T10:00:00Z" }))));
    },
    async editElsewhere(id, title) {
      await db.query(`update compliance.pms_issues set title = $1, updated_at = now() where id = $2`, [title, id]);
    },
    async deleteElsewhere(id) {
      await db.query(`delete from compliance.pms_issues where id = $1`, [id]);
    },
    async setReleaseFloor(current, minCompatible) {
      const man = { release_version: current, git_sha: "abc1234", built_at: "2026-10-02T10:00:00Z", protocol: 2, schema: 3, bundle: { path: `/_release/px-${current}.tar.gz`, size: 1, sha256: "b".repeat(64) }, files: [{ path: "a.js", sha256: "1".repeat(64), size: 1 }] };
      const r = await rpc("projexa_release_register", { p_manifest: { ...man, manifest_sha256: await signMod.sha256Hex(signMod.canonicalize(man)) } });
      if (r.error) throw new Error(`register failed: ${r.error.message}`);
      await rpc("projexa_release_set_min_compatible", { p_release: minCompatible });
      deps.releaseBox = { at: 0, value: null };
      for (const d of limiters.values()) d.releaseBox = { at: 0, value: null };
    },
    loseNextPushResponse() {
      lose = 1;
    },
    async serverTitle(id) {
      return (await db.query(`select title from compliance.pms_issues where id = $1`, [id])).rows[0]?.title;
    },
    async close() {
      await db.close();
    },
  };
}

// ─── the scenarios: identical code and identical expectations for both worlds ─────────────────────────────────

function scenarios(label: string, make: () => Promise<World>, enabled: boolean) {
  const suite = enabled ? describe : describe.skip;
  suite(`parity [${label}]`, () => {
    let world: World;
    let idb: IDBFactory;
    let client, replica, outbox;
    let clock = START;
    const local = async () => {
      const db = await openLocalDb(idb, localDbNameFor(SUB));
      try {
        const rows = await db.listByProject(ORG, "tasks", PROJECT);
        return Object.fromEntries(rows.filter((r) => ["t1", "t2"].includes(r.id.slice("tasks:".length))).map((r) => [r.id.slice("tasks:".length), { title: r.data.title, version: r.serverVersion, dirty: r.dirty ?? null }]));
      } finally {
        db.close();
      }
    };

    beforeAll(async () => {
      if (!enabled) return;
      // the laptop's "local-first is on" switch (local-writes reads it)
      globalThis.localStorage = { getItem: (k) => (k === "px-local-first" ? "1" : null), setItem() {}, removeItem() {} };
      world = await make();
      idb = new IDBFactory();
      client = world.client();
      replica = createReplica({ userId: SUB, client, idb, yieldFn: async () => {} });
      outbox = createOutbox({ userId: SUB, client, deviceId: "device-parity-0001", idb, now: () => clock, sleep: async () => {}, autoFlush: false, locks: null });
      await world.seedTasks(["t1", "t2"]);
    });
    afterAll(async () => {
      outbox?.dispose();
      await world?.close();
    });

    test("P1 first sync: the person's rows arrive at version 1, the sign-in id is accepted", async () => {
      const report = await replica.sync();
      expect({ status: report.status, issues: report.issues }).toEqual({ status: "done", issues: [] });
      expect(await local()).toEqual({ t1: { title: "Task t1", version: 1, dirty: null }, t2: { title: "Task t2", version: 1, dirty: null } });
    });

    test("P2 incremental sync: an update made elsewhere arrives at version 2", async () => {
      await world.editElsewhere("t1", "Edited elsewhere");
      const report = await replica.sync();
      expect({ status: report.status, issues: report.issues }).toEqual({ status: "done", issues: [] });
      expect((await local()).t1).toEqual({ title: "Edited elsewhere", version: 2, dirty: null });
    });

    test("P3 tombstone: a row deleted on the server leaves the laptop", async () => {
      await world.deleteElsewhere("t2");
      const report = await replica.sync();
      expect(report.status).toBe("done");
      expect(Object.keys(await local())).toEqual(["t1"]);
    });

    test("P4 push applied: the edit reaches the server once, the row is clean at version 3", async () => {
      expect(await updateTaskLocally({ projectId: PROJECT, taskId: "t1", patch: { title: "Mine" } }, { userId: SUB, idb, outbox })).toMatchObject({ queued: true });
      const report = await outbox.flush();
      expect(report).toMatchObject({ sent: 1, applied: 1, conflicts: 0, rejected: 0, failed: 0, remaining: 0 });
      expect((await local()).t1).toEqual({ title: "Mine", version: 3, dirty: null });
      expect(await world.serverTitle("t1")).toBe("Mine");
    });

    test("P5 push conflict: nothing is written, both sides are shown; keep_theirs leaves the server's row", async () => {
      const q = await updateTaskLocally({ projectId: PROJECT, taskId: "t1", patch: { title: "Mine again" } }, { userId: SUB, idb, outbox });
      await world.editElsewhere("t1", "Theirs");
      expect(await outbox.flush()).toMatchObject({ conflicts: 1, applied: 0 });
      const conflicts = await outbox.getConflicts();
      expect(conflicts.map((c) => [c.server?.data?.title, c.server?.version])).toEqual([["Theirs", 4]]);
      expect(await world.serverTitle("t1")).toBe("Theirs");
      await outbox.resolve(q.opId, "keep_theirs");
      expect((await local()).t1).toEqual({ title: "Theirs", version: 4, dirty: null });
    });

    test("P6 a lost answer: the re-send of the same op is a duplicate, applied once, the row ends clean", async () => {
      await updateTaskLocally({ projectId: PROJECT, taskId: "t1", patch: { title: "Exactly once" } }, { userId: SUB, idb, outbox });
      world.loseNextPushResponse();
      expect(await outbox.flush()).toMatchObject({ applied: 0, failed: 1 });
      expect(await world.serverTitle("t1")).toBe("Exactly once"); // the server DID it
      clock += 10 * 60_000;
      expect(await outbox.flush()).toMatchObject({ duplicates: 1, remaining: 0 });
      const t1 = (await local()).t1;
      expect(t1.title).toBe("Exactly once");
      expect(t1.dirty).toBeNull();
      expect(t1.version).toBe(5);
    });

    test("P7 426: a release below the floor is told to update, with current and minimum; a dev build is not gated", async () => {
      await world.setReleaseFloor("2026.10.02-001", "2026.10.01-001");
      const err = await world.client({ release: "2026.09.30-001" }).manifest().catch((e) => e);
      expect({ kind: err.kind, status: err.status, update: err.update }).toEqual({ kind: "update_required", status: 426, update: { current: "2026.10.02-001", minCompatible: "2026.10.01-001" } });
      expect((await world.client({ release: "dev" }).manifest()).release).toMatchObject({ current: "2026.10.02-001", min_compatible: "2026.10.01-001", protocol: 2 });
    });

    test("P8 429: over the per-minute cap the answer is 429 with Retry-After, which the client waits (capped at 30 s) before its retry", async () => {
      const waits: number[] = [];
      const c = world.client({ perMinute: 1, maxRetries: 1, sleep: async (ms) => void waits.push(ms) });
      await c.manifest();
      const err = await c.manifest().catch((e) => e);
      expect({ kind: err.kind, status: err.status }).toEqual({ kind: "rate_limited", status: 429 });
      expect(waits).toEqual([30_000]);
    });
  });
}

scenarios("fake", async () => fakeWorld(), true);
scenarios("real handler", realWorld, !!CT);

test("the fake world's client really talks to the fake (not to the network)", () => {
  expect(FAKE_BASE_URL).toContain("fake.sync.test");
});
