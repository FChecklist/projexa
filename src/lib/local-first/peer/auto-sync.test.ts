import { describe, expect, test } from "bun:test";
import { foreignOrg } from "../replica";
import { createFakeNtfy, createFakeRealtime } from "./__fixtures__/fake-signalling";
import { makeLaptop, type Laptop } from "./__fixtures__/laptop";
import { createMemoryRtc } from "./__fixtures__/memory-rtc";
import { createTestSigner, type TestSigner } from "./__fixtures__/test-signer";
import { createAutoSync } from "./auto-sync";
import { ntfyProvider, supabaseRealtimeProvider } from "./signalling";

// The whole laptop-side assembly, with OUR server down from the start of the peer phase: the cached attestation and cached keys
// carry verification, ntfy carries signalling, the in-memory transport carries data. No user action anywhere.

const T1 = "2026-10-01T10:00:00Z";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Polls until `check` holds or the deadline passes (no fixed sleep: the suite runs under very different loads). */
async function until(check: () => Promise<boolean> | boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return; await wait(20); }
}

describe("auto-sync with our server down", () => {
  test("two laptops find each other and converge with no button pressed", async () => {
    const signer: TestSigner = await createTestSigner();
    const now = Date.now();
    const mk = (u: string) => makeLaptop(signer, { userId: u, org: "o1", view: "v1", projects: ["p1"], nowMs: now });
    const [A, B] = await Promise.all([mk("ua"), mk("ub")]);
    await A.seed({ project: "p1", kind: "rfis", id: "fromA", version: 3, updated_at: T1, data: { a: 1 } });
    await B.seed({ project: "p1", kind: "tasks", id: "fromB", version: 1, updated_at: T1, data: { b: 1 } });

    // 1) while online, each laptop got its attestation once
    const serverUp = { up: true };
    const fetchFor = (L: Laptop) => async () => {
      if (!serverUp.up) throw new Error("our server is down");
      return { token: L.self.token, expires_at: new Date(now + 86_400_000).toISOString(), org_id: "o1", user_id: L.userId, view_class: "v1", projects: ["p1"], channel: "org-chan", public_keys: [signer.publicKey] };
    };
    const rt = createFakeRealtime({ down: true }); // Supabase Realtime is down too
    const nt = createFakeNtfy();
    const rtc = createMemoryRtc();
    let serverCalls = 0;
    const make = (L: Laptop) => createAutoSync({
      userId: L.userId, selfId: L.userId, db: L.db, fetchAttest: fetchFor(L),
      remoteProviders: [supabaseRealtimeProvider(rt.client), ntfyProvider({ fetchImpl: nt.fetchImpl, EventSourceImpl: nt.EventSourceImpl })],
      openLink: rtc.openLink, serverStep: async () => { serverCalls++; throw new Error("unreachable"); },
      isVisible: () => true, isOnline: () => true, locks: null, foreignOrg, requirePx3: false, // px2-only fixtures; px3 is tested in px3.test.ts and the real-browser peer specs
     
    });
    // attestation fetched, then the server goes down before the laptops ever meet
    const first = make(A);
    await until(async () => !!(await first.attestation.current()));
    first.stop();
    const firstB = make(B);
    await until(async () => !!(await firstB.attestation.current()));
    firstB.stop();
    serverUp.up = false;

    const a = make(A);
    const b = make(B);
    await until(async () => a.network()?.verifiedCount() === 1 && b.network()?.verifiedCount() === 1 && !!(await B.get("rfis", "fromA")) && !!(await A.get("tasks", "fromB")), 15_000);
    expect(a.network()?.verifiedCount()).toBe(1);
    expect(b.network()?.verifiedCount()).toBe(1);
    expect((await B.get("rfis", "fromA"))?.serverVersion).toBe(3);
    expect(await A.get("tasks", "fromB")).toBeDefined();
    expect(serverCalls).toBeGreaterThan(0); // it did try our server, failed quietly, and peers still worked
    a.stop();
    b.stop();
  }, 20_000);
});
