// lf-e7: the replica's ORGANISATION kinds and its "as per role" re-evaluation, rule by rule, against fake-org-client.ts (the role,
// class, epoch and reset_required rules of drizzle/0679, 0684, 0686). The same scenarios run against the REAL handler in
// conformance/wire.integration.test.ts (section O).
import { beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeOrgServer, seedOrgWorld, type FakeOrgServer } from "./__fixtures__/fake-org-client";
import { changeCursorKey, localDbNameFor, openLocalDb, type LocalDb } from "./local-db";
import { LAST_SYNC_KEY, MANIFEST_KEY, createReplica, doneKey, type StoredManifest } from "./replica";
import { EPOCH_KEY, ORG_CHECK_KEY, classKey } from "./replica-class";
import { ORG_PROJECT, resetOrgCheckMemory } from "./replica-org";

const U = "signin-1";
const HOUR = 60 * 60_000;

function setup(role: FakeOrgServer["role"] = "member") {
  const idb = new IDBFactory();
  const server = createFakeOrgServer({ signInId: U, role });
  seedOrgWorld(server);
  let clock = Date.parse("2026-10-02T10:00:00Z");
  const replica = createReplica({ userId: U, client: server.client, idb, yieldFn: async () => {}, now: () => clock });
  const open = () => openLocalDb(idb, localDbNameFor(U));
  const withDb = async <T,>(fn: (db: LocalDb) => Promise<T>) => {
    const db = await open();
    try { return await fn(db); } finally { db.close(); }
  };
  const ids = (kind: string, project = ORG_PROJECT) => withDb(async (db) => (await db.listByProject("org-a", kind, project)).map((r) => r.id.slice(kind.length + 1)).sort());
  const row = (kind: string, id: string) => withDb((db) => db.getRecord(kind, id));
  const advance = (ms: number) => { clock += ms; };
  return { idb, server, replica, open, withDb, ids, row, advance };
}

async function makeDirty(t: ReturnType<typeof setup>, kind: string, id: string, data: Record<string, unknown>) {
  await t.withDb(async (db) => {
    await db.transact(async (tx) => {
      const r = (await tx.getRecord(kind, id))!;
      await tx.putRecord({ id: r.id, type: kind, orgId: r.orgId, projectId: r.projectId, data, dirty: "op-mine", serverVersion: r.serverVersion, serverUpdatedAt: r.serverUpdatedAt, sig: r.sig, kid: r.kid });
      await tx.putOp({ opId: "op-mine", functionId: "update_x", projectId: r.projectId ?? "p1", params: data, record: { kind, id, baseVersion: r.serverVersion ?? 0 }, clientAt: "2026-10-02T10:00:00Z", status: "pending", attempts: 0, nextAttemptAt: 0 });
    });
  });
}

beforeEach(() => resetOrgCheckMemory());

describe("first sync of the organisation (as per role)", () => {
  test("a member gets every organisation kind under __org__, versioned and signed, beside the project rows", async () => {
    const t = setup("member");
    const report = await t.replica.sync();
    expect(report.issues).toEqual([]);
    expect(report.status).toBe("done");
    expect(report.projectsTotal).toBe(2); // the organisation is not counted as one of the person's projects
    expect(await t.ids("vendors")).toEqual(["ven-1", "ven-2"]);
    expect(await t.ids("departments")).toEqual(["dep-1"]);
    expect(await t.ids("org_people")).toEqual(["u-mgr"]);
    expect(await t.ids("cost_visibility")).toEqual(["cv1"]);
    expect(await t.ids("tasks", "p1")).toEqual(["t1", "t2"]);
    const v = (await t.row("vendors", "ven-1"))!;
    expect(v).toMatchObject({ projectId: ORG_PROJECT, orgId: "org-a", serverVersion: 1, sig: "sig:__org__:vendors:ven-1:1", kid: "k1" });
    // a member is below the money rank: credit_limit hidden exactly as the server cut it
    expect((v.data as Record<string, unknown>).credit_limit).toBeNull();
    await t.withDb(async (db) => {
      const m = (await db.getMeta<StoredManifest>(MANIFEST_KEY))!;
      expect(m.orgKinds).toEqual(["vendors", "departments", "org_people", "cost_visibility"]);
      expect(m.orgNoPeerKinds).toEqual(["org_people"]);
      expect(m.projectIds).toEqual(["p1", "p2"]);
      expect(await db.getMeta(doneKey(ORG_PROJECT, "vendors"))).toBeTruthy();
      expect(await db.getMeta(classKey(ORG_PROJECT))).toMatchObject({ view: "ov-2-nocost" });
      expect(await db.getMeta(classKey("p1"))).toMatchObject({ view: "v-nomoney" });
      expect(await db.getMeta(EPOCH_KEY)).toBe("epoch-1");
    });
  });

  test("a viewer gets cost_visibility only, and never asks for any other organisation kind", async () => {
    const t = setup("viewer");
    const report = await t.replica.sync();
    expect(report.status).toBe("done");
    expect(await t.ids("cost_visibility")).toEqual(["cv1"]);
    expect(await t.ids("vendors")).toEqual([]);
    const orgPulls = t.server.calls.filter((c) => c.projectId === ORG_PROJECT && c.kind);
    expect(orgPulls.every((c) => c.kind === "cost_visibility")).toBe(true);
  });

  test("an older service (no org_kinds in the manifest) costs no organisation call at all", async () => {
    const t = setup("member");
    const base = t.server.client.manifest;
    t.server.client.manifest = async () => { const m = await base(); delete m.org_kinds; delete m.org_view_class; return m; };
    expect((await t.replica.sync()).status).toBe("done");
    expect(t.server.calls.filter((c) => c.projectId === ORG_PROJECT)).toEqual([]);
  });
});

describe("updates and deletes reach the laptop", () => {
  test("an organisation update and a delete arrive through the organisation feed, with no new keyset sweep", async () => {
    const t = setup("member");
    await t.replica.sync();
    t.server.upsert(ORG_PROJECT, "vendors", "ven-1", { supplier_name: "Ace Cement Ltd", credit_limit: 1 });
    t.server.remove(ORG_PROJECT, "departments", "dep-1");
    t.server.calls.length = 0;
    const report = await t.replica.sync();
    expect(report.status).toBe("done");
    expect(((await t.row("vendors", "ven-1"))!.data as Record<string, unknown>).supplier_name).toBe("Ace Cement Ltd");
    expect((await t.row("vendors", "ven-1"))!.serverVersion).toBe(2);
    expect(await t.ids("departments")).toEqual([]);
    expect(t.server.calls.filter((c) => c.op === "pull" && c.projectId === ORG_PROJECT)).toEqual([]); // feed-covered
    expect(t.server.calls.filter((c) => c.op === "changes" && c.projectId === ORG_PROJECT).length).toBe(1);
  });
});

describe("role change, cost-visibility change, epoch, reset_required", () => {
  test("member -> viewer: vendor rows leave the laptop, a pending edit of one stays with its outbox op, project rows are re-cut", async () => {
    const t = setup("member");
    await t.replica.sync();
    await makeDirty(t, "vendors", "ven-2", { supplier_name: "Bright Paints (my edit)" });
    t.server.role = "viewer";
    const mark = t.server.calls.length;
    const report = await t.replica.sync();
    expect(report.status).toBe("done");
    expect(await t.ids("vendors")).toEqual(["ven-2"]); // only the row with a pending edit
    expect(((await t.row("vendors", "ven-2"))!.data as Record<string, unknown>).supplier_name).toBe("Bright Paints (my edit)");
    expect(await t.ids("departments")).toEqual([]);
    expect(await t.ids("org_people")).toEqual([]);
    expect(await t.ids("cost_visibility")).toEqual(["cv1"]);
    await t.withDb(async (db) => {
      expect((await db.listOps()).map((o) => o.opId)).toEqual(["op-mine"]);
      expect((await db.getMeta<StoredManifest>(MANIFEST_KEY))!.orgKinds).toEqual(["cost_visibility"]);
      expect(await db.getMeta(doneKey(ORG_PROJECT, "vendors"))).toBeNull();
    });
    // nothing but cost_visibility was asked for as a viewer
    expect(t.server.calls.slice(mark).filter((c) => c.projectId === ORG_PROJECT && c.kind && c.kind !== "cost_visibility")).toEqual([]);
  });

  test("member -> manager: the project class changed, so project rows are dropped and pulled again with the money they may now see", async () => {
    const t = setup("member");
    await t.replica.sync();
    expect(((await t.row("tasks", "t1"))!.data as Record<string, unknown>).cost).toBeNull();
    t.server.role = "manager";
    expect((await t.replica.sync()).status).toBe("done");
    expect(((await t.row("tasks", "t1"))!.data as Record<string, unknown>).cost).toBe(1200);
    expect(((await t.row("vendors", "ven-1"))!.data as Record<string, unknown>).credit_limit).toBe(500000);
    await t.withDb(async (db) => expect(await db.getMeta(classKey("p1"))).toMatchObject({ view: "v-money" }));
  });

  test("manager -> member: money a manager could see never stays on the laptop (the higher-class rows are dropped, not kept)", async () => {
    const t = setup("manager");
    await t.replica.sync();
    expect(((await t.row("tasks", "t2"))!.data as Record<string, unknown>).cost).toBe(800);
    t.server.role = "member";
    await t.replica.sync();
    expect(((await t.row("tasks", "t2"))!.data as Record<string, unknown>).cost).toBeNull();
    expect(((await t.row("vendors", "ven-2"))!.data as Record<string, unknown>).credit_limit).toBeNull();
  });

  test("cost-visibility change: only the organisation (whose class changed) is re-pulled; the projects are untouched", async () => {
    const t = setup("manager");
    await t.replica.sync();
    expect(((await t.row("vendors", "ven-1"))!.data as Record<string, unknown>).credit_limit).toBe(500000);
    t.server.costVisible = false;
    t.server.calls.length = 0;
    expect((await t.replica.sync()).status).toBe("done");
    expect(((await t.row("vendors", "ven-1"))!.data as Record<string, unknown>).credit_limit).toBeNull();
    expect(t.server.calls.filter((c) => c.op === "pull" && c.projectId === ORG_PROJECT).length).toBeGreaterThan(0);
    expect(t.server.calls.filter((c) => c.op === "pull" && c.projectId !== ORG_PROJECT)).toEqual([]);
  });

  test("a one-project run on a stored manifest that meets a page of another class stores nothing of it, resets and runs again with a fresh manifest", async () => {
    const t = setup("manager");
    await t.replica.sync();
    t.server.role = "member";
    // a new row so the project's feed names something to fetch: that page is the first to carry the new class
    t.server.upsert("p1", "tasks", "t3", { title: "Plaster", cost: 300 });
    t.advance(3 * 60_000); // past the replica's "this project was just checked" window
    t.server.calls.length = 0;
    const report = await t.replica.syncProject("p1", "tasks");
    expect(report.status).toBe("done");
    expect(t.server.calls.filter((c) => c.op === "manifest").length).toBe(1); // the rerun asked again
    const rows = await t.withDb((db) => db.listByProject("org-a", "tasks", "p1"));
    expect(rows.map((r) => (r.data as Record<string, unknown>).cost)).toEqual([null, null, null]);
  });

  test("a new epoch resets everything (versions restart) but keeps the row with a pending edit, its op and every draft", async () => {
    const t = setup("member");
    await t.replica.sync();
    t.server.upsert("p1", "tasks", "t1", { title: "Pour slab v2", cost: 1 });
    await t.replica.sync();
    expect((await t.row("tasks", "t1"))!.serverVersion).toBe(2);
    await makeDirty(t, "tasks", "t2", { title: "My shuttering note" });
    await t.withDb((db) => db.transact((tx) => tx.putDraft({ opId: "op-old", functionId: "update_x", projectId: "p1", params: { title: "typed" }, message: "Not saved", at: 1 })));
    t.server.restore("epoch-2");
    const report = await t.replica.sync();
    expect(report.status).toBe("done");
    expect((await t.row("tasks", "t1"))!.serverVersion).toBe(1); // re-pulled from the new epoch, not refused as "older"
    expect(((await t.row("tasks", "t2"))!.data as Record<string, unknown>).title).toBe("My shuttering note");
    expect(await t.ids("vendors")).toEqual(["ven-1", "ven-2"]);
    await t.withDb(async (db) => {
      expect(await db.getMeta(EPOCH_KEY)).toBe("epoch-2");
      expect((await db.listOps()).map((o) => o.opId)).toEqual(["op-mine"]);
      expect((await db.listDrafts()).map((d) => d.opId)).toEqual(["op-old"]);
    });
  });

  test("reset_required for one project resyncs that project only (its rows re-pulled, the other project's left alone)", async () => {
    const t = setup("member");
    await t.replica.sync();
    t.server.resetRequired.add("p1");
    t.server.calls.length = 0;
    const report = await t.replica.sync();
    expect(report.status).toBe("done");
    expect(await t.ids("tasks", "p1")).toEqual(["t1", "t2"]);
    expect(t.server.calls.filter((c) => c.op === "pull" && c.projectId === "p1").length).toBeGreaterThan(0);
    expect(t.server.calls.filter((c) => c.op === "pull" && c.projectId === "p2")).toEqual([]);
  });

  test("reset_required for the organisation resyncs the organisation", async () => {
    const t = setup("member");
    await t.replica.sync();
    await makeDirty(t, "departments", "dep-1", { name: "Mine" });
    t.server.resetRequired.add(ORG_PROJECT);
    t.server.calls.length = 0;
    expect((await t.replica.sync()).status).toBe("done");
    expect(t.server.calls.filter((c) => c.op === "pull" && c.projectId === ORG_PROJECT).length).toBeGreaterThan(0);
    expect(await t.ids("vendors")).toEqual(["ven-1", "ven-2"]);
    expect(((await t.row("departments", "dep-1"))!.data as Record<string, unknown>).name).toBe("Mine");
  });
});

describe("the organisation's share of a scheduler round (cost)", () => {
  test("within the hour a one-project run sends nothing for the organisation; after it, ONE /heads and no /changes when its head did not move", async () => {
    const t = setup("member");
    await t.replica.sync();
    const MIN3 = 3 * 60_000; // past the replica's own "this project was just checked" window, so every round really runs
    t.advance(MIN3);
    t.server.calls.length = 0;
    await t.replica.syncProject("p1");
    expect(t.server.calls.filter((c) => c.op === "changes" && c.projectId === "p1").length).toBe(1); // the round ran
    expect(t.server.calls.filter((c) => c.op === "heads" || c.projectId === ORG_PROJECT)).toEqual([]);
    t.advance(HOUR);
    t.server.calls.length = 0;
    await t.replica.syncProject("p1");
    expect(t.server.calls.filter((c) => c.op === "heads").length).toBe(1);
    expect(t.server.calls.filter((c) => c.projectId === ORG_PROJECT)).toEqual([]);
    // checked: the next round within the hour is free again
    t.advance(MIN3);
    t.server.calls.length = 0;
    await t.replica.syncProject("p1");
    expect(t.server.calls.filter((c) => c.op === "changes" && c.projectId === "p1").length).toBe(1);
    expect(t.server.calls.filter((c) => c.op === "heads")).toEqual([]);
  });

  test("a moved organisation head costs one /changes, and the change is on the laptop", async () => {
    const t = setup("member");
    await t.replica.sync();
    t.server.upsert(ORG_PROJECT, "vendors", "ven-3", { supplier_name: "Coastal Steel", credit_limit: 9 });
    t.advance(HOUR + 1);
    t.server.calls.length = 0;
    await t.replica.syncProject("p1");
    expect(t.server.calls.filter((c) => c.op === "changes" && c.projectId === ORG_PROJECT).length).toBe(1);
    expect(await t.ids("vendors")).toEqual(["ven-1", "ven-2", "ven-3"]);
  });

  test("a screen's kind-scoped run never checks the organisation", async () => {
    const t = setup("member");
    await t.replica.sync();
    t.advance(HOUR + 1);
    t.server.calls.length = 0;
    await t.replica.syncProject("p1", "tasks");
    expect(t.server.calls.filter((c) => c.op === "heads" || c.projectId === ORG_PROJECT)).toEqual([]);
  });

  test("/heads naming another role class: the classes are re-applied within the hour, silently", async () => {
    const t = setup("manager");
    await t.replica.sync();
    t.server.role = "member";
    t.advance(HOUR + 1);
    const report = await t.replica.syncProject("p1");
    expect(report.status).toBe("done");
    // the manager-cut organisation rows are gone at once (never shown to a member), and the open project is back, re-cut
    expect(await t.row("vendors", "ven-1")).toBeUndefined();
    expect(((await t.row("tasks", "t1"))!.data as Record<string, unknown>).cost).toBeNull();
    // p2 and the organisation were reset too and are brought back by the next whole run: the scheduler is told to make one
    await t.withDb(async (db) => {
      expect(await db.getMeta(LAST_SYNC_KEY)).toBeNull();
      expect(await db.getMeta(changeCursorKey("p2"))).toBeNull();
    });
    expect(await t.ids("tasks", "p2")).toEqual([]);
    expect((await t.replica.sync()).status).toBe("done");
    expect(((await t.row("tasks", "t9"))!.data as Record<string, unknown>).cost).toBeNull();
    expect(((await t.row("vendors", "ven-1"))!.data as Record<string, unknown>).credit_limit).toBeNull();
  });

  test("an older service without /heads: the hourly check is the one organisation /changes", async () => {
    const t = setup("member");
    t.server.noHeads = true;
    await t.replica.sync();
    t.advance(HOUR + 1);
    t.server.calls.length = 0;
    await t.replica.syncProject("p1");
    expect(t.server.calls.filter((c) => c.op === "changes" && c.projectId === ORG_PROJECT).length).toBe(1);
    await t.withDb(async (db) => expect(await db.getMeta(ORG_CHECK_KEY)).toBeTruthy());
  });
});

describe("isolation", () => {
  test("another person's database on the same laptop holds none of these organisation rows", async () => {
    const t = setup("member");
    await t.replica.sync();
    const other = await openLocalDb(t.idb, localDbNameFor("someone-else"));
    try {
      expect(await other.listByProject("org-a", "vendors", ORG_PROJECT)).toEqual([]);
      expect(await other.countRecords()).toBe(0);
    } finally {
      other.close();
    }
  });
});
