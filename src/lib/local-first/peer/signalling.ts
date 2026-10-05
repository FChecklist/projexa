// LOCAL-FIRST PEERS: signalling -- how two laptops of one organisation find each other and swap the few small messages
// (presence, the WebRTC offer/answer, ICE candidates) needed before their data channel opens. NEVER data: rows only ever travel
// over the data channel itself (protocol.ts), behind a verified hello.
//
// Providers, cheapest that works:
//   (a) supabase   Supabase Realtime broadcast + presence on channel `px:<channel>`, with PROJEXA's own Supabase client.
//                  Free-plan quota; carries only a handful of tiny messages per connection.
//   (b) local      BroadcastChannel, for tabs/windows of one browser. Costs nothing and needs no network, so it ALWAYS runs
//                  alongside whichever remote provider won (it would otherwise win every race and hide the other laptops).
//   (c) ntfy       a FREE public fallback for when OUR server is down: ntfy.sh topics derived from the channel (SSE subscribe,
//                  plain HTTP publish, no account). Messages are AES-GCM encrypted with a key derived from the channel name
//                  (which itself is not guessable without our server key), rate-limited and size-capped.
// The remote providers are tried IN PARALLEL and the first that connects wins; the others are closed at once.
//
// Everything is injected (the Supabase client, BroadcastChannel, EventSource, fetch, the clock), so tests run with fakes.

import { b64url, fromB64url, sha256Hex } from "./verify";
import type { RtcSignal } from "./transport";

export const MAX_SIGNAL_BYTES = 3800; // ntfy.sh refuses messages above 4096 bytes; the other providers get the same cap

export type SignalEnvelope = {
  /** Unique per message: the hub drops a message it has already seen (it can arrive by two providers). */
  id: string;
  from: string;
  /** Absent = everyone on the channel. */
  to?: string;
  kind: "announce" | "rtc" | "leave";
  rtc?: RtcSignal;
};

export type SignalConnection = {
  readonly name: string;
  send(m: SignalEnvelope): void;
  onmessage: ((m: SignalEnvelope) => void) | null;
  onclose: (() => void) | null;
  close(): void;
};

export type SignalProvider = {
  readonly name: string;
  connect(channel: string, selfId: string): Promise<SignalConnection>;
};

export function newId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return b64url(b);
}

export function parseEnvelope(raw: unknown): SignalEnvelope | null {
  let v = raw;
  if (typeof v === "string") {
    if (v.length > MAX_SIGNAL_BYTES * 2) return null;
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.from !== "string" || o.from.length > 64 || o.id.length > 64) return null;
  if (o.to !== undefined && typeof o.to !== "string") return null;
  if (o.kind !== "announce" && o.kind !== "rtc" && o.kind !== "leave") return null;
  if (o.kind === "rtc") {
    const r = o.rtc as Record<string, unknown> | undefined;
    if (!r || (r.type !== "offer" && r.type !== "answer" && r.type !== "ice")) return null;
  }
  return o as SignalEnvelope;
}

const fits = (m: SignalEnvelope) => new TextEncoder().encode(JSON.stringify(m)).length <= MAX_SIGNAL_BYTES;

// ─── (a) Supabase Realtime ──────────────────────────────────────────────────────────────────────────

/** The part of a supabase-js RealtimeChannel this provider uses. */
export type RealtimeChannelLike = {
  on(type: "broadcast", filter: { event: string }, cb: (msg: { payload?: unknown }) => void): RealtimeChannelLike;
  on(type: "presence", filter: { event: "join" }, cb: (msg: { key?: string }) => void): RealtimeChannelLike;
  subscribe(cb: (status: string) => void): unknown;
  send(msg: { type: "broadcast"; event: string; payload: unknown }): Promise<unknown> | unknown;
  track?(state: Record<string, unknown>): Promise<unknown> | unknown;
  unsubscribe(): Promise<unknown> | unknown;
};
export type RealtimeClientLike = { channel(name: string, opts?: Record<string, unknown>): RealtimeChannelLike; removeChannel?(ch: RealtimeChannelLike): unknown };

export function supabaseRealtimeProvider(getClient: () => RealtimeClientLike, opts: { timeoutMs?: number } = {}): SignalProvider {
  return {
    name: "supabase",
    connect(channel, selfId) {
      return new Promise<SignalConnection>((resolve, reject) => {
        let client: RealtimeClientLike;
        try { client = getClient(); } catch (e) { reject(e); return; }
        const ch = client.channel(`px:${channel}`, { config: { broadcast: { self: false }, presence: { key: selfId } } });
        let settled = false;
        let closed = false;
        const conn: SignalConnection = {
          name: "supabase",
          send(m) { if (!closed && fits(m)) void Promise.resolve(ch.send({ type: "broadcast", event: "sig", payload: m })).catch(() => {}); },
          onmessage: null,
          onclose: null,
          close() {
            if (closed) return;
            closed = true;
            try {
              if (client.removeChannel) client.removeChannel(ch);
              else void ch.unsubscribe();
            } catch { /* gone */ }
          },
        };
        ch.on("broadcast", { event: "sig" }, (msg) => { const e = parseEnvelope(msg.payload); if (e) conn.onmessage?.(e); });
        ch.on("presence", { event: "join" }, (msg) => {
          if (msg.key && msg.key !== selfId) conn.onmessage?.({ id: `join:${msg.key}:${Date.now()}`, from: msg.key, kind: "announce" });
        });
        const timer = setTimeout(() => { if (!settled) { settled = true; conn.close(); reject(new Error("supabase: timed out")); } }, opts.timeoutMs ?? 10_000);
        ch.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            void Promise.resolve(ch.track?.({ at: Date.now() })).catch(() => {});
            resolve(conn);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            clearTimeout(timer);
            if (!settled) { settled = true; conn.close(); reject(new Error(`supabase: ${status}`)); }
            else if (!closed) { conn.close(); conn.onclose?.(); }
          }
        });
      });
    },
  };
}

// ─── (b) BroadcastChannel ───────────────────────────────────────────────────────────────────────────

export function broadcastChannelProvider(Impl: typeof BroadcastChannel | undefined = (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel): SignalProvider {
  return {
    name: "local",
    async connect(channel) {
      if (!Impl) throw new Error("local: no BroadcastChannel");
      const bc = new Impl(`px:${channel}`);
      let closed = false;
      const conn: SignalConnection = {
        name: "local",
        send(m) { if (!closed && fits(m)) bc.postMessage(m); },
        onmessage: null,
        onclose: null,
        close() { if (!closed) { closed = true; bc.close(); } },
      };
      bc.onmessage = (ev) => { const e = parseEnvelope(ev.data); if (e) conn.onmessage?.(e); };
      return conn;
    },
  };
}

// ─── (c) ntfy.sh ────────────────────────────────────────────────────────────────────────────────────

export type EventSourceLike = { onopen: ((ev: unknown) => void) | null; onmessage: ((ev: { data: string }) => void) | null; onerror: ((ev: unknown) => void) | null; close(): void };

export type NtfyOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  EventSourceImpl?: new (url: string) => EventSourceLike;
  now?: () => number;
  /** Token bucket: at most `burst` publishes at once, refilled at one per `refillMs`. */
  burst?: number;
  refillMs?: number;
  timeoutMs?: number;
};

/** The ntfy topic for a channel: not the channel itself (so the Realtime name never appears on a public service). */
export async function ntfyTopic(channel: string): Promise<string> {
  return "px" + (await sha256Hex(`px-ntfy-topic|${channel}`)).slice(0, 40);
}

async function channelKey(channel: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`px-ntfy-key|${channel}`));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sealSignal(key: CryptoKey, m: SignalEnvelope): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(m))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64url(out);
}

export async function openSignal(key: CryptoKey, text: string): Promise<SignalEnvelope | null> {
  try {
    const bytes = fromB64url(text);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return parseEnvelope(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}

export function ntfyProvider(options: NtfyOptions = {}): SignalProvider {
  const base = (options.baseUrl ?? "https://ntfy.sh").replace(/\/+$/, "");
  const now = options.now ?? (() => Date.now());
  const burst = options.burst ?? 20;
  const refillMs = options.refillMs ?? 3000;
  return {
    name: "ntfy",
    async connect(channel) {
      const ES = options.EventSourceImpl ?? (globalThis as { EventSource?: new (url: string) => EventSourceLike }).EventSource;
      const doFetch = options.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
      if (!ES) throw new Error("ntfy: no EventSource");
      const topic = await ntfyTopic(channel);
      const key = await channelKey(channel);
      let tokens = burst;
      let last = now();
      const take = () => {
        const t = now();
        tokens = Math.min(burst, tokens + (t - last) / refillMs);
        last = t;
        if (tokens < 1) return false;
        tokens -= 1;
        return true;
      };
      return new Promise<SignalConnection>((resolve, reject) => {
        const es = new ES(`${base}/${topic}/sse`);
        let opened = false;
        let closed = false;
        const conn: SignalConnection = {
          name: "ntfy",
          send(m) {
            if (closed || !fits(m) || !take()) return; // over the cap or the rate: dropped (signalling retries on the next announce)
            void sealSignal(key, m).then((body) => doFetch(`${base}/${topic}`, { method: "POST", body })).catch(() => {});
          },
          onmessage: null,
          onclose: null,
          close() { if (!closed) { closed = true; es.close(); } },
        };
        const timer = setTimeout(() => { if (!opened) { conn.close(); reject(new Error("ntfy: timed out")); } }, options.timeoutMs ?? 10_000);
        es.onopen = () => { if (!opened) { opened = true; clearTimeout(timer); resolve(conn); } };
        es.onerror = () => {
          if (!opened) { clearTimeout(timer); conn.close(); reject(new Error("ntfy: unreachable")); }
          // after open, EventSource reconnects on its own; nothing to do
        };
        es.onmessage = (ev) => {
          let outer: { event?: string; message?: string };
          try { outer = JSON.parse(ev.data); } catch { return; }
          if (outer.event !== "message" || typeof outer.message !== "string" || outer.message.length > MAX_SIGNAL_BYTES * 2) return;
          void openSignal(key, outer.message).then((e) => { if (e) conn.onmessage?.(e); });
        };
      });
    },
  };
}

/**
 * The remote providers the app races, in one place (peer-shared.ts uses it; so does the real-browser test of "Supabase down -> ntfy",
 * e2e/lf-peer-ntfy.spec.ts, so the list it proves is the list that ships): Supabase Realtime first, ntfy.sh as the free fallback.
 */
export function remoteSignalProviders(getClient: () => RealtimeClientLike, ntfy: NtfyOptions = {}): SignalProvider[] {
  return [supabaseRealtimeProvider(getClient), ntfyProvider(ntfy)];
}

// ─── the race and the hub ───────────────────────────────────────────────────────────────────────────

/** Starts every provider at once; the first to connect wins and the rest are closed. Rejects only when all of them fail. */
export async function connectFirst(providers: SignalProvider[], channel: string, selfId: string): Promise<SignalConnection> {
  if (providers.length === 0) throw new Error("no signalling provider");
  return new Promise<SignalConnection>((resolve, reject) => {
    let winner: SignalConnection | null = null;
    let failures = 0;
    for (const p of providers) {
      p.connect(channel, selfId).then(
        (c) => {
          if (winner) { c.close(); return; }
          winner = c;
          resolve(c);
        },
        () => {
          failures += 1;
          if (failures === providers.length) reject(new Error("every signalling provider failed"));
        },
      );
    }
  });
}

export type SignalHub = {
  /** Connects the local providers and races the remote ones (again, if the last winner closed). Returns the remote winner's name or null. */
  ensure(): Promise<string | null>;
  send(m: Omit<SignalEnvelope, "id" | "from">): void;
  onmessage: ((m: SignalEnvelope) => void) | null;
  readonly remote: string | null;
  close(): void;
};

export function createSignalHub(o: { channel: string; selfId: string; remote: SignalProvider[]; local?: SignalProvider[] }): SignalHub {
  const seen: string[] = [];
  const seenSet = new Set<string>();
  let remote: SignalConnection | null = null;
  let locals: SignalConnection[] | null = null;
  let racing: Promise<string | null> | null = null;
  let closed = false;

  const deliver = (m: SignalEnvelope) => {
    if (m.from === o.selfId || (m.to !== undefined && m.to !== o.selfId)) return;
    if (seenSet.has(m.id)) return;
    seenSet.add(m.id);
    seen.push(m.id);
    if (seen.length > 512) seenSet.delete(seen.shift()!);
    hub.onmessage?.(m);
  };

  const hub: SignalHub = {
    onmessage: null,
    get remote() { return remote?.name ?? null; },
    async ensure() {
      if (closed) return null;
      if (!locals) {
        locals = [];
        for (const p of o.local ?? []) {
          try { const c = await p.connect(o.channel, o.selfId); c.onmessage = deliver; locals.push(c); } catch { /* no local channel: fine */ }
        }
      }
      if (remote) return remote.name;
      if (!racing) {
        racing = connectFirst(o.remote, o.channel, o.selfId)
          .then((c) => {
            if (closed) { c.close(); return null; }
            remote = c;
            c.onmessage = deliver;
            c.onclose = () => { if (remote === c) remote = null; };
            return c.name;
          })
          .catch(() => null)
          .finally(() => { racing = null; });
      }
      return racing;
    },
    send(partial) {
      const m: SignalEnvelope = { ...partial, id: newId(), from: o.selfId };
      remote?.send(m);
      for (const l of locals ?? []) l.send(m);
    },
    close() {
      closed = true;
      remote?.close();
      remote = null;
      for (const l of locals ?? []) l.close();
      locals = [];
    },
  };
  return hub;
}
