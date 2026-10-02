// OPTIONAL presence: which colleagues of the organisation are online right now (Supabase Realtime presence on the
// organisation channel named by POST /attest). Nothing waits on it: the claim loop and the requester never read it,
// a channel that fails to connect is simply an empty list, and the hook renders at once.
import { useEffect, useState } from "react";

export type Colleague = { userId: string; name?: string };

/** What a presence source gives us (a Supabase channel adapter, or a fake in tests). */
export type PresenceSource = {
  /** Calls back with the full current list whenever it changes. */
  onSync(cb: (online: Colleague[]) => void): void;
  /** Announces this person; the promise may never settle and nothing depends on it. */
  track(me: Colleague): Promise<unknown>;
  close(): void;
};

/** Starts presence without ever throwing or blocking. Returns a stop function. */
export function startPresence(connect: () => PresenceSource | null | Promise<PresenceSource | null>, me: Colleague, onChange: (online: Colleague[]) => void): () => void {
  let stopped = false;
  let source: PresenceSource | null = null;
  void (async () => {
    try {
      const s = await connect();
      if (!s) return;
      if (stopped) return s.close();
      source = s;
      s.onSync((online) => { if (!stopped) onChange(online.filter((c) => c.userId !== me.userId)); });
      void s.track(me).catch(() => undefined);
    } catch {
      /* presence is a nicety: no list, no problem */
    }
  })();
  return () => {
    stopped = true;
    try { source?.close(); } catch { /* ignore */ }
  };
}

/** The online colleagues (never including yourself). `[]` until, or unless, presence connects. */
export function useOnlineColleagues(connect: () => PresenceSource | null | Promise<PresenceSource | null>, me: Colleague | null): Colleague[] {
  const [online, setOnline] = useState<Colleague[]>([]);
  const meId = me?.userId ?? null;
  useEffect(() => {
    if (!meId) return;
    return startPresence(connect, { userId: meId, name: me?.name }, setOnline);
  }, [meId]);
  return online;
}
