import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "./local-db";
import { MANIFEST_KEY, cursorKey, createReplica, doneKey, type ReplicaProgress } from "./replica";
import { SyncError, type SyncClient, type SyncItem, type SyncManifest } from "./sync-client";

type Fake = {
  client: SyncClient;
  pulls: { projectId: string; kind: string; after: unknown }[];
  maxInFlight: () => number;
  data: Map<string, SyncItem[]>;
  failAt: { n: number; error: Error } | null;
};

/** A stand-in for the sync service: pages by numeric offset cursor, optionally failing on the Nth pull. */
function fakeService(opts: {
  userId?: string;
  orgId?: string;
  projects?: string[];
  kinds?: string[];
  pageSize?: number;
  data?: Record<string, SyncItem[]>; // key `${project}:${kind}`
  delayMs?: number;
}): Fake {
  const projects = opts.projects ?? ["p1"];
  const kinds = opts.kinds ?? ["boq_lines"];
  const pageSize = opts.pageSize ?? 500;
  const data = new Map(Object.entries(opts.data ?? {}));
  let inFlight = 0;
  let peak = 0;
  const fake: Fake = {
    pulls: [],
    data,
    failAt: null,
    maxInFlight: () => peak,
    client: {
      async manifest() {
        return {
          user: { id: opts.userId ?? "u1", org_id: opts.orgId ?? "orgA" },
          projects: projects.map((id) => ({ id })),
          kinds: kinds.map((kind) => ({ kind, project_scoped: true })),
        } satisfies SyncManifest;
      },
      async pull({ projectId, kind, after }) {
        fake.pulls.push({ projectId, kind, after });
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        try {
          if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
          if (fake.failAt && fake.pulls.length === fake.failAt.n) throw fake.failAt.error;
          const all = data.get(`${projectId}:${kind}`) ?? [];
          const start = typeof after === "number" ? after : 0;
          const items = all.slice(start, start + pageSize);
          const end = start + items.length;
          return { items, next_cursor: end, has_more: end < all.length, hidden_fields: [], redacted: false };
        } finally {
          inFlight -= 1;
        }
      },
    },
  };
  return fake;
}

const row = (id: string, extra: Record<string, unknown> = {}, deleted = false): SyncItem => ({
  id, updated_at: "2026-10-02T10:00:00Z", data: { id, description: `line ${id}`, ...extra }, deleted,
});
const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => row(String(from + i)));
const noYield = async () => {};

describe("replica sync", () => {
  test("copies every project and kind, stores the cursor per pair and marks each pair done", async () => {
    const idb = new IDBFactory();
    const fake = fakeService({ projects: ["p1", "p2"], kinds: ["boq_lines", "rfis"], pageSize: 2, data: { "p1:boq_lines": rows(5), "p2:boq_lines": rows(1, 100), "p1:rfis": rows(2, 200) } });
    const report = await createReplica({ userId: "u1", client: fake.client, idb, yieldFn: noYield }).sync();
    expect(report.status).toBe("done");
    expect(report.itemsStored).toBe(8);
    expect(report.projectsSynced).toBe(2);

    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((await db.listByProject("orgA", "boq_lines", "p1")).length).toBe(5);
    expect((await db.getRecord("boq_lines", "100"))?.projectId).toBe("p2");
    expect(await db.getMeta(cursorKey("p1", "boq_lines"))).toBe(5);
    expect(await db.getMeta(doneKey("p2", "rfis"))).toMatchObject({ redacted: false });
    expect((await db.getMeta<{ orgId: string }>(MANIFEST_KEY))?.orgId).toBe("orgA");
    db.close();
  });

  test("AUDIT-100 B10: the stored manifest keeps the project NAMES of the manifest it came from, so a project made today is named at once", async () => {
    const idb = new IDBFactory();
    const fake = fakeService({ projects: ["p1", "p2"] });
    let projects: { id: string; name?: string }[] = [{ id: "p1", name: "Cedar Heights Villa" }, { id: "p2" }];
    const manifest = fake.client.manifest.bind(fake.client);
    fake.client.manifest = async (signal) => ({ ...(await manifest(signal)), projects });
    const replica = createReplica({ userId: "u1", client: fake.client, idb, yieldFn: noYield });
    expect((await replica.sync()).status).toBe("done");
    const read = async () => {
      const db = await openLocalDb(idb, localDbNameFor("u1"));
      try { return await db.getMeta<{ projectIds: string[]; projectNames?: Record<string, string> }>(MANIFEST_KEY); } finally { db.close(); }
    };
    expect((await read())?.projectNames).toEqual({ p1: "Cedar Heights Villa" }); // an unnamed project is not given an empty name
    // the person makes a project: the next whole sync lists it and names it
    projects = [...projects, { id: "p3", name: "Riverside Annex" }];
    expect((await replica.sync()).status).toBe("done");
    expect(await read()).toMatchObject({ projectIds: ["p1", "p2", "p3"], projectNames: { p1: "Cedar Heights Villa", p3: "Riverside Annex" } });
  });

  test("a second sync pulls only what changed (it starts from the stored cursor), and is idempotent", async () => {
    const idb = new IDBFactory();
    const fake = fakeService({ pageSize: 100, data: { "p1:boq_lines": rows(3) } });
    const replica = createReplica({ userId: "u1", client: fake.client, idb, yieldFn: noYield });
    await replica.sync();
    fake.data.set("p1:boq_lines", [...rows(3), row("3")]);
    fake.pulls.length = 0;
    const again = await replica.sync();
    expect(again.status).toBe("done");
    expect(fake.pulls[0]!.after).toBe(3); // not null: the first sync's cursor
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((await db.listByProject("orgA", "boq_lines", "p1")).length).toBe(4); // no duplicates from re-delivery
    db.close();
  });

  test("resumes after an interruption: earlier pages stay, the cursor sits after the last stored page", async () => {
    const idb = new IDBFactory();
    const fake = fakeService({ pageSize: 2, data: { "p1:boq_lines": rows(7) } });
    fake.failAt = { n: 3, error: new SyncError("network", "offline") }; // pages 1 and 2 arrive, page 3 never does
    const first = await createReplica({ userId: "u1", client: fake.client, idb, yieldFn: noYield }).sync();
    expect(first.status).toBe("partial");
    expect(first.issues[0]).toMatchObject({ projectId: "p1", kind: "boq_lines", reason: "network" });

    let db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((await db.listByProject("orgA", "boq_lines", "p1")).length).toBe(4); // pages 1 and 2 kept
    expect(await db.getMeta(cursorKey("p1", "boq_lines"))).toBe(4);
    expect(await db.getMeta(doneKey("p1", "boq_lines"))).toBeFalsy(); // not complete, so the reader will not trust it
    db.close();

    fake.failAt = null;
    fake.pulls.length = 0;
    const second = await createReplica({ userId: "u1", client: fake.client, idb, yieldFn: noYield }).sync();
    expect(second.status).toBe("done");
    expect(fake.pulls[0]!.after).toBe(4); // resumed, did not start over
    db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((await db.listByProject("orgA", "boq_lines", "p1")).length).toBe(7);
    expect(await db.getMeta(doneKey("p1", "boq_lines"))).toBeTruthy();
    db.close();
  });

  test("the cursor advances only after the page is stored: a page that cannot be stored leaves the cursor where it was", async () => {
    const idb = new IDBFactory();
    // Page 2 carries a record that belongs to another organisation: that whole page is refused.
    const data = [...rows(2), row("2"), row("3", { org_id: "orgB" })];
    const fake = fakeService({ pageSize: 2, data: { "p1:boq_lines": data } });
    const report = await createReplica({ userId: "u1", client: fake.client, idb, yieldFn: noYield }).sync();
    expect(report.status).toBe("partial"); // page 1 was stored, page 2 refused
    expect(report.issues[0]).toMatchObject({ reason: "org_mismatch" });
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect(await db.getMeta(cursorKey("p1", "boq_lines"))).toBe(2); // page 1's cursor, not page 2's
    expect(await db.getRecord("boq_lines", "3")).toBeUndefined();
    expect(await db.getRecord("boq_lines", "0")).toBeDefined(); // page 1 kept
    db.close();
  });

  test("a deleted item removes the local record", async () => {
    const idb = new IDBFactory();
    const fake = fakeService({ data: { "p1:boq_lines": rows(3) } });
    const replica = createReplica({ userId: "u1", client: fake.client, idb, yieldFn: noYield });
    await replica.sync();
    fake.data.set("p1:boq_lines", [...rows(3), row("1", {}, true)]);
    const report = await replica.sync();
    expect(report.itemsRemoved).toBe(1);
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect(await db.getRecord("boq_lines", "1")).toBeUndefined();
    expect(await db.getRecord("boq_lines", "0")).toBeDefined();
    db.close();
  });

  test("two people on one laptop never mix: separate databases, and a manifest for someone else is refused", async () => {
    const idb = new IDBFactory();
    const a = fakeService({ userId: "uA", orgId: "orgA", data: { "p1:boq_lines": rows(2) } });
    const b = fakeService({ userId: "uB", orgId: "orgB", projects: ["p9"], data: { "p9:boq_lines": rows(3, 50) } });
    await createReplica({ userId: "uA", client: a.client, idb, yieldFn: noYield }).sync();
    await createReplica({ userId: "uB", client: b.client, idb, yieldFn: noYield }).sync();

    const dbA = await openLocalDb(idb, localDbNameFor("uA"));
    const dbB = await openLocalDb(idb, localDbNameFor("uB"));
    expect(await dbA.countRecords()).toBe(2);
    expect(await dbB.countRecords()).toBe(3);
    expect(await dbA.getRecord("boq_lines", "50")).toBeUndefined();
    dbA.close();
    dbB.close();

    // uA's database fed with uB's token (the signed-in person changed under it): refused, nothing stored.
    const mismatched = await createReplica({ userId: "uA", client: b.client, idb, yieldFn: noYield }).sync();
    expect(mismatched.status).toBe("error");
    expect(mismatched.issues[0]!.reason).toBe("user_mismatch");
    const again = await openLocalDb(idb, localDbNameFor("uA"));
    expect(await again.countRecords()).toBe(2);
    again.close();
  });

  test("a record of another organisation is refused and cannot overwrite an existing one", async () => {
    const idb = new IDBFactory();
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    await db.putRecord({ id: "boq_lines:7", type: "boq_lines", orgId: "orgB", projectId: "p1", data: { id: "7", secret: true } });
    db.close();
    const fake = fakeService({ orgId: "orgA", data: { "p1:boq_lines": [row("7", { description: "overwrite attempt" })] } });
    const report = await createReplica({ userId: "u1", client: fake.client, idb, yieldFn: noYield }).sync();
    expect(report.status).toBe("error");
    const after = await openLocalDb(idb, localDbNameFor("u1"));
    expect(((await after.getRecord("boq_lines", "7"))?.data as { secret?: boolean }).secret).toBe(true);
    expect((await after.getRecord("boq_lines", "7"))?.orgId).toBe("orgB");
    after.close();
  });

  test("a manifest for a different organisation than the one on this laptop is refused", async () => {
    const idb = new IDBFactory();
    await createReplica({ userId: "u1", client: fakeService({ orgId: "orgA", data: { "p1:boq_lines": rows(1) } }).client, idb, yieldFn: noYield }).sync();
    const report = await createReplica({ userId: "u1", client: fakeService({ orgId: "orgB", data: { "p1:boq_lines": rows(1, 9) } }).client, idb, yieldFn: noYield }).sync();
    expect(report.status).toBe("error");
    expect(report.issues[0]!.reason).toBe("org_mismatch");
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect(await db.getRecord("boq_lines", "9")).toBeUndefined();
    db.close();
  });

  test("a project the person no longer belongs to is removed from the laptop", async () => {
    const idb = new IDBFactory();
    const svc = fakeService({ projects: ["p1", "p2"], data: { "p1:boq_lines": rows(2), "p2:boq_lines": rows(2, 10) } });
    await createReplica({ userId: "u1", client: svc.client, idb, yieldFn: noYield }).sync();
    const later = fakeService({ projects: ["p1"], data: { "p1:boq_lines": rows(2) } });
    const report = await createReplica({ userId: "u1", client: later.client, idb, yieldFn: noYield }).sync();
    expect(report.itemsRemoved).toBe(2);
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((await db.listByProject("orgA", "boq_lines", "p2")).length).toBe(0);
    expect(await db.getMeta(doneKey("p2", "boq_lines"))).toBeFalsy();
    expect((await db.listByProject("orgA", "boq_lines", "p1")).length).toBe(2);
    db.close();
  });

  test("a 404 for one pair removes that pair's copy, keeps the rest, and the run reports partial", async () => {
    const idb = new IDBFactory();
    const svc = fakeService({ projects: ["p1", "p2"], data: { "p1:boq_lines": rows(2), "p2:boq_lines": rows(2, 10) } });
    await createReplica({ userId: "u1", client: svc.client, idb, yieldFn: noYield }).sync();
    const origPull = svc.client.pull;
    svc.client.pull = async (req, signal) => {
      if (req.projectId === "p2") throw new SyncError("not_found", "gone", 404);
      return origPull(req, signal);
    };
    const report = await createReplica({ userId: "u1", client: svc.client, idb, yieldFn: noYield }).sync();
    expect(report.status).toBe("partial");
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((await db.listByProject("orgA", "boq_lines", "p2")).length).toBe(0);
    expect((await db.listByProject("orgA", "boq_lines", "p1")).length).toBe(2);
    db.close();
  });

  test("a 401 stops everything and reports signed out", async () => {
    const idb = new IDBFactory();
    const svc = fakeService({ projects: ["p1", "p2", "p3"], data: { "p1:boq_lines": rows(1), "p2:boq_lines": rows(1, 5), "p3:boq_lines": rows(1, 9) } });
    svc.client.pull = async () => { throw new SyncError("signed_out", "signed out", 401); };
    const report = await createReplica({ userId: "u1", client: svc.client, idb, yieldFn: noYield }).sync();
    expect(report.status).toBe("signed_out");
    expect(report.syncedAt).toBeNull();
  });

  test("an unreachable manifest becomes a status, not an exception", async () => {
    const client: SyncClient = {
      manifest: async () => { throw new SyncError("network", "down"); },
      pull: async () => { throw new Error("unreachable"); },
    };
    const report = await createReplica({ userId: "u1", client, idb: new IDBFactory(), yieldFn: noYield }).sync();
    expect(report.status).toBe("error");
    expect(report.issues[0]!.reason).toBe("network");
  });

  test("a service that says has_more without moving its cursor is stopped, not looped forever", async () => {
    const idb = new IDBFactory();
    const client: SyncClient = {
      manifest: async () => ({ user: { id: "u1", org_id: "orgA" }, projects: [{ id: "p1" }], kinds: [{ kind: "boq_lines" }] }),
      pull: async () => ({ items: [], next_cursor: null, has_more: true, hidden_fields: [], redacted: false }),
    };
    const report = await createReplica({ userId: "u1", client, idb, yieldFn: noYield }).sync();
    expect(report.status).toBe("error");
    expect(report.issues[0]!.reason).toBe("no_progress");
  });

  test("at most two pulls are in flight, and progress counts projects done out of total", async () => {
    const idb = new IDBFactory();
    const projects = ["a", "b", "c", "d", "e"];
    const svc = fakeService({ projects, delayMs: 5, data: Object.fromEntries(projects.map((p) => [`${p}:boq_lines`, rows(1, projects.indexOf(p) * 10)])) });
    const seen: ReplicaProgress[] = [];
    const report = await createReplica({ userId: "u1", client: svc.client, idb, yieldFn: noYield, concurrency: 8, onProgress: (p) => seen.push({ ...p }) }).sync();
    expect(report.status).toBe("done");
    expect(svc.maxInFlight()).toBe(2);
    expect(seen.at(-1)).toMatchObject({ projectsDone: 5, projectsTotal: 5 });
    expect(seen.map((p) => p.projectsDone)).toEqual([...seen.map((p) => p.projectsDone)].sort((x, y) => x - y));
  });

  test("a large set (10,000 rows) is written in small chunks, each followed by a yield: never one long block", async () => {
    const idb = new IDBFactory();
    const svc = fakeService({ pageSize: 500, data: { "p1:boq_lines": rows(10_000) } });
    let yields = 0;
    const chunks: number[] = [];
    const report = await createReplica({
      userId: "u1", client: svc.client, idb, chunkSize: 100,
      onChunk: (n) => chunks.push(n),
      yieldFn: async () => { yields += 1; },
    }).sync();
    expect(report.status).toBe("done");
    expect(report.itemsStored).toBe(10_000);
    expect(svc.pulls.length).toBe(20); // 500 per page: pages are processed one at a time, never all held at once
    expect(chunks.length).toBe(100);
    expect(Math.max(...chunks)).toBeLessThanOrEqual(100); // the longest synchronous write stretch
    expect(yields).toBeGreaterThanOrEqual(chunks.length); // the thread is handed back after every chunk
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect(await db.countRecords("orgA")).toBe(10_000);
    db.close();
  }, 120_000);
});
