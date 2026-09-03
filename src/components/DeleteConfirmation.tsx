"use client";

// R67 D-67 -- the confirm step every destructive control on an object page
// was missing.
//
// WHAT THE AUDIT ASKED FOR. R-257: "Add Delete to Scope, Materials,
// Documents, Drawings and MoMs through the existing DELETE proxies with a
// confirm naming the blast radius ('Delete permit BP-2026-0142 and its PDF?
// This cannot be undone.')."
//
// WHAT IS ACTUALLY THERE. Four of the five already have a real Delete wired
// to a real endpoint -- Scope deletes a draft BOQ, Drawings and Documents
// dispose the record and its file, Materials deactivates. The missing half
// is the confirm, and it is missing in the one place it cannot be added
// per-screen: the kit's ObjectScreen renders the Delete button itself and
// calls `onDelete()` straight from onClick
// (node_modules/@fchecklist/veridian-ui-kit/src/screens/ObjectScreen.tsx),
// so ONE CLICK disposes a drawing and its file. There is no confirm on any
// of the four.
//
// WHY THIS AND NOT A KIT CHANGE OR A FORK. Programme decision D-09 forbids
// a kit release, and forking ObjectScreen for four screens would mean
// re-implementing its edit-mode, field-renderer, lock and message machinery
// -- a large rewrite to add one card. Instead the screens pass an onDelete
// that ARMS this confirmation, and render its card in the children they
// already own. The kit is untouched, the destructive call is reached only
// through a second, deliberate click, and the sentence naming what is about
// to be destroyed comes from the tested deleteConfirmation() helper.
//
// NOT A MODAL, deliberately. PROJEXA's one remaining popup was removed by
// D-01 and this is not the place to add a new one -- the card renders in
// the page, above the record it is about to remove, so the user can still
// see what they are deleting while they decide.

import { useCallback, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteConfirmation } from "@/lib/create-screen";

export type UseDeleteConfirmationOptions = {
  /** "Permit", "Drawing", "BOQ" -- the noun in the sentence and the button. */
  objectLabel: string;
  /** What the user would recognise: a permit number, a drawing name. */
  identifier: string | null | undefined;
  /** What goes with it: "and its PDF", "and its uploaded file". */
  extra?: string | null;
  /** The word on the confirming button, where "Delete" is not what happens. */
  verb?: string;
  /** The real destructive call. Only ever reached from the second click. */
  run: () => void | Promise<void>;
};

export type DeleteConfirmationHandle = {
  /** Pass as the object screen's `onDelete`. Arms the card; destroys nothing. */
  request: () => void;
  /** Render inside the screen's own children. Null until armed. */
  card: React.ReactNode;
  /** True while the destructive call is in flight. */
  running: boolean;
};

export function useDeleteConfirmation({
  objectLabel,
  identifier,
  extra,
  verb = "Delete",
  run,
}: UseDeleteConfirmationOptions): DeleteConfirmationHandle {
  const [armed, setArmed] = useState(false);
  const [running, setRunning] = useState(false);

  const request = useCallback(() => setArmed(true), []);

  const confirm = useCallback(async () => {
    setRunning(true);
    try {
      await run();
    } finally {
      setRunning(false);
      setArmed(false);
    }
  }, [run]);

  const card = armed ? (
    <DeleteConfirmationCard
      sentence={deleteConfirmation(objectLabel, identifier, extra)}
      confirmLabel={`${verb} ${objectLabel.toLowerCase()}`}
      running={running}
      onConfirm={() => void confirm()}
      onCancel={() => setArmed(false)}
    />
  ) : null;

  return { request, card, running };
}

export function DeleteConfirmationCard({
  sentence,
  confirmLabel,
  running,
  onConfirm,
  onCancel,
}: {
  sentence: string;
  confirmLabel: string;
  running: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="Confirm delete"
      className="m-4 rounded-lg border border-px-error-border bg-px-error-light p-4 text-sm"
    >
      <p className="flex items-start gap-2 text-px-error">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {sentence}
      </p>
      <div className="mt-3 flex items-center gap-2 pl-6">
        {/* The destructive word is on the button that DOES it, never on the
            one that backs out -- and Cancel is what the Escape-shaped
            instinct lands on, so it sits second and is not the primary. */}
        <Button size="sm" variant="outline" disabled={running} onClick={onConfirm}>
          {running ? "Working…" : confirmLabel}
        </Button>
        <Button size="sm" variant="ghost" disabled={running} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default DeleteConfirmationCard;
