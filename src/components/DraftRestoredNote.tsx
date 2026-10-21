"use client";

// GUIDED ERRORS (G3): shown above a form whose values were put back from an earlier visit, so a restored form is never a silent surprise.
// "Start fresh" throws the saved entries away. Used with useFormDraft (src/lib/guided-form.ts).

import type { FormDraft } from "@/lib/guided-form";

export function DraftRestoredNote({ draft }: { draft: Pick<FormDraft, "restored" | "startFresh"> }) {
  if (!draft.restored) return null;
  return (
    <p role="status" data-testid="draft-restored" className="rounded-md border border-px-info-border bg-px-info-light px-3 py-2 text-sm text-px-info">
      What you typed before has been put back. {" "}
      <button type="button" className="underline underline-offset-2" onClick={draft.startFresh} data-testid="draft-start-fresh">
        Start fresh
      </button>
    </p>
  );
}

export default DraftRestoredNote;
