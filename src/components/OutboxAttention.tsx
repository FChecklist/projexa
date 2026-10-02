"use client";

// LOCAL-FIRST: the one place that tells a person when something they did on this laptop needs them. It renders NOTHING
// unless the local-first flag is on AND there is something to say, so with the flag off the app looks exactly as before.
//
//   a change was turned down     the sentence from the outbox (in plain words) and a Dismiss
//   a conflict                   somebody else changed the same thing while the person worked: what each side says, and the
//                                two choices -- "Keep theirs" (drop my change) or "Keep mine" (send it over theirs)
//   a change that needs the      this laptop cannot send it by itself: Discard (the change is undone here)
//   online screen
//   waiting                      offline / signed out / "update PROJEXA" -- and that nothing is lost
//
// Mounted once, in (app)/layout.tsx, as a small card in the bottom-right corner.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useOutboxState } from "@/lib/local-first/use-outbox-state";
import type { Outbox, OutboxConflict } from "@/lib/local-first/outbox";

const ID_LIKE = /(^id$|Id$|_id$|At$|_at$|^number$|^sig$|^kid$|^version$)/;

function humanise(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const isScalar = (v: unknown): v is string | number | boolean | null => v === null || ["string", "number", "boolean"].includes(typeof v);
const show = (v: unknown) => (v === null || v === "" ? "empty" : String(v));

/** The fields that differ between my row and the server's, in words (scalars only, never an id). At most four. */
export function differences(local: unknown, server: unknown): { label: string; mine: string; theirs: string }[] {
  if (typeof local !== "object" || local === null || typeof server !== "object" || server === null) return [];
  const a = local as Record<string, unknown>;
  const b = server as Record<string, unknown>;
  const out: { label: string; mine: string; theirs: string }[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (ID_LIKE.test(key) || !isScalar(a[key] ?? null) || !isScalar(b[key] ?? null)) continue;
    if ((a[key] ?? null) !== (b[key] ?? null)) out.push({ label: humanise(key), mine: show(a[key] ?? null), theirs: show(b[key] ?? null) });
    if (out.length === 4) break;
  }
  return out;
}

function ConflictRow({ conflict, outbox }: { conflict: OutboxConflict; outbox: Outbox }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const diff = differences(conflict.local, conflict.server.data);
  const decide = async (choice: "keep_theirs" | "keep_mine") => {
    setBusy(true);
    setFailed(null);
    try {
      await outbox.resolve(conflict.opId, choice);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="space-y-1.5 border-t border-black/10 pt-2" data-testid="outbox-conflict">
      <p className="font-medium text-px-ink">
        {conflict.label ? `${conflict.label}: someone` : "Someone"} else changed the same thing while you were working.
      </p>
      {diff.length > 0 ? (
        <ul className="space-y-0.5 text-px-muted">
          {diff.map((d) => <li key={d.label}>{d.label}: you wrote <b>{d.mine}</b>, they wrote <b>{d.theirs}</b></li>)}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide("keep_theirs")}>Keep theirs</Button>
        <Button size="sm" disabled={busy} onClick={() => void decide("keep_mine")}>Keep mine</Button>
      </div>
      {failed ? <p role="alert" className="text-px-error">{failed}</p> : null}
    </li>
  );
}

export function OutboxAttention({ outbox: injected }: { outbox?: Outbox } = {}) {
  const view = useOutboxState({ outbox: injected });
  if (!view) return null;
  const { outbox, state } = view;

  const waitingLine =
    state.updateRequired
      ? "PROJEXA on this laptop must be updated before your changes can be sent. Nothing is lost."
      : state.status === "signed_out" && state.pending > 0
        ? `You are signed out. Sign in again to send ${state.pending} ${state.pending === 1 ? "change" : "changes"} made on this laptop.`
        : state.status === "offline" && state.pending > 0
          ? `Offline: ${state.pending} ${state.pending === 1 ? "change is" : "changes are"} saved on this laptop and will be sent when the connection returns.`
          : null;

  const nothing = !waitingLine && state.conflicts.length === 0 && state.blocked.length === 0 && state.notices.length === 0;
  if (nothing) return null;

  return (
    <section aria-label="Changes made on this laptop" data-testid="outbox-attention" className="fixed bottom-4 right-4 z-[90] max-w-sm space-y-2 rounded-lg border border-black/10 bg-white p-3 text-[13px] shadow-lg">
      {waitingLine ? <p role="status" className="text-px-muted">{waitingLine}</p> : null}

      {state.notices.map((n) => (
        <div key={n.opId} className="flex items-start justify-between gap-2 border-t border-black/10 pt-2 first:border-t-0 first:pt-0" data-testid="outbox-notice">
          <p role="alert" className="text-px-ink">{n.message}</p>
          <Button size="sm" variant="ghost" onClick={() => void outbox.dismissNotice(n.opId)}>Dismiss</Button>
        </div>
      ))}

      {state.conflicts.length > 0 ? (
        <ul className="space-y-2">
          {state.conflicts.map((c) => <ConflictRow key={c.opId} conflict={c} outbox={outbox} />)}
        </ul>
      ) : null}

      {state.blocked.map((b) => (
        <div key={b.opId} className="flex items-start justify-between gap-2 border-t border-black/10 pt-2" data-testid="outbox-blocked">
          <p className="text-px-ink">{b.message}</p>
          <Button size="sm" variant="outline" onClick={() => void outbox.discard(b.opId)}>Discard</Button>
        </div>
      ))}
    </section>
  );
}
