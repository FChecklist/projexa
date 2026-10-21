"use client";

// GUIDED ERRORS G1 -- the panel for a button that failed (Submit, Approve, Delete, Save title, Confirm baseline, Import ...) or a screen that could not
// load. It keeps the error exactly as it was caught (status, code, call, the server's words) so the catalogue picks the right guide, adds the entity
// the screen is about (so "Open the BOQ" goes to THIS BOQ), and, when the server's words name an input, takes the person to it.
// Same inline role="alert" panel as everywhere else; never a toast.

import { useEffect, useMemo } from "react";
import { GuidedError } from "@/components/GuidedError";
import { contextFromError } from "@/lib/error-guide/context";
import { findFocusTarget, highlightElement } from "@/lib/error-guide/focus";

export type ActionFailureState = {
  err: unknown;
  /** The input the failure is about, when the screen or the server's words can name one (a DOM id). */
  field?: string;
  /** Overrides the words of the error (a screen that built a fuller sentence). */
  message?: string;
  /** Distinguishes two failures with the same words, so the panel is brought into view again. */
  at?: number;
  /** Repeats exactly the action that failed ("Try again"); offered only when the guide says trying again is honest. */
  retry?: () => void;
};

export function ActionFailurePanel({
  failure,
  entityType,
  entityId,
  projectId,
  onRetry,
  retryable,
  draftKey,
  className,
  sentence,
  quiet,
}: {
  failure: ActionFailureState | null;
  entityType?: string;
  entityId?: string;
  projectId?: string;
  onRetry?: () => void;
  retryable?: boolean;
  draftKey?: string;
  className?: string;
  /** The screen's own complete sentence for what happened; it replaces the guide's one-line "what happened" (the steps and the fix stay the guide's). */
  sentence?: string;
  /** A state of the screen, not a failure that just happened: not written to the device log (see GuidedError). */
  quiet?: boolean;
}) {
  const ctx = useMemo(
    () => (failure ? contextFromError(failure.err, { entityType, entityId, projectId, ...(failure.field ? { field: failure.field } : {}), ...(failure.message ? { serverMessage: failure.message } : {}) }) : null),
    [failure, entityType, entityId, projectId]
  );

  useEffect(() => {
    if (!failure?.field) return;
    const el = findFocusTarget(failure.field);
    if (el) highlightElement(el);
  }, [failure]);

  if (!ctx) return null;
  return <GuidedError ctx={ctx} message={sentence} onRetry={failure?.retry ?? onRetry} retryable={retryable} draftKey={draftKey} className={className} quiet={quiet} />;
}

export default ActionFailurePanel;

/** A failure the screen itself knows by name (no request was made): a missing project, a missing approved BOQ, an unconfirmed save. */
export function codedFailure(code: string, message: string, extra: Partial<ActionFailureState> & { status?: number } = {}): ActionFailureState {
  const { status, ...rest } = extra;
  return { err: Object.assign(new Error(message), { code, ...(status !== undefined ? { status } : {}) }), at: Date.now(), ...rest };
}
