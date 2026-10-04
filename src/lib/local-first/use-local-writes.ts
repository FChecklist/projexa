"use client";

// LOCAL-FIRST: what a screen needs to show edits that are still on their way to the server.
//
//   created   rows made on this laptop that the server has not confirmed yet (temporary id): a list shows them at the
//             top with a "saved on this laptop, syncing" marker, and they vanish when the real row replaces them;
//   edits     record id -> the merged parameters of that record's pending edits: an Object Page overlays them on the
//             data it loaded from the server (which does not have them yet) and shows the same marker.
//
// The view refreshes whenever the outbox changes. `onApplied` fires when an op of this kind and project was applied, so
// the screen can re-read the server's row (the marker disappears because the op is gone).
//
// With the local-first flag off, or nobody signed in, the hook does nothing at all: no import, no database, an empty view.

import { useEffect, useRef, useState } from "react";
import { localDbNameFor, openLocalDb } from "./local-db";
import { isLocalFirstEnabled, resolveLocalUserId } from "./local-reader";
import type { LocalWriteAccess } from "./local-writes";

export type PendingRow<T = unknown> = { id: string; data: T; opId: string };

export type LocalWritesView<T = unknown> = {
  created: PendingRow<T>[];
  edits: Map<string, Record<string, unknown>>;
  pendingCount: number;
};

const EMPTY: LocalWritesView = { created: [], edits: new Map(), pendingCount: 0 };

export function useLocalWrites<T = unknown>(
  kind: string,
  projectId: string | null | undefined,
  /** `onApplied` receives WHICH record was applied: an Object Page reloads only for its own record (data:F5). */
  options: { onApplied?: (applied: { recordId: string | null; created: boolean; opId: string }) => void; access?: LocalWriteAccess } = {}
): LocalWritesView<T> {
  const [view, setView] = useState<LocalWritesView>(EMPTY);
  const onApplied = useRef(options.onApplied);
  useEffect(() => { onApplied.current = options.onApplied; });
  const accessRef = useRef(options.access);
  useEffect(() => { accessRef.current = options.access; });

  useEffect(() => {
    if (!projectId || !isLocalFirstEnabled()) {
      setView(EMPTY);
      return;
    }
    let cancelled = false;
    let unsubscribe: () => void = () => {};

    (async () => {
      const access = accessRef.current;
      const userId = access?.userId ?? (await resolveLocalUserId());
      if (!userId || cancelled) return;
      const idb = access?.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
      if (!idb) return;
      const outbox = access?.outbox ?? (await import("./outbox-shared")).getSharedOutbox(userId);
      if (cancelled) return;

      const load = async () => {
        const ops = (await outbox.listPending()).filter((op) => op.projectId === projectId);
        const created: PendingRow[] = [];
        const edits = new Map<string, Record<string, unknown>>();
        const db = await openLocalDb(idb, localDbNameFor(userId));
        try {
          for (const op of ops) {
            if (op.creates?.kind === kind) {
              const row = await db.getRecord(kind, op.creates.id);
              if (row) created.push({ id: op.creates.id, data: row.data, opId: op.opId });
            } else if (op.record?.kind === kind) {
              edits.set(op.record.id, { ...(edits.get(op.record.id) ?? {}), ...op.params });
            }
          }
        } finally {
          db.close();
        }
        if (!cancelled) setView({ created, edits, pendingCount: ops.length });
      };

      await load();
      unsubscribe = outbox.subscribe((event) => {
        if (event.type === "applied" && event.projectId === projectId && event.kind === kind) onApplied.current?.({ recordId: event.recordId, created: event.created, opId: event.opId });
        if (event.type === "changed" || event.type === "applied" || event.type === "rejected" || event.type === "conflict") void load().catch(() => {});
      });
    })().catch(() => {
      /* the screen simply shows no pending edits */
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [kind, projectId]);

  return view as LocalWritesView<T>;
}
