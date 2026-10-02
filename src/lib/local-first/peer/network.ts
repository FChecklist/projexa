// LOCAL-FIRST PEERS: the set of laptops this one is talking to right now.
//
//   1. signalling (signalling.ts) carries `announce` messages; when two laptops hear each other, the one with the smaller id
//      opens the WebRTC link (the other answers), so exactly one link exists per pair and nobody offers twice;
//   2. once the data channel is open, a protocol.ts session runs on it: hello (verified attestation) -> have -> want -> items;
//   3. `syncAll()` asks every verified peer for anything new (the scheduler calls it); `verifiedCount()` feeds the UI marker.
//
// No attestation (never fetched, or expired with our server down for more than 24 h): this laptop does not announce, answer
// or link at all. A peer that fails hello is dropped and not retried until it announces again.

import { createPeerSession, type PeerSession, type PeerStore } from "./protocol";
import type { SignalEnvelope, SignalHub } from "./signalling";
import type { PeerLink, RtcHandle, RtcSignal } from "./transport";
import type { KeyRing, PeerClaims } from "./verify";

export const DEFAULT_MAX_PEERS = 8;
/** A second announce this long after joining: two laptops that start together can miss each other's first one (ntfy has no presence). */
export const REANNOUNCE_MS = 4000;
/** Answer a given peer's broadcast announce at most this often (it re-announces when it did not hear us). */
export const REPLY_EVERY_MS = 2_000;

export type OpenLink = (o: { peerId: string; initiator: boolean; sendSignal: (s: RtcSignal) => void }) => RtcHandle;

export type PeerNetworkOptions = {
  selfId: string;
  hub: SignalHub;
  /** Our attestation (from the cache): null = we may not take part. */
  getSelf: () => Promise<{ token: string; claims: PeerClaims } | null>;
  keys: KeyRing;
  store: PeerStore;
  openLink: OpenLink;
  now?: () => number;
  maxPeers?: number;
  allowedKinds?: readonly string[];
  foreignOrg?: (data: unknown, org: string) => boolean;
  /** A new peer passed hello (the scheduler treats it as a reason to sync). */
  onPeerVerified?: (peer: PeerClaims) => void;
  /** Rows were accepted from a peer. */
  onRows?: (n: number) => void;
  /** The number of verified peers changed. */
  onChange?: (verified: number) => void;
  reannounceMs?: number;
  replyEveryMs?: number;
};

export type PeerNetwork = {
  /** Connects signalling (if needed) and announces this laptop. Safe to call often. */
  start(): Promise<void>;
  /** Asks every verified peer for anything new. Resolves with how many rows were accepted in this round. */
  syncAll(timeoutMs?: number): Promise<{ peers: number; accepted: number }>;
  verifiedCount(): number;
  close(): void;
};

type Entry = { handle: RtcHandle; session: PeerSession | null; initiator: boolean };

export function createPeerNetwork(o: PeerNetworkOptions): PeerNetwork {
  const entries = new Map<string, Entry>();
  const replied = new Map<string, number>();
  const maxPeers = o.maxPeers ?? DEFAULT_MAX_PEERS;
  let closed = false;
  let reannounced = false;
  let reannounceTimer: ReturnType<typeof setTimeout> | null = null;

  const verifiedCount = () => [...entries.values()].filter((e) => e.session?.state === "verified").length;
  const changed = () => o.onChange?.(verifiedCount());

  function drop(peerId: string, e: Entry) {
    if (entries.get(peerId) !== e) return;
    entries.delete(peerId);
    replied.delete(peerId);
    e.handle.close();
    changed();
  }

  async function open(peerId: string, initiator: boolean): Promise<Entry | null> {
    if (closed || entries.has(peerId) || entries.size >= maxPeers) return entries.get(peerId) ?? null;
    const self = await o.getSelf();
    if (!self || entries.has(peerId)) return entries.get(peerId) ?? null;
    const handle = o.openLink({ peerId, initiator, sendSignal: (rtc) => o.hub.send({ kind: "rtc", to: peerId, rtc }) });
    const entry: Entry = { handle, session: null, initiator };
    entries.set(peerId, entry);
    handle.link.then(
      (link: PeerLink) => {
        if (closed || entries.get(peerId) !== entry) { link.close(); return; }
        entry.session = createPeerSession({
          link, self, keys: o.keys, store: o.store, now: o.now, allowedKinds: o.allowedKinds, foreignOrg: o.foreignOrg,
          onVerified: (peer) => { changed(); o.onPeerVerified?.(peer); },
          onRows: (n) => o.onRows?.(n),
          onClose: () => drop(peerId, entry),
        });
      },
      () => drop(peerId, entry),
    );
    return entry;
  }

  async function onSignal(m: SignalEnvelope) {
    if (closed || m.from === o.selfId) return;
    if (m.kind === "leave") {
      const e = entries.get(m.from);
      if (e) { e.session?.close("leave"); drop(m.from, e); }
      return;
    }
    if (m.kind === "announce") {
      if (entries.has(m.from)) return;
      if (!(await o.getSelf())) return;
      if (o.selfId < m.from) await open(m.from, true);
      else {
        // the other side has the smaller id: tell it we exist, it will offer (rate-limited per peer, never a storm)
        const t = Date.now();
        if (t - (replied.get(m.from) ?? -Infinity) >= (o.replyEveryMs ?? REPLY_EVERY_MS)) {
          replied.set(m.from, t);
          o.hub.send({ kind: "announce", to: m.from });
        }
      }
      return;
    }
    if (m.kind === "rtc" && m.rtc) {
      let e = entries.get(m.from) ?? null;
      if (!e && m.rtc.type === "offer") e = await open(m.from, false);
      if (e) await e.handle.handleSignal(m.rtc);
    }
  }

  o.hub.onmessage = (m) => { void onSignal(m); };

  return {
    async start() {
      if (closed) return;
      if (!(await o.getSelf())) return;
      await o.hub.ensure();
      o.hub.send({ kind: "announce" });
      const again = o.reannounceMs ?? REANNOUNCE_MS;
      if (again > 0 && !reannounced) {
        reannounced = true;
        reannounceTimer = setTimeout(() => { if (!closed && entries.size === 0) o.hub.send({ kind: "announce" }); }, again);
      }
    },
    async syncAll(timeoutMs = 60_000) {
      const sessions = [...entries.values()].map((e) => e.session).filter((s): s is PeerSession => s?.state === "verified");
      const before = sessions.reduce((n, s) => n + s.stats.accepted, 0);
      await Promise.all(sessions.map((s) => s.resync(timeoutMs)));
      const after = sessions.reduce((n, s) => n + s.stats.accepted, 0);
      return { peers: sessions.length, accepted: after - before };
    },
    verifiedCount,
    close() {
      if (closed) return;
      closed = true;
      if (reannounceTimer) clearTimeout(reannounceTimer);
      try { o.hub.send({ kind: "leave" }); } catch { /* best effort */ }
      for (const [id, e] of entries) { e.session?.close("leave"); e.handle.close(); entries.delete(id); }
      o.hub.close();
      changed();
    },
  };
}
