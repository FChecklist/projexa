// Live finding 2026-10-13: a copy refused for ever after the person's organisation changed. The replica still refuses (never mixes two organisations);
// the caller now rebuilds the copy from the new organisation when a WHOLE run is refused for that reason.
import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "./local-db";
import { MANIFEST_KEY, createReplica } from "./replica";
import { isOrgChangeRefusal, syncRecoveringFromOrgChange } from "./org-change";
import { createFakeSyncServer } from "./__fixtures__/fake-sync-server";

const noYield = async () => {};
type Rfi = Parameters<ReturnType<typeof createFakeSyncServer>["upsert"]>[0];
const rfi = (id: string): Rfi => ({ kind: "rfis", projectId: "p1", id, data: { subject: id } });

async function setup() {
  const idb = new IDBFactory();
  const a = createFakeSyncServer({ orgId: "orgA" });
  a.upsert(rfi("old-1"));
  await createReplica({ userId: "u1", client: a.client, idb, yieldFn: noYield }).sync();
  const b = createFakeSyncServer({ orgId: "orgB" });
  b.upsert(rfi("new-1"));
  const openDb = () => openLocalDb(idb, localDbNameFor("u1"));
  const syncB = () => createReplica({ userId: "u1", client: b.client, idb, yieldFn: noYield }).sync();
  return { idb, openDb, syncB };
}

describe("a person whose organisation changed under the same sign-in", () => {
  test("the plain replica still refuses (nothing mixed), and the report says why", async () => {
    const { syncB } = await setup();
    const report = await syncB();
    expect(report.status).toBe("error");
    expect(isOrgChangeRefusal(report)).toBe(true);
  });

  test("the recovering sync drops the OLD organisation's copy and rebuilds from the new one", async () => {
    const { syncB, openDb } = await setup();
    const report = await syncRecoveringFromOrgChange(syncB, openDb);
    expect(report.status).toBe("done");
    const db = await openDb();
    expect(await db.getRecord("rfis", "old-1")).toBeUndefined();
    expect((await db.getRecord("rfis", "new-1"))?.orgId).toBe("orgB");
    expect((await db.getMeta<{ orgId: string }>(MANIFEST_KEY))?.orgId).toBe("orgB");
    db.close();
  });

  test("a copy of the SAME organisation is never touched", async () => {
    const idb = new IDBFactory();
    const a = createFakeSyncServer({ orgId: "orgA" });
    a.upsert(rfi("keep"));
    const openDb = () => openLocalDb(idb, localDbNameFor("u1"));
    const syncA = () => createReplica({ userId: "u1", client: a.client, idb, yieldFn: noYield }).sync();
    await syncA();
    const report = await syncRecoveringFromOrgChange(syncA, openDb);
    expect(report.status).toBe("done");
    const db = await openDb();
    expect(await db.getRecord("rfis", "keep")).toBeDefined();
    db.close();
  });

  test("a refusal for another reason is returned as it is, nothing dropped", () => {
    expect(isOrgChangeRefusal({ status: "error", itemsStored: 0, issues: [{ reason: "user_mismatch", message: "x" }] })).toBe(false);
    expect(isOrgChangeRefusal({ status: "partial", itemsStored: 3, issues: [{ reason: "org_mismatch", message: "different organisation" }] })).toBe(false);
  });
});
