import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "./__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "./local-db";
import { createOutbox } from "./outbox";
import { createReplica } from "./replica";
import {
  DELETE_FAILED_NOTICE, DELETE_UNKNOWN_PERSON_NOTICE, finishLocalWorkspaceOnSignOut, forgetLastSignOutNotice, pendingKeptNotice, pendingNotice,
} from "./sign-out";

// Sign-out and this laptop's copy (package lf-fc, review cost:COST-05, data:F11, cost:TEST-14, cost:FLAG-16):
//   * DEFAULT: the copy is KEPT (a re-login costs nothing and works offline); the outbox is still flushed while the session lives;
//   * the explicit choice `deleteLocalCopy` deletes it -- never while edits or drafts wait, and a failed / blocked delete is SAID;
//   * the BOQ hints go in every path; the "workspace ready" key goes only with a deleted copy;
//   * flag off and no delete asked: inert (no listing, no database opened, no flush).

async function names(idb: IDBFactory): Promise<string[]> {
  return (await idb.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("projexa-local")).sort();
}

function memoryStorage(initial: Record<string, string>) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    storage: { getItem: (k: string) => map.get(k) ?? null, removeItem: (k: string) => void map.delete(k), key: (i: number) => [...map.keys()][i] ?? null, get length() { return map.size; } },
  };
}

async function laptop(opts: { users?: string[]; edit?: boolean } = {}) {
  const idb = new IDBFactory();
  const server = createFakeSyncServer({ userId: "u1" });
  server.upsert({ kind: "rfis", projectId: "p1", id: "r1", data: { subject: "x" } });
  await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  for (const other of opts.users ?? []) {
    const db = await openLocalDb(idb, localDbNameFor(other));
    await db.setMeta("workspace", { userId: other });
    db.close();
  }
  let n = 0;
  const outbox = createOutbox({ userId: "u1", client: server.client, deviceId: "d", idb, autoFlush: false, locks: null, sleep: async () => {}, newOpId: () => `op-${++n}` });
  if (opts.edit) {
    await outbox.enqueue({
      functionId: "create_rfi", projectId: "p1", params: { projectId: "p1", subject: "Made offline", question: "Q?" }, label: "New RFI",
      creates: { kind: "rfis", id: "local-1" },
      optimistic: async (tx) => { await tx.putRecord({ id: "rfis:local-1", type: "rfis", orgId: "orgA", projectId: "p1", data: { id: "local-1", subject: "Made offline" } }); },
    });
  }
  return { idb, server, outbox };
}

const opts = (l: Awaited<ReturnType<typeof laptop>>, extra: Record<string, unknown> = {}) =>
  ({ userId: "u1", idb: l.idb, outbox: l.outbox, clearBoqCopy: async () => {}, noticeDedupeMs: 0, storage: null, localFirstOn: () => true, ...extra });

const HINTS = { "px-local-first": "1", "px-local-first-boq:b1": "{}", "px-local-first-boq:b2": "{}", "px-workspace-ready-v1:u1": "1", "px-workspace-ready-v1:other": "1", unrelated: "keep" };

describe("the DEFAULT sign-out keeps this laptop's copy", () => {
  test("nothing pending: the database STAYS, the ready key stays (no re-download next time), the BOQ hints go, nothing to say", async () => {
    const l = await laptop();
    const { map, storage } = memoryStorage(HINTS);
    let boqCleared = 0;
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { storage, clearBoqCopy: async () => { boqCleared += 1; } }));
    expect(result).toEqual({ pending: 0, wiped: false, notice: null, kept: true });
    expect(await names(l.idb)).toEqual(["projexa-local:u1"]);
    expect(boqCleared).toBe(0);
    expect([...map.keys()].sort()).toEqual(["px-local-first", "px-workspace-ready-v1:other", "px-workspace-ready-v1:u1", "unrelated"]);
  });

  test("a kept copy really is reused: signing in again syncs without pulling the rows again", async () => {
    const l = await laptop();
    await finishLocalWorkspaceOnSignOut(opts(l));
    const before = l.server.requests.length;
    const report = await createReplica({ userId: "u1", client: l.server.client, idb: l.idb, yieldFn: async () => {} }).sync();
    expect(report.status).toBe("done");
    const again = l.server.requests.slice(before);
    expect(again.filter((r) => r.path === "/pull" && !Array.isArray(r.body?.ids))).toEqual([]); // no keyset re-download
  });

  test("the outbox is still FLUSHED while the session lives: an offline edit reaches the server", async () => {
    const l = await laptop({ edit: true });
    const result = await finishLocalWorkspaceOnSignOut(opts(l));
    expect(result).toMatchObject({ pending: 0, wiped: false, notice: null, kept: true });
    expect(l.server.getRow("rfis", "srv-rfi-1")).toMatchObject({ data: { subject: "Made offline" } });
  });

  test("edits still pending: kept, and told in words that they are safe", async () => {
    const l = await laptop({ edit: true });
    l.server.failNext({ status: 503, path: "/push", times: 5 });
    const result = await finishLocalWorkspaceOnSignOut(opts(l));
    expect(result).toMatchObject({ pending: 1, wiped: false, kept: true });
    expect(result.notice).toBe(pendingKeptNotice(1));
    const db = await openLocalDb(l.idb, localDbNameFor("u1"));
    expect((await db.listOps()).map((o) => o.opId)).toEqual(["op-1"]);
    db.close();
  });

  test("an UNKNOWN person (no session, no remembered user): nothing is looked at, deleted or flushed -- other people's copies included", async () => {
    const l = await laptop({ users: ["u2"] });
    let flushes = 0;
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { userId: null, outbox: { flush: async () => { flushes += 1; return undefined as never; } } }));
    expect(result).toEqual({ pending: 0, wiped: false, notice: null });
    expect(flushes).toBe(0);
    expect(await names(l.idb)).toEqual(["projexa-local:u1", "projexa-local:u2"]);
  });
});

describe("flag OFF (cost:FLAG-16)", () => {
  test("no delete asked: inert -- no flush, no listing, nothing deleted; only the BOQ hints go", async () => {
    const l = await laptop({ edit: true });
    let flushes = 0;
    let listed = 0;
    const realDatabases = l.idb.databases.bind(l.idb);
    (l.idb as { databases: () => Promise<IDBDatabaseInfo[]> }).databases = async () => { listed += 1; return realDatabases(); };
    const { map, storage } = memoryStorage(HINTS);
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { localFirstOn: () => false, storage, outbox: { flush: async () => { flushes += 1; return undefined as never; } } }));
    expect(result).toEqual({ pending: 0, wiped: false, notice: null });
    expect(flushes).toBe(0);
    expect(listed).toBe(0);
    expect([...map.keys()].filter((k) => k.startsWith("px-local-first-boq:"))).toEqual([]);
    expect(await realDatabases().then((d) => d.map((x) => x.name).filter((n) => n?.startsWith("projexa-local:")))).toEqual(["projexa-local:u1"]);
  });

  test("the explicit delete still works with the flag off (an older copy can always be removed)", async () => {
    const l = await laptop();
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { localFirstOn: () => false, deleteLocalCopy: true }));
    expect(result.wiped).toBe(true);
    expect(await names(l.idb)).toEqual([]);
  });
});

describe("the explicit choice: Sign out and delete this laptop's copy", () => {
  test("nothing pending: the database, the BOQ device copy, the BOQ hints and THIS person's ready key go; nobody else's", async () => {
    const l = await laptop({ users: ["u2"] });
    const { map, storage } = memoryStorage(HINTS);
    let boqCleared = 0;
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { deleteLocalCopy: true, storage, clearBoqCopy: async () => { boqCleared += 1; } }));
    expect(result).toEqual({ pending: 0, wiped: true, notice: null });
    expect(await names(l.idb)).toEqual(["projexa-local:u2"]);
    expect(boqCleared).toBe(1);
    expect([...map.keys()].sort()).toEqual(["px-local-first", "px-workspace-ready-v1:other", "unrelated"]);
  });

  test("an offline edit is flushed first and reaches the server; only then is the copy deleted", async () => {
    const l = await laptop({ edit: true });
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { deleteLocalCopy: true }));
    expect(result).toEqual({ pending: 0, wiped: true, notice: null });
    expect(l.server.getRow("rfis", "srv-rfi-1")).toMatchObject({ data: { subject: "Made offline" } });
    expect(await names(l.idb)).toEqual([]);
  });

  test("edits still pending: the copy is KEPT anyway and the person is told", async () => {
    const l = await laptop({ edit: true });
    l.server.failNext({ status: 503, path: "/push", times: 5 });
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { deleteLocalCopy: true }));
    expect(result).toMatchObject({ pending: 1, wiped: false, kept: true });
    expect(result.notice).toBe(pendingNotice(1));
    expect(await names(l.idb)).toEqual(["projexa-local:u1"]);
  });

  test("a conflict that waits for the person's decision counts as pending too", async () => {
    const l = await laptop();
    l.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old" } });
    await createReplica({ userId: "u1", client: l.server.client, idb: l.idb, yieldFn: async () => {} }).sync();
    await l.outbox.enqueue({
      functionId: "update_task", projectId: "p1", params: { issueId: "t1", title: "Mine" }, record: { kind: "tasks", id: "t1", baseVersion: 1 },
      optimistic: async (tx) => { await tx.patchRecord("tasks", "t1", { data: { id: "t1", title: "Mine" } }); },
    });
    l.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs" } });
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { deleteLocalCopy: true }));
    expect(result).toMatchObject({ wiped: false, pending: 1 });
    expect(await names(l.idb)).toEqual(["projexa-local:u1"]);
  });

  test("TEST-14: a delete BLOCKED by another tab that never closes the database is SAID, and nothing claims it was wiped", async () => {
    const l = await laptop();
    // another tab: a raw connection with no versionchange handler, so it never lets go
    const holder = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = l.idb.open(localDbNameFor("u1"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const { map, storage } = memoryStorage(HINTS);
    const t0 = Date.now();
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { deleteLocalCopy: true, deleteTimeoutMs: 60, storage }));
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(result).toMatchObject({ wiped: false, kept: true, deleteFailed: true, notice: DELETE_FAILED_NOTICE });
    expect(map.has("px-workspace-ready-v1:u1")).toBe(true); // the copy is still there, so it is still "ready"
    holder.close();
  });

  test("TEST-14: an edit joined to a flush pass that was already ending is sent by the SECOND flush, so the copy can go", async () => {
    const l = await laptop({ edit: true });
    let calls = 0;
    // the first pass ends without the op (it joined too late); the second pass really sends it
    const outbox = { flush: async () => { calls += 1; return calls === 1 ? (undefined as never) : l.outbox.flush(); } };
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { deleteLocalCopy: true, outbox }));
    expect(calls).toBe(2);
    expect(result).toEqual({ pending: 0, wiped: true, notice: null });
    expect(l.server.getRow("rfis", "srv-rfi-1")).toMatchObject({ data: { subject: "Made offline" } });
  });

  test("an unknown person: nothing is deleted, and the person is told why", async () => {
    const l = await laptop({ users: ["u2"] });
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { userId: null, deleteLocalCopy: true }));
    expect(result).toMatchObject({ wiped: false, notice: DELETE_UNKNOWN_PERSON_NOTICE });
    expect(await names(l.idb)).toEqual(["projexa-local:u1", "projexa-local:u2"]);
  });

  test("no copy at all on this laptop: the ready key goes (nothing to be ready with), nothing to say", async () => {
    const idb = new IDBFactory();
    const { map, storage } = memoryStorage(HINTS);
    const result = await finishLocalWorkspaceOnSignOut({ userId: "u1", idb, deleteLocalCopy: true, storage, noticeDedupeMs: 0, clearBoqCopy: async () => {} });
    expect(result).toEqual({ pending: 0, wiped: false, notice: null });
    expect(map.has("px-workspace-ready-v1:u1")).toBe(false);
  });
});

describe("words, timing, and never failing", () => {
  test("the plurals read naturally", () => {
    expect(pendingNotice(3)).toBe("3 changes you made on this laptop have not reached the server yet, so this laptop kept your workspace. Nothing is lost: sign in again to finish syncing them.");
    expect(pendingKeptNotice(3)).toBe("3 changes you made on this laptop have not reached the server yet. They are kept safely on this laptop: sign in again to finish syncing them.");
  });

  test("a flush that never returns does not hold the sign-out hostage: after the timeout the edit counts as pending", async () => {
    const l = await laptop({ edit: true });
    const t0 = Date.now();
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { deleteLocalCopy: true, outbox: { flush: () => new Promise(() => {}) }, flushTimeoutMs: 40 }));
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(result).toMatchObject({ wiped: false, pending: 1 });
    expect(await names(l.idb)).toEqual(["projexa-local:u1"]);
  });

  test("the same notice is not given twice in a row (this tab's sign-out is followed by a SIGNED_OUT event)", async () => {
    forgetLastSignOutNotice();
    const l = await laptop({ edit: true });
    l.server.failNext({ status: 503, path: "/push", times: 5 });
    const first = await finishLocalWorkspaceOnSignOut(opts(l, { noticeDedupeMs: 60_000 }));
    expect(first.notice).not.toBeNull();
    const second = await finishLocalWorkspaceOnSignOut(opts(l, { noticeDedupeMs: 60_000 }));
    expect(second.pending).toBe(1);
    expect(second.notice).toBeNull();
  });

  test("no IndexedDB at all (or nothing stored): a no-op", async () => {
    expect(await finishLocalWorkspaceOnSignOut({ userId: "u1", idb: undefined, clearBoqCopy: async () => {}, localFirstOn: () => true, storage: null })).toEqual({ pending: 0, wiped: false, notice: null });
    const empty = new IDBFactory();
    expect(await finishLocalWorkspaceOnSignOut({ userId: "u1", idb: empty, clearBoqCopy: async () => {}, storage: null, localFirstOn: () => true })).toMatchObject({ pending: 0, notice: null });
    expect(await names(empty)).toEqual([]); // looking did not create it
  });

  test("a throwing flush or BOQ clear is swallowed", async () => {
    const l = await laptop({ edit: true });
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { deleteLocalCopy: true, outbox: { flush: async () => { throw new Error("boom"); } }, clearBoqCopy: async () => { throw new Error("boom"); } }));
    expect(result).toMatchObject({ wiped: false, pending: 1 });
  });
});
