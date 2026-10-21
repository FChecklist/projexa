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

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { GuidedPanel, type PanelAction } from "@/components/GuidedPanel";
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

// GUIDED ERRORS (G4): every card below is the same four-part panel the rest of the app uses -- what happened, why, what to do, the exact place to
// fix it -- with the card's own buttons as its actions. The panel's `ctx.route` is only used for the report and the way back.
const here = (): { route: string; search: string } => {
  if (typeof window === "undefined") return { route: "/", search: "" };
  return { route: window.location.pathname, search: window.location.search };
};

function ConflictRow({ conflict, outbox }: { conflict: OutboxConflict; outbox: Outbox }) {
  const { busy, failed, act } = useAct();
  const decide = (choice: ResolveChoice) => act(() => outbox.resolve(conflict.opId, choice));
  const screen = here();

  if (conflict.kind === "deleted") {
    const actions: PanelAction[] = [
      conflict.canRecreate
        ? { id: "keep-new", primary: true, label: "Keep my version as a new one", disabled: busy, onClick: () => void decide("keep_as_new") }
        : { id: "keep-text", primary: true, label: "Keep my text", disabled: busy, onClick: () => void decide("keep_text") },
      { id: "discard", label: "Discard", disabled: busy, onClick: () => void decide("discard") },
    ];
    return (
      <li data-testid="outbox-deleted">
        <GuidedPanel
          ctx={{ ...screen, code: "OUTBOX_DELETED", serverMessage: `${conflict.label ? `${conflict.label}: this` : "This"} was deleted by someone else while you were working, so your change could not be saved.` }}
          actions={actions}
          noCopy
        >
          {failed ? <p role="alert" className="text-px-error">{failed}</p> : null}
        </GuidedPanel>
      </li>
    );
  }

  const diff = differences(conflict.local, conflict.server?.data, conflict.fields);
  return (
    <li data-testid="outbox-conflict">
      <GuidedPanel
        ctx={{ ...screen, code: "OUTBOX_CONFLICT", serverMessage: `${conflict.label ? `${conflict.label}: someone` : "Someone"} else changed the same thing while you were working.` }}
        actions={[
          { id: "keep-theirs", label: "Keep theirs", disabled: busy, onClick: () => void decide("keep_theirs") },
          { id: "keep-mine", primary: true, label: "Keep mine", disabled: busy, onClick: () => void decide("keep_mine") },
        ]}
        noCopy
      >
        {diff.length > 0 ? (
          <ul className="space-y-0.5 text-px-muted">
            {diff.map((d) => <li key={d.label}>{d.label}: you wrote <b>{d.mine}</b>, they wrote <b>{d.theirs}</b></li>)}
          </ul>
        ) : null}
        {failed ? <p role="alert" className="text-px-error">{failed}</p> : null}
      </GuidedPanel>
    </li>
  );
}

/** The values the person typed, each with its field's name, for the "what you typed" block of a refused change. */
function typedValues(params: Record<string, unknown>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (ID_LIKE.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out.push({ label: humanise(k), value: String(v) });
    else if (typeof v === "string" && v.trim() !== "") out.push({ label: humanise(k), value: v });
    if (out.length === 8) break;
  }
  return out;
}

function DraftCard({ draft, outbox }: { draft: OutboxDraft; outbox: Outbox }) {
  const { busy, failed, act } = useAct();
  const href = draftHref(draft);
  const text = href ? "" : draftText(draft);
  const typed = typedValues(draft.params);
  const screen = here();
  const fix = href
    ? {
        label: draft.openAt ? "Go to it and re-enter your values" : "Edit again",
        href,
        where: draft.subject ? `${draft.label ?? "The change"} > ${draft.subject}` : draft.label ?? "The screen that edits it",
        focus: undefined as string | undefined,
      }
    : null;
  return (
    <div data-testid="outbox-draft">
      <GuidedPanel
        ctx={{ ...screen, code: "OUTBOX_REFUSED", serverMessage: draft.message }}
        title={draft.label ? `${draft.label} was not saved` : "A change was not saved"}
        what={draft.message}
        fix={fix}
        noCopy
        actions={[
          ...(!href && text && typeof navigator !== "undefined" && navigator.clipboard ? [{ id: "copy-text", primary: true, label: "Copy text", onClick: () => void navigator.clipboard.writeText(text).catch(() => {}) } as PanelAction] : []),
          { id: "discard", label: "Discard", disabled: busy, onClick: () => void act(() => outbox.discardDraft(draft.opId)) },
        ]}
      >
        {draft.subject ? <p data-testid="outbox-draft-subject"><span className="font-medium">Which one: </span>{draft.subject}</p> : null}
        <p className="text-px-muted">What you typed is kept on this laptop until you send it again or discard it.</p>
        {typed.length > 0 && href ? (
          <dl data-testid="outbox-draft-values" className="rounded border border-black/10 bg-white/60 p-1.5">
            {typed.map((t) => <div key={t.label} className="flex gap-2"><dt className="text-px-muted">{t.label}:</dt><dd className="font-medium">{t.value}</dd></div>)}
          </dl>
        ) : null}
        {text ? <p className="max-h-24 overflow-auto whitespace-pre-wrap rounded border border-black/10 p-1.5 text-px-muted" data-testid="outbox-draft-text">{text}</p> : null}
        {failed ? <p role="alert" className="text-px-error">{failed}</p> : null}
      </GuidedPanel>
    </div>
  );
}

// A turned-down change is REPORTED once: after the person has had the card in front of them and moved to another screen, it is
// marked as reported (kept on this device, so a reload or a replay of the same rejection does not raise it again) and its
// notice is dismissed. What they typed stays saved in the draft store; only the repeated message stops.
const REPORTED_KEY = "px.outbox.reported-rejections";
function readReported(): Set<string> {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(REPORTED_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
function writeReported(ids: Set<string>): void {
  try {
    localStorage.setItem(REPORTED_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    /* storage refused: the in-memory set still stops repeats for this visit */
  }
}

export function OutboxAttention({ outbox: injected, path: pathProp }: { outbox?: Outbox; path?: string } = {}) {
  const view = useOutboxState({ outbox: injected });
  const livePath = usePathname();
  const path = pathProp ?? livePath ?? "";
  const [reported, setReported] = useState<Set<string>>(() => readReported());
  const shown = useRef<Set<string>>(new Set());
  const lastPath = useRef(path);
  const outboxRef = useRef<Outbox | null>(null);
  const activeOutbox = view?.outbox ?? null;
  useEffect(() => {
    outboxRef.current = activeOutbox;
  }, [activeOutbox]);

  useEffect(() => {
    if (lastPath.current === path) return;
    lastPath.current = path;
    const ids = [...shown.current];
    shown.current = new Set();
    if (ids.length === 0) return;
    setReported((prev) => {
      const next = new Set([...prev, ...ids]);
      writeReported(next);
      return next;
    });
    for (const id of ids) void outboxRef.current?.dismissNotice(id).catch(() => {});
  }, [path]);

  const visibleDrafts = (view?.state.drafts ?? []).filter((d) => !reported.has(d.opId));
  const visibleNotices = (view?.state.notices ?? []).filter((n) => !reported.has(n.opId) && !(view?.state.drafts ?? []).some((d) => d.opId === n.opId));
  useEffect(() => {
    for (const d of visibleDrafts) shown.current.add(d.opId);
    for (const n of visibleNotices) shown.current.add(n.opId);
  });

  if (!view) return null;
  const { outbox, state } = view;
  const changes = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;
  const checking = state.checking ?? [];
  const attention = state.attention ?? [];
  const drafts = visibleDrafts;

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
  const notices = visibleNotices;

  const nothing = !waitingLine && !storageLine && state.conflicts.length === 0 && state.blocked.length === 0 && notices.length === 0
    && drafts.length === 0 && checking.length === 0 && attention.length === 0;
  if (nothing) return null;

  const screen = here();
  const waitingCode = state.updateRequired ? "OUTBOX_UPDATE_REQUIRED" : state.status === "not_linked" ? "OUTBOX_NOT_LINKED" : state.status === "signed_out" ? "OUTBOX_SIGNED_OUT" : "OUTBOX_OFFLINE";

  return (
    <section aria-label="Changes made on this laptop" data-testid="outbox-attention" className="fixed bottom-4 right-4 z-[90] max-h-[85vh] w-[26rem] max-w-[calc(100vw-2rem)] space-y-2 overflow-auto rounded-lg border border-black/10 bg-white p-3 text-[13px] shadow-lg">
      {waitingLine ? (
        <div data-testid="outbox-waiting">
          <GuidedPanel
            ctx={{ ...screen, code: waitingCode, serverMessage: waitingLine }}
            noCopy
            actions={state.status === "not_linked" ? [{ id: "retry", label: "Try again", primary: true, onClick: () => outbox.resume() }] : []}
          />
        </div>
      ) : null}

      {checking.map((c) => (
        <div key={c.opId} data-testid="outbox-checking">
          <GuidedPanel ctx={{ ...screen, code: "OUTBOX_CHECKING", serverMessage: c.message }} noCopy />
        </div>
      ))}

      {drafts.map((d) => <DraftCard key={d.opId} draft={d} outbox={outbox} />)}

      {notices.map((n) => (
        <div key={n.opId} data-testid="outbox-notice">
          <GuidedPanel
            ctx={{ ...screen, code: "OUTBOX_REFUSED", serverMessage: n.message }}
            title="A change was not saved"
            what={n.message}
            noCopy
            actions={[{ id: "dismiss", label: "Dismiss", onClick: () => void outbox.dismissNotice(n.opId) }]}
          />
        </div>
      ))}

      {state.conflicts.length > 0 ? (
        <ul className="space-y-2">
          {state.conflicts.map((c) => <ConflictRow key={c.opId} conflict={c} outbox={outbox} />)}
        </ul>
      ) : null}

      {attention.map((a) => (
        <div key={a.opId} data-testid="outbox-needs-you">
          <GuidedPanel
            ctx={{ ...screen, code: "OUTBOX_NEEDS_YOU", serverMessage: a.message }}
            noCopy
            actions={[
              { id: "send-again", primary: true, label: "Send again", onClick: () => void outbox.retry(a.opId) },
              { id: "stop", label: "Stop and keep my text", onClick: () => void outbox.discard(a.opId) },
            ]}
          />
        </div>
      ))}

      {state.blocked.map((b) => (
        <div key={b.opId} data-testid="outbox-blocked">
          <GuidedPanel
            ctx={{ ...screen, code: "OUTBOX_BLOCKED", serverMessage: b.message }}
            noCopy
            actions={[{ id: "stop", primary: true, label: "Keep my text and stop", onClick: () => void outbox.discard(b.opId) }]}
          />
        </div>
      ))}

      {storageLine ? (
        <div data-testid="outbox-storage">
          <GuidedPanel ctx={{ ...screen, code: "STORAGE_SHORT", serverMessage: storageLine }} noCopy />
        </div>
      ) : null}
    </section>
  );
}
