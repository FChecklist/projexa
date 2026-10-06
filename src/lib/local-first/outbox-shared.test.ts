/// <reference types="bun-types" />
// cost:TEST-15: the PRODUCTION wiring of the shared outbox, not a stub of it -- the per-person memo, the resume of what a
// reload left behind, the browser `online` trigger, and the release on sign-out. Only the network client is replaced (by
// the REAL sync client over the shared fake server); outbox-shared.ts itself runs unmodified.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "./__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "./local-db";
import { createReplica } from "./replica";

const current: { server: FakeSyncServer | null; clientOptions: unknown[] } = { server: null, clientOptions: [] };
mock.module("./shared-client", () => ({
  getReleaseVersion: () => "test",
  accessToken: async () => "fake-token",
  createSharedSyncClient: (options: unknown) => {
    current.clientOptions.push(options);
    return current.server!.client;
  },
}));

const shared = await import("./outbox-shared");
const reader = await import("./local-reader");

let user = 0;
async function setup() {
  const idb = new IDBFactory();
  (globalThis as { indexedDB?: unknown }).indexedDB = idb;
  const server = createFakeSyncServer({ userId: `u${++user}` });
  server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old" } });
  current.server = server;
  const userId = `u${user}`;
  await createReplica({ userId, client: server.client, idb, yieldFn: async () => {} }).sync();
  return { idb, server, userId };
}

/** An op left in the person's database by a closed tab (it was never sent). */
async function leaveOpBehind(idb: IDBFactory, userId: string, opId: string, title: string) {
  const db = await openLocalDb(idb, localDbNameFor(userId));
  await db.putOp({ opId, functionId: "update_task", projectId: "p1", params: { issueId: "t1", title }, record: { kind: "tasks", id: "t1", baseVersion: 1 }, clientAt: "2026-10-02T10:00:00Z", status: "pending", attempts: 0, nextAttemptAt: 0 });
  db.close();
}

const pushes = (s: FakeSyncServer) => s.requests.filter((r) => r.path === "/push");

async function until(check: () => boolean | Promise<boolean>, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition not reached");
}

beforeEach(() => { current.clientOptions = []; });

describe("outbox-shared (production wiring)", () => {
  test("one outbox per person (memoised), a different one for another person, and the person becomes the active local user", async () => {
    const { userId } = await setup();
    const a = shared.getSharedOutbox(userId);
    expect(shared.getSharedOutbox(userId)).toBe(a);
    expect(shared.peekSharedOutbox(userId)).toBe(a);
    expect(await reader.resolveLocalUserId()).toBe(userId);
    const other = shared.getSharedOutbox(`${userId}-other`);
    expect(other).not.toBe(a);
    shared.releaseSharedOutbox(`${userId}-other`);
    shared.releaseSharedOutbox(userId);
  });

  test("the client it uses retries once with a 20 s ceiling (the cost-bounding settings)", async () => {
    const { userId } = await setup();
    shared.getSharedOutbox(userId);
    expect(current.clientOptions).toEqual([{ timeoutMs: 20_000, maxRetries: 1 }]);
    shared.releaseSharedOutbox(userId);
  });

  test("creating it RESUMES what a reload left behind: the waiting op is sent with its original op_id, once", async () => {
    const { idb, server, userId } = await setup();
    await leaveOpBehind(idb, userId, "left-1", "From before the reload");
    const outbox = shared.getSharedOutbox(userId);
    await until(async () => (await outbox.pendingCount()) === 0);
    expect(pushes(server).map((p) => p.body.ops.map((o: { op_id: string }) => o.op_id))).toEqual([["left-1"]]);
    expect(server.getRow("tasks", "t1")!.data).toMatchObject({ title: "From before the reload" });
    shared.releaseSharedOutbox(userId);
  });

  test("a browser `online` event flushes; after release (sign-out) it no longer does, and the outbox is stopped", async () => {
    const { idb, server, userId } = await setup();
    const outbox = shared.getSharedOutbox(userId);
    await until(() => outbox.getState().status === "idle");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const before = pushes(server).length;

    await leaveOpBehind(idb, userId, "after-online", "Sent when the connection returned");
    window.dispatchEvent(new Event("online"));
    await until(() => pushes(server).length >= before + 1);
    await until(async () => (await outbox.pendingCount()) === 0);

    shared.releaseSharedOutbox(userId);
    expect(shared.peekSharedOutbox(userId)).toBeNull();
    await leaveOpBehind(idb, userId, "after-release", "Must wait for the next sign-in");
    window.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    // The invariant is "the op left behind after sign-out is never sent". The exact push count is a timing artefact
    // (a late resume flush under CI load can add one more push of the SAME op), so assert on op ids, not on the count.
    const sent = pushes(server).flatMap((p) => p.body.ops.map((o: { op_id: string }) => o.op_id));
    expect(sent).toContain("after-online");
    expect(sent).not.toContain("after-release");
  });

  test("the device id is stable for this browser", () => {
    const id = shared.getDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(shared.getDeviceId()).toBe(id);
  });
});
