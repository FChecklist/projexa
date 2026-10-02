// TEST ONLY (Playwright, e2e/peer-sync.spec.ts): a browser entry point that runs the REAL peer stack -- real IndexedDB, real
// RTCPeerConnection + RTCDataChannel (loopback), the real protocol -- in a page with no app around it. Signalling is bridged by
// the test runner (window.pxSignalOut -> the other page's pxPeerHarness.signalIn), standing in for Supabase Realtime / ntfy.
// Not imported by the app.

import { localDbNameFor, openLocalDb, type LocalDb } from "../local-db";
import { createLocalDbPeerStore } from "./localdb-store";
import { createPeerNetwork, type PeerNetwork } from "./network";
import { parseEnvelope, type SignalEnvelope, type SignalHub } from "./signalling";
import { createRtcLink } from "./transport";
import { createKeyRing, verifyToken, type PublicKeyInfo, type SignedRow } from "./verify";

declare global {
  interface Window {
    pxSignalOut?: (json: string) => Promise<void>;
    pxPeerHarness?: typeof harness;
  }
}

let db: LocalDb | null = null;
let net: PeerNetwork | null = null;
let hub: (SignalHub & { deliver(m: SignalEnvelope): void }) | null = null;

const harness = {
  async setup(o: { userId: string; org: string; token: string; keys: PublicKeyInfo[]; rows: Array<SignedRow & { dirty?: string }> }) {
    db = await openLocalDb(indexedDB, localDbNameFor(o.userId));
    const keys = createKeyRing(db);
    await keys.replace(o.keys);
    for (const r of o.rows) {
      await db.putRecord({ id: `${r.kind}:${r.id}`, type: r.kind, orgId: o.org, projectId: r.project, data: r.data, serverVersion: r.version, serverUpdatedAt: r.updated_at, sig: r.sig, kid: r.kid, ...(r.dirty ? { dirty: r.dirty } : {}) });
    }
    const check = await verifyToken(o.token, keys, Date.now());
    if (!check.ok) throw new Error(`own token does not verify: ${check.reason}`);
    const self = { token: o.token, claims: check.claims };
    const h = {
      onmessage: null as ((m: SignalEnvelope) => void) | null,
      remote: "bridge" as string | null,
      async ensure() { return "bridge"; },
      send(partial: Omit<SignalEnvelope, "id" | "from">) {
        const m: SignalEnvelope = { ...partial, id: crypto.randomUUID(), from: o.userId };
        void window.pxSignalOut?.(JSON.stringify(m));
      },
      close() {},
      deliver(m: SignalEnvelope) { if (m.from !== o.userId && (!m.to || m.to === o.userId)) h.onmessage?.(m); },
    };
    hub = h;
    net = createPeerNetwork({
      selfId: o.userId, hub: h, getSelf: async () => self, keys, store: createLocalDbPeerStore(db, o.org),
      openLink: ({ initiator, sendSignal }) => createRtcLink({ initiator, sendSignal, iceServers: [] }), // loopback: host candidates only
    });
  },
  async start() { await net?.start(); },
  signalIn(json: string) { const m = parseEnvelope(json); if (m) hub?.deliver(m); },
  peers() { return net?.verifiedCount() ?? 0; },
  async syncAll() { return net?.syncAll(5000); },
  async ids(org: string) { return (await db!.listByOrg(org)).map((r) => `${r.id}@${r.serverVersion}${r.dirty ? "*" : ""}`).sort(); },
};

window.pxPeerHarness = harness;
