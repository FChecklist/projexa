import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "./__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "./local-db";
import { CHANGE_FEED_OVERLAP, MANIFEST_KEY, changeCursorKey, createReplica } from "./replica";
import { refreshShellManifest } from "./shell/manifest-cache";
import { rememberIdentity } from "./ai/identity";

// LOCAL-FIRST review F01 / F1 and F08, against the rebuilt fake (which, like the real service, names the person by a VERIDIAN id in
// user.id and by their sign-in id in user.auth_user_id). The same behaviours run against the REAL handler in
// conformance/wire.integration.test.ts (W02, W02b, W14, W14b) when CT_ROOT is set.

const memoryMeta = () => {
  const m = new Map<string, unknown>();
  return { getMeta: async <T>(k: string) => m.get(k) as T | undefined, setMeta: async (k: string, v: unknown) => void m.set(k, v), m };
};

describe("whose manifest is this: the sign-in id, not the VERIDIAN id", () => {
  test("the replica syncs the person the app signs in as (sign-in id), though the manifest's user.id is a different VERIDIAN id", async () => {
    const server = createFakeSyncServer({ strict: true });
    server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "A" } });
    expect(server.veridianUserId).not.toBe(server.userId);
    const idb = new IDBFactory();
    const report = await createReplica({ userId: server.userId, client: server.client, idb, yieldFn: async () => {} }).sync();
    expect(report.issues).toEqual([]);
    expect(report.status).toBe("done");
    const db = await openLocalDb(idb, localDbNameFor(server.userId)); // the database is named by the sign-in id
    try {
      expect((await db.getMeta<{ userId: string }>(MANIFEST_KEY))?.userId).toBe(server.userId);
      expect((await db.listByProject("orgA", "tasks", "p1")).length).toBe(1);
    } finally {
      db.close();
    }
  });

  test("a laptop of ANOTHER person (or one keyed by the VERIDIAN id) stores nothing: user_mismatch", async () => {
    for (const laptopUser of ["someone-else", "ckfakeveridianuser000001"]) {
      const server = createFakeSyncServer({ strict: true });
      server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "A" } });
      const report = await createReplica({ userId: laptopUser, client: server.client, idb: new IDBFactory(), yieldFn: async () => {} }).sync();
      expect(report.issues.map((i) => i.reason)).toEqual(["user_mismatch"]);
      expect(report.status).toBe("error");
      expect(report.itemsStored).toBe(0);
    }
  });

  test("the shell's names cache and the AI identity accept the real person's manifest and refuse another's", async () => {
    const server = createFakeSyncServer({ strict: true });
    const meta = memoryMeta();
    expect((await refreshShellManifest({ client: server.client, meta, userId: server.userId, force: true })).result).toBe("refreshed");
    expect((await refreshShellManifest({ client: server.client, meta: memoryMeta(), userId: "someone-else", force: true })).result).toBe("failed");
    const manifest = await server.client.manifest();
    expect((await rememberIdentity(memoryMeta(), manifest, server.userId, 1))?.userId).toBe(server.userId);
    expect(await rememberIdentity(memoryMeta(), manifest, "someone-else", 1)).toBeNull();
  });
});

describe("the change feed is re-read with an overlap (0679 KNOWN LIMIT)", () => {
  test("the first /changes of a run asks from position - CHANGE_FEED_OVERLAP; already-held versions are not fetched again; the position only moves forward", async () => {
    const server = createFakeSyncServer({ strict: true, kinds: [{ kind: "tasks" }, { kind: "progress", cursor_field: null }] });
    for (let i = 0; i < 250; i++) server.upsert({ kind: "progress", projectId: "p1", id: `x${String(i).padStart(3, "0")}`, data: { percent: 1 } });
    const idb = new IDBFactory();
    const replica = createReplica({ userId: server.userId, client: server.client, idb, yieldFn: async () => {} });
    await replica.sync();
    // 250 rows changed elsewhere; the feed position moves past them on the next sync
    for (let i = 0; i < 250; i++) server.upsert({ kind: "progress", projectId: "p1", id: `x${String(i).padStart(3, "0")}`, data: { percent: 50 }, touch: false });
    await replica.sync();
    const position = async () => {
      const db = await openLocalDb(idb, localDbNameFor(server.userId));
      try {
        return (await db.getMeta<{ seq: number }>(changeCursorKey("p1")))!.seq;
      } finally {
        db.close();
      }
    };
    const held = await position();
    expect(held).toBe(server.headSeq());
    const before = server.requests.length;
    await replica.sync();
    const asks = server.requests.slice(before).filter((r) => r.path === "/changes" && r.body.after_seq !== null);
    expect(CHANGE_FEED_OVERLAP).toBe(200);
    expect(asks[0]!.body.after_seq).toBe(held - CHANGE_FEED_OVERLAP);
    // the re-read names versions the laptop already holds: no row is fetched again
    expect(server.requests.slice(before).filter((r) => r.path === "/pull" && Array.isArray(r.body.ids))).toEqual([]);
    expect(await position()).toBe(held);
  });

  test("a change that becomes visible below the laptop's position (a long transaction) is picked up by the overlap", async () => {
    const server = createFakeSyncServer({ strict: true, kinds: [{ kind: "tasks" }, { kind: "progress", cursor_field: null }] });
    server.upsert({ kind: "progress", projectId: "p1", id: "late", data: { percent: 1 } });
    const idb = new IDBFactory();
    const replica = createReplica({ userId: server.userId, client: server.client, idb, yieldFn: async () => {} });
    await replica.sync();
    // the late row's update took seq S; the laptop syncs past S; only afterwards is it re-read (simulated: the change exists at a seq the
    // laptop has passed, and the keyset cannot see it because a table without updated_at keeps its cursor)
    server.upsert({ kind: "progress", projectId: "p1", id: "late", data: { percent: 99 }, touch: false });
    const db = await openLocalDb(idb, localDbNameFor(server.userId));
    await db.setMeta(changeCursorKey("p1"), { seq: server.headSeq() + 5 }); // the laptop already holds a position past that change
    db.close();
    await replica.sync();
    const db2 = await openLocalDb(idb, localDbNameFor(server.userId));
    try {
      expect((await db2.getRecord("progress", "late"))?.data).toMatchObject({ percent: 99 });
    } finally {
      db2.close();
    }
  });
});
