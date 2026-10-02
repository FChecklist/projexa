/// <reference types="bun-types" />
// LOCAL-FIRST, flag OFF (package lf-fc, review cost:COST-02 / FLAG-16): every caller of the shared replica (WorkspacePrepare's
// first copy, boot.ts's re-download, the auto-sync server step, a screen's background revalidation) goes through gateByFlag. With
// the flag off it must send ZERO requests and create no database. Measured against the shared fake sync server with a REAL replica
// behind the gate, so a removed check shows up as real requests (the control case with the flag on proves they would be counted).
import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "./__fixtures__/fake-sync-server";
import { createReplica } from "./replica";
import { gateByFlag } from "./replica-shared";

function rig() {
  const server = createFakeSyncServer({ projects: ["p1", "p2"] });
  server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "A" } });
  const idb = new IDBFactory();
  const replica = createReplica({ userId: server.userId, client: server.client, idb, yieldFn: async () => {} });
  return { server, idb, replica };
}

const personDbs = async (idb: IDBFactory) => (await idb.databases()).map((d) => d.name).filter((n) => n?.startsWith("projexa-local:"));

describe("the shared replica behind the local-first flag", () => {
  test("flag OFF: sync, syncProject and reconcileDeletes send nothing and create no database", async () => {
    const { server, idb, replica } = rig();
    const gated = gateByFlag(replica, () => false);
    const r1 = await gated.sync();
    const r2 = await gated.syncProject("p1", "tasks");
    const r3 = await gated.reconcileDeletes("p1", "tasks", { force: true });
    expect(server.requests).toEqual([]);
    expect(await personDbs(idb)).toEqual([]);
    expect(r1.status).toBe("idle");
    expect(r2.status).toBe("idle");
    expect(r3).toEqual({ removed: 0, skipped: true });
  });

  test("flag ON (control): the same calls reach the server and fill the laptop's database", async () => {
    const { server, idb, replica } = rig();
    const gated = gateByFlag(replica, () => true);
    const r = await gated.sync();
    expect(r.status).toBe("done");
    expect(server.requests.length).toBeGreaterThan(0);
    expect(await personDbs(idb)).toEqual([`projexa-local:${server.userId}`]);
  });

  test("the flag is read at CALL time: turning it on later starts syncing without a new replica", async () => {
    const { server, replica } = rig();
    let on = false;
    const gated = gateByFlag(replica, () => on);
    await gated.sync();
    expect(server.requests).toEqual([]);
    on = true;
    await gated.sync();
    expect(server.requests.length).toBeGreaterThan(0);
  });
});
