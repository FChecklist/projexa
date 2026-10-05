// LOCAL-FIRST PEERS: the one bit of peer state the screens show ("Synced with 2 laptops"). A tiny external store, so the
// marker re-renders only when the number of verified laptops (or the last peer exchange time) changes.

/**
 * `unreachable` (AUDIT-100 B22): another laptop of the organisation was heard on signalling but no direct (or relayed) path to it opened --
 * e.g. both behind a symmetric NAT with no relay configured. Cleared the moment a laptop is reached.
 */
export type PeerStatus = { peers: number; lastPeerSyncAt: number | null; unreachable?: boolean };

let status: PeerStatus = { peers: 0, lastPeerSyncAt: null, unreachable: false };
const listeners = new Set<() => void>();

export function getPeerStatus(): PeerStatus {
  return status;
}

export function setPeerStatus(patch: Partial<PeerStatus>): void {
  const next = { ...status, ...patch };
  if (next.peers > 0) next.unreachable = false;
  if (next.peers === status.peers && next.lastPeerSyncAt === status.lastPeerSyncAt && !!next.unreachable === !!status.unreachable) return;
  status = next;
  for (const l of listeners) l();
}

export function subscribePeerStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** AUDIT-100 B22: the one sentence shown when another laptop was found but could not be reached (no error, no dialog). */
export const PEER_UNREACHABLE_TEXT = "Another laptop was found but could not be reached directly; your work is safe on this laptop.";

/** The marker's words: calm, no numbers when there is nothing to say. */
export function peerSyncText(peers: number, unreachable = false): string | null {
  if (peers <= 0) return unreachable ? PEER_UNREACHABLE_TEXT : null;
  return peers === 1 ? "Synced with 1 laptop" : `Synced with ${peers} laptops`;
}
