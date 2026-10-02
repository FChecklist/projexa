import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "../__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "../local-db";
import { createReplica } from "../replica";
import type { SyncClient } from "../sync-client";
import { ORG_PROJECT } from "../sync-client";
import { createOrgSigner } from "./__fixtures__/org-signer";
import { createTestSigner } from "./__fixtures__/test-signer";
import { connect, makeLaptop, type Laptop } from "./__fixtures__/laptop";
import { createLocalDbPeerStore } from "./localdb-store";
import { canonicalize, itemMessageV3, sha256Hex, verifyRowV3, type SignedRow } from "./verify";

// lf-e9 (review D1 TI-2 / F-12): the px3 signature (`sig3`, compliance-tracker sign.ts itemMessageV3) commits to the VIEW CLASS a row was
// redacted for. A laptop stores it with the row, hands it on to peers, and a receiver verifies it with its OWN view class: a row the
// server cut for another class (e.g. money visible) cannot be passed to a laptop of a lower class by a peer of that lower class's own
// view, even though its px2 signature is genuine.

const NOW = Date.parse("2026-10-02T10:00:00Z");
const T1 = "2026-10-01T10:00:00Z";

async function sig3For(sign: (m: string) => Promise<string>, org: string, view: string, r: Omit<SignedRow, "sig" | "kid">) {
  const dataHash = await sha256Hex(canonicalize(r.data));
  return sign(itemMessageV3({ org, project: r.project, kind: r.kind, view, id: r.id, version: r.version, updatedAt: r.updated_at, dataHash }));
}

async function setup() {
  const signer = await createTestSigner("kpx3");
  const A = await makeLaptop(signer, { org: "o1", view: "v-site", nowMs: NOW, userId: "ua", projects: ["p1"] });
  const B = await makeLaptop(signer, { org: "o1", view: "v-site", nowMs: NOW, userId: "ub", projects: ["p1"] });
  return { signer, A, B };
}

/** Stores a row on `L` with a genuine px2 signature (signer) and the given sig3. */
async function seedWithSig3(L: Laptop, signer: Awaited<ReturnType<typeof createTestSigner>>, r: Omit<SignedRow, "sig" | "kid">, sig3: string) {
  const s = await signer.row(L.org, r);
  await L.db.putRecord({ id: `${r.kind}:${r.id}`, type: r.kind, orgId: L.org, projectId: r.project, data: r.data, serverVersion: r.version, serverUpdatedAt: r.updated_at, sig: s.sig, kid: s.kid, sig3 });
}

describe("px3: the view-class signature travels laptop to laptop and is checked with the receiver's own view class", () => {
  test("a row whose sig3 was made for OUR view class is accepted, and B stores the sig3 so it can hand it on", async () => {
    const { signer, A, B } = await setup();
    const r = { project: "p1", kind: "rfis", id: "r1", version: 2, updated_at: T1, data: { subject: "Door" } };
    await seedWithSig3(A, signer, r, await sig3For(signer.signRaw, "o1", "v-site", r));
    const s = await connect(A, B, { nowMs: NOW });
    expect(s.b.stats.rejected).toEqual({});
    const got = await B.get("rfis", "r1");
    expect(got?.data).toEqual({ subject: "Door" });
    expect(typeof got?.sig3).toBe("string");
    // what B would now hand on carries the sig3, and it verifies for B's class
    const onward = (await createLocalDbPeerStore(B.db, "o1").shareable("p1", "rfis"))[0];
    expect(onward.sig3).toBe(got!.sig3);
    expect(await verifyRowV3(onward, "o1", "v-site", B.keys)).toBe(true);
  });

  test("a row the server cut for ANOTHER view class (genuine px2 sig, sig3 over the other class) is refused as wrong_view and not stored", async () => {
    const { signer, A, B } = await setup();
    const r = { project: "p1", kind: "boq", id: "b1", version: 4, updated_at: T1, data: { rate: 1200, amount: 54000 } };
    await seedWithSig3(A, signer, r, await sig3For(signer.signRaw, "o1", "v-money", r));
    const s = await connect(A, B, { nowMs: NOW });
    expect(s.b.stats.rejected).toEqual({ wrong_view: 1 });
    expect(s.b.stats.accepted).toBe(0);
    expect(await B.get("boq", "b1")).toBeUndefined();
  });

  test("a sig3 that is not a string is malformed, never trusted", async () => {
    const { signer, A, B } = await setup();
    const r = { project: "p1", kind: "rfis", id: "r2", version: 1, updated_at: T1, data: { subject: "x" } };
    await seedWithSig3(A, signer, r, await sig3For(signer.signRaw, "o1", "v-site", r));
    const s = await connect(A, B, { nowMs: NOW, tapAtoB: (t) => t.replace(/"sig3":"[^"]*"/, '"sig3":42') });
    expect(s.b.stats.rejected).toEqual({ malformed: 1 });
    expect(await B.get("rfis", "r2")).toBeUndefined();
  });
});

describe("px3 on organisation rows: checked with the ORGANISATION view class (the class the server signs them with)", () => {
  test("a vendor row whose sig3 is over the shared org view class is accepted; one over another org class is refused", async () => {
    const signer = await createOrgSigner("korg-px3");
    const A = await signer.makeLaptop({ userId: "ua", org: "o1", view: "v-site", orgView: "ov-cost", projects: ["p1"], nowMs: NOW });
    const B = await signer.makeLaptop({ userId: "ub", org: "o1", view: "v-site", orgView: "ov-cost", projects: ["p1"], nowMs: NOW });
    const ok = { project: ORG_PROJECT, kind: "vendors", id: "ven-1", version: 3, updated_at: T1, data: { id: "ven-1", supplier_name: "Ace" } };
    const other = { project: ORG_PROJECT, kind: "vendors", id: "ven-2", version: 1, updated_at: T1, data: { id: "ven-2", credit_limit: 9 } };
    for (const [r, view] of [[ok, "ov-cost"], [other, "ov-admin"]] as const) {
      const s = await signer.row("o1", r);
      await A.db.putRecord({ id: `vendors:${r.id}`, type: "vendors", orgId: "o1", projectId: ORG_PROJECT, data: r.data, serverVersion: r.version, serverUpdatedAt: T1, sig: s.sig, kid: s.kid, sig3: await sig3For(signer.signRaw, "o1", view, r) });
    }
    const s = await connect(A, B, { nowMs: NOW });
    expect(s.b.stats.rejected).toEqual({ wrong_view: 1 });
    expect((await B.get("vendors", "ven-1"))?.serverVersion).toBe(3);
    expect(await B.get("vendors", "ven-2")).toBeUndefined();
  });
});

describe("px3: the replica stores the sig3 the service sends next to sig", () => {
  test("a pulled row keeps its sig3; a later pull without one clears it (never a stale signature on new data)", async () => {
    const idb = new IDBFactory();
    const server = createFakeSyncServer({});
    server.upsert({ kind: "rfis", projectId: "p1", id: "a", data: { subject: "v1" } });
    let withSig3 = true;
    const client: SyncClient = {
      ...server.client,
      pull: async (req, signal) => {
        const page = await server.client.pull(req, signal);
        return { ...page, items: page.items.map((it) => (withSig3 && it.sig ? { ...it, sig3: `px3-of-${it.id}` } : it)) };
      },
    };
    const replica = createReplica({ userId: "u1", client, idb, yieldFn: async () => {} });
    expect((await replica.sync()).status).toBe("done");
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((await db.getRecord("rfis", "a"))?.sig3).toBe("px3-of-a");
    db.close();

    withSig3 = false;
    server.upsert({ kind: "rfis", projectId: "p1", id: "a", data: { subject: "v2" } });
    expect((await replica.sync()).status).toBe("done");
    const db2 = await openLocalDb(idb, localDbNameFor("u1"));
    const row = await db2.getRecord("rfis", "a");
    expect(row?.data).toMatchObject({ subject: "v2" });
    expect(row?.sig3).toBeUndefined();
    db2.close();
  });
});
