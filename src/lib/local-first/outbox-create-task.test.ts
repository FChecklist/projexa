import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "./__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "./local-db";
import { createOutbox } from "./outbox";
import { createReplica } from "./replica";

// An AI-created schedule task (a temporary row + `creates`, exactly what src/lib/local-first/ai/api.ts enqueues) must still be on the laptop
// after the push settles AND after the next syncs: found in the real-browser run, where it was missing from the Schedule screen.

describe("a created schedule task survives the push and the next syncs", () => {
  test("temp row -> server row, and it stays through two more replica syncs", async () => {
    const idb = new IDBFactory();
    const server = createFakeSyncServer();
    server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old" } });
    let n = 0;
    const outbox = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-1", idb, sleep: async () => {}, autoFlush: false, newOpId: () => `op-${++n}`, locks: null });
    const replica = createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} });
    await replica.sync();
    const params = { projectId: "p1", title: "Install site hoarding (AI)", startDate: "2026-10-06", dueDate: "2026-10-08", priority: "medium" };
    await outbox.enqueue({
      functionId: "create_schedule_task", projectId: "p1", params, label: "Create a task (by your AI)",
      creates: { kind: "tasks", id: "local-ai1" },
      optimistic: async (tx) => { await tx.putRecord({ id: "tasks:local-ai1", type: "tasks", orgId: "orgA", projectId: "p1", data: { ...params, id: "local-ai1" } }); },
    });
    const titles = async () => {
      const db = await openLocalDb(idb, localDbNameFor("u1"));
      try { return (await db.listByProject("orgA", "tasks", "p1")).map((r) => [r.id, r.data.title]); } finally { db.close(); }
    };
    expect((await titles()).map((t) => t[1])).toContain("Install site hoarding (AI)"); // shown at once
    await outbox.flush();
    const after = await titles();
    expect(after.filter((t) => t[1] === "Install site hoarding (AI)"), "after the push: the server's row, once").toHaveLength(1);
    await replica.sync();
    await replica.sync();
    expect((await titles()).filter((t) => t[1] === "Install site hoarding (AI)"), "after two syncs it is still there").toHaveLength(1);
  });
});
