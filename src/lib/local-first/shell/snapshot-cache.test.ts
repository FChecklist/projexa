import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../local-db";
import {
  SNAPSHOT_INDEX_KEY,
  SNAPSHOT_PREFIX,
  asOfLabel,
  canonicalQuery,
  clearSnapshots,
  createSnapshotCache,
  refreshSnapshot,
  snapshotCacheFor,
  snapshotKey,
} from "./snapshot-cache";

type Body = { total: number };
const isBody = (v: unknown): v is Body => typeof v === "object" && v !== null && typeof (v as Body).total === "number";
const NAME = { route: "/api/dashboard/project", projectId: "p1" };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("snapshot keys", () => {
  test("the query is canonical: order and empty values do not make two different reads", () => {
    expect(canonicalQuery("b=2&a=1&c=")).toBe("a=1&b=2");
    expect(canonicalQuery({ b: "2", a: "1", c: null })).toBe("a=1&b=2");
    expect(snapshotKey({ ...NAME, query: "?b=2&a=1" })).toBe(snapshotKey({ ...NAME, query: new URLSearchParams("a=1&b=2") }));
    expect(snapshotKey({ ...NAME, projectId: "p2" })).not.toBe(snapshotKey(NAME));
    expect(snapshotKey({ route: "/x", projectId: null })).toBe("/x|-|");
  });

  test("the label says plainly when and where the numbers come from", () => {
    expect(asOfLabel(Date.UTC(2026, 9, 2, 14, 30))).toMatch(/^As of .*2026.*, from this laptop$/);
  });
});

describe("the snapshot cache, in the person's own database", () => {
  test("keeps the last server answer with when it came, and reads it back", async () => {
    const idb = new IDBFactory();
    const cache = createSnapshotCache({ userId: "u1", role: "pm", meta: personMeta("u1", idb), now: () => 1_000 });
    expect(await cache.read(NAME, isBody)).toBeNull();
    await cache.write(NAME, { total: 5 });
    const snap = await cache.read(NAME, isBody);
    expect(snap).toMatchObject({ body: { total: 5 }, fetchedAt: 1_000, userId: "u1", role: "pm", projectId: "p1" });
    // It is in u1's own database, nowhere else.
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect(await db.getMeta(SNAPSHOT_PREFIX + snapshotKey(NAME))).toBeTruthy();
    db.close();
    const other = await openLocalDb(idb, localDbNameFor("u2"));
    expect(await other.getMeta(SNAPSHOT_PREFIX + snapshotKey(NAME))).toBeUndefined();
    other.close();
  });

  test("another person on the same laptop never reads it", async () => {
    const idb = new IDBFactory();
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(NAME, { total: 5 });
    expect(await snapshotCacheFor({ userId: "u2", role: "pm", idb }).read(NAME, isBody)).toBeNull();
    // Even a copy planted in u2's own database under u1's name is ignored.
    const db = await openLocalDb(idb, localDbNameFor("u2"));
    await db.setMeta(SNAPSHOT_PREFIX + snapshotKey(NAME), { key: snapshotKey(NAME), route: NAME.route, projectId: "p1", query: "", userId: "u1", role: "pm", fetchedAt: 1, body: { total: 9 } });
    db.close();
    expect(await snapshotCacheFor({ userId: "u2", role: "pm", idb }).read(NAME, isBody)).toBeNull();
  });

  test("a snapshot taken under another role is not shown (a person made a viewer does not keep a manager's numbers)", async () => {
    const idb = new IDBFactory();
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(NAME, { total: 5 });
    expect(await snapshotCacheFor({ userId: "u1", role: "viewer", idb }).read(NAME, isBody)).toBeNull();
    expect(await snapshotCacheFor({ userId: "u1", role: "pm", idb }).read(NAME, isBody)).not.toBeNull();
  });

  test("a stored body that does not look right is 'no snapshot' (untrusted input)", async () => {
    const idb = new IDBFactory();
    const cache = snapshotCacheFor({ userId: "u1", role: "pm", idb });
    await cache.write(NAME, { total: "five" });
    expect(await cache.read(NAME, isBody)).toBeNull();
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    await db.setMeta(SNAPSHOT_PREFIX + snapshotKey(NAME), "garbage");
    db.close();
    expect(await cache.read(NAME, isBody)).toBeNull();
  });

  test("bounded: the oldest snapshot goes first, and an answer too large is not kept", async () => {
    const idb = new IDBFactory();
    let t = 0;
    const cache = createSnapshotCache({ userId: "u1", role: "pm", meta: personMeta("u1", idb), now: () => ++t, maxEntries: 2, maxBytes: 50 });
    await cache.write({ ...NAME, projectId: "a" }, { total: 1 });
    await cache.write({ ...NAME, projectId: "b" }, { total: 2 });
    await cache.write({ ...NAME, projectId: "c" }, { total: 3 });
    expect((await cache.list()).map((e) => e.key)).toEqual([snapshotKey({ ...NAME, projectId: "c" }), snapshotKey({ ...NAME, projectId: "b" })]);
    expect(await cache.read({ ...NAME, projectId: "a" }, isBody)).toBeNull();
    expect(await cache.write({ ...NAME, projectId: "d" }, { total: 1, pad: "x".repeat(100) })).toBeNull();
    expect(await cache.read({ ...NAME, projectId: "d" }, isBody)).toBeNull();
  });

  test("clearSnapshots(userId) removes every snapshot of that person and only theirs", async () => {
    const idb = new IDBFactory();
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(NAME, { total: 1 });
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write({ ...NAME, projectId: "p2" }, { total: 2 });
    await snapshotCacheFor({ userId: "u2", role: "pm", idb }).write(NAME, { total: 3 });
    await clearSnapshots("u1", idb);
    expect(await snapshotCacheFor({ userId: "u1", role: "pm", idb }).read(NAME, isBody)).toBeNull();
    expect(await snapshotCacheFor({ userId: "u1", role: "pm", idb }).read({ ...NAME, projectId: "p2" }, isBody)).toBeNull();
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect(await db.getMeta(SNAPSHOT_INDEX_KEY)).toEqual([]);
    db.close();
    expect((await snapshotCacheFor({ userId: "u2", role: "pm", idb }).read(NAME, isBody))?.body).toEqual({ total: 3 });
    await clearSnapshots(""); // never throws
  });
});

describe("refreshing a snapshot from the server", () => {
  test("online: the same endpoint is fetched and its answer replaces the snapshot", async () => {
    const idb = new IDBFactory();
    const cache = snapshotCacheFor({ userId: "u1", role: "pm", idb });
    const calls: string[] = [];
    const out = await refreshSnapshot(cache, NAME, "/api/dashboard/project/p1", isBody, { fetchImpl: (async (u: string) => { calls.push(u); return json(200, { total: 7 }); }) as unknown as typeof fetch });
    expect(out.state).toBe("fresh");
    expect(calls).toEqual(["/api/dashboard/project/p1"]);
    expect((await cache.read(NAME, isBody))?.body).toEqual({ total: 7 });
  });

  test("offline, a struggling server, a sign-out or an odd answer keep the last snapshot", async () => {
    const idb = new IDBFactory();
    const cache = snapshotCacheFor({ userId: "u1", role: "pm", idb });
    await cache.write(NAME, { total: 1 });
    const cases: [typeof fetch, string][] = [
      [(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch, "offline"],
      [(async () => json(503, {})) as unknown as typeof fetch, "server"],
      [(async () => json(401, {})) as unknown as typeof fetch, "signed_out"],
      [(async () => json(200, { total: "x" })) as unknown as typeof fetch, "invalid"],
    ];
    for (const [fetchImpl, state] of cases) {
      expect((await refreshSnapshot(cache, NAME, "/x", isBody, { fetchImpl })).state).toBe(state as never);
      expect((await cache.read(NAME, isBody))?.body).toEqual({ total: 1 });
    }
  });

  test("a refusal (403/404) removes the snapshot: a person no longer allowed does not keep the numbers", async () => {
    const idb = new IDBFactory();
    const cache = snapshotCacheFor({ userId: "u1", role: "pm", idb });
    await cache.write(NAME, { total: 1 });
    const out = await refreshSnapshot(cache, NAME, "/x", isBody, { fetchImpl: (async () => json(403, { error: "Not allowed" })) as unknown as typeof fetch });
    expect(out).toEqual({ state: "refused", status: 403, message: "Not allowed" });
    expect(await cache.read(NAME, isBody)).toBeNull();
  });
});

function personMeta(userId: string, idb: IDBFactory) {
  return {
    async getMeta<T>(key: string) {
      const db = await openLocalDb(idb, localDbNameFor(userId));
      try { return await db.getMeta<T>(key); } finally { db.close(); }
    },
    async setMeta(key: string, value: unknown) {
      const db = await openLocalDb(idb, localDbNameFor(userId));
      try { await db.setMeta(key, value); } finally { db.close(); }
    },
  };
}
