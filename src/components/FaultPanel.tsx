"use client";

// GUIDED ERRORS G1 -- the panel for faults the FORM found itself (src/lib/error-guide/g1-faults.ts): the first fault in full, a count of the others,
// "Fix it now" (the input is scrolled to, outlined for 3 s and read out), and the typed values are untouched. It also takes the person to the first
// bad input at once when a save is attempted (`attempt` goes up by one each press), so on a long BOQ nobody has to hunt for the line.
// Not a popup: the same inline role="alert" panel every other failure uses.

import { useEffect, useMemo } from "react";
import { GuidedError } from "@/components/GuidedError";
import { contextFromFailure } from "@/lib/error-guide/context";
import { findFocusTarget, highlightElement } from "@/lib/error-guide/focus";
import { faultFailure, type Fault } from "@/lib/error-guide/g1-faults";

export function FaultPanel({
  faults,
  attempt,
  entityType,
  entityId,
  projectId,
  draftKey,
  remap,
  className,
}: {
  faults: Fault[];
  /** Goes up by one every time the person presses Save and there are faults: the first bad input is brought into view each time. */
  attempt?: number;
  entityType?: string;
  entityId?: string;
  projectId?: string;
  draftKey?: string;
  /** Screens whose input has another id than the shared one (the online title box is "title", not "boq-title"). */
  remap?: Record<string, string>;
  className?: string;
}) {
  const mapped = useMemo(() => (remap ? faults.map((f) => (f.field && remap[f.field] ? { ...f, field: remap[f.field] } : f)) : faults), [faults, remap]);
  const failure = useMemo(() => faultFailure(mapped), [mapped]);
  const firstField = mapped[0]?.field;
  const ctx = useMemo(() => (failure ? contextFromFailure(failure, { entityType, entityId, projectId }) : null), [failure, entityType, entityId, projectId]);

  useEffect(() => {
    if (!attempt || !firstField) return;
    const el = findFocusTarget(firstField);
    if (el) highlightElement(el);
  }, [attempt, firstField]);

  if (!failure || !ctx) return null;
  return <GuidedError ctx={ctx} message={failure.message} retryable={false} draftKey={draftKey} className={className} />;
}

export default FaultPanel;
