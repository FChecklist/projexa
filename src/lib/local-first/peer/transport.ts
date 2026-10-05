// LOCAL-FIRST PEERS: the pipe between two laptops. Data goes over a WebRTC data channel, straight from one browser to the other.
//
// COST FIRST: by default only free public STUN servers (they tell a browser its public address; no data passes through them) and NO
// TURN relay (a TURN server carries the data and is billed). When two laptops cannot reach each other directly (a symmetric /
// carrier-grade NAT), there is simply no peer link, the peer marker says so in one plain sentence, and they keep syncing through
// Supabase, as CONTRACT.md section 4 says. AUDIT-100 B22: an owner-configured relay (ice.ts, NEXT_PUBLIC_PEER_ICE_URL, short-lived
// credentials fetched per signed-in person, never a secret in the bundle) is added to `iceServers` when present; proven in a real
// browser with relay-only candidates by e2e/lf-peer-relay.spec.ts.
//
// Signalling (who wants to talk, the SDP offer/answer and ICE candidates) is NOT done here: the caller passes `sendSignal` and
// feeds the answers back through `handleSignal` (signalling.ts carries them over Supabase Realtime, BroadcastChannel or ntfy).
//
// `createMemoryLinkPair` is the in-memory transport the tests use: two linked ends, asynchronous delivery, an optional tap.

export type PeerLink = {
  readonly open: boolean;
  send(text: string): void;
  onmessage: ((text: string) => void) | null;
  onclose: (() => void) | null;
  close(): void;
};

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

/**
 * A PeerLink whose messages that arrive before anyone listens are held (up to 256) and handed over the moment `onmessage` is
 * set: the far end may say hello before this end has attached its session.
 */
export function bufferedLink(impl: { open: () => boolean; send: (t: string) => void; close: () => void }): PeerLink & { deliver(text: string): void } {
  let handler: ((text: string) => void) | null = null;
  const held: string[] = [];
  return {
    get open() { return impl.open(); },
    send: (t) => impl.send(t),
    close: () => impl.close(),
    onclose: null,
    get onmessage() { return handler; },
    set onmessage(h) {
      handler = h;
      while (h && held.length) h(held.shift()!);
    },
    deliver(text) {
      if (handler) handler(text);
      else if (held.length < 256) held.push(text);
    },
  };
}

/** The signalling payloads a WebRTC link exchanges. */
export type RtcSignal =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit | null };

export type RtcHandle = {
  /** Resolves with the link once its data channel is open; rejects when it fails or times out. */
  link: Promise<PeerLink>;
  handleSignal(signal: RtcSignal): Promise<void>;
  close(): void;
};

export type RtcOptions = {
  initiator: boolean;
  sendSignal: (signal: RtcSignal) => void;
  iceServers?: RTCIceServer[];
  /** "relay": only TURN-relayed candidates (tests use it to prove the relay path; the app leaves it "all"). */
  iceTransportPolicy?: RTCIceTransportPolicy;
  /** Injected for tests / non-browser runtimes. Defaults to the global RTCPeerConnection. */
  RTCPeerConnectionImpl?: typeof RTCPeerConnection;
  openTimeoutMs?: number;
};

/** A link over one RTCDataChannel ("px", ordered, reliable). */
export function createRtcLink(options: RtcOptions): RtcHandle {
  const Impl = options.RTCPeerConnectionImpl ?? (globalThis as { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection;
  if (!Impl) {
    return { link: Promise.reject(new Error("This browser cannot make direct connections.")), handleSignal: async () => {}, close: () => {} };
  }
  const pc = new Impl({ iceServers: options.iceServers ?? DEFAULT_ICE_SERVERS, ...(options.iceTransportPolicy ? { iceTransportPolicy: options.iceTransportPolicy } : {}) });
  let closed = false;
  const pendingIce: RTCIceCandidateInit[] = [];
  let remoteSet = false;

  let resolveLink!: (l: PeerLink) => void;
  let rejectLink!: (e: Error) => void;
  const link = new Promise<PeerLink>((res, rej) => { resolveLink = res; rejectLink = rej; });
  link.catch(() => {});

  const close = () => {
    if (closed) return;
    closed = true;
    try { pc.close(); } catch { /* already gone */ }
    rejectLink(new Error("closed"));
  };

  const timer = setTimeout(() => { if (!opened) { close(); } }, options.openTimeoutMs ?? 30_000);
  let opened = false;

  const wire = (dc: RTCDataChannel) => {
    const l = bufferedLink({
      open: () => dc.readyState === "open" && !closed,
      send: (text) => { if (dc.readyState === "open") dc.send(text); },
      close: () => { try { dc.close(); } catch { /* gone */ } close(); },
    });
    dc.onmessage = (e) => { if (typeof e.data === "string") l.deliver(e.data); };
    dc.onclose = () => { l.onclose?.(); close(); };
    dc.onopen = () => { opened = true; clearTimeout(timer); resolveLink(l); };
  };

  pc.onicecandidate = (e) => { if (!closed) options.sendSignal({ type: "ice", candidate: e.candidate ? e.candidate.toJSON() : null }); };
  pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" || pc.connectionState === "closed") close(); };

  if (options.initiator) {
    wire(pc.createDataChannel("px", { ordered: true }));
    void (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        options.sendSignal({ type: "offer", sdp: offer.sdp ?? "" });
      } catch { close(); }
    })();
  } else {
    pc.ondatachannel = (e) => { if (e.channel.label === "px") wire(e.channel); };
  }

  async function flushIce() {
    while (pendingIce.length) {
      try { await pc.addIceCandidate(pendingIce.shift()!); } catch { /* a stale candidate is harmless */ }
    }
  }

  return {
    link,
    async handleSignal(signal) {
      if (closed) return;
      try {
        if (signal.type === "offer" && !options.initiator) {
          await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
          remoteSet = true;
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          options.sendSignal({ type: "answer", sdp: answer.sdp ?? "" });
          await flushIce();
        } else if (signal.type === "answer" && options.initiator && !remoteSet) {
          await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
          remoteSet = true;
          await flushIce();
        } else if (signal.type === "ice" && signal.candidate) {
          if (remoteSet) await pc.addIceCandidate(signal.candidate).catch(() => {});
          else if (pendingIce.length < 64) pendingIce.push(signal.candidate);
        }
      } catch {
        close();
      }
    },
    close,
  };
}

/** Two linked in-memory ends (tests). `tap` sees, and may rewrite or drop (return null), every message from a to b. */
export function createMemoryLinkPair(options: { tapAtoB?: (text: string) => string | null; tapBtoA?: (text: string) => string | null } = {}): [PeerLink, PeerLink] {
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    queueMicrotask(() => { a.onclose?.(); b.onclose?.(); });
  };
  // a and b refer to each other only inside callbacks that run later, so both can be const
  const a: ReturnType<typeof bufferedLink> = bufferedLink({ open: () => open, close, send: (t) => { const x = options.tapAtoB ? options.tapAtoB(t) : t; if (x !== null) setTimeout(() => b.deliver(x), 0); } });
  const b: ReturnType<typeof bufferedLink> = bufferedLink({ open: () => open, close, send: (t) => { const x = options.tapBtoA ? options.tapBtoA(t) : t; if (x !== null) setTimeout(() => a.deliver(x), 0); } });
  return [a, b];
}
