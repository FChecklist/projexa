// TEST ONLY (Playwright, e2e/lf-peer-*.spec.ts, package lf-e9): a browser entry point that runs the REAL peer stack of one laptop -- real
// IndexedDB (local-db.ts), real RTCPeerConnection + RTCDataChannel over loopback, the real protocol, network, auto-sync, scheduler and
// server step -- in a page with no app around it. Signalling is bridged by the test runner (window.pxSignalOut -> the other page's
// pxPeerLf.signalIn), standing in for Supabase Realtime / ntfy (which carry only signalling, never rows). Not imported by the app.
//
// Unlike e2e-harness.ts (the original single-test harness, kept as it is), this one exposes what the peer specs assert on: every
// refusal and rejection (network.stats()), the stored record with its version / signatures / dirty flag, the auto-sync assembly with a
// counted (and unreachable) server, and the epoch reset of the server step.

import { changeCursorKey, localDbNameFor, openLocalDb, type LocalDb } from "../local-db";
import { foreignOrg, LAST_SYNC_KEY, MANIFEST_KEY, type StoredManifest } from "../replica";
import { createAutoSync, type AutoSync } from "./auto-sync";
import { createLocalDbPeerStore } from "./localdb-store";
import { createPeerNetwork, type NetworkStats, type PeerNetwork } from "./network";
import { createServerStep, HEADS_KEY, type StoredHeads } from "./server-step";
import { resetLocalCopy } from "./reset-copy";
import { createClient } from "@supabase/supabase-js";
import { parseEnvelope, remoteSignalProviders, type RealtimeClientLike, type SignalConnection, type SignalEnvelope, type SignalProvider } from "./signalling";
import { createRtcLink } from "./transport";
import { getPeerStatus } from "./status";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { PeerSyncMarker } from "@/components/PeerSyncMarker";
import { createKeyRing, PEER_ATTEST_KEY, verifyToken, type KeyRing, type PublicKeyInfo, type SignedRow } from "./verify";

declare global {
  interface Window {
    pxSignalOut?: (json: string) => Promise<void>;
    pxPeerLf?: typeof harness;
  }
}

type SeedRow = SignedRow & { dirty?: string };
/** The change-feed head the stubbed GET /heads reports for every project (nothing moved since the copy was made). */
const FEED_HEAD = 10;

let db: LocalDb | null = null;
let keys: KeyRing | null = null;
let me = { userId: "", org: "" };
let net: PeerNetwork | null = null;
let auto: AutoSync | null = null;
let conn: (SignalConnection & { deliver(m: SignalEnvelope): void }) | null = null;
const refusals: Array<{ peer: string; reason: string }> = [];
const counters = { serverStep: 0, attestFetch: 0, fetch: 0 };
/** startAutoReal: which real signalling provider connected, and which failed (with why). */
const providerLog: { connected: string[]; failed: Array<{ name: string; error: string }> } = { connected: [], failed: [] };

/**
 * AUDIT-100 B22: how startAuto's links are built. Default: loopback host candidates only (iceServers []). The relay spec passes TURN
 * servers and iceTransportPolicy "relay" (host and server-reflexive candidates are never gathered, so only a relay path can connect).
 */
type RtcSetup = { iceServers: RTCIceServer[]; iceTransportPolicy?: RTCIceTransportPolicy; openTimeoutMs?: number };
let rtcSetup: RtcSetup = { iceServers: [] };
/** Every RTCPeerConnection the links made (to read which candidate pair carried the data). */
const pcs: RTCPeerConnection[] = [];
class RecordedPC extends RTCPeerConnection {
  constructor(config?: RTCConfiguration) { super(config); pcs.push(this); }
}
const openRtc = ({ initiator, sendSignal }: { initiator: boolean; sendSignal: Parameters<typeof createRtcLink>[0]["sendSignal"] }) =>
  createRtcLink({ initiator, sendSignal, iceServers: rtcSetup.iceServers, iceTransportPolicy: rtcSetup.iceTransportPolicy, openTimeoutMs: rtcSetup.openTimeoutMs, RTCPeerConnectionImpl: RecordedPC });

// every network request this page makes is counted: the peer path must make none
const realFetch = window.fetch.bind(window);
window.fetch = (...args: Parameters<typeof fetch>) => { counters.fetch += 1; return realFetch(...args); };

/** The bridged signalling connection: what this page sends goes to the test runner, what the runner relays comes in through signalIn. */
function bridgeProvider(selfId: string): SignalProvider {
  return {
    name: "bridge",
    async connect() {
      const c = {
        name: "bridge",
        onmessage: null as ((m: SignalEnvelope) => void) | null,
        onclose: null as (() => void) | null,
        send(m: SignalEnvelope) { void window.pxSignalOut?.(JSON.stringify(m)); },
        close() {},
        deliver(m: SignalEnvelope) { if (m.from !== selfId) c.onmessage?.(m); },
      };
      conn = c;
      return c;
    },
  };
}

async function putRows(rows: SeedRow[]) {
  for (const r of rows) {
    await db!.putRecord({
      id: `${r.kind}:${r.id}`, type: r.kind, orgId: me.org, projectId: r.project, data: r.data, serverVersion: r.version, serverUpdatedAt: r.updated_at,
      sig: r.sig, kid: r.kid, ...(r.sig3 ? { sig3: r.sig3 } : {}), ...(r.dirty ? { dirty: r.dirty } : {}),
    });
  }
}

const harness = {
  /** Opens this laptop's own database and stores what an earlier server pull would have left: the server's public keys and signed rows. */
  async setup(o: { userId: string; org: string; keys: PublicKeyInfo[]; rows: SeedRow[]; manifest?: StoredManifest; heads?: StoredHeads }) {
    me = { userId: o.userId, org: o.org };
    db = await openLocalDb(indexedDB, localDbNameFor(o.userId));
    keys = createKeyRing(db);
    await keys.replace(o.keys);
    await putRows(o.rows);
    if (o.manifest) await db.setMeta(MANIFEST_KEY, o.manifest);
    if (o.heads) await db.setMeta(HEADS_KEY, o.heads);
    if (o.heads) {
      // the whole sync that made the copy these heads describe, and each project's change-feed position at the head the stub reports
      await db.setMeta(LAST_SYNC_KEY, { at: o.heads.at });
      for (const p of o.manifest?.projectIds ?? []) await db.setMeta(changeCursorKey(p), { seq: FEED_HEAD });
    }
  },
  /** More rows later (what a server pull on this laptop would store). */
  async addRows(rows: SeedRow[]) { await putRows(rows); },
  /** The peer network alone, with this laptop's attestation token (which must verify under its own keys, as attest.ts guarantees). */
  async startNet(o: { token: string; noPeerKinds?: string[]; presentAnyway?: boolean }) {
    const check = await verifyToken(o.token, keys!, Date.now());
    // presentAnyway: play a laptop that presents a token the real app would never hand out (attest.ts current() refuses an expired
    // one), so the RECEIVER's check is what is tested; the claims are read from the token body unverified, as such a laptop would
    if (!check.ok && !o.presentAnyway) throw new Error(`own token does not verify: ${check.reason}`);
    const claims = check.ok ? check.claims : JSON.parse(atob(o.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const self = { token: o.token, claims };
    const provider = bridgeProvider(me.userId);
    const c = await provider.connect("bridge", me.userId);
    const hub = {
      onmessage: null as ((m: SignalEnvelope) => void) | null,
      remote: "bridge" as string | null,
      async ensure() { return "bridge"; },
      send(partial: Omit<SignalEnvelope, "id" | "from">) { c.send({ ...partial, id: crypto.randomUUID(), from: me.userId } as SignalEnvelope); },
      close() {},
    };
    c.onmessage = (m) => { if (!m.to || m.to === me.userId) hub.onmessage?.(m); };
    net = createPeerNetwork({
      selfId: me.userId, hub, getSelf: async () => self, keys: keys!, store: createLocalDbPeerStore(db!, me.org), foreignOrg,
      noPeerKinds: o.noPeerKinds ? () => o.noPeerKinds! : undefined,
      onRefused: (peer, reason) => refusals.push({ peer, reason }),
      openLink: ({ initiator, sendSignal }) => createRtcLink({ initiator, sendSignal, iceServers: [] }), // loopback: host candidates only
    });
    await net.start();
  },
  /**
   * The whole auto-sync assembly (attest.ts + signalling hub + network + scheduler + server step) as peer-shared.ts wires it, with OUR
   * server unreachable: the attestation comes from the laptop's own cache (stored here as /attest would have left it), every server
   * step and attestation fetch is counted and fails.
   */
  async startAuto(o: { attestation: { token: string; expiresAt: number; viewClass: string; projects: string[]; channel: string }; rtc?: RtcSetup }) {
    if (o.rtc) rtcSetup = o.rtc;
    await db!.setMeta(PEER_ATTEST_KEY, { ...o.attestation, orgId: me.org, userId: me.userId, fetchedAt: Date.now() });
    auto = createAutoSync({
      userId: me.userId, selfId: me.userId, db: db!,
      fetchAttest: async () => { counters.attestFetch += 1; throw new Error("our server is down"); },
      remoteProviders: [bridgeProvider(me.userId)],
      openLink: openRtc,
      serverStep: async () => { counters.serverStep += 1; throw new Error("our server is down"); },
      isVisible: () => true, isOnline: () => true, locks: null, foreignOrg,
    });
  },
  /**
   * AUDIT-100 B21: the same auto-sync assembly with the app's REAL signalling providers (remoteSignalProviders, the list peer-shared.ts
   * races) instead of the bridge: a real supabase-js Realtime client pointed at `supabaseUrl` (the test makes it refuse: Supabase down)
   * and the real ntfy provider (real EventSource + fetch) pointed at `ntfyBase` (the test's local ntfy stand-in). Each provider is only
   * watched (connected / failed), never changed.
   */
  async startAutoReal(o: { attestation: { token: string; expiresAt: number; viewClass: string; projects: string[]; channel: string }; supabaseUrl: string; ntfyBase: string }) {
    await db!.setMeta(PEER_ATTEST_KEY, { ...o.attestation, orgId: me.org, userId: me.userId, fetchedAt: Date.now() });
    const client = createClient(o.supabaseUrl, "local-placeholder-anon-key", { auth: { persistSession: false, autoRefreshToken: false } });
    const watched = remoteSignalProviders(() => client as unknown as RealtimeClientLike, { baseUrl: o.ntfyBase }).map((p): SignalProvider => ({
      name: p.name,
      connect: (channel, selfId) => p.connect(channel, selfId).then(
        (c) => { providerLog.connected.push(p.name); return c; },
        (e: unknown) => { providerLog.failed.push({ name: p.name, error: String(e) }); throw e; },
      ),
    }));
    auto = createAutoSync({
      userId: me.userId, selfId: me.userId, db: db!,
      fetchAttest: async () => { counters.attestFetch += 1; throw new Error("our server is down"); },
      remoteProviders: watched,
      openLink: ({ initiator, sendSignal }) => createRtcLink({ initiator, sendSignal, iceServers: [] }),
      serverStep: async () => { counters.serverStep += 1; throw new Error("our server is down"); },
      isVisible: () => true, isOnline: () => true, locks: null, foreignOrg,
    });
  },
  providers() { return { connected: providerLog.connected.slice(), failed: providerLog.failed.slice() }; },
  /** B22: the real peer marker (components/PeerSyncMarker.tsx), mounted in this page as the shell mounts it. */
  mountMarker() {
    const el = document.createElement("div");
    el.id = "marker";
    document.body.appendChild(el);
    createRoot(el).render(createElement(PeerSyncMarker));
  },
  peerStatus() { return { ...getPeerStatus() }; },
  /** B22: for each link this page made, the candidate types of the pair that carried the data (from the browser's own getStats). */
  async selectedPairs() {
    const out: Array<{ state: string; local: string | null; remote: string | null; bytesSent: number }> = [];
    for (const pc of pcs) {
      const stats = await pc.getStats();
      const byId = new Map<string, Record<string, unknown>>();
      stats.forEach((s: Record<string, unknown>) => byId.set(s.id as string, s));
      let pairId: string | null = null;
      stats.forEach((s: Record<string, unknown>) => { if (s.type === "transport" && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId as string; });
      const pair = pairId ? byId.get(pairId) : undefined;
      const cand = (id: unknown) => (id ? (byId.get(id as string)?.candidateType as string | undefined) ?? null : null);
      out.push({ state: pc.connectionState, local: cand(pair?.localCandidateId), remote: cand(pair?.remoteCandidateId), bytesSent: Number(pair?.bytesSent ?? 0) });
    }
    return out;
  },
  /** B22: the app keeps working: a local write and a re-read of this laptop's own database. */
  async writeLocal(kind: string, id: string, data: Record<string, unknown>) {
    await db!.putRecord({ id: `${kind}:${id}`, type: kind, orgId: me.org, projectId: "p1", data, dirty: crypto.randomUUID() });
    return (await db!.getRecord(kind, id))?.data ?? null;
  },
  /**
   * One heads-mode server step (server-step.ts) against a stubbed GET /heads answer: when the epoch or view class differs from the stored
   * one, the REAL resetLocalCopy runs (reset-copy.ts) and a whole sync follows (stubbed: counted, stores nothing).
   */
  async serverStepWithHeads(answer: { epoch: string; view_class: string }) {
    let wholeSyncs = 0;
    const step = createServerStep({
      meta: db!, changes: async () => ({ head_seq: 0 }),
      sync: async () => { wholeSyncs += 1; await db!.setMeta(LAST_SYNC_KEY, { at: Date.now() }); return { status: "done" }; },
      syncProject: async () => ({ status: "done" }),
      heads: async () => ({ heads: Object.fromEntries(((await db!.getMeta<StoredManifest>(MANIFEST_KEY))?.projectIds ?? []).map((p) => [p, FEED_HEAD])), projects_etag: "e1", view_class: answer.view_class, org_view_class: null, epoch: answer.epoch }),
      resetCopy: async () => { await resetLocalCopy(db!); },
    });
    const r = await step();
    return { changed: !!r && r.changed, wholeSyncs };
  },
  /** What peer-shared.ts wires to the `online` / `visibilitychange` events: a scheduler trigger. */
  async triggerAuto(reason: "online" | "visible" | "manual") { await auto?.scheduler.trigger(reason); },
  signalIn(json: string) { const m = parseEnvelope(json); if (m) conn?.deliver(m); },
  peers() { return (auto ? auto.network() : net)?.verifiedCount() ?? 0; },
  stats(): NetworkStats | null { return (auto ? auto.network() : net)?.stats() ?? null; },
  refusals() { return refusals.slice(); },
  counters() { return { ...counters }; },
  async syncAll() { return (auto ? auto.network() : net)?.syncAll(5000); },
  async ids(org: string) { return (await db!.listByOrg(org)).map((r) => `${r.id}@${r.serverVersion}${r.dirty ? "*" : ""}`).sort(); },
  async rec(kind: string, id: string) {
    const r = await db!.getRecord(kind, id);
    return r ? { data: r.data, version: r.serverVersion ?? null, dirty: r.dirty ?? null, sig: !!r.sig, sig3: !!r.sig3, kid: r.kid ?? null } : null;
  },
  /** Every stored row's signature, re-verified in this page with the laptop's own keys (verify.ts, the production path). */
  async verifyAll(org: string, view: string) {
    const { verifyRow, verifyRowV3 } = await import("./verify");
    const out: Record<string, { px2: boolean; px3: boolean | null }> = {};
    for (const r of await db!.listByOrg(org)) {
      if (!r.sig || !r.kid || r.serverVersion === undefined || !r.serverUpdatedAt || r.projectId === null) continue;
      const row: SignedRow = { project: r.projectId, kind: r.type, id: r.id.slice(r.type.length + 1), version: r.serverVersion, updated_at: r.serverUpdatedAt, data: r.data, sig: r.sig, kid: r.kid, ...(r.sig3 ? { sig3: r.sig3 } : {}) };
      out[r.id] = { px2: await verifyRow(row, org, keys!), px3: r.sig3 ? await verifyRowV3(row, org, view, keys!) : null };
    }
    return out;
  },
  stop() { auto?.stop(); net?.close(); auto = null; net = null; },
};

window.pxPeerLf = harness;
