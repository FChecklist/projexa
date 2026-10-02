import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "./__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "./local-db";
import { createOutbox } from "./outbox";
import { createReplica } from "./replica";
import { finishLocalWorkspaceOnSignOut, forgetLastSignOutNotice, pendingNotice } from "./sign-out";

// (viii) Sign-out: flush the outbox; with nothing pending delete the person's laptop database (and the BOQ device
// copy, and the hints local-first leaves in localStorage); with edits still pending KEEP the database and say so.

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

const opts = (l: Awaited<ReturnType<typeof laptop>>, extra: Record<string, unknown> = {}) => ({ userId: "u1", idb: l.idb, outbox: l.outbox, clearBoqCopy: async () => {}, noticeDedupeMs: 0, storage: null, ...extra });

describe("sign-out with NOTHING pending", () => {
  test("deletes the person's database, empties the BOQ device copy, removes the localStorage hints, and has nothing to say", async () => {
    const l = await laptop();
    expect(await names(l.idb)).toEqual(["projexa-local:u1"]);
    const { map, storage } = memoryStorage({
      "px-local-first": "1", "px-local-first-boq:b1": "{}", "px-local-first-boq:b2": "{}", "px-workspace-ready-v1:u1": "1", "px-workspace-ready-v1:other": "1", "unrelated": "keep",
    });
    let boqCleared = 0;
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { storage, clearBoqCopy: async () => { boqCleared += 1; } }));
    expect(result).toEqual({ pending: 0, wiped: true, notice: null });
    expect(await names(l.idb)).toEqual([]);
    expect(boqCleared).toBe(1);
    expect([...map.keys()].sort()).toEqual(["px-local-first", "px-workspace-ready-v1:other", "unrelated"]); // theirs gone, nobody else's touched
  });

  test("does not flush when there is nothing to send, and leaves other people's databases alone", async () => {
    const l = await laptop({ users: ["u2"] });
    let flushes = 0;
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { outbox: { flush: async () => { flushes += 1; return undefined as never; } } }));
    expect(result.wiped).toBe(true);
    expect(flushes).toBe(0);
    expect(await names(l.idb)).toEqual(["projexa-local:u2"]);
  });

  test("the outbox is FLUSHED first: an edit made offline reaches the server, and only then is the database deleted", async () => {
    const l = await laptop({ edit: true });
    const result = await finishLocalWorkspaceOnSignOut(opts(l));
    expect(result).toEqual({ pending: 0, wiped: true, notice: null });
    expect(l.server.requests.filter((r) => r.path === "/push")).toHaveLength(1);
    expect(l.server.getRow("rfis", "srv-rfi-1")).toMatchObject({ data: { subject: "Made offline" } }); // the person's work is on the server
    expect(await names(l.idb)).toEqual([]);
  });
});

describe("sign-out with edits STILL pending", () => {
  test("the database is KEPT, and the person is told in plain words (nothing lost, sign in to finish)", async () => {
    const l = await laptop({ edit: true });
    l.server.failNext({ status: 503, path: "/push", times: 5 }); // the service is not answering
    let boqCleared = 0;
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { clearBoqCopy: async () => { boqCleared += 1; } }));
    expect(result.wiped).toBe(false);
    expect(result.pending).toBe(1);
    expect(result.notice).toBe("1 change you made on this laptop has not reached the server yet, so this laptop kept your workspace. Nothing is lost: sign in again to finish syncing it.");
    expect(await names(l.idb)).toEqual(["projexa-local:u1"]);
    expect(boqCleared).toBe(0); // nothing was wiped, so no wipe-side effects
    // ...and the op is still there to be sent on the next sign-in
    const db = await openLocalDb(l.idb, localDbNameFor("u1"));
    expect((await db.listOps()).map((o) => o.opId)).toEqual(["op-1"]);
    expect((await db.getRecord("rfis", "local-1"))!.dirty).toBe("op-1");
    db.close();
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
    const result = await finishLocalWorkspaceOnSignOut(opts(l));
    expect(result).toMatchObject({ wiped: false, pending: 1 });
    expect(await names(l.idb)).toEqual(["projexa-local:u1"]);
  });

  test("the plural reads naturally", () => {
    expect(pendingNotice(3)).toBe("3 changes you made on this laptop have not reached the server yet, so this laptop kept your workspace. Nothing is lost: sign in again to finish syncing them.");
  });

  test("a flush that never returns does not hold the sign-out hostage: after the timeout the edit counts as pending", async () => {
    const l = await laptop({ edit: true });
    const t0 = Date.now();
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { outbox: { flush: () => new Promise(() => {}) }, flushTimeoutMs: 40 }));
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
});

describe("sign-out when the person is not known (another tab signed out, so the event carries no session)", () => {
  test("every local database with nothing pending is deleted; one with pending edits is kept; the notice counts only what was kept", async () => {
    const l = await laptop({ users: ["u2", "u3"], edit: true });
    // u3 has a pending edit of its own
    const db3 = await openLocalDb(l.idb, localDbNameFor("u3"));
    await db3.putOp({ opId: "u3-op", functionId: "create_rfi", projectId: "p1", params: {}, clientAt: "t", status: "pending", attempts: 0, nextAttemptAt: 0 });
    db3.close();
    l.server.failNext({ status: 503, path: "/push", times: 5 });
    const result = await finishLocalWorkspaceOnSignOut({ userId: null, idb: l.idb, clearBoqCopy: async () => {}, noticeDedupeMs: 0, storage: null });
    // u1 also has its op pending; u2 had nothing
    expect(await names(l.idb)).toEqual(["projexa-local:u1", "projexa-local:u3"]);
    expect(result).toMatchObject({ wiped: true, pending: 2 });
    expect(result.notice).toContain("2 changes");
  });
});

describe("sign-out never fails", () => {
  test("no IndexedDB at all (or nothing stored): a no-op", async () => {
    expect(await finishLocalWorkspaceOnSignOut({ userId: "u1", idb: undefined, clearBoqCopy: async () => {} })).toEqual({ pending: 0, wiped: false, notice: null });
    const empty = new IDBFactory();
    expect(await finishLocalWorkspaceOnSignOut({ userId: "u1", idb: empty, clearBoqCopy: async () => {}, storage: null })).toMatchObject({ pending: 0, notice: null });
  });

  test("a throwing flush or BOQ clear is swallowed", async () => {
    const l = await laptop({ edit: true });
    const result = await finishLocalWorkspaceOnSignOut(opts(l, { outbox: { flush: async () => { throw new Error("boom"); } }, clearBoqCopy: async () => { throw new Error("boom"); } }));
    expect(result).toMatchObject({ wiped: false, pending: 1 }); // the edit is still pending, so kept
  });
});
