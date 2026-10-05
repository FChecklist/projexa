// LOCAL-FIRST PEERS (AUDIT-100 B22): which ICE servers a laptop gives its RTCPeerConnection.
//
// Two laptops on the SAME network reach each other directly (host candidates). On different home networks the free public STUN
// servers (transport.ts DEFAULT_ICE_SERVERS) usually find a direct path too. Behind a symmetric / carrier-grade NAT no direct path
// exists at all: the only way through is a TURN relay, which carries the (already end-to-end encrypted) data channel and is billed.
//
// So TURN is OPT-IN and owner-configured, and NO relay secret ever sits in the browser bundle:
//   * NEXT_PUBLIC_PEER_ICE_URL (build time, not a secret) names an endpoint that hands a SIGNED-IN person short-lived relay
//     credentials (TURN REST credentials expire by design: Cloudflare Realtime TURN's generate-ice-servers, metered.ca's
//     /turn/credentials, or our own sync service). It is called with the person's own access token.
//   * Unset (today's default): STUN only, and not one extra request -- exactly the behaviour before B22.
//   * The answer is checked before use: only stun:/turn:/turns: addresses, string credentials, at most 8 servers. Anything else, a
//     failure, or being offline means STUN only; the laptop keeps working and keeps syncing through the server.
// Credentials stay in memory only (never IndexedDB / localStorage): they are short-lived, and a laptop that restarts offline cannot
// reach a relay on the internet anyway.

import { DEFAULT_ICE_SERVERS } from "./transport";

export type IceSourceOptions = {
  /** The credential endpoint (NEXT_PUBLIC_PEER_ICE_URL). Empty / undefined: STUN only, never a request. */
  url?: string | null;
  /** The signed-in person's access token (Authorization: Bearer). null: signed out, no request. */
  token: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  isOnline?: () => boolean;
  /** Always offered alongside what the endpoint returns (default: the free public STUN servers). */
  base?: RTCIceServer[];
};

export type IceSource = {
  /** What to give a new RTCPeerConnection right now (synchronous: links open from signalling callbacks). */
  peek(): RTCIceServer[];
  /** Fetches fresh credentials when none are held or they are close to expiry. Never throws. */
  refresh(): Promise<void>;
  /** True while relay credentials are held (diagnostics, tests). */
  hasRelay(): boolean;
};

const MAX_SERVERS = 8;
/** When the endpoint gives no ttl. Cloudflare and metered default to a day; an hour keeps a leaked credential short-lived. */
const DEFAULT_TTL_S = 3600;
/** Refresh this long before expiry, and wait this long after a failure before asking again. */
const EARLY_MS = 5 * 60_000;
const RETRY_MS = 5 * 60_000;

/** Keeps only well-formed ICE servers: stun:/turn:/turns: urls, string username/credential. Returns [] for anything else. */
export function sanitizeIceServers(input: unknown): RTCIceServer[] {
  const list = Array.isArray(input) ? input : input && typeof input === "object" ? [input] : [];
  const out: RTCIceServer[] = [];
  for (const s of list) {
    if (!s || typeof s !== "object") continue;
    const raw = (s as { urls?: unknown }).urls;
    const urls = (Array.isArray(raw) ? raw : [raw]).filter((u): u is string => typeof u === "string" && /^(stun|turns?):[^\s]{1,250}$/i.test(u));
    if (urls.length === 0) continue;
    const { username, credential } = s as { username?: unknown; credential?: unknown };
    const needsAuth = urls.some((u) => /^turns?:/i.test(u));
    if (needsAuth && (typeof username !== "string" || typeof credential !== "string")) continue; // a relay without credentials is useless
    out.push({ urls, ...(typeof username === "string" ? { username } : {}), ...(typeof credential === "string" ? { credential } : {}) });
    if (out.length >= MAX_SERVERS) break;
  }
  return out;
}

/** Reads the endpoint's answer: `{ iceServers: [...] | {...}, ttl? }` (Cloudflare, our service) or a bare array (metered.ca). */
export function parseIceAnswer(body: unknown): { servers: RTCIceServer[]; ttlS: number } {
  const b = body as { iceServers?: unknown; ice_servers?: unknown; ttl?: unknown } | unknown[] | null;
  const servers = sanitizeIceServers(Array.isArray(b) ? b : b && typeof b === "object" ? (b.iceServers ?? b.ice_servers) : null);
  const ttl = !Array.isArray(b) && b && typeof b === "object" && typeof b.ttl === "number" && b.ttl > 0 ? b.ttl : DEFAULT_TTL_S;
  return { servers, ttlS: Math.min(ttl, 86_400) };
}

export function createIceSource(o: IceSourceOptions): IceSource {
  const base = o.base ?? DEFAULT_ICE_SERVERS;
  const now = o.now ?? (() => Date.now());
  const url = (o.url ?? "").trim();
  let relay: RTCIceServer[] = [];
  let expiresAt = 0;
  let nextTry = 0;
  let inflight: Promise<void> | null = null;

  const live = () => relay.length > 0 && now() < expiresAt;

  async function fetchOnce(): Promise<void> {
    try {
      const token = await o.token();
      if (!token) return;
      const res = await (o.fetchImpl ?? fetch)(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) { nextTry = now() + RETRY_MS; return; }
      const { servers, ttlS } = parseIceAnswer(await res.json());
      if (servers.length === 0) { nextTry = now() + RETRY_MS; return; }
      relay = servers;
      expiresAt = now() + ttlS * 1000;
    } catch {
      nextTry = now() + RETRY_MS;
    }
  }

  return {
    peek() { return live() ? [...base, ...relay] : base.slice(); },
    hasRelay: live,
    refresh() {
      if (!url) return Promise.resolve();
      if (o.isOnline && !o.isOnline()) return Promise.resolve();
      if (live() && now() < expiresAt - EARLY_MS) return Promise.resolve();
      if (now() < nextTry) return Promise.resolve();
      if (!inflight) inflight = fetchOnce().finally(() => { inflight = null; });
      return inflight;
    },
  };
}
