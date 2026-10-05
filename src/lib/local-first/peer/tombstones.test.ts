import { describe, expect, test } from "bun:test";
import { createReplica } from "../replica";
import { PEER_SUSPECT_KEY, TOMBSTONE_TTL_MS, peerTouchedKey, type PeerSuspect } from "../local-db";
import { createTestSigner, type TestSigner } from "./__fixtures__/test-signer";
import { connect, makeLaptop, type Laptop } from "./__fixtures__/laptop";
import { createStubService, type StubService } from "./__fixtures__/stub-service";

// AUDIT-100 B8 (deletes): a record the SERVER deleted must stay deleted on a laptop, even when another laptop that still holds the old,
// validly signed version offers it over the peer link. Two simulated laptops (separate fake-IndexedDB databases), the REAL replica
// (replica.ts) against a stub sync service, the REAL peer protocol over the in-memory link. Each test re-reads the laptops' own databases.
//
// Before the fix (seen failing): a server delete left no trace (local-db.ts deleteRecords), the peer protocol refused an older row only when a
// local row existed, and a laptop whose change cursor was past the delete never asked /ids -- so (1) B got the meeting back from A, (2) A
// never learned the meeting was gone, (3) a row a peer handed back after B's tombstone expired stayed on B for good.

const NOW = Date.now();
const T1 = "2026-10-01T10:00:00Z";
const ORG = "org-1";
const VIEW = "view-pm";

const meeting = (signer: TestSigner, id: string, version: number) =>
  signer.row(ORG, { project: "p1", kind: "meetings", id, version, updated_at: T1, data: { title: `Meeting ${id}` } });

async function world() {
  const signer = await createTestSigner();
  const service = createStubService({ org: ORG, projects: ["p1"], kinds: ["meetings"] });
  const A = await makeLaptop(signer, { org: ORG, view: VIEW, userId: "ua", projects: ["p1"], nowMs: NOW });
  const B = await makeLaptop(signer, { org: ORG, view: VIEW, userId: "ub", projects: ["p1"], nowMs: NOW });
  const replicaOf = (l: Laptop, s: StubService, now?: () => number) =>
    createReplica({ userId: l.userId, client: s.client(l.userId), idb: l.idb, yieldFn: async () => {}, pacer: null, ...(now ? { now } : {}) });
  return { signer, service, A, B, replicaOf };
}

/** A and B both hold meeting m1 at version 1 (B through a real server sync); then the server deletes it and B syncs (a D in its feed). */
async function deletedOnServerAndOnB() {
  const w = await world();
  const m1 = await meeting(w.signer, "m1", 1);
  w.service.put(m1);
  await w.A.seed(m1); // A copied it earlier and has not synced since
  expect((await w.replicaOf(w.B, w.service).sync()).status).toBe("done");
  expect((await w.B.get("meetings", "m1"))?.serverVersion).toBe(1);

  w.service.remove("p1", "meetings", "m1", 2);
  const second = await w.replicaOf(w.B, w.service).sync();
  expect(second.issues).toEqual([]);
  expect(second.status).toBe("done");
  expect(await w.B.get("meetings", "m1")).toBeUndefined(); // the server's delete reached B (this part worked before the fix too)
  return { ...w, m1 };
}

describe("AUDIT-100 B8: a server delete is not undone by a stale peer", () => {
  test("B keeps a tombstone of the server's delete, and A's old signed copy is never stored on B again", async () => {
    const { A, B } = await deletedOnServerAndOnB();
    const s = await connect(A, B, { nowMs: NOW });
    expect(s.a.state).toBe("verified");
    // re-read B's own database: the deleted meeting did NOT come back
    expect(await B.get("meetings", "m1")).toBeUndefined();
    expect(await B.db.listByOrg(ORG, "meetings")).toEqual([]);
    // ... because B kept a tombstone of the server's delete, at the D's version
    const tomb = (await B.db.getTombstones(["meetings:m1"])).get("meetings:m1");
    expect(tomb).toMatchObject({ type: "meetings", orgId: ORG, projectId: "p1", version: 2, source: "server" });
    expect(await B.db.countTombstones()).toBe(1);
  });

  test("even a peer that ignores the receiver's tombstone in `known` and sends the row anyway is refused (reason `deleted`)", async () => {
    const { A, B } = await deletedOnServerAndOnB();
    // strip every entry from B's `want` so A sends the stale row regardless
    const s = await connect(A, B, { nowMs: NOW, tapBtoA: (t) => { const m = JSON.parse(t); if (m.t === "want") m.known = []; return JSON.stringify(m); } });
    expect(await B.get("meetings", "m1")).toBeUndefined();
    expect(s.b.stats.rejected.deleted).toBe(1);
    expect(s.b.stats.accepted).toBe(0);
  });

  test("A learns of the delete as a HINT (never a delete on a peer's word), stops sharing the row, and drops it once the SERVER confirms", async () => {
    const { signer, service, A, B, replicaOf } = await deletedOnServerAndOnB();
    await connect(A, B, { nowMs: NOW });
    // A still holds the row (an unsigned hint deletes nothing) but has it on its list to check with the server
    expect((await A.get("meetings", "m1"))?.serverVersion).toBe(1);
    const hints = (await A.db.getMeta<PeerSuspect[]>(PEER_SUSPECT_KEY)) ?? [];
    expect(hints.map((h) => `${h.project}|${h.kind}|${h.id}`)).toEqual(["p1|meetings|m1"]);

    // meanwhile A does not hand the row to a third laptop
    const C = await makeLaptop(signer, { org: ORG, view: VIEW, userId: "uc", projects: ["p1"], nowMs: NOW });
    await connect(A, C, { nowMs: NOW });
    expect(await C.get("meetings", "m1")).toBeUndefined();

    // A's next sync asks the server about the hinted row (one /pull by ids) and, since the server no longer serves it, removes it with a tombstone.
    // (The feed has moved on by then, so A's own change-feed re-read does not reach the D: only the hint can tell A.)
    service.advance("p1", 300);
    expect((await replicaOf(A, service).sync()).status).toBe("done");
    expect(service.calls).toContain("/pull-ids p1 meetings");
    expect(await A.get("meetings", "m1")).toBeUndefined();
    expect((await A.db.getTombstones(["meetings:m1"])).get("meetings:m1")?.version).toBe(1);
    expect((await A.db.getMeta<PeerSuspect[]>(PEER_SUSPECT_KEY)) ?? []).toEqual([]);
  });

  test("a hint about a row the server still serves changes nothing but the hint (a lying peer cannot delete anything)", async () => {
    const w = await world();
    const m2 = await meeting(w.signer, "m2", 3);
    w.service.put(m2);
    await w.A.seed(m2);
    // B forges a `gone` for m2 although the server never deleted it
    const s = await connect(w.A, w.B, { nowMs: NOW, tapBtoA: (t) => (JSON.parse(t).t === "want" ? JSON.stringify({ t: "gone", project: "p1", kind: "meetings", ids: [["m2", 3]] }) : t) });
    expect(s.a.state).toBe("verified");
    expect((await w.A.get("meetings", "m2"))?.serverVersion).toBe(3);
    expect((await w.replicaOf(w.A, w.service).sync()).status).toBe("done");
    expect((await w.A.get("meetings", "m2"))?.serverVersion).toBe(3); // still there: the server served it
    expect((await w.A.db.getTombstones(["meetings:m2"])).size).toBe(0);
    expect((await w.A.db.getMeta<PeerSuspect[]>(PEER_SUSPECT_KEY)) ?? []).toEqual([]);
  });

  test("a row a peer handed back after B's tombstone expired is dropped by B's next id reconcile, although B's change cursor is past the delete", async () => {
    const { A, B, service, replicaOf } = await deletedOnServerAndOnB();
    service.advance("p1", 300); // the feed moved on: the D is out of the 200-position window a run re-reads
    expect((await replicaOf(B, service).sync()).status).toBe("done");
    // 31 days later: B's tombstone has expired (bounded storage) and A, still stale, peers with B again
    const pruned = await B.db.pruneTombstones?.(NOW + TOMBSTONE_TTL_MS + 24 * 60 * 60 * 1000);
    await connect(A, B, { nowMs: NOW });
    expect((await B.get("meetings", "m1"))?.serverVersion).toBe(1); // A's signed v1 was accepted again (the tombstone had expired)

    // B's next ONE-PROJECT run (what the scheduler does; it is 31 days later in this story) asks /ids for that pair and drops the row the
    // server no longer lists
    const before = service.calls.length;
    const report = await replicaOf(B, service, () => NOW + TOMBSTONE_TTL_MS + 24 * 60 * 60 * 1000).syncProject("p1");
    expect(report.status).toBe("done");
    expect(service.calls.slice(before)).toContain("/ids p1 meetings");
    expect(await B.get("meetings", "m1")).toBeUndefined();
    expect((await B.db.getTombstones(["meetings:m1"])).get("meetings:m1")?.version).toBe(1);
    expect(await B.db.getMeta(peerTouchedKey("p1", "meetings"))).toBeNull(); // the pair's peer rows are checked now
    expect(pruned).toBe(1); // the tombstone that expired was really dropped (bounded storage)
  });
});
