// TEST ONLY: in-memory stand-ins for Supabase Realtime and ntfy.sh, each can be "down".

import type { EventSourceLike, RealtimeChannelLike, RealtimeClientLike } from "../signalling";

/** A fake Supabase Realtime: every client on the same bus sees the others' broadcasts on the same channel name. */
export function createFakeRealtime(o: { down?: boolean; delayMs?: number } = {}) {
  const channels = new Map<string, Set<{ fire: (payload: unknown) => void; join: (key: string) => void; key: string }>>();
  const subscribed: Array<(status: string) => void> = [];
  const state = { down: o.down ?? false, sent: 0 };
  /** Our server goes down under live channels: every subscribed channel is told CLOSED. */
  const kill = () => { state.down = true; channels.clear(); for (const cb of subscribed.splice(0)) cb("CLOSED"); };
  const client = (): RealtimeClientLike => ({
    channel(name, opts) {
      const key = ((opts?.config as { presence?: { key?: string } })?.presence?.key) ?? "";
      let onB: ((m: { payload?: unknown }) => void) | null = null;
      let onJ: ((m: { key?: string }) => void) | null = null;
      const member = { key, fire: (p: unknown) => onB?.({ payload: p }), join: (k: string) => onJ?.({ key: k }) };
      const ch: RealtimeChannelLike = {
        on(type: string, _f: unknown, cb: (m: never) => void) {
          if (type === "broadcast") onB = cb as typeof onB;
          else onJ = cb as typeof onJ;
          return ch;
        },
        subscribe(cb) {
          setTimeout(() => {
            if (state.down) return cb("CHANNEL_ERROR");
            let set = channels.get(name);
            if (!set) channels.set(name, (set = new Set()));
            for (const m of set) { m.join(key); member.join(m.key); }
            set.add(member);
            subscribed.push(cb);
            cb("SUBSCRIBED");
          }, o.delayMs ?? 1);
          return ch;
        },
        send(msg) {
          state.sent += 1;
          for (const m of channels.get(name) ?? []) if (m !== member) setTimeout(() => m.fire(msg.payload), 0);
        },
        track: () => undefined,
        unsubscribe() { channels.get(name)?.delete(member); },
      } as RealtimeChannelLike;
      return ch;
    },
  });
  return { client, state, channels, kill };
}

/** A fake ntfy.sh: SSE subscribers per topic; a POST is delivered to every subscriber of the topic (the sender included, like ntfy). */
export function createFakeNtfy(o: { down?: boolean } = {}) {
  const subs = new Map<string, Set<EventSourceLike>>();
  const state = { down: o.down ?? false, posts: [] as Array<{ url: string; body: string }> };
  class ES implements EventSourceLike {
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    private topic: string;
    constructor(url: string) {
      this.topic = url.replace(/^https:\/\/ntfy\.sh\//, "").replace(/\/sse$/, "");
      setTimeout(() => {
        if (state.down) return this.onerror?.({});
        let s = subs.get(this.topic);
        if (!s) subs.set(this.topic, (s = new Set()));
        s.add(this);
        this.onopen?.({});
      }, 2);
    }
    close() { subs.get(this.topic)?.delete(this); }
  }
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (state.down) throw new Error("down");
    const body = String(init?.body ?? "");
    state.posts.push({ url, body });
    const topic = url.replace(/^https:\/\/ntfy\.sh\//, "");
    for (const es of subs.get(topic) ?? []) setTimeout(() => es.onmessage?.({ data: JSON.stringify({ event: "message", message: body }) }), 0);
    return new Response("{}");
  }) as unknown as typeof fetch;
  return { EventSourceImpl: ES, fetchImpl, state, subs };
}
