// @ts-nocheck -- test files are outside tsconfig (see tsconfig.json "exclude"); the backend is imported from another checkout at run time.
/// <reference types="bun-types" />
// PROJEXA LOCAL-FIRST: WIRE CONFORMANCE between the REAL laptop client and the REAL backend, in one process, no network, no live database.
//
//   client  : this repo                         src/lib/local-first/{sync-client,replica,outbox,local-writes,boq-local}.ts (fake-indexeddb for IndexedDB)
//   backend : FChecklist/compliance-tracker    supabase/functions/projexa-sync/handler.ts + sign.ts (the REAL Edge handler), from $CT_ROOT
//   database: PGlite (real Postgres as WASM) built like the backend's projexa-sync-push.pglite.test.ts: 0618, 0677..0683 and the AI work link registry
//   glue    : the client's `fetchImpl` turns every request into `handleSync(new Request(...))`; the session verifier accepts `tok:<sub>`;
//             the pushed write's pipeline (ai-work-link-exec) is a scripted stand-in that REALLY writes the business table, so the
//             record-version triggers, the change log and the signed rows are all the real thing.
//
// WHY THIS FILE EXISTS (review package FA, 2026-10-02): the client engine was built and tested only against a fake server written from
// the contract text, and the fake hid real defects (every real sync ended in user_mismatch; the BOQ screen dropped every real row; a
// 200-id pull was a 413 that wedged a project). This file runs the real client against the real handler so that class of defect has
// nowhere to hide. It started as the independent reviewer's harness (compliance-tracker ai-os/cloud-agents/review-findings/
// lf-wire.integration.test.ts.txt, tests [W01]..[W32]); see docs/local-first/CONFORMANCE.md for how to run it and its CI job.
//
// RUN:  CT_ROOT=/path/to/compliance-tracker  bun test --isolate src/lib/local-first/conformance/wire.integration.test.ts
//       (CT_ROOT is a checkout of compliance-tracker at feat/lf-sync-backend, with `bun install` done there). Without CT_ROOT the whole
//       file is skipped with a one-line reason, so this repo's normal `bun test` stays fast and independent of the backend.
//
// OWNERS: every title carries who owns the behaviour: [client:FA] (this package: wire, identity, BOQ shape, contract),
// [client:FB] (the outbox package), [client:FC] (replica scheduling / rate budget), [backend] (compliance-tracker). Tests whose fix is
// still in flight in ANOTHER package are kept here but skipped until that work merges:
//   BACKEND-PENDING   runs when LF_BACKEND_HARDENED=1   (claude/lf-d1-*, d2, d3: CORS, 413 cap, transient codes, `uncertain`)
//   CLIENT-PENDING:FB runs when LF_CLIENT_FB=1          (claude/lf-fb-outbox-safety: record_kind, server-deleted conflicts, 64 KB op, NOT_LINKED)
//   CLIENT-PENDING:FC runs when LF_CLIENT_FC=1          (replica request budget under the 120/min cap)
// LF_RUN_PENDING=1 runs every pending test (to see what is still red). The tests share one database and one laptop and run in order.
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import * as syncClientMod from "../sync-client";
import * as replicaMod from "../replica";
import * as outboxMod from "../outbox";
import * as localDbMod from "../local-db";
import * as writesMod from "../local-writes";
import * as fakeMod from "../__fixtures__/fake-sync-server";
import * as boqLocalMod from "../boq-local";
import * as scopeAdapter from "../shell/modules/scope-adapter";

setDefaultTimeout(600_000);

const CT = process.env.CT_ROOT ? process.env.CT_ROOT.replace(/\/+$/, "") : null;
const SKIP_REASON = "wire conformance skipped: set CT_ROOT to a compliance-tracker checkout (feat/lf-sync-backend) to run the real backend handler";
if (!CT) console.log(SKIP_REASON);

const env = (k: string) => process.env[k] === "1" || process.env.LF_RUN_PENDING === "1";
const PENDING = {
  backend: { tag: "BACKEND-PENDING", on: env("LF_BACKEND_HARDENED") },
  FB: { tag: "CLIENT-PENDING:FB", on: env("LF_CLIENT_FB") },
  FC: { tag: "CLIENT-PENDING:FC", on: env("LF_CLIENT_FC") },
} as const;

/** A harness test: `[Wnn] [owner] title`, skipped when its owner's fix has not merged yet (see PENDING). */
function wt(id: string, owner: "client:FA" | "client:FB" | "client:FC" | "backend", title: string, fn: () => Promise<void>, pending?: keyof typeof PENDING) {
  const p = pending ? PENDING[pending] : null;
  const name = `[${id}] [${owner}]${p ? ` ${p.tag}` : ""} ${title}`;
  if (p && !p.on) test.skip(name, fn);
  else test(name, fn);
}

const BASE = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync";
// sign-in ids (the verified token's sub) of the backend fixture's people; their VERIDIAN ids (compliance.users.id) are the keys
const SUBS = { "u-mgr": "11111111-1111-4111-8111-111111111111", "u-mem": "22222222-2222-4222-8222-222222222222", "u-view": "66666666-6666-4666-8666-666666666666", "u-b": "44444444-4444-4444-8444-444444444444" };

// ---- the backend, loaded in beforeAll from CT_ROOT ------------------------------------------------------------------------------------------
let handler, signMod, awl, userLink, recs;
let db, rpc, key, signing;

const seen = []; // every request the client really sent, with the answer
const calls = []; // every write that reached the (stand-in) pipeline
const script = new Map(); // op_id -> scripted outcome
const nextScript = []; // outcomes for the next ops, in order
const inject = { dropPushResponse: 0, failPull: 0 }; // network faults: the server DID the work but the answer is lost / the next /pull never answers
const session = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" });
const noYield = async () => {};

async function stand(body) {
  calls.push(body);
  const scripted = script.get(body.op_id) ?? nextScript.shift();
  if (scripted === "throw") throw new Error("connection lost");
  if (scripted) return scripted;
  const p = body.params;
  const { org_id: org, project_id: project, user_id: user } = body.ctx;
  if (body.function_id === "update_task") {
    const r = await db.query(`update compliance.pms_issues set title = coalesce($1, title), description = coalesce($5, description), updated_at = now() where id = $2 and org_id = $3 and project_id = $4 returning id`, [p.title ?? null, p.issueId, org, project, p.description ?? null]);
    if (!r.rows.length) return { kind: "failed", code: "TASK_NOT_FOUND", missing: [] };
    return { kind: "done", record: { id: String(p.issueId), route: `/schedule/${p.issueId}` }, submission_id: `sub-${body.op_id}` };
  }
  if (body.function_id === "create_rfi") {
    const n = Number((await db.query(`select coalesce(max(number), 0) + 1 as n from compliance.construction_rfis where project_id = $1`, [project])).rows[0].n);
    const r = await db.query(`insert into compliance.construction_rfis (org_id, project_id, number, subject, question, raised_by_id) values ($1, $2, $3, $4, $5, $6) returning id`, [org, project, n, p.subject, p.question, user]);
    return { kind: "done", record: { id: r.rows[0].id, route: `/rfis/${r.rows[0].id}` }, submission_id: `sub-${body.op_id}` };
  }
  if (body.function_id === "answer_rfi") {
    const r = await db.query(`update compliance.construction_rfis set answer = $1, status = 'answered', answered_by_id = $2, answered_at = now() where id = $3 and org_id = $4 and project_id = $5 returning id`, [p.answer, user, p.rfiId, org, project]);
    if (!r.rows.length) return { kind: "failed", code: "RFI_NOT_FOUND", missing: [] };
    return { kind: "done", record: { id: String(p.rfiId), route: `/rfis/${p.rfiId}` }, submission_id: `sub-${body.op_id}` };
  }
  return { kind: "failed", code: "FUNCTION_NOT_AVAILABLE", missing: [] };
}

function depsWith(over = {}) {
  return { rpc, session, signing: async () => signing, publicKeys: async () => [{ kid: key.kid, alg: "ES256", jwk: key.public_jwk, active: true }], execRun: stand, limiter: new handler.RateLimiter(1_000_000), ...over };
}
let deps;

/** The client's fetch, answered by the real handler in this process. Records what was really sent. */
function fetchFor(d) {
  return async (input, init = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    const rec = { method: init.method ?? "GET", path: url.slice(BASE.length), headers: Object.fromEntries(headers.entries()), body: init.body === undefined ? undefined : JSON.parse(init.body), bodyBytes: typeof init.body === "string" ? init.body.length : 0 };
    seen.push(rec);
    if (inject.failPull > 0 && rec.path === "/pull") {
      inject.failPull -= 1;
      rec.status = "network";
      throw new TypeError("network down");
    }
    const res = await handler.handleSync(new Request(url, { method: rec.method, headers, body: init.body }), d);
    rec.status = res.status;
    rec.resHeaders = Object.fromEntries(res.headers.entries());
    if (inject.dropPushResponse > 0 && rec.path === "/push") {
      inject.dropPushResponse -= 1;
      rec.status = "response lost";
      throw new TypeError("network lost after the server applied the request");
    }
    return res;
  };
}

/** A sync client signed in as `who` (a fixture key such as "u-mgr", or a raw sign-in id). */
function clientFor(who, o = {}) {
  return syncClientMod.createSyncClient({
    getAccessToken: async () => `tok:${SUBS[who] ?? who}`,
    baseUrl: BASE,
    fetchImpl: fetchFor(o.deps ?? deps),
    sleep: async () => {},
    maxRetries: o.maxRetries ?? 0,
    getReleaseVersion: () => o.release ?? "dev",
  });
}

const idb = () => new IDBFactory();
let IDB; // the laptop's IndexedDB for the main person
// The laptop knows the person by their SIGN-IN id (supabase.auth.getUser().id, the token's sub): that is what the app passes to the replica
// and the outbox, and what names the local database. The server names the same person "u-mgr" (compliance.users.id).
const U = SUBS["u-mgr"];
let clock = Date.parse("2026-10-02T10:00:00Z");
let clientMgr, replica, outbox;

const openDb = (user = U, factory = IDB) => localDbMod.openLocalDb(factory, localDbMod.localDbNameFor(user));
async function withLocal(fn) {
  const l = await openDb();
  try {
    return await fn(l);
  } finally {
    l.close();
  }
}
const localRow = (kind, id) => withLocal((l) => l.getRecord(kind, id));
const localList = (kind, project = "proj-a") => withLocal((l) => l.listByProject("org-a", kind, project));
const feedPosition = (project = "proj-a") => withLocal(async (l) => (await l.getMeta(localDbMod.changeCursorKey(project)))?.seq);
const head = async (kind, id) => {
  const r = (await db.query(`select version, deleted from platform.projexa_record_head where kind = $1 and record_id = $2`, [kind, id])).rows[0];
  return r ? { version: Number(r.version), deleted: r.deleted } : undefined;
};
const task = (id, extra = {}) => ({ id, org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 1, title: `Task ${id}`, updated_at: "2026-09-01T10:00:00Z", ...extra });
const pushes = () => seen.filter((r) => r.path === "/push");
const pendingOp = async (opId) => (await outbox.listPending()).find((o) => o.opId === opId);
const cuidLike = () => "c" + crypto.randomUUID().replace(/-/g, "").slice(0, 23); // 24-char cuid2-like ids (compliance.users.id style)

beforeAll(async () => {
  if (!CT) return;
  handler = await import(`${CT}/supabase/functions/projexa-sync/handler`);
  signMod = await import(`${CT}/supabase/functions/projexa-sync/sign`);
  awl = await import(`${CT}/src/lib/services/__test-helpers__/awl-pglite`);
  userLink = await import(`${CT}/src/lib/services/__test-helpers__/awl-user-link-db`);
  recs = await import(`${CT}/src/lib/services/__test-helpers__/awl-records-v2-db`);

  db = await userLink.createUserLinkDb();
  for (const m of ["0618_build001_projexa_gateway", "0677_projexa_sync_read", "0678_projexa_sync_keys_ids", "0679_projexa_record_versions", "0680_projexa_release_registry", "0681_projexa_sync_push", "0682_projexa_work_jobs", "0683_projexa_sync_more_kinds"]) await db.exec(awl.forwardSql(m));
  rpc = recs.pgRpc(db);
  key = await signMod.generateKeyRecord();
  await rpc("projexa_sync_key_put", { p_kid: key.kid, p_public: key.public_jwk, p_private: key.private_jwk });
  signing = await signMod.createSigning(key);
  await db.exec(
    recs.insert("pms_issues", [task("t1", { number: 1 }), task("t2", { number: 2 }), task("t3", { number: 3 }), task("t4", { number: 4 }), { ...task("tp", { number: 1 }), project_id: "proj-priv" }]) +
      recs.insert("construction_rfis", [
        { org_id: "org-a", project_id: "proj-a", number: 1, subject: "Beam depth", question: "Confirm 450?", raised_by_id: "u-mem" },
        { org_id: "org-a", project_id: "proj-a", number: 2, subject: "Door schedule", question: "Which hinge?", raised_by_id: "u-mem" },
      ]) +
      `insert into compliance.construction_boqs (id, org_id, project_id, title, created_by_id) values ('boq1', 'org-a', 'proj-a', 'Villa BOQ', 'u-mgr');
       insert into compliance.construction_boq_line_items (id, boq_id, description, unit, org_id, quantity, rate, amount, item_code) values
         ('li1', 'boq1', 'Excavation', 'm3', 'org-a', 120.5, 450, 54225, '1.1'), ('li2', 'boq1', 'PCC', 'm3', 'org-a', 30, 5200, 156000, '1.2');`,
  );
  deps = depsWith();
  IDB = idb();
  clientMgr = clientFor("u-mgr");
  replica = replicaMod.createReplica({ userId: U, client: clientMgr, idb: IDB, yieldFn: noYield });
  outbox = outboxMod.createOutbox({ userId: U, client: clientMgr, deviceId: crypto.randomUUID(), idb: IDB, now: () => clock, sleep: async () => {}, autoFlush: false, locks: null });
  // the laptop's "local-first is on" switch (the screens' own flag)
  globalThis.localStorage = { getItem: (k) => (k === "px-local-first" ? "1" : null), setItem() {}, removeItem() {} };
}, 900_000);

afterAll(async () => {
  outbox?.dispose();
  await db?.close();
});

const suite = CT ? describe : describe.skip;

// =====================================================================================================================================================
suite("A. identity and the first contact", () => {
  wt("W01", "client:FA", "manifest: every field the client reads is there with the right type, including the sign-in id (user.auth_user_id)", async () => {
    const m = await clientMgr.manifest();
    expect(m.user).toMatchObject({ id: "u-mgr", org_id: "org-a", auth_user_id: SUBS["u-mgr"] });
    expect(m.projects.map((p) => p.id)).toContain("proj-a");
    expect(m.kinds.length).toBe(28);
    expect(m.kinds.every((k) => k.project_scoped === true && typeof k.kind === "string")).toBe(true);
    expect(m.view_class).toMatch(/^[0-9a-f]{16}$/);
    expect(m.release).toMatchObject({ protocol: 2 });
    const raw = seen.find((r) => r.path === "/manifest");
    expect(raw.status).toBe(200);
    expect(raw.headers["x-px-client"]).toBe(`dev; protocol=2; schema=${localDbMod.LOCAL_DB_VERSION}`);
    console.log("[W01] release block of the real manifest (empty registry):", JSON.stringify(m.release), "| cursor_field values:", JSON.stringify([...new Set(m.kinds.map((k) => k.cursor_field))]));
  });

  wt("W02", "client:FA", "the replica accepts the person the app signs in as: the app passes the sign-in id (token sub), the manifest names compliance.users.id AND auth_user_id", async () => {
    // M24Shell.tsx and WorkspacePrepare.tsx take `data.user.id` of the browser Supabase client; getSharedReplica(userId) hands exactly that to createReplica.
    const factory = idb();
    const r = replicaMod.createReplica({ userId: SUBS["u-mgr"], client: clientFor("u-mgr"), idb: factory, yieldFn: noYield });
    const report = await r.sync();
    expect(report.issues.map((i) => i.reason)).not.toContain("user_mismatch");
    expect(report.status).toBe("done");
    // the person's local database is named by the sign-in id, and holds rows
    const l = await localDbMod.openLocalDb(factory, localDbMod.localDbNameFor(SUBS["u-mgr"]));
    try {
      expect((await l.listByProject("org-a", "tasks", "proj-a")).length).toBeGreaterThan(0);
    } finally {
      l.close();
    }
  });

  wt("W02b", "client:FA", "a laptop whose sign-in is another person's never stores the manifest's data (the person-isolation guard holds on the real wire)", async () => {
    const factory = idb();
    // the token is u-mgr's, the laptop belongs to u-mem: the real manifest's auth_user_id names u-mgr
    const r = replicaMod.createReplica({ userId: SUBS["u-mem"], client: clientFor("u-mgr"), idb: factory, yieldFn: noYield });
    const report = await r.sync();
    expect(report.issues.map((i) => i.reason)).toContain("user_mismatch");
    expect(report.status).toBe("error");
    expect(report.itemsStored).toBe(0);
    // ... and the compliance id itself is not accepted as the laptop's sign-in id either (the server sends auth_user_id: it is required)
    const r2 = replicaMod.createReplica({ userId: "u-mgr", client: clientFor("u-mgr"), idb: idb(), yieldFn: noYield });
    expect((await r2.sync()).issues.map((i) => i.reason)).toContain("user_mismatch");
  });
});

suite("B. pull: full sync, signatures, versions", () => {
  wt("W03", "client:FA", "a full sync of every project and kind completes and stores versioned, signed rows", async () => {
    const before = seen.length;
    const report = await replica.sync();
    const mine = seen.slice(before);
    console.log("[W03] first sync:", JSON.stringify({ status: report.status, stored: report.itemsStored, projects: report.projectsTotal, issues: report.issues, requests: mine.length, byPath: mine.reduce((a, r) => ((a[r.path] = (a[r.path] ?? 0) + 1), a), {}) }));
    expect(report.issues).toEqual([]);
    expect(report.status).toBe("done");
    const t1 = await localRow("tasks", "t1");
    expect(t1).toBeTruthy();
    expect(Number.isInteger(t1.serverVersion)).toBe(true);
    expect(typeof t1.sig).toBe("string");
    expect(typeof t1.kid).toBe("string");
    expect((await localList("rfis")).length).toBe(2);
    const all = await withLocal((l) => l.listByOrg("org-a"));
    expect(all.every((r) => r.orgId === "org-a")).toBe(true);
  });

  wt("W04", "client:FA", "every stored row's signature verifies with the server's public key, over the CLIENT's canonical form", async () => {
    const pub = await signMod.importPublic(key.public_jwk);
    for (const [kind, id] of [["tasks", "t1"], ["tasks", "t2"], ["rfis", (await localList("rfis"))[0].id.slice(5)], ["boq_lines", "li1"]]) {
      const row = await localRow(kind, id);
      const message = await fakeMod.signedMessage({ org: row.orgId, project: row.projectId, kind, id, version: row.serverVersion, updated_at: row.serverUpdatedAt, data: row.data });
      expect(await signMod.verifyMessage(pub, message, row.sig)).toBe(true);
    }
  });

  wt("W05", "client:FA", "canonical JSON and the signed message are byte-identical between the client fixture and the backend (fixed vector + 2000 random values)", async () => {
    const v = signMod.TEST_VECTOR;
    expect(signMod.canonicalize(v.value)).toBe(v.canonical);
    expect(fakeMod.canonicalJson(v.value)).toBe(v.canonical);
    expect(await signMod.sha256Hex(v.canonical)).toBe(v.sha256);
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const atoms = [0, -0, 1, 2.5, -0.5, 1e21, 1e-7, 123456789012345680000, 'é\n"', "\u{1F600}", "\ud800", "", "x".repeat(40), true, false, null, undefined, NaN, Infinity];
    const gen = (d) => {
      const t = rnd();
      if (d > 3 || t < 0.35) return atoms[Math.floor(rnd() * atoms.length)];
      if (t < 0.6) return Array.from({ length: Math.floor(rnd() * 4) }, () => gen(d + 1));
      const o = {};
      for (let i = 0, n = Math.floor(rnd() * 5); i < n; i++) o[["b", "a", "é", "Z", "10", "2", "_k"][Math.floor(rnd() * 7)] + (rnd() < 0.3 ? "x" : "")] = gen(d + 1);
      return o;
    };
    for (let i = 0; i < 2000; i++) {
      const x = gen(0);
      expect(fakeMod.canonicalJson(x)).toBe(signMod.canonicalize(x));
    }
    const parts = { org: "o", project: "p", kind: "k", id: "i", version: 3, updated_at: "2026-10-02T10:00:00.000000Z", data: { a: 1 } };
    expect(await fakeMod.signedMessage(parts)).toBe(signMod.itemMessage({ org: "o", project: "p", kind: "k", id: "i", version: 3, updatedAt: parts.updated_at, dataHash: await signMod.sha256Hex(signMod.canonicalize({ a: 1 })) }));
  });

  wt("W06", "client:FA", "pull by ids: 200 real-length uuid ids AND 200 cuid ids are accepted, each request at most 80 ids and 3,500 bytes", async () => {
    for (const mk of [() => crypto.randomUUID(), cuidLike]) {
      const before = seen.length;
      const ids = Array.from({ length: 200 }, mk);
      const page = await clientMgr.pullIds({ projectId: "proj-a", kind: "rfis", ids });
      expect(page.items).toEqual([]);
      const sent = seen.slice(before).filter((r) => r.path === "/pull");
      expect(sent.every((r) => r.status === 200)).toBe(true);
      expect(sent.flatMap((r) => r.body.ids).sort()).toEqual([...ids].sort());
      expect(Math.max(...sent.map((r) => r.body.ids.length))).toBeLessThanOrEqual(syncClientMod.SYNC_IDS_LIMIT);
      expect(Math.max(...sent.map((r) => r.bodyBytes))).toBeLessThanOrEqual(syncClientMod.SYNC_IDS_BODY_MAX_BYTES);
    }
    expect(syncClientMod.SYNC_IDS_LIMIT).toBeLessThanOrEqual(80);
    expect(syncClientMod.SYNC_IDS_BODY_MAX_BYTES).toBeLessThanOrEqual(3500);
    expect(syncClientMod.SYNC_IDS_BODY_MAX_BYTES).toBeLessThan(handler.BODY_MAX_BYTES); // the client chunks below the deployed server's cap
  });

  wt("W06b", "backend", "the server accepts its own PULL_IDS_MAX (200) ids per /pull, whatever their length", async () => {
    const limitFor = async (mk) => {
      let lo = 1, hi = 200;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const res = await handler.handleSync(new Request(`${BASE}/pull`, { method: "POST", headers: { authorization: `Bearer tok:${U}` }, body: JSON.stringify({ project_id: "proj-a", kind: "rfis", ids: Array.from({ length: mid }, mk) }) }), deps);
        if (res.status === 413) hi = mid - 1;
        else lo = mid;
      }
      return lo;
    };
    const uuid = await limitFor(() => crypto.randomUUID());
    const cuid = await limitFor(cuidLike);
    console.log(`[W06b] most ids per /pull before 413: 36-char uuid ids = ${uuid}, 24-char cuid ids = ${cuid}`);
    expect(Math.min(uuid, cuid)).toBe(200);
  }, "backend");

  wt("W07", "client:FA", "pull by ids: 98 uuid ids (inside the cap) work, with a partial hit; items carry version, signature and the page the kid", async () => {
    const real = (await localList("rfis")).map((r) => r.id.slice(5));
    const ids = [...real, ...Array.from({ length: 96 }, () => crypto.randomUUID())];
    const page = await clientMgr.pullIds({ projectId: "proj-a", kind: "rfis", ids });
    expect(page.items.map((i) => i.id).sort()).toEqual([...real].sort());
    expect(page.items.every((i) => Number.isInteger(i.version) && typeof i.sig === "string")).toBe(true);
    expect(page.kid).toBe(key.kid);
  });

  wt("W08", "client:FA", "pull keyset: the cursor the real server returns is accepted back, and the second page ends", async () => {
    const p1 = await clientMgr.pull({ projectId: "proj-a", kind: "tasks", after: null, limit: 2 });
    expect(p1.items.length).toBe(2);
    expect(p1.has_more).toBe(true);
    expect(typeof p1.next_cursor).toBe("string");
    const p2 = await clientMgr.pull({ projectId: "proj-a", kind: "tasks", after: p1.next_cursor, limit: 500 });
    expect(p2.items.length).toBe(2);
    expect(p2.has_more).toBe(false);
    expect(p1.kid).toBe(key.kid);
  });

  wt("W09", "client:FA", "an unknown project / unreadable project / unknown kind is ONE 404 and the client turns it into not_found", async () => {
    for (const body of [{ project_id: "nope", kind: "tasks" }, { project_id: "proj-b", kind: "tasks" }, { project_id: "proj-a", kind: "nonsense" }]) {
      await expect(clientMgr.pull({ projectId: body.project_id, kind: body.kind, after: null })).rejects.toMatchObject({ kind: "not_found" });
    }
  });

  wt("W10", "client:FB", "a person who is not linked: what the client reports (403 NOT_LINKED) (informational)", async () => {
    const c = clientFor("99999999-9999-4999-8999-999999999999");
    const err = await c.manifest().catch((e) => e);
    console.log("[W10] not-linked person ->", err.kind, err.status, err.message);
    expect(err.kind).toBeDefined();
  });
});

suite("C. the change feed and deletes", () => {
  wt("W11", "client:FA", "changes: null -> head only; then a change by someone else is named, with its version and op", async () => {
    const head0 = await clientMgr.changes({ projectId: "proj-a", afterSeq: null, limit: 1 });
    expect(head0.changes).toEqual([]);
    expect(Number.isInteger(head0.head_seq)).toBe(true);
    await db.exec(`update compliance.pms_issues set title = 'Edited elsewhere', updated_at = now() where id = 't2'`);
    const page = await clientMgr.changes({ projectId: "proj-a", afterSeq: head0.head_seq, limit: 1000 });
    expect(page.changes).toEqual([expect.objectContaining({ kind: "tasks", id: "t2", op: "U", version: (await head("tasks", "t2")).version })]);
    expect(page.next_seq).toBe(page.head_seq);
  });

  wt("W12", "client:FA", "a change made by someone else reaches the laptop through a sync (an updated_at kind, and a created_at-only kind the keyset cannot see)", async () => {
    const rfi = (await localList("rfis"))[0];
    const rfiId = rfi.id.slice(5);
    const before = rfi.serverVersion;
    await db.query(`update compliance.construction_rfis set answer = 'Use 450', status = 'answered', answered_at = now() where id = $1`, [rfiId]);
    const report = await replica.sync();
    expect(report.issues).toEqual([]);
    const t2 = await localRow("tasks", "t2");
    expect(t2.data.title).toBe("Edited elsewhere");
    const r = await localRow("rfis", rfiId);
    expect(r.serverVersion).toBe(before + 1);
    expect(JSON.stringify(r.data)).toContain("Use 450");
  });

  wt("W13", "client:FA", "a row deleted on the server disappears from the laptop (tombstone), and /ids agrees", async () => {
    await db.exec(`delete from compliance.pms_issues where id = 't4'`);
    expect(await localRow("tasks", "t4")).toBeTruthy();
    const report = await replica.sync();
    expect(report.issues).toEqual([]);
    expect(await localRow("tasks", "t4")).toBeUndefined();
    const ids = await clientMgr.ids({ projectId: "proj-a", kind: "tasks", afterId: null });
    expect(ids.ids).not.toContain("t4");
    expect([...ids.ids].sort()).toEqual((await localList("tasks")).map((r) => r.id.slice(6)).sort());
    expect((await replica.reconcileDeletes("proj-a", "tasks", { force: true })).removed).toBe(0);
  });

  wt("W14", "client:FA", "the change feed is read with an overlap (0679 header KNOWN LIMIT: re-ask from after_seq - 200, because seq is an identity and commits land out of order)", async () => {
    const pos = await feedPosition();
    const before = seen.length;
    await db.exec(`update compliance.pms_issues set title = 'overlap probe', updated_at = now() where id = 't2'`);
    await replica.sync();
    const ask = seen.slice(before).find((r) => r.path === "/changes" && r.body.project_id === "proj-a" && r.body.after_seq !== null);
    console.log(`[W14] laptop held feed position ${pos}; first /changes ask used after_seq=${ask.body.after_seq}`);
    expect(replicaMod.CHANGE_FEED_OVERLAP).toBe(200);
    expect(ask.body.after_seq).toBe(Math.max(0, pos - replicaMod.CHANGE_FEED_OVERLAP));
    expect(await feedPosition()).toBeGreaterThan(pos); // the position itself still moves forward
  });

  wt("W14b", "client:FA", "a change that becomes visible with a sequence number BELOW the laptop's feed position (a long transaction that took its seq early) is still picked up (client overlap stopgap; the proper fix is the backend's xid horizon)", async () => {
    // the long transaction takes seq G now ...
    const seqName = (await db.query(`select pg_get_serial_sequence('platform.projexa_change_log', 'seq') as s`)).rows[0].s;
    const G = Number((await db.query(`select nextval('${seqName}') as n`)).rows[0].n);
    // ... other writers commit meanwhile and the laptop syncs past G ...
    await db.exec(`update compliance.pms_issues set title = 'moved on 1', updated_at = now() where id = 't2'`);
    await db.exec(`update compliance.pms_issues set title = 'moved on 2', updated_at = now() where id = 't2'`);
    await replica.sync();
    expect(await feedPosition()).toBeGreaterThan(G);
    // ... then it commits: its row carries the START time of the transaction and its change-log row carries seq G
    await db.exec(`set session_replication_role = replica`);
    await db.exec(recs.insert("construction_rfis", [{ id: "late-rfi-1", org_id: "org-a", project_id: "proj-a", number: 90, subject: "Late commit", question: "q", raised_by_id: "u-mem", created_at: "2026-01-01T00:00:00Z" }]));
    await db.exec(`insert into platform.projexa_record_head (org_id, kind, record_id, project_id, version, content_hash) values ('org-a', 'rfis', 'late-rfi-1', 'proj-a', 1, 'x')`);
    await db.exec(`insert into platform.projexa_change_log (seq, org_id, project_id, kind, record_id, version, op, content_hash) overriding system value values (${G}, 'org-a', 'proj-a', 'rfis', 'late-rfi-1', 1, 'I', 'x')`);
    await db.exec(`set session_replication_role = origin`);
    await replica.sync();
    const ids = await clientMgr.ids({ projectId: "proj-a", kind: "rfis", afterId: null });
    expect(ids.ids).toContain("late-rfi-1"); // the server lists it
    expect(await localRow("rfis", "late-rfi-1")).toBeTruthy(); // ... and the overlap re-read names it, so the laptop has it after ONE sync
  });
});

suite("D. push through the outbox: update, create, answer; the real row shapes", () => {
  wt("W15", "client:FB", "update_task: the op on the wire has the exact shape; the real pipeline runs it; the dirty row becomes the server's row at its new version", async () => {
    const row = await localRow("tasks", "t1");
    const baseVersion = row.serverVersion;
    const queued = await writesMod.updateTaskLocally({ projectId: "proj-a", taskId: "t1", patch: { title: "Pour slab L2" } }, { userId: U, idb: IDB, outbox });
    expect(queued).toMatchObject({ queued: true });
    expect((await localRow("tasks", "t1")).dirty).toBe(queued.opId);
    const report = await outbox.flush();
    const sent = pushes().at(-1);
    expect(Object.keys(sent.body).sort()).toEqual(["device_id", "ops"]);
    expect(sent.headers["x-px-client"]).toMatch(/protocol=2; schema=3$/);
    const wire = sent.body.ops[0];
    expect(wire).toMatchObject({ function_id: "update_task", project_id: "proj-a", params: { projectId: "proj-a", issueId: "t1", title: "Pour slab L2" }, record: { kind: "tasks", id: "t1", base_version: baseVersion } });
    expect(sent.status).toBe(200);
    expect(report).toMatchObject({ sent: 1, applied: 1, conflicts: 0, rejected: 0, failed: 0, remaining: 0 });
    const after = await localRow("tasks", "t1");
    expect(after.dirty ?? null).toBeNull();
    expect(after.serverVersion).toBe((await head("tasks", "t1")).version);
    expect(after.serverVersion).toBe(baseVersion + 1);
    expect(JSON.stringify(after.data)).toContain("Pour slab L2");
    expect(typeof after.sig).toBe("string");
    expect((await db.query(`select title from compliance.pms_issues where id = 't1'`)).rows[0].title).toBe("Pour slab L2"); // persisted, not just a success message
  });

  wt("W15b", "client:FB", "the laptop's own applied edit is not fetched again when the change feed names it", async () => {
    const before = seen.length;
    await replica.sync();
    const refetched = seen.slice(before).filter((r) => r.path === "/pull" && r.body.ids);
    expect(refetched.filter((r) => r.body.ids.includes("t1"))).toEqual([]);
  });

  wt("W16", "client:FB", "create_rfi: the op names the kind it creates (record_kind, which handler.ts push() reads)", async () => {
    const q = await writesMod.createRfiLocally({ projectId: "proj-a", subject: "Lift pit", question: "Waterproofing spec?", dueDate: "2026-10-20" }, { userId: U, idb: IDB, outbox });
    expect(q).toMatchObject({ queued: true });
    expect(await localRow("rfis", q.tempId)).toBeTruthy();
    const report = await outbox.flush();
    const wire = pushes().at(-1).body.ops[0];
    expect(report).toMatchObject({ applied: 1, remaining: 0, failed: 0 });
    expect(await localRow("rfis", q.tempId)).toBeUndefined();
    const realId = (await db.query(`select id from compliance.construction_rfis where subject = 'Lift pit'`)).rows[0].id;
    const stored = await localRow("rfis", realId);
    expect(stored.serverVersion).toBe((await head("rfis", realId)).version);
    expect(wire.record_kind).toBe("rfis");
  }, "FB");

  wt("W16b", "client:FB", "a created row is settled from the push answer itself: no second request, so a failure right after the save cannot make the new RFI vanish from the laptop", async () => {
    const q = await writesMod.createRfiLocally({ projectId: "proj-a", subject: "Stair rail", question: "Height?" }, { userId: U, idb: IDB, outbox });
    inject.failPull = 1; // the refetch that follows the save does not get through
    await outbox.flush();
    inject.failPull = 0;
    const realId = (await db.query(`select id from compliance.construction_rfis where subject = 'Stair rail'`)).rows[0].id;
    expect((await localRow("rfis", q.tempId)) || (await localRow("rfis", realId))).toBeTruthy();
    await replica.sync(); // heals on the next sync
    expect(await localRow("rfis", realId)).toBeTruthy();
  }, "FB");

  wt("W17", "client:FB", "answer_rfi on a row the laptop holds at a server version: applied, clean, version +1, the answer is on the server", async () => {
    const rfi = (await localList("rfis")).find((r) => r.data.subject === "Door schedule");
    const id = rfi.id.slice(5);
    const v0 = (await head("rfis", id)).version;
    const q = await writesMod.answerRfiLocally({ projectId: "proj-a", rfiId: id, answer: "Use the 90mm hinge" }, { userId: U, idb: IDB, outbox });
    expect(q).toMatchObject({ queued: true });
    const report = await outbox.flush();
    expect(report).toMatchObject({ applied: 1, remaining: 0 });
    const after = await localRow("rfis", id);
    expect(after.dirty ?? null).toBeNull();
    expect(after.serverVersion).toBe(v0 + 1);
    expect((await db.query(`select answer, status from compliance.construction_rfis where id = $1`, [id])).rows[0]).toMatchObject({ answer: "Use the 90mm hinge", status: "answered" });
  });

  wt("W18", "client:FA", "the real `data` of a synced row (informational): keys the server sends vs keys the optimistic overlay uses", async () => {
    const rfi = (await localList("rfis"))[0];
    const t = await localRow("tasks", "t1");
    const boq = (await localList("boqs"))[0];
    console.log("[W18] real rfis data keys:", Object.keys(rfi.data).sort().join(","), "\n[W18] real tasks data keys:", Object.keys(t.data).sort().join(","), "\n[W18] real boqs data keys:", boq && Object.keys(boq.data).sort().join(","));
    expect(rfi.data.subject).toBeDefined();
  });

  wt("W18b", "client:FA", "the BOQ readers accept the REAL boq_lines rows (snake_case, numbers) and draw a real synced BOQ with its title from the `boqs` kind", async () => {
    const lines = await localList("boq_lines");
    expect(lines.length).toBe(2);
    console.log("[W18b] real boq_lines data keys:", Object.keys(lines[0].data).sort().join(","));
    // every real line maps to the screen's line shape, its BOQ facts from the real `boqs` row (and not without them: nothing invented)
    const boqRows = (await localList("boqs")).map((r) => r.data);
    expect(boqLocalMod.linesFromReplica(lines.map((l) => l.data), boqRows).length).toBe(lines.length);
    expect(lines.map((l) => boqLocalMod.toGatewayLine(l.data)).filter(Boolean)).toEqual([]);
    // the golden rows the non-CT unit test (shell/modules/scope-adapter-real-rows.test.ts) is fed: still the real handler's key sets
    // (LF_WRITE_GOLDEN=1 re-captures them first, e.g. after the backend changes a kind's columns)
    const goldenUrl = new URL("../__fixtures__/real-sync-rows.json", import.meta.url);
    if (process.env.LF_WRITE_GOLDEN === "1") {
      await Bun.write(goldenUrl, JSON.stringify({ captured: "wire.integration.test.ts W18b: rows stored by the real client from the real projexa-sync handler on PGlite (feat/lf-sync-backend)", boqs: boqRows, boq_lines: lines.map((l) => l.data) }, null, 2) + "\n");
    }
    const golden = JSON.parse(await Bun.file(goldenUrl).text());
    const keys = (rows) => [...new Set(rows.map((r) => Object.keys(r).sort().join(",")))];
    expect(keys(golden.boq_lines)).toEqual(keys(lines.map((l) => l.data)));
    expect(keys(golden.boqs)).toEqual(keys(boqRows));
    // the shell's scope module (laptop shell) draws the BOQ from the local database only
    const shell = { userId: U, idb: IDB, projects: [{ id: "proj-a", name: "A" }] };
    const list = await scopeAdapter.loadScopeList(shell, "proj-a");
    expect(list).toMatchObject({ state: "local", rows: [{ id: "boq1", title: "Villa BOQ", lineCount: 2, total: 54225 + 156000 }] });
    const obj = await scopeAdapter.loadScopeObject(shell, "boq1", "proj-a");
    expect(obj.state).toBe("local");
    expect(obj.boq).toMatchObject({ id: "boq1", projectId: "proj-a", title: "Villa BOQ" });
    expect(obj.lines.map((l) => [l.id, l.itemCode, l.description, l.unit, l.quantity, l.rate, l.amount])).toEqual([
      ["li1", "1.1", "Excavation", "m3", "120.5", "450", "54225"],
      ["li2", "1.2", "PCC", "m3", "30", "5200", "156000"],
    ]);
    // the online screen's local-first reader (ScopeObjectClient -> loadBoqFromReplica), from the remembered header
    const store = new Map();
    const saved = globalThis.localStorage;
    globalThis.localStorage = { getItem: (k) => (k === "px-local-first" ? "1" : store.get(k) ?? null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    try {
      boqLocalMod.rememberBoq({ id: "boq1", projectId: "proj-a", title: "old title", version: 1, status: "draft", parentBoqId: null, createdAt: "" });
      const loaded = await boqLocalMod.loadBoqFromReplica("boq1", { userId: U, idb: IDB });
      expect(loaded?.source).toBe("local-replica");
      expect(loaded.boq.title).toBe("Villa BOQ");
      expect(loaded.lines.map((l) => l.amount)).toEqual(["54225", "156000"]);
    } finally {
      globalThis.localStorage = saved;
    }
  });
});

suite("E. conflicts, rejections, uncertain outcomes", () => {
  wt("W19", "client:FB", "a conflict: nothing is written, the client shows both sides; keep_mine resends and applies", async () => {
    const row = await localRow("tasks", "t3");
    const q = await writesMod.updateTaskLocally({ projectId: "proj-a", taskId: "t3", patch: { title: "Mine" } }, { userId: U, idb: IDB, outbox });
    await db.exec(`update compliance.pms_issues set title = 'Theirs', updated_at = now() where id = 't3'`);
    const r1 = await outbox.flush();
    expect(r1).toMatchObject({ conflicts: 1, applied: 0 });
    const conflicts = await outbox.getConflicts();
    expect(conflicts.length).toBe(1);
    expect(JSON.stringify(conflicts[0].server.data)).toContain("Theirs");
    expect((await db.query(`select title from compliance.pms_issues where id = 't3'`)).rows[0].title).toBe("Theirs");
    await outbox.resolve(q.opId, "keep_mine");
    const r2 = await outbox.flush();
    expect(r2).toMatchObject({ applied: 1, remaining: 0 });
    expect((await db.query(`select title from compliance.pms_issues where id = 't3'`)).rows[0].title).toBe("Mine");
    expect(row.serverVersion).toBeLessThan((await localRow("tasks", "t3")).serverVersion);
  });

  wt("W19b", "client:FB", "keep_theirs: the op is dropped, the laptop row is the server's row", async () => {
    const q = await writesMod.updateTaskLocally({ projectId: "proj-a", taskId: "t3", patch: { title: "Mine again" } }, { userId: U, idb: IDB, outbox });
    await db.exec(`update compliance.pms_issues set title = 'Theirs again', updated_at = now() where id = 't3'`);
    expect(await outbox.flush()).toMatchObject({ conflicts: 1 });
    await outbox.resolve(q.opId, "keep_theirs");
    const row = await localRow("tasks", "t3");
    expect(row.dirty ?? null).toBeNull();
    expect(row.data.title).toBe("Theirs again");
    expect(row.serverVersion).toBe((await head("tasks", "t3")).version);
    expect(await outbox.pendingCount()).toBe(0);
  });

  wt("W20", "client:FB", "a conflict where the server DELETED the row (conflict with server:null): the person is told and the op leaves the retry loop", async () => {
    await db.exec(recs.insert("pms_issues", [task("t5", { number: 5 })]));
    await replica.sync();
    const q = await writesMod.updateTaskLocally({ projectId: "proj-a", taskId: "t5", patch: { title: "Mine on a deleted task" } }, { userId: U, idb: IDB, outbox });
    expect(q).toMatchObject({ queued: true });
    await db.exec(`delete from compliance.pms_issues where id = 't5'`);
    for (let i = 0; i < 3; i++) {
      clock += 10 * 60_000;
      await outbox.flush();
    }
    const state = await outbox.refresh();
    const op = await pendingOp(q.opId);
    const stuck = !!op && op.status === "pending" && state.conflicts.length === 0 && state.notices.length === 0;
    if (op) await withLocal((l) => l.deleteOp(q.opId)); // clean up so the next tests start clean
    expect(stuck).toBe(false);
  }, "FB");

  wt("W21", "client:FA", "permanent refusals reach the person in words, not the generic fallback (codes the backend really sends; dictionary in task-errors.ts)", async () => {
    const generic = outboxMod.rejectionMessage({ functionId: "update_task", label: "x" }, { code: "SOMETHING_UNKNOWN_TO_THE_CLIENT" });
    const same = [];
    for (const code of ["ROLE_TOO_LOW", "FUNCTION_NOT_ALLOWED", "PROJECT_NOT_READABLE", "OP_ID_REUSED", "BAD_OP", "CAP_DAY"]) {
      if (outboxMod.rejectionMessage({ functionId: "update_task", label: "x" }, { code }) === generic) same.push(code);
    }
    console.log("[W21] codes that fall back to the generic sentence:", same.join(",") || "(none)");
    expect(same).toEqual([]);
  });

  wt("W22", "backend", "a lost answer (EXECUTION_UNCERTAIN): the SAME op_id is re-sent; the op must not stay pending forever in silence", async () => {
    const q = await writesMod.updateTaskLocally({ projectId: "proj-a", taskId: "t1", patch: { title: "After a lost answer" } }, { userId: U, idb: IDB, outbox });
    nextScript.push("throw"); // the pipeline's answer never arrives: the handler maps that to EXECUTION_UNCERTAIN
    for (let i = 0; i < 6; i++) {
      clock += 6 * 60_000;
      await outbox.flush();
    }
    const state = await outbox.refresh();
    const op = await pendingOp(q.opId);
    const stuck = !!op && op.status === "pending" && state.notices.length === 0;
    if (op) await withLocal((l) => l.deleteOp(q.opId));
    expect(stuck).toBe(false);
  }, "backend");

  wt("W23", "client:FB", "a response lost AFTER the server applied the op: the re-send is answered `duplicate`, nothing is done twice, the row ends clean at the server's version", async () => {
    const before = (await head("tasks", "t1")).version;
    await writesMod.updateTaskLocally({ projectId: "proj-a", taskId: "t1", patch: { title: "Exactly once" } }, { userId: U, idb: IDB, outbox });
    inject.dropPushResponse = 1;
    const callsBefore = calls.length;
    const r1 = await outbox.flush();
    expect(r1).toMatchObject({ applied: 0, failed: 1 });
    expect((await db.query(`select title from compliance.pms_issues where id = 't1'`)).rows[0].title).toBe("Exactly once"); // the server DID it
    clock += 10 * 60_000;
    const r2 = await outbox.flush();
    expect(r2).toMatchObject({ duplicates: 1, remaining: 0 });
    expect(calls.length - callsBefore).toBe(1);
    const row = await localRow("tasks", "t1");
    expect(row.dirty ?? null).toBeNull();
    expect(row.serverVersion).toBe((await head("tasks", "t1")).version);
    expect(row.serverVersion).toBe(before + 1);
    expect(row.data.title).toBe("Exactly once");
  });

  wt("W24", "client:FB", "an op above the backend's 64 KB per-op ceiling (0681 -> BAD_OP) is stopped by the client in words, not sent to be refused", async () => {
    const q = await writesMod.updateTaskLocally({ projectId: "proj-a", taskId: "t2", patch: { description: "x".repeat(70_000) } }, { userId: U, idb: IDB, outbox });
    expect(q).toMatchObject({ queued: true });
    await outbox.flush();
    const state = await outbox.refresh();
    const notice = state.notices.at(-1);
    if (state.notices.length) await outbox.dismissNotice(notice.opId);
    expect(notice?.message ?? "").toContain("too large");
  }, "FB");
});

suite("F. limits and gates", () => {
  wt("W25", "client:FA", "130 RFIs changed elsewhere while the laptop was away do not wedge the project's change feed (client chunks pull-by-ids under the 4 KB cap)", async () => {
    const rows = Array.from({ length: 130 }, (_, i) => ({ org_id: "org-a", project_id: "proj-a2", number: i + 1, subject: `Bulk ${i}`, question: "q", raised_by_id: "u-mem" }));
    await db.exec(recs.insert("construction_rfis", rows));
    const r0 = await replica.sync(); // pulls them (keyset by created_at)
    expect(r0.issues).toEqual([]);
    await db.exec(`update compliance.construction_rfis set answer = 'ok', status = 'answered', answered_at = now() where project_id = 'proj-a2'`); // created_at does not move: only the feed can tell
    const pos = await feedPosition("proj-a2");
    const r1 = await replica.sync();
    const r2 = await replica.sync();
    const fails = seen.filter((r) => r.path === "/pull" && r.status === 413);
    console.log("[W25] 2nd sync:", JSON.stringify({ status: r1.status, issues: r1.issues }), "| 3rd sync:", r2.status, "| 413s:", fails.length, "| feed position before/after:", pos, await feedPosition("proj-a2"));
    expect(fails).toEqual([]);
    expect(r1.issues).toEqual([]);
    expect(r1.status).toBe("done");
    expect(r2.issues).toEqual([]);
    expect(await feedPosition("proj-a2")).toBeGreaterThan(pos);
    const answered = (await localList("rfis", "proj-a2")).filter((r) => r.data.answer === "ok");
    expect(answered.length).toBe(130);
  });

  wt("W26", "client:FC", "a first sync of an organisation with 6 projects (6 x 28 kinds) stays under the server's 120 requests/minute cap", async () => {
    await db.exec(`insert into compliance.projects (id, product_id, org_id, name, lead_user_id, access_level, project_value, status, created_at)
                   select 'proj-x' || g, 'prod', 'org-a', 'Extra ' || g, 'u-mgr', 'public', 1, 'active', now() from generate_series(1, 4) g`);
    const d = depsWith({ limiter: new handler.RateLimiter() }); // the real default: 120 per person per minute
    const r = replicaMod.createReplica({ userId: U, client: clientFor("u-mgr", { deps: d, maxRetries: 2 }), idb: idb(), yieldFn: noYield });
    const before = seen.length;
    const report = await r.sync();
    const limited = seen.slice(before).filter((x) => x.status === 429);
    expect(limited.length).toBe(0);
    expect(report.status).toBe("done");
  }, "FC");

  wt("W27", "backend", "CORS: the browser preflight allows every header the client really sends, from the real origin", async () => {
    const sent = seen.find((r) => r.path === "/pull");
    const nonSafelisted = Object.keys(sent.headers).filter((h) => !["accept", "accept-language", "content-language"].includes(h));
    const req = new Request(`${BASE}/pull`, { method: "OPTIONS", headers: { origin: "https://projexa-ai.com", "access-control-request-method": "POST", "access-control-request-headers": nonSafelisted.join(",") } });
    const res = await handler.handleSync(req, deps);
    const allow = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase().split(",").map((s) => s.trim());
    console.log("[W27] client sends", nonSafelisted.join(","), "| server allows", allow.join(","));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://projexa-ai.com");
    expect(nonSafelisted.filter((h) => !allow.includes(h))).toEqual([]);
  }, "backend");

  wt("W27b", "backend", "CORS: a browser can read Retry-After on a 429 (Access-Control-Expose-Headers), which the client uses to wait", async () => {
    const d = depsWith({ limiter: new handler.RateLimiter(1) });
    const mk = () => handler.handleSync(new Request(`${BASE}/manifest`, { method: "GET", headers: { authorization: `Bearer tok:${U}`, origin: "https://projexa-ai.com" } }), d);
    await mk();
    const res = await mk();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect((res.headers.get("access-control-expose-headers") ?? "").toLowerCase()).toContain("retry-after");
  }, "backend");

  wt("W28", "client:FA", "426: a laptop below min_compatible is told how; the client maps current/min_compatible; a protocol mismatch is gated; release/current stays open", async () => {
    const man = { release_version: "2026.10.02-001", git_sha: "abc1234", built_at: "2026-10-02T10:00:00Z", protocol: 2, schema: 3, bundle: { path: "/_release/px-2026.10.02-001.tar.gz", size: 1, sha256: "b".repeat(64) }, files: [{ path: "a.js", sha256: "1".repeat(64), size: 1 }] };
    const manifest = { ...man, manifest_sha256: await signMod.sha256Hex(signMod.canonicalize(man)) };
    expect((await rpc("projexa_release_register", { p_manifest: manifest })).error).toBeNull();
    await rpc("projexa_release_set_min_compatible", { p_release: "2026.10.01-001" });
    const d = depsWith({ releaseBox: { at: 0, value: null } });
    const err = await clientFor("u-mgr", { deps: d, release: "2026.09.30-001" }).manifest().catch((e) => e);
    expect(err.kind).toBe("update_required");
    expect(err.update).toEqual({ current: "2026.10.02-001", minCompatible: "2026.10.01-001" });
    const res = await handler.handleSync(new Request(`${BASE}/manifest`, { method: "GET", headers: { authorization: `Bearer tok:${U}`, "x-px-client": "2026.10.02-001; protocol=1; schema=3" } }), d);
    expect(res.status).toBe(426);
    expect(await res.json()).toMatchObject({ code: "UPDATE_REQUIRED", reason: "protocol", protocol: 2 });
    const rc = await handler.handleSync(new Request(`${BASE}/release/current`, { method: "GET", headers: { authorization: `Bearer tok:${U}`, "x-px-client": "2026.09.30-001; protocol=2; schema=3" } }), d);
    expect(rc.status).toBe(200);
    expect((await rc.json()).current.release_version).toBe("2026.10.02-001");
  });

  wt("W28b", "client:FA", "release numbers are YYYY.MM.DD-NNN everywhere (contract, fake, fixtures): the fake gates exactly what the backend gates; a non-matching release (dev, a commit sha) is exempt by design", async () => {
    // the backend's rule, observed through the real handler with a floor of 2026.10.01-001 (set in W28)
    const d = depsWith({ releaseBox: { at: 0, value: null } });
    const gated = async (release) => (await clientFor("u-mgr", { deps: d, release }).manifest().catch((e) => e)).kind === "update_required";
    const samples = ["2026.09.30-001", "2026.10.01-000", "2026.10.01-001", "2026.10.02-007", "2026.09.30-1", "dev", "abcdef0123456789abcdef0123456789abcdef01"];
    const real = {};
    for (const s of samples) real[s] = await gated(s);
    expect(real).toEqual({ "2026.09.30-001": true, "2026.10.01-000": true, "2026.10.01-001": false, "2026.10.02-007": false, "2026.09.30-1": false, dev: false, abcdef0123456789abcdef0123456789abcdef01: false });
    // the fake answers the same
    const fake = fakeMod.createFakeSyncServer({ projects: ["proj-a"] });
    fake.setRelease({ current: "2026.10.02-001", minCompatible: "2026.10.01-001" });
    const fakeSays = {};
    for (const s of samples) fakeSays[s] = (await fake.clientWith({ getReleaseVersion: () => s }).manifest().catch((e) => e)).kind === "update_required";
    expect(fakeSays).toEqual(real);
    // a short build number cannot even be registered: the fixtures and the contract use -NNN
    const man = { release_version: "2026.10.03-3", git_sha: "abc1234", built_at: "2026-10-03T10:00:00Z", protocol: 2, schema: 3, bundle: { path: "/_release/px-2026.10.03-3.tar.gz", size: 1, sha256: "c".repeat(64) }, files: [{ path: "a.js", sha256: "1".repeat(64), size: 1 }] };
    expect((await rpc("projexa_release_register", { p_manifest: { ...man, manifest_sha256: await signMod.sha256Hex(signMod.canonicalize(man)) } })).error).not.toBeNull();
    expect(fakeMod.FAKE_RELEASE).toMatch(fakeMod.RELEASE_RE);
  });

  wt("W29", "client:FA", "attest: the peer statement's lifetime is what the contract says (24 hours, sign.ts ATTEST_TTL_SECONDS)", async () => {
    const res = await handler.handleSync(new Request(`${BASE}/attest`, { method: "POST", headers: { authorization: `Bearer tok:${U}`, "content-type": "application/json" }, body: "{}" }), deps);
    expect(res.status).toBe(200);
    const j = await res.json();
    const claims = JSON.parse(atob(j.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    console.log("[W29] attest: exp - iat =", claims.exp - claims.iat, "s; fields:", Object.keys(j).sort().join(","));
    expect(claims.exp - claims.iat).toBe(86_400);
  });

  wt("W29b", "client:FA", "the fake sync server's limits are the real handler's (a golden constant set, checked against handler.ts on every run)", async () => {
    const L = fakeMod.REAL_LIMITS;
    expect({ BODY_MAX_BYTES: handler.BODY_MAX_BYTES, PUSH_BODY_MAX_BYTES: handler.PUSH_BODY_MAX_BYTES, PUSH_OPS_MAX: handler.PUSH_OPS_MAX, PULL_IDS_MAX: handler.PULL_IDS_MAX, PULL_LIMIT_DEFAULT: handler.PULL_LIMIT_DEFAULT, PULL_LIMIT_MAX: handler.PULL_LIMIT_MAX, CHANGES_LIMIT_MAX: handler.CHANGES_LIMIT_MAX, IDS_LIMIT_MAX: handler.IDS_LIMIT_MAX, REQUESTS_PER_MINUTE: handler.REQUESTS_PER_MINUTE, SERVER_PROTOCOL: handler.SERVER_PROTOCOL })
      .toEqual({ BODY_MAX_BYTES: L.BODY_MAX_BYTES, PUSH_BODY_MAX_BYTES: L.PUSH_BODY_MAX_BYTES, PUSH_OPS_MAX: L.PUSH_OPS_MAX, PULL_IDS_MAX: L.PULL_IDS_MAX, PULL_LIMIT_DEFAULT: L.PULL_LIMIT_DEFAULT, PULL_LIMIT_MAX: L.PULL_LIMIT_MAX, CHANGES_LIMIT_MAX: L.CHANGES_LIMIT_MAX, IDS_LIMIT_MAX: L.IDS_LIMIT_MAX, REQUESTS_PER_MINUTE: L.REQUESTS_PER_MINUTE, SERVER_PROTOCOL: L.SERVER_PROTOCOL });
    // the client's own pull-by-ids chunk stays under the real body cap
    expect(syncClientMod.SYNC_IDS_BODY_MAX_BYTES).toBeLessThan(handler.BODY_MAX_BYTES);
    expect(syncClientMod.SYNC_IDS_LIMIT).toBeLessThanOrEqual(handler.PULL_IDS_MAX);
  });

  wt("W30", "client:FA", "every route the client calls exists with the method the client uses (no router 404/405)", async () => {
    const used = new Set(seen.map((r) => `${r.method} ${r.path}`));
    console.log("[W30] routes used by the client:", [...used].sort().join(" | "));
    expect(seen.filter((r) => r.status === 405).length).toBe(0);
    expect([...used].every((u) => ["GET /manifest", "POST /pull", "POST /changes", "POST /ids", "POST /push"].includes(u))).toBe(true);
  });
});

suite("G. failure classes the backend and the client must agree on", () => {
  wt("W31", "backend", "a transient failure of the real pipeline (BACKEND_UNAVAILABLE / UPSTREAM_TIMEOUT) is `failed` (op kept, retried), not `rejected` (the person's edit undone)", async () => {
    const outcome = {};
    for (const code of ["BACKEND_UNAVAILABLE", "UPSTREAM_TIMEOUT"]) {
      const q = await writesMod.updateTaskLocally({ projectId: "proj-a", taskId: "t3", patch: { title: `retry after ${code}` } }, { userId: U, idb: IDB, outbox });
      nextScript.push({ kind: "failed", code, missing: [] });
      const rep = await outbox.flush();
      const op = await pendingOp(q.opId);
      outcome[code] = { rejected: rep.rejected, stillQueued: !!op };
      if (op) {
        clock += 10 * 60_000;
        await outbox.flush();
      }
      await outbox.refresh();
      for (const n of outbox.getState().notices) await outbox.dismissNotice(n.opId);
    }
    for (const code of Object.keys(outcome)) {
      expect(outcome[code].rejected).toBe(0);
      expect(outcome[code].stillQueued).toBe(true);
    }
  }, "backend");

  wt("W32", "client:FB", "a person who is deactivated while edits wait on their laptop (backend: 403 NOT_LINKED for the whole batch): the person is told, instead of the outbox retrying forever in silence", async () => {
    await writesMod.updateTaskLocally({ projectId: "proj-a", taskId: "t2", patch: { title: "Waiting while deactivated" } }, { userId: U, idb: IDB, outbox });
    await db.exec(`update compliance.users set is_active = false where id = 'u-mgr'`);
    let state;
    try {
      for (let i = 0; i < 3; i++) {
        clock += 10 * 60_000;
        await outbox.flush();
      }
      state = await outbox.refresh();
    } finally {
      await db.exec(`update compliance.users set is_active = true where id = 'u-mgr'`);
    }
    clock += 10 * 60_000;
    await outbox.flush(); // clean up: the person is active again, the op applies
    expect(state.status === "signed_out" || state.notices.length > 0 || state.blocked.length > 0).toBe(true);
  }, "FB");
});
