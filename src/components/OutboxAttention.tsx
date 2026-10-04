"use client";

// LOCAL-FIRST: the one place that tells a person when something they did on this laptop needs them. It renders NOTHING
// unless the local-first flag is on AND there is something to say, so with the flag off the app looks exactly as before.
//
//   not saved (a draft)          ONE card per change the server turned down (or that was stopped): what was not saved and
//                                why, in plain words, with "Edit again" (the form opens filled with what they typed) and
//                                "Discard". Nothing a person typed is lost without them choosing to discard it (FB data:F4)
//   a conflict                   only the fields BOTH sides changed differently (the rest merged by itself, R12): what each
//                                side says, and "Keep theirs" / "Keep mine"
//   deleted by someone else      "Keep my version as a new one" (or "Keep my text") / "Discard" (data:F6)
//   checking                     the server could not confirm a change yet: re-asked a few times, said in one line (data:F7)
//   needs you                    re-asking stopped: "Send again" / "Stop and keep my text"
//   needs the online screen      this laptop cannot send it by itself: "Keep my text and stop"
//   waiting                      offline / signed out / not linked any more / "update PROJEXA" -- and that nothing is lost
//   storage                      the browser refused to keep this site's storage: one quiet sentence (data:F13)
//
// Mounted once, in (app)/layout.tsx, as a small card in the bottom-right corner.

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useOutboxState } from "@/lib/local-first/use-outbox-state";
import { draftHref, draftText } from "@/lib/local-first/outbox-drafts";
import type { Outbox, OutboxConflict, ResolveChoice } from "@/lib/local-first/outbox";
import type { OutboxDraft } from "@/lib/local-first/local-db";

const ID_LIKE = /(^id$|Id$|_id$|At$|_at$|^number$|^sig$|^kid$|^version$)/;

function humanise(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const isScalar = (v: unknown): v is string | number | boolean | null => v === null || ["string", "number", "boolean"].includes(typeof v);
const show = (v: unknown) => (v === null || v === "" ? "empty" : String(v));
const snake = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/**
 * The fields that differ between my row and the server's, in words (scalars only, never an id). At most four. With `only`,
 * just those fields (a field and its snake_case twin are the same field) -- the ones the person actually has to decide.
 */
export function differences(local: unknown, server: unknown, only?: string[]): { label: string; mine: string; theirs: string }[] {
  if (typeof local !== "object" || local === null || typeof server !== "object" || server === null) return [];
  const a = local as Record<string, unknown>;
  const b = server as Record<string, unknown>;
  const wanted = only && only.length ? new Set(only.flatMap((f) => [f, snake(f)])) : null;
  const out: { label: string; mine: string; theirs: string }[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (wanted && !wanted.has(key)) continue;
    if (!wanted && ID_LIKE.test(key)) continue;
    if (!isScalar(a[key] ?? null) || !isScalar(b[key] ?? null)) continue;
    if ((a[key] ?? null) !== (b[key] ?? null)) out.push({ label: humanise(key), mine: show(a[key] ?? null), theirs: show(b[key] ?? null) });
    if (out.length === 4) break;
  }
  return out;
}

function useAct() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    setFailed(null);
    try {
      await run();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, failed, act };
}

function ConflictRow({ conflict, outbox }: { conflict: OutboxConflict; outbox: Outbox }) {
  const { busy, failed, act } = useAct();
  const decide = (choice: ResolveChoice) => act(() => outbox.resolve(conflict.opId, choice));

  if (conflict.kind === "deleted") {
    return (
      <li className="space-y-1.5 border-t border-black/10 pt-2" data-testid="outbox-deleted">
        <p className="font-medium text-px-ink">
          {conflict.label ? `${conflict.label}: this` : "This"} was deleted by someone else while you were working, so your change could not be saved.
        </p>
        <div className="flex flex-wrap gap-2">
          {conflict.canRecreate ? (
            <Button size="sm" disabled={busy} onClick={() => void decide("keep_as_new")}>Keep my version as a new one</Button>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => void decide("keep_text")}>Keep my text</Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide("discard")}>Discard</Button>
        </div>
        {failed ? <p role="alert" className="text-px-error">{failed}</p> : null}
      </li>
    );
  }

  const diff = differences(conflict.local, conflict.server?.data, conflict.fields);
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

function DraftCard({ draft, outbox }: { draft: OutboxDraft; outbox: Outbox }) {
  const { busy, failed, act } = useAct();
  const href = draftHref(draft);
  const text = href ? "" : draftText(draft);
  return (
    <div className="space-y-1.5 border-t border-black/10 pt-2 first:border-t-0 first:pt-0" data-testid="outbox-draft">
      <p role="alert" className="text-px-ink">{draft.message}</p>
      <p className="text-px-muted">What you typed is kept on this laptop until you send it again or discard it.</p>
      {text ? <p className="max-h-24 overflow-auto whitespace-pre-wrap rounded border border-black/10 p-1.5 text-px-muted" data-testid="outbox-draft-text">{text}</p> : null}
      <div className="flex flex-wrap gap-2">
        {href ? (
          <Button size="sm" asChild><Link href={href}>Edit again</Link></Button>
        ) : text && typeof navigator !== "undefined" && navigator.clipboard ? (
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(text).catch(() => {})}>Copy text</Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => outbox.discardDraft(draft.opId))}>Discard</Button>
      </div>
      {failed ? <p role="alert" className="text-px-error">{failed}</p> : null}
    </div>
  );
}

export function OutboxAttention({ outbox: injected }: { outbox?: Outbox } = {}) {
  const view = useOutboxState({ outbox: injected });
  if (!view) return null;
  const { outbox, state } = view;
  const changes = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;
  const checking = state.checking ?? [];
  const attention = state.attention ?? [];
  const drafts = state.drafts ?? [];

  const waitingLine =
    state.updateRequired
      ? "PROJEXA on this laptop must be updated before your changes can be sent. Nothing is lost."
      : state.status === "not_linked" && state.pending > 0
        ? `The server no longer recognises your sign-in as a person in your organisation, so ${changes(state.pending)} made on this laptop ${state.pending === 1 ? "is" : "are"} waiting. Nothing is lost. Ask your administrator, then try again.`
        : state.status === "signed_out" && state.pending > 0
          ? `You are signed out. Sign in again to send ${changes(state.pending)} made on this laptop.`
          : state.status === "offline" && state.pending > 0
            ? `Offline: ${state.pending} ${state.pending === 1 ? "change is" : "changes are"} saved on this laptop and will be sent when the connection returns.`
            : null;

  const storageLine = state.storageWarning && (state.pending > 0 || drafts.length > 0)
    ? "This browser may clear what is saved on this laptop if it runs short of space. Installing PROJEXA as an app keeps it safer."
    : null;

  // A notice that has a draft is said by the draft's card (one card per change, never two).
  const draftIds = new Set(drafts.map((d) => d.opId));
  const notices = state.notices.filter((n) => !draftIds.has(n.opId));

  const nothing = !waitingLine && !storageLine && state.conflicts.length === 0 && state.blocked.length === 0 && notices.length === 0
    && drafts.length === 0 && checking.length === 0 && attention.length === 0;
  if (nothing) return null;

  return (
    <section aria-label="Changes made on this laptop" data-testid="outbox-attention" className="fixed bottom-4 right-4 z-[90] max-w-sm space-y-2 rounded-lg border border-black/10 bg-white p-3 text-[13px] shadow-lg">
      {waitingLine ? <p role="status" className="text-px-muted">{waitingLine}</p> : null}
      {state.status === "not_linked" ? (
        <Button size="sm" variant="outline" onClick={() => outbox.resume()}>Try again</Button>
      ) : null}

      {checking.map((c) => <p key={c.opId} className="text-px-muted" data-testid="outbox-checking">{c.message}</p>)}

      {drafts.map((d) => <DraftCard key={d.opId} draft={d} outbox={outbox} />)}

      {notices.map((n) => (
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

      {attention.map((a) => (
        <div key={a.opId} className="space-y-1.5 border-t border-black/10 pt-2" data-testid="outbox-needs-you">
          <p className="text-px-ink">{a.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void outbox.retry(a.opId)}>Send again</Button>
            <Button size="sm" variant="outline" onClick={() => void outbox.discard(a.opId)}>Stop and keep my text</Button>
          </div>
        </div>
      ))}

      {state.blocked.map((b) => (
        <div key={b.opId} className="flex items-start justify-between gap-2 border-t border-black/10 pt-2" data-testid="outbox-blocked">
          <p className="text-px-ink">{b.message}</p>
          <Button size="sm" variant="outline" onClick={() => void outbox.discard(b.opId)}>Keep my text and stop</Button>
        </div>
      ))}

      {storageLine ? <p className="text-px-muted" data-testid="outbox-storage">{storageLine}</p> : null}
    </section>
  );
}
