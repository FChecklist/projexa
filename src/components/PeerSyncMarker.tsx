// LOCAL-FIRST PEERS: a calm, one-line note that this laptop is syncing directly with other laptops of the organisation
// ("Synced with 2 laptops"). No dialog, no button, nothing at all when no peer is connected.
"use client";

import { peerSyncText } from "@/lib/local-first/peer/status";
import { usePeerSyncStatus } from "@/lib/local-first/peer/use-peer-sync";

export function PeerSyncMarker({ className = "" }: { className?: string }) {
  const { peers } = usePeerSyncStatus();
  const text = peerSyncText(peers);
  if (!text) return null;
  return (
    <span role="status" aria-live="polite" data-testid="peer-sync" className={`inline-flex items-center gap-1 text-[11px] text-px-muted ${className}`}>
      <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-px-muted" />
      {text}
    </span>
  );
}
