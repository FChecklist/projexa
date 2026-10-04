// lf-e7: ORGANISATION rows between laptops (handler README "Peers": only when org_view_class is equal; org_people never). Two simulated
// laptops over the in-memory transport, rows signed with project "__org__" exactly as the server signs them.
import { describe, expect, test } from "bun:test";
import { foreignOrg } from "../replica";
import { ORG_PROJECT } from "../sync-client";
import type { Laptop, Pair } from "./__fixtures__/laptop";
import { createOrgSigner } from "./__fixtures__/org-signer";
import { createLocalDbPeerStore } from "./localdb-store";
import { createMemoryLinkPair } from "./transport";
import { verifyToken } from "./verify";

// PLANTED-BUG FORM (PREAMBLE: isolation checks are never broken in place): LF_E7_PEER_MUTANT = absolute path of a modified copy of
// protocol.ts; this file then runs every exchange through that copy. connect() is laptop.ts's, taking the session factory.
const proto: typeof import("./protocol") = await import(process.env.LF_E7_PEER_MUTANT ?? "./protocol");
async function connect(x: Laptop, y: Laptop, extra: { nowMs: number; tapAtoB?: (t: string) => string | null }): Promise<Pair> {
  const [la, lb] = createMemoryLinkPair({ tapAtoB: extra.tapAtoB });
  const refusedA: string[] = [];
  const refusedB: string[] = [];
  const a = proto.createPeerSession({ link: la, self: x.self, keys: x.keys, store: createLocalDbPeerStore(x.db, x.org), now: () => extra.nowMs, foreignOrg, onRefused: (r) => refusedA.push(r) });
  const b = proto.createPeerSession({ link: lb, self: y.self, keys: y.keys, store: createLocalDbPeerStore(y.db, y.org), now: () => extra.nowMs, foreignOrg, onRefused: (r) => refusedB.push(r) });
  await Promise.race([Promise.all([a.ready, b.ready]), new Promise((r) => setTimeout(r, 3000))]);
  await new Promise((r) => setTimeout(r, 20));
  return { a, b, refusedA, refusedB };
}

const NOW = Date.parse("2026-10-02T10:00:00Z");
const T1 = "2026-10-01T10:00:00Z";

async function pair(aOrgView: string | undefined, bOrgView: string | undefined) {
  const signer = await createOrgSigner();
  const A = await signer.makeLaptop({ userId: "ua", org: "org-1", view: "v1", orgView: aOrgView, projects: ["p1"], nowMs: NOW });
  const B = await signer.makeLaptop({ userId: "ub", org: "org-1", view: "v1", orgView: bOrgView, projects: ["p1"], nowMs: NOW });
  await A.seed({ project: ORG_PROJECT, kind: "vendors", id: "ven-1", version: 3, updated_at: T1, data: { id: "ven-1", supplier_name: "Ace Cement" } });
  await A.seed({ project: ORG_PROJECT, kind: "org_people", id: "u-a", version: 1, updated_at: T1, data: { id: "u-a", name: "Asha", email: "asha@own.example" } });
  await A.seed({ project: "p1", kind: "rfis", id: "r1", version: 1, updated_at: T1, data: { subject: "Door" } });
  return { signer, A, B };
}

describe("organisation rows between laptops", () => {
  test("the token's org_view claim is read (and absent when the server does not send it)", async () => {
    const signer = await createOrgSigner();
    const A = await signer.makeLaptop({ userId: "ua", org: "org-1", view: "v1", orgView: "ov-2", projects: [], nowMs: NOW });
    expect(A.self.claims.orgView).toBe("ov-2");
    const B = await signer.makeLaptop({ userId: "ub", org: "org-1", view: "v1", projects: [], nowMs: NOW });
    expect("orgView" in B.self.claims).toBe(false);
    expect((await verifyToken(B.self.token, B.keys, NOW)).ok).toBe(true);
  });

  test("same org_view: a vendor row moves, verified, with its version; org_people NEVER moves; project rows move as before", async () => {
    const { A, B } = await pair("ov-2", "ov-2");
    const s = await connect(A, B, { nowMs: NOW });
    expect(s.a.sharedProjects.sort()).toEqual([ORG_PROJECT, "p1"].sort());
    expect((await B.get("vendors", "ven-1"))?.serverVersion).toBe(3);
    expect((await B.get("vendors", "ven-1"))?.projectId).toBe(ORG_PROJECT);
    expect(await B.get("org_people", "u-a")).toBeUndefined();
    expect((await B.get("rfis", "r1"))?.data).toEqual({ subject: "Door" });
  });

  test("different org_view (another role or cost setting): no organisation row moves, project rows still do", async () => {
    const { A, B } = await pair("ov-3-cost", "ov-1");
    const s = await connect(A, B, { nowMs: NOW });
    expect(s.a.sharedProjects).toEqual(["p1"]);
    expect(await B.get("vendors", "ven-1")).toBeUndefined();
    expect(await B.get("rfis", "r1")).toBeTruthy();
  });

  test("a token without org_view (today's /attest): no organisation row moves, on either side", async () => {
    for (const [a, b] of [["ov-2", undefined], [undefined, "ov-2"], [undefined, undefined]] as const) {
      const { A, B } = await pair(a, b);
      await connect(A, B, { nowMs: NOW });
      expect(await B.get("vendors", "ven-1")).toBeUndefined();
    }
  });

  test("a peer that pushes organisation rows anyway (no shared __org__) has them refused as not_shared", async () => {
    const { signer, A, B } = await pair("ov-2", "ov-9");
    const vendor = await signer.row("org-1", { project: ORG_PROJECT, kind: "vendors", id: "ven-x", version: 1, updated_at: T1, data: { id: "ven-x" } });
    const s = await connect(A, B, { nowMs: NOW, tapAtoB: (t) => (JSON.parse(t).t === "have" ? JSON.stringify({ t: "items", rows: [vendor] }) : t) });
    expect(await B.get("vendors", "ven-x")).toBeUndefined();
    expect(s.b.stats.rejected.not_shared).toBe(1);
  });

  test("an org_people row pushed anyway is refused even when __org__ is shared", async () => {
    const same = await pair("ov-2", "ov-2");
    const person = await same.signer.row("org-1", { project: ORG_PROJECT, kind: "org_people", id: "u-z", version: 1, updated_at: T1, data: { id: "u-z", email: "z@own.example" } });
    const s2 = await connect(same.A, same.B, { nowMs: NOW, tapAtoB: (t) => (JSON.parse(t).t === "have" ? JSON.stringify({ t: "items", rows: [person] }) : t) });
    expect(await same.B.get("org_people", "u-z")).toBeUndefined();
    expect(s2.b.stats.rejected.not_shared).toBe(1);
  });

  test("a project id literally named __org__ in a token is never treated as the organisation", async () => {
    const signer = await createOrgSigner();
    const A = await signer.makeLaptop({ userId: "ua", org: "org-1", view: "v1", projects: [ORG_PROJECT], nowMs: NOW });
    const B = await signer.makeLaptop({ userId: "ub", org: "org-1", view: "v1", projects: [ORG_PROJECT], nowMs: NOW });
    await A.seed({ project: ORG_PROJECT, kind: "vendors", id: "ven-1", version: 1, updated_at: T1, data: { id: "ven-1" } });
    const s = await connect(A, B, { nowMs: NOW });
    expect(s.a.sharedProjects).toEqual([]);
    expect(await B.get("vendors", "ven-1")).toBeUndefined();
  });
});
