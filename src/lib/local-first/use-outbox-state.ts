"use client";

// LOCAL-FIRST: the outbox's state as a React value (pending count, conflicts, blocked ops, notices, status), for the one
// component that tells the person when something needs them (OutboxAttention). With the local-first flag off, or nobody
// signed in, it returns null and loads nothing.

import { useEffect, useState } from "react";
import { isLocalFirstEnabled, resolveLocalUserId } from "./local-reader";
import type { LocalWriteAccess } from "./local-writes";
import type { Outbox, OutboxState } from "./outbox";

export type OutboxView = { outbox: Outbox; state: OutboxState };

export function useOutboxState(options: { outbox?: Outbox; access?: LocalWriteAccess } = {}): OutboxView | null {
  const [view, setView] = useState<OutboxView | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: () => void = () => {};

    (async () => {
      let outbox = options.outbox ?? options.access?.outbox ?? null;
      if (!outbox) {
        if (!isLocalFirstEnabled()) return;
        const userId = options.access?.userId ?? (await resolveLocalUserId());
        if (!userId || cancelled) return;
        outbox = (await import("./outbox-shared")).getSharedOutbox(userId);
      }
      if (cancelled) return;
      const live = outbox;
      const state = await live.refresh();
      if (cancelled) return;
      setView({ outbox: live, state });
      unsubscribe = live.subscribe(() => { if (!cancelled) setView({ outbox: live, state: live.getState() }); });
    })().catch(() => {
      /* nothing to show */
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // The outbox is chosen once per mount; a different one is a different mount.
  }, []);

  return view;
}
