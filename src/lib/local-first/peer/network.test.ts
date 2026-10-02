import { describe, expect, test } from "bun:test";
import { foreignOrg } from "../replica";
import { createFakeNtfy, createFakeRealtime } from "./__fixtures__/fake-signalling";
import { makeLaptop, type Laptop } from "./__fixtures__/laptop";
import { createMemoryRtc } from "./__fixtures__/memory-rtc";
import { createTestSigner } from "./__fixtures__/test-signer";
import { createLocalDbPeerStore } from "./localdb-store";
import { createPeerNetwork, type PeerNetwork } from "./network";
import { createSignalHub, ntfyProvider, supabaseRealtimeProvider, type SignalEnvelope, type SignalHub } from "./signalling";

// Whole-path: discovery over signalling (Supabase DOWN, so ntfy carries it), one link per pair, hello, exchange. No server in the data path.

const NOW = Date.parse("2026-10-02T10:00:00Z");
const T1 = "2026-10-01T10:00:00Z";
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return; await wait(20); }
}

async function node(L: Laptop, deps: { rt: ReturnType<typeof createFakeRealtime>; nt: ReturnType<typeof createFakeNtfy>; rtc: ReturnType<typeof createMemoryRtc> }, counts: Map<string, number>): Promise<PeerNetwork> {
  const hub = createSignalHub({
    channel: "org-channel",
    selfId: L.userId,
    remote: [supabaseRealtimeProvider(deps.rt.client), ntfyProvider({ fetchImpl: deps.nt.fetchImpl, EventSourceImpl: deps.nt.EventSourceImpl })],
  });
  return createPeerNetwork({
    selfId: L.userId, hub, getSelf: async () => L.self, keys: L.keys, store: createLocalDbPeerStore(L.db, L.org), openLink: deps.rtc.openLink,
    now: () => NOW, foreignOrg, onChange: (n) => counts.set(L.userId, n),
  });
}

describe("peer network", () => {
  test("three laptops of one org converge with our server down; a laptop of another org on the same channel gets nothing", async () => {
    const signer = await createTestSigner();
    const mk = (userId: string, org = "org-1") => makeLaptop(signer, { userId, org, view: "v", projects: ["p1"], nowMs: NOW });
    const [A, B, C, X] = await Promise.all([mk("ua"), mk("ub"), mk("uc"), mk("ux", "org-evil")]);
    await A.seed({ project: "p1", kind: "rfis", id: "a", version: 1, updated_at: T1, data: { by: "A" } });
    await B.seed({ project: "p1", kind: "rfis", id: "b", version: 1, updated_at: T1, data: { by: "B" } });
    await C.seed({ project: "p1", kind: "tasks", id: "c", version: 2, updated_at: T1, data: { by: "C" } });
    const deps = { rt: createFakeRealtime({ down: true }), nt: createFakeNtfy(), rtc: createMemoryRtc() };
    const counts = new Map<string, number>();
    const nets = await Promise.all([A, B, C, X].map((L) => node(L, deps, counts)));
    for (const n of nets) await n.start();
    const full = async (L: Laptop) => (await L.db.listByOrg("org-1")).length === 3;
    await until(async () => (await full(A)) && (await full(B)) && (await full(C)) && nets[0].verifiedCount() === 2);
    await wait(100); // and give a wrongly-admitted laptop X time to receive anything
    // signalling went over ntfy, data did not: ntfy only ever saw small encrypted signalling messages
    expect(deps.nt.state.posts.length).toBeGreaterThan(0);
    expect(deps.nt.state.posts.every((p) => p.body.length < 4096 && !p.body.includes("rfis"))).toBe(true);
    for (const L of [A, B, C]) {
      expect((await L.db.listByOrg("org-1")).map((r) => r.id).sort()).toEqual(["rfis:a", "rfis:b", "tasks:c"]);
    }
    expect(await X.db.listByOrg("org-1")).toEqual([]);
    expect(nets[0].verifiedCount()).toBe(2);
    expect(counts.get("ua")).toBe(2);
    expect(nets[3].verifiedCount()).toBe(0);
    // exactly one link per pair (6 pairs among 4 laptops at most, never two for one pair)
    expect(deps.rtc.opened()).toBeLessThanOrEqual(6);
    // a later server pull on A reaches B and C through syncAll
    await A.seed({ project: "p1", kind: "rfis", id: "late", version: 1, updated_at: T1, data: {} });
    const r = await nets[1].syncAll(2000);
    expect(r.peers).toBe(2);
    expect(await B.get("rfis", "late")).toBeDefined();
    for (const n of nets) n.close();
  });

  test("without an attestation a laptop neither announces nor links", async () => {
    const signer = await createTestSigner();
    const A = await makeLaptop(signer, { userId: "ua", org: "o", view: "v", projects: ["p1"], nowMs: NOW });
    const B = await makeLaptop(signer, { userId: "ub", org: "o", view: "v", projects: ["p1"], nowMs: NOW });
    await A.seed({ project: "p1", kind: "rfis", id: "a", version: 1, updated_at: T1, data: {} });
    const deps = { rt: createFakeRealtime(), nt: createFakeNtfy(), rtc: createMemoryRtc() };
    const counts = new Map<string, number>();
    const na = await node(A, deps, counts);
    const hub = createSignalHub({ channel: "org-channel", selfId: "ub", remote: [supabaseRealtimeProvider(deps.rt.client)] });
    const nb = createPeerNetwork({ selfId: "ub", hub, getSelf: async () => null, keys: B.keys, store: createLocalDbPeerStore(B.db, "o"), openLink: deps.rtc.openLink, now: () => NOW });
    await na.start();
    await nb.start();
    await wait(200);
    expect(deps.rtc.opened()).toBe(0);
    expect(await B.get("rfis", "a")).toBeUndefined();
    na.close();
    nb.close();
  });

  test("two laptops that start together and lose their first announces still find each other (re-announce)", async () => {
    const signer = await createTestSigner();
    const A = await makeLaptop(signer, { userId: "ua", org: "o", view: "v", projects: ["p1"], nowMs: NOW });
    const B = await makeLaptop(signer, { userId: "ub", org: "o", view: "v", projects: ["p1"], nowMs: NOW });
    await A.seed({ project: "p1", kind: "rfis", id: "a", version: 1, updated_at: T1, data: {} });
    // a tiny bus that loses every announce sent in the first 50 ms (both laptops "not yet subscribed")
    const started = Date.now();
    const hubs: Array<SignalHub & { id: string }> = [];
    const bus = (id: string): SignalHub & { id: string } => {
      const h = {
        id, onmessage: null as ((m: SignalEnvelope) => void) | null, remote: "bus" as string | null,
        async ensure() { return "bus"; },
        send(p: Omit<SignalEnvelope, "id" | "from">) {
          if (p.kind === "announce" && Date.now() - started < 50) return;
          const m = { ...p, id: crypto.randomUUID(), from: id } as SignalEnvelope;
          for (const o of hubs) if (o !== h && (!m.to || m.to === o.id)) setTimeout(() => o.onmessage?.(m), 0);
        },
        close() {},
      };
      hubs.push(h);
      return h;
    };
    const rtc = createMemoryRtc();
    const mk = (L: Laptop, reannounceMs: number) => createPeerNetwork({ selfId: L.userId, hub: bus(L.userId), getSelf: async () => L.self, keys: L.keys, store: createLocalDbPeerStore(L.db, "o"), openLink: rtc.openLink, now: () => NOW, reannounceMs, replyEveryMs: 10 });
    const na = mk(A, 150);
    const nb = mk(B, 150);
    await Promise.all([na.start(), nb.start()]);
    await until(async () => !!(await B.get("rfis", "a")), 3000);
    expect(await B.get("rfis", "a")).toBeDefined();
    na.close();
    nb.close();
  });
});
