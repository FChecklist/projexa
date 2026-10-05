import { afterEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "./__fixtures__/fake-sync-server";
import { createOutbox } from "./outbox";
import { createReplica } from "./replica";
import { SyncError, type SyncClient } from "./sync-client";
import { configureFaultReportForTests, isExpectedFault, reportFault } from "./sync-fault-report";

// AUDIT-100 B57: the background engines (outbox, replica, peer sync, AI tools) report a REAL fault to us and stay quiet about normal states.

type Seen = { kind: string; message: string; where: string };
const seen: Seen[] = [];
const collect = () => configureFaultReportForTests({ sink: (kind, err, where) => void seen.push({ kind, message: err instanceof Error ? err.message : String(err), where }) });

afterEach(() => {
  seen.length = 0;
  configureFaultReportForTests();
});

describe("reportFault", () => {
  test("a real fault is reported once per five minutes, not once per retry", () => {
    let t = 0;
    configureFaultReportForTests({ sink: (kind, err, where) => void seen.push({ kind, message: String(err), where }), now: () => t });
    for (let i = 0; i < 10; i++) reportFault("outbox:push", new SyncError("server", "HTTP 503", 503));
    expect(seen).toHaveLength(1);
    t += 5 * 60_000 + 1;
    reportFault("outbox:push", new SyncError("server", "HTTP 503", 503));
    expect(seen).toHaveLength(2);
  });
  test("signed out, update required and a cancelled request are normal states, not faults", () => {
    collect();
    for (const kind of ["signed_out", "update_required", "aborted"] as const) reportFault("replica:sync", new SyncError(kind, "x"));
    expect(seen).toHaveLength(0);
    expect(isExpectedFault(new SyncError("server", "x", 500))).toBe(false);
  });
  test("a timeout or network error while the browser is online IS reported (the slow-edge case); while offline it is not", () => {
    collect();
    reportFault("replica:sync", new SyncError("timeout", "slow", 0));
    expect(seen.map((s) => s.kind)).toEqual(["replica_sync_timeout"]);
    const nav = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
    try {
      reportFault("replica:sync", new SyncError("network", "offline", 0));
      expect(seen).toHaveLength(1);
    } finally {
      Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
    }
  });
  test("never throws, even when the sink does", () => {
    configureFaultReportForTests({ sink: () => { throw new Error("sink broke"); } });
    expect(() => reportFault("peer:sync", new Error("x"))).not.toThrow();
  });
});

describe("the engines call it from the catch blocks that used to swallow the error", () => {
  test("outbox: a 503 on push reaches the reporter (and the edit is kept for retry)", async () => {
    collect();
    const idb = new IDBFactory();
    const server = createFakeSyncServer();
    const failing: SyncClient = { ...server.client, push: async () => { throw new SyncError("server", "HTTP 503", 503); } };
    let n = 0;
    const outbox = createOutbox({ userId: "u1", client: failing, deviceId: "d", idb, now: () => 1_800_000_000_000, sleep: async () => {}, autoFlush: false, newOpId: () => `op-${++n}`, locks: null });
    await outbox.enqueue({ functionId: "update_task", projectId: "p1", params: { issueId: "t1", title: "x" }, label: "Task change" });
    await outbox.flush();
    expect(seen.map((s) => s.where)).toContain("outbox:push");
    expect(seen.find((s) => s.where === "outbox:push")?.message).toContain("503");
  });
  test("outbox: a signed-out answer is not reported", async () => {
    collect();
    const idb = new IDBFactory();
    const server = createFakeSyncServer();
    const out: SyncClient = { ...server.client, push: async () => { throw new SyncError("signed_out", "401", 401); } };
    let n = 0;
    const outbox = createOutbox({ userId: "u1", client: out, deviceId: "d", idb, now: () => 1_800_000_000_000, sleep: async () => {}, autoFlush: false, newOpId: () => `op-${++n}`, locks: null });
    await outbox.enqueue({ functionId: "update_task", projectId: "p1", params: { issueId: "t1", title: "x" }, label: "Task change" });
    await outbox.flush();
    expect(seen).toHaveLength(0);
  });
  test("replica: a failing manifest request reaches the reporter", async () => {
    collect();
    const server = createFakeSyncServer();
    const failing: SyncClient = { ...server.client, manifest: async () => { throw new SyncError("bad_response", "not the contract", 502); } };
    const result = await createReplica({ userId: "u1", client: failing, idb: new IDBFactory(), yieldFn: async () => {} }).sync();
    expect(result.status).toBe("error");
    expect(seen.map((s) => s.where)).toContain("replica:sync");
  });
});
