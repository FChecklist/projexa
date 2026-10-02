// LOCAL-FIRST PEERS: the hook behind <PeerSyncMarker/>. The server snapshot is "no peers", so nothing renders during SSR.
"use client";

import { useSyncExternalStore } from "react";
import { getPeerStatus, subscribePeerStatus, type PeerStatus } from "./status";

const SERVER: PeerStatus = { peers: 0, lastPeerSyncAt: null };

export function usePeerSyncStatus(): PeerStatus {
  return useSyncExternalStore(subscribePeerStatus, getPeerStatus, () => SERVER);
}
