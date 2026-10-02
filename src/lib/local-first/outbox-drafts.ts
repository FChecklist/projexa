"use client";

// LOCAL-FIRST: "Edit again" for a draft (what a person typed for an edit that did not reach the server, outbox.ts).
//
//   draftHref(draft)   the screen that edits that kind of change, with `?draft=<opId>`: the form opens filled with the text
//   useDraft(opId)     a form reads the draft named in its URL; after it is saved again (on the laptop or online) the form
//                      calls clear(), which removes the draft and its notice. A draft is only ever removed by the person:
//                      re-sending it, or "Discard".
//
// A draft of a function no screen edits yet has no href: its card shows the text itself so the person can copy it.

import { useEffect, useState } from "react";
import { isLocalFirstEnabled, resolveLocalUserId } from "./local-reader";
import type { LocalWriteAccess } from "./local-writes";
import type { OutboxDraft } from "./local-db";

const OP_ID = /^[A-Za-z0-9_-]{1,80}$/;
const enc = encodeURIComponent;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Where the person edits this draft again, or null when no screen edits that kind of change. */
export function draftHref(draft: Pick<OutboxDraft, "opId" | "functionId" | "projectId" | "params" | "record">): string | null {
  const d = `draft=${enc(draft.opId)}`;
  switch (draft.functionId) {
    case "create_rfi":
      return `/rfis/new?projectId=${enc(draft.projectId)}&${d}`;
    case "answer_rfi": {
      const id = str(draft.params.rfiId) ?? draft.record?.id ?? null;
      return id ? `/rfis/${enc(id)}?${d}` : null;
    }
    case "update_task": {
      const id = str(draft.params.issueId) ?? draft.record?.id ?? null;
      return id ? `/schedule/tasks/${enc(id)}?${d}` : null;
    }
    default:
      return null;
  }
}

/** The draft's free text, for a card that has no screen to open (so the person can still copy what they wrote). */
export function draftText(draft: Pick<OutboxDraft, "params">): string {
  return Object.entries(draft.params)
    .filter(([k, v]) => typeof v === "string" && v.trim() && !/(^id$|Id$|_id$|Date$|_date$)/.test(k))
    .map(([, v]) => v as string)
    .join("\n\n");
}

export type DraftView = { draft: OutboxDraft | null; clear: () => Promise<void> };

/** The draft a form was opened with (`?draft=<opId>`), or null. With the flag off, or no such draft, it is always null. */
export function useDraft(opId: string | null | undefined, options: { access?: LocalWriteAccess } = {}): DraftView {
  const [draft, setDraft] = useState<OutboxDraft | null>(null);
  const access = options.access;

  useEffect(() => {
    setDraft(null);
    if (!opId || !OP_ID.test(opId)) return;
    let cancelled = false;
    (async () => {
      const outbox = access?.outbox ?? (isLocalFirstEnabled() ? await (async () => {
        const userId = access?.userId ?? (await resolveLocalUserId());
        return userId ? (await import("./outbox-shared")).getSharedOutbox(userId) : null;
      })() : null);
      if (!outbox || cancelled) return;
      const found = await outbox.getDraft(opId);
      if (!cancelled) setDraft(found ?? null);
    })().catch(() => { /* no draft: the form opens empty, as it always did */ });
    return () => { cancelled = true; };
    // `access` is chosen once per mount (tests); a different one is a different mount.
  }, [opId]);

  const clear = async () => {
    if (!draft) return;
    try {
      const outbox = access?.outbox ?? (await (async () => {
        const userId = access?.userId ?? (await resolveLocalUserId());
        return userId ? (await import("./outbox-shared")).getSharedOutbox(userId) : null;
      })());
      await outbox?.discardDraft(draft.opId);
    } catch { /* it stays listed; the person can discard it from the card */ }
    setDraft(null);
  };

  return { draft, clear };
}
