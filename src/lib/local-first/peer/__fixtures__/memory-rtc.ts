// TEST ONLY: an OpenLink (network.ts) that pairs two laptops through an in-memory registry instead of real WebRTC.
// The offer's `sdp` is just the registry id of a createMemoryLinkPair(); the answerer picks up the other end.

import type { OpenLink } from "../network";
import { createMemoryLinkPair, type PeerLink } from "../transport";

export function createMemoryRtc(): { openLink: OpenLink; opened: () => number } {
  const registry = new Map<string, PeerLink>();
  let n = 0;
  let count = 0;
  const openLink: OpenLink = ({ initiator, sendSignal }) => {
    let resolve!: (l: PeerLink) => void;
    let reject!: (e: Error) => void;
    const link = new Promise<PeerLink>((res, rej) => { resolve = res; reject = rej; });
    link.catch(() => {});
    let mine: PeerLink | null = null;
    if (initiator) {
      const [a, b] = createMemoryLinkPair();
      const id = `pair-${++n}`;
      registry.set(id, b);
      mine = a;
      count += 1;
      queueMicrotask(() => sendSignal({ type: "offer", sdp: id }));
    }
    return {
      link,
      async handleSignal(s) {
        if (s.type === "offer" && !initiator) {
          const b = registry.get(s.sdp);
          if (!b) { reject(new Error("unknown offer")); return; }
          registry.delete(s.sdp);
          mine = b;
          resolve(b);
          sendSignal({ type: "answer", sdp: s.sdp });
        } else if (s.type === "answer" && initiator && mine) {
          resolve(mine);
        }
      },
      close() { mine?.close(); reject(new Error("closed")); },
    };
  };
  return { openLink, opened: () => count };
}
