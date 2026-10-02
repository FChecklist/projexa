import { describe, expect, test } from "bun:test";
import { foreignOrg, MANIFEST_KEY } from "../replica";
import { ORG_PROJECT } from "../sync-client";
import { createFakeNtfy, createFakeRealtime } from "./__fixtures__/fake-signalling";
import type { Laptop } from "./__fixtures__/laptop";
import { createMemoryRtc } from "./__fixtures__/memory-rtc";
import { createOrgSigner } from "./__fixtures__/org-signer";
import { createAutoSync } from "./auto-sync";
import { createLocalDbPeerStore } from "./localdb-store";
import { createPeerNetwork, type PeerNetwork, type PeerNetworkOptions } from "./network";
import { createSignalHub, ntfyProvider, supabaseRealtimeProvider } from "./signalling";

// lf-e9 (found by the real-browser peer e2e): the network layer (network.ts) used to swallow everything a session refused -- a peer of
// another organisation, an expired or forged token, a row whose signature fails -- so nothing above it (the UI, the tests, a person
// asking "why did my colleague's laptop not sync?") could see that a refusal happened. And the manifest's never-share organisation kinds
// (`peer_shareable: false`, stored as orgNoPeerKinds) were stored by the replica but never handed to the sessions, so only the hard-coded
// org_people was held back. Both are fixed; these tests fail without the fixes.

const NOW = Date.parse("2026-10-02T10:00:00Z");
const T1 = "2026-10-01T10:00:00Z";
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => Promise<boolean> | boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return; await wait(20); }
}

function net(L: Laptop, deps: { nt: ReturnType<typeof createFakeNtfy>; rt: ReturnType<typeof createFakeRealtime>; rtc: ReturnType<typeof createMemoryRtc> }, extra: Partial<PeerNetworkOptions> = {}): PeerNetwork {
  const hub = createSignalHub({ channel: "chan", selfId: L.userId, remote: [supabaseRealtimeProvider(deps.rt.client), ntfyProvider({ fetchImpl: deps.nt.fetchImpl, EventSourceImpl: deps.nt.EventSourceImpl })] });
  return createPeerNetwork({ selfId: L.userId, hub, getSelf: async () => L.self, keys: L.keys, store: createLocalDbPeerStore(L.db, L.org), openLink: deps.rtc.openLink, now: () => NOW, foreignOrg, ...extra });
}
const deps = () => ({ nt: createFakeNtfy(), rt: createFakeRealtime({ down: true }), rtc: createMemoryRtc() });

describe("network: refusals and rejections are visible", () => {
  test("a peer of another organisation is refused: onRefused names it and stats() counts wrong_org; nothing arrives", async () => {
    const signer = await createOrgSigner();
    const A = await signer.makeLaptop({ userId: "ua", org: "o1", view: "v1", projects: ["p1"], nowMs: NOW });
    const X = await signer.makeLaptop({ userId: "ux", org: "o2", view: "v1", projects: ["p1"], nowMs: NOW });
    await X.seed({ project: "p1", kind: "rfis", id: "evil", version: 9, updated_at: T1, data: { subject: "x" } });
    const d = deps();
    const seen: Array<[string, string]> = [];
    const a = net(A, d, { onRefused: (peer, reason) => seen.push([peer, reason]) });
    const x = net(X, d);
    await a.start();
    await x.start();
    await until(() => a.stats().refused.wrong_org === 1);
    expect(seen).toContainEqual(["ux", "wrong_org"]);
    expect(a.stats().refused).toEqual({ wrong_org: 1 });
    expect(a.verifiedCount()).toBe(0);
    expect(await A.db.listByOrg("o2")).toEqual([]);
    expect(await A.get("rfis", "evil")).toBeUndefined();
    a.close();
    x.close();
  });

  test("a row whose signature fails is counted as bad_signature (and kept out), the good one beside it lands", async () => {
    const signer = await createOrgSigner("k-real");
    const stranger = await createOrgSigner("k-unknown"); // a key B never got from our server
    const A = await signer.makeLaptop({ userId: "ua", org: "o1", view: "v1", projects: ["p1"], nowMs: NOW });
    const B = await signer.makeLaptop({ userId: "ub", org: "o1", view: "v1", projects: ["p1"], nowMs: NOW });
    await A.seed({ project: "p1", kind: "rfis", id: "good", version: 2, updated_at: T1, data: { subject: "ok" } });
    const forged = await stranger.row("o1", { project: "p1", kind: "rfis", id: "forged", version: 7, updated_at: T1, data: { subject: "made up" } });
    await A.db.putRecord({ id: "rfis:forged", type: "rfis", orgId: "o1", projectId: "p1", data: forged.data, serverVersion: 7, serverUpdatedAt: T1, sig: forged.sig, kid: forged.kid });
    const d = deps();
    const a = net(A, d);
    const b = net(B, d);
    await a.start();
    await b.start();
    await until(async () => !!(await B.get("rfis", "good")) && (b.stats().rejected.bad_signature ?? 0) >= 1);
    expect((await B.get("rfis", "good"))?.serverVersion).toBe(2);
    expect(await B.get("rfis", "forged")).toBeUndefined();
    expect(b.stats().rejected).toEqual({ bad_signature: 1 });
    expect(b.stats().accepted).toBe(1);
    a.close();
    b.close();
    // closed sessions are still counted
    expect(b.stats().rejected).toEqual({ bad_signature: 1 });
  });
});

describe("network + auto-sync: the manifest's never-share organisation kinds are held back", () => {
  async function orgPair() {
    const signer = await createOrgSigner();
    const A = await signer.makeLaptop({ userId: "ua", org: "o1", view: "v1", orgView: "ov", projects: ["p1"], nowMs: NOW });
    const B = await signer.makeLaptop({ userId: "ub", org: "o1", view: "v1", orgView: "ov", projects: ["p1"], nowMs: NOW });
    await A.seed({ project: ORG_PROJECT, kind: "vendors", id: "ven-1", version: 3, updated_at: T1, data: { id: "ven-1", supplier_name: "Ace Cement" } });
    await A.seed({ project: ORG_PROJECT, kind: "departments", id: "dep-1", version: 1, updated_at: T1, data: { id: "dep-1", name: "Site" } });
    return { signer, A, B };
  }

  test("network: noPeerKinds() reaches the sessions (vendors held back, departments move)", async () => {
    const { A, B } = await orgPair();
    const d = deps();
    const a = net(A, d, { noPeerKinds: () => ["vendors"] });
    const b = net(B, d, { noPeerKinds: () => ["vendors"] });
    await a.start();
    await b.start();
    await until(async () => !!(await B.get("departments", "dep-1")));
    await wait(100);
    expect((await B.get("departments", "dep-1"))?.serverVersion).toBe(1);
    expect(await B.get("vendors", "ven-1")).toBeUndefined();
    a.close();
    b.close();
  });

  test("auto-sync reads orgNoPeerKinds from the stored manifest", async () => {
    const { A, B } = await orgPair();
    for (const L of [A, B]) {
      await L.db.setMeta(MANIFEST_KEY, { userId: L.userId, orgId: "o1", projectIds: ["p1"], kinds: ["rfis"], at: NOW, orgKinds: ["vendors", "departments"], orgNoPeerKinds: ["vendors", "org_people"] });
    }
    const d = deps();
    const now = Date.now();
    const make = (L: Laptop) => createAutoSync({
      userId: L.userId, selfId: L.userId, db: L.db,
      fetchAttest: async () => { throw new Error("our server is down"); }, // the cached attestation below carries it
      remoteProviders: [supabaseRealtimeProvider(d.rt.client), ntfyProvider({ fetchImpl: d.nt.fetchImpl, EventSourceImpl: d.nt.EventSourceImpl })],
      openLink: d.rtc.openLink, isVisible: () => true, isOnline: () => true, locks: null, foreignOrg, now: () => NOW,
    });
    for (const L of [A, B]) {
      await L.db.setMeta("peer:attest", { token: L.self.token, expiresAt: now + 86_400_000, orgId: "o1", userId: L.userId, viewClass: "v1", projects: ["p1"], channel: "chan", fetchedAt: now });
    }
    const a = make(A);
    const b = make(B);
    await until(async () => !!(await B.get("departments", "dep-1")), 10_000);
    await wait(150);
    expect((await B.get("departments", "dep-1"))?.serverVersion).toBe(1);
    expect(await B.get("vendors", "ven-1")).toBeUndefined();
    a.stop();
    b.stop();
  }, 15_000);
});
