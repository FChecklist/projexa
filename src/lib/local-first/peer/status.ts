// LOCAL-FIRST PEERS: the one bit of peer state the screens show ("Synced with 2 laptops"). A tiny external store, so the
// marker re-renders only when the number of verified laptops (or the last peer exchange time) changes.

export type PeerStatus = { peers: number; lastPeerSyncAt: number | null };

let status: PeerStatus = { peers: 0, lastPeerSyncAt: null };
const listeners = new Set<() => void>();

export function getPeerStatus(): PeerStatus {
  return status;
}

export function setPeerStatus(patch: Partial<PeerStatus>): void {
  const next = { ...status, ...patch };
  if (next.peers === status.peers && next.lastPeerSyncAt === status.lastPeerSyncAt) return;
  status = next;
  for (const l of listeners) l();
}

export function subscribePeerStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The marker's words: calm, no numbers when there is nothing to say. */
export function peerSyncText(peers: number): string | null {
  if (peers <= 0) return null;
  return peers === 1 ? "Synced with 1 laptop" : `Synced with ${peers} laptops`;
}
