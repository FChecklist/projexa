// lf-e7: loadOrgLocal reads the organisation kinds from the laptop only, with a calm state for every case. Seeded through the REAL
// replica from fake-org-client.ts (so "synced" means what the engine writes), with the network spied on: no read may call it.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeOrgServer, seedOrgWorld, type Role } from "./__fixtures__/fake-org-client";
import { localDbNameFor, openLocalDb } from "./local-db";
import { loadOrgLocal, orgStateWords } from "./org-local";
import { MANIFEST_KEY, createReplica } from "./replica";
import { ORG_PROJECT } from "./sync-client";

const U = "signin-1";
let fetchSpy: ReturnType<typeof spyOn>;
beforeEach(() => { fetchSpy = spyOn(globalThis, "fetch"); });
afterEach(() => { expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore(); });

async function synced(role: Role) {
  const idb = new IDBFactory();
  const server = createFakeOrgServer({ signInId: U, role });
  seedOrgWorld(server);
  const report = await createReplica({ userId: U, client: server.client, idb, yieldFn: async () => {} }).sync();
  expect(report.status).toBe("done");
  return { idb, server };
}

describe("loadOrgLocal", () => {
  test("a member's vendors are local: every row, as the server cut them (credit_limit hidden below the money rank)", async () => {
    const { idb } = await synced("member");
    const r = await loadOrgLocal("vendors", { userId: U, idb, sort: (a, b) => a.id.localeCompare(b.id) });
    expect(r.state).toBe("local");
    if (r.state !== "local") throw new Error("unreachable");
    expect(r.rows.map((v) => [v.id, v.supplier_name, v.credit_limit])).toEqual([["ven-1", "Ace Cement", null], ["ven-2", "Bright Paints", null]]);
    expect(typeof r.syncedAt).toBe("number");
  });

  test("a viewer: vendors are 'not_allowed' (the role does not include them), cost_visibility is local", async () => {
    const { idb } = await synced("viewer");
    expect(await loadOrgLocal("vendors", { userId: U, idb })).toEqual({ state: "not_allowed" });
    expect((await loadOrgLocal("cost_visibility", { userId: U, idb })).state).toBe("local");
    expect(orgStateWords("not_allowed", "suppliers")).toContain("Your role does not include");
  });

  test("never synced, or synced by an older build that knew no organisation kinds: 'not_synced'", async () => {
    const idb = new IDBFactory();
    expect(await loadOrgLocal("vendors", { userId: U, idb })).toEqual({ state: "not_synced" });
    const db = await openLocalDb(idb, localDbNameFor(U));
    await db.setMeta(MANIFEST_KEY, { userId: U, orgId: "org-a", projectIds: ["p1"], kinds: ["tasks"], at: 1 });
    db.close();
    expect(await loadOrgLocal("vendors", { userId: U, idb })).toEqual({ state: "not_synced" });
  });

  test("a kind the manifest lists but that was not pulled to the end is 'not_synced', never a partial list", async () => {
    const idb = new IDBFactory();
    const db = await openLocalDb(idb, localDbNameFor(U));
    await db.setMeta(MANIFEST_KEY, { userId: U, orgId: "org-a", projectIds: [], kinds: [], at: 1, orgKinds: ["vendors"] });
    await db.putRecord({ id: "vendors:ven-1", type: "vendors", orgId: "org-a", projectId: ORG_PROJECT, data: { id: "ven-1" } });
    db.close();
    expect(await loadOrgLocal("vendors", { userId: U, idb })).toEqual({ state: "not_synced" });
  });

  test("rows are untrusted input: a malformed row is left out, never cast", async () => {
    const { idb } = await synced("member");
    const db = await openLocalDb(idb, localDbNameFor(U));
    await db.putRecord({ id: "vendors:bad", type: "vendors", orgId: "org-a", projectId: ORG_PROJECT, data: ["not", "a", "row"] });
    await db.putRecord({ id: "vendors:bad2", type: "vendors", orgId: "org-a", projectId: ORG_PROJECT, data: { id: 7 } });
    db.close();
    const r = await loadOrgLocal("vendors", { userId: U, idb });
    if (r.state !== "local") throw new Error("expected local");
    expect(r.rows.map((v) => v.id).sort()).toEqual(["ven-1", "ven-2"]);
  });

  test("another person's database on this laptop gives that person nothing of this organisation", async () => {
    const { idb } = await synced("member");
    expect(await loadOrgLocal("vendors", { userId: "someone-else", idb })).toEqual({ state: "not_synced" });
  });

  test("rows of another organisation stored by mistake are never read (the manifest's organisation decides)", async () => {
    const { idb } = await synced("member");
    const db = await openLocalDb(idb, localDbNameFor(U));
    await db.putRecord({ id: "vendors:x-b", type: "vendors", orgId: "org-b", projectId: ORG_PROJECT, data: { id: "x-b", supplier_name: "Other org" } });
    db.close();
    const r = await loadOrgLocal("vendors", { userId: U, idb });
    if (r.state !== "local") throw new Error("expected local");
    expect(r.rows.map((v) => v.id)).not.toContain("x-b");
  });
});
