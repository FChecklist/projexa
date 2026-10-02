"use client";

// LOCAL-FIRST browser AI: the one component that makes PROJEXA available to the person's browser AI on every signed-in
// page (mounted once in src/app/(app)/layout.tsx). Nothing for the person to set up (R11, R12):
//   * window.projexa.ai + WebMCP tools as soon as the person is known (attach.ts);
//   * the static manual inside the page: <script type="application/json" id="px-ai-manual"> (no personal data);
//   * the one-click confirmation of a delete the AI asked for (AiDraftConfirm) -- the ONLY way a draft is confirmed.
// A failure here never breaks the page: the AI doors simply stay closed.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { resolveLocalUserId } from "../local-reader";
import type { AiSurface } from "./api";
import type { AiDraft, DraftStore } from "./drafts";
import { buildManual } from "./manual";

/** The manual as safe inline JSON: `<` is escaped so no value can close the script element. */
export function inlineManualJson(): string {
  return JSON.stringify(buildManual()).replace(/</g, "\\u003c");
}

export function AiManualScript() {
  const json = useMemo(() => inlineManualJson(), []);
  return <script type="application/json" id="px-ai-manual" dangerouslySetInnerHTML={{ __html: json }} />;
}

const EMPTY: AiDraft[] = [];

function useDrafts(store: DraftStore | null): AiDraft[] {
  return useSyncExternalStore(
    (cb) => (store ? store.subscribe(cb) : () => {}),
    () => (store ? cachedList(store) : EMPTY),
    () => EMPTY,
  );
}

// useSyncExternalStore needs the same array back until something changed.
const lists = new WeakMap<DraftStore, { key: string; list: AiDraft[] }>();
function cachedList(store: DraftStore): AiDraft[] {
  const list = store.list();
  const key = list.map((d) => d.draftId).join("|");
  const cached = lists.get(store);
  if (cached && cached.key === key) return cached.list;
  lists.set(store, { key, list });
  return list;
}

/** Runs `fn` only for an event the browser itself produced from a real person's input (a script cannot set isTrusted). */
export function onlyTrusted(event: { isTrusted: boolean }, fn: () => void): boolean {
  if (!event.isTrusted) return false;
  fn();
  return true;
}

/**
 * The person's one-click answer to a delete their AI asked for. A confirm is honoured only from a REAL user event
 * (event.isTrusted): a script -- the AI included -- cannot click this button for the person.
 */
export function AiDraftConfirm({ surface }: { surface: Pick<AiSurface, "drafts" | "confirmDraft" | "discardDraft"> | null }) {
  const drafts = useDrafts(surface?.drafts ?? null);
  const [message, setMessage] = useState<string | null>(null);
  if (!surface || (drafts.length === 0 && !message)) return null;
  return (
    <section role="region" aria-label="Requests from your AI" className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2 rounded-lg border bg-white p-3 text-sm shadow-lg" style={{ borderColor: "var(--color-ct-border, #ddd)" }}>
      {drafts.map((d) => (
        <div key={d.draftId} role="group" aria-label={d.summary} className="flex flex-col gap-2">
          <p>{d.summary} Nothing is removed until you confirm.</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border px-3 py-1 font-medium"
              aria-label={`Confirm: ${d.label}`}
              onClick={(event) => onlyTrusted(event, () => {
                surface.confirmDraft(d.draftId).then((r) => setMessage(r.message), (err: unknown) => setMessage(err instanceof Error ? err.message : "That could not be done."));
              })}
            >
              Yes, do it
            </button>
            <button type="button" className="rounded border px-3 py-1" aria-label={`Keep it: do not ${d.label.toLowerCase()}`} onClick={(event) => onlyTrusted(event, () => surface.discardDraft(d.draftId))}>
              Keep it
            </button>
          </div>
        </div>
      ))}
      {message ? (
        <p role="status">
          {message}{" "}
          <button type="button" className="underline" aria-label="Dismiss this message" onClick={() => setMessage(null)}>OK</button>
        </p>
      ) : null}
    </section>
  );
}

export function AiAttach() {
  const [surface, setSurface] = useState<AiSurface | null>(null);
  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;
    (async () => {
      const userId = await resolveLocalUserId();
      if (!userId || cancelled || typeof window === "undefined" || typeof indexedDB === "undefined") return;
      const [{ attachAi }, { createSharedSyncClient }] = await Promise.all([import("./attach"), import("../shared-client")]);
      const attached = await attachAi({
        userId,
        win: window as unknown as Parameters<typeof attachAi>[0]["win"],
        nav: navigator as unknown as Parameters<typeof attachAi>[0]["nav"],
        idb: indexedDB,
        caches: typeof caches === "undefined" ? null : caches,
        // The outbox starts only when the AI actually writes something.
        outbox: { enqueue: async (input) => (await import("../outbox-shared")).getSharedOutbox(userId).enqueue(input) },
        fetchManifest: () => createSharedSyncClient({ timeoutMs: 10_000, maxRetries: 0 }).manifest(),
        onTamper: (report) => console.error("[projexa] AI access switched off: the installed release does not match its recorded fingerprints", report.problems),
      });
      if (cancelled) { attached.detach(); return; }
      detach = attached.detach;
      setSurface(attached.surface);
    })().catch(() => { /* the AI doors stay closed; the app is unaffected */ });
    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);
  return (
    <>
      <AiManualScript />
      <AiDraftConfirm surface={surface} />
    </>
  );
}
