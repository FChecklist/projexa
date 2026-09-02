// R67 D-27 (R-068). The shape and the wording of the scope-reduction 409, kept
// pure so the sentence a user is asked to accept is testable without mounting
// the screen.
//
// THE FAULT: the backend has always blocked a revision that reduces or removes
// work already recorded on site, but it said so only in a paragraph, and the
// destructive way out was labelled "Apply anyway (override)" -- a button that
// named neither what it overrides nor how much of it. A user could accept it
// without ever seeing which lines were affected.

/** One line this revision would reduce or remove that already has recorded progress. */
export type ScopeReductionConflict = {
  itemCode: string | null;
  description: string;
  recordedQty: number;
  unit: string;
  lastRecordedAt: string;
};

/**
 * "Apply anyway - override 1 completed line" / "... 3 completed lines".
 * The count is IN the label, because "how much am I overriding" is the only
 * question that matters at the moment of clicking it, and singular/plural is
 * spelled correctly because a destructive control that reads "1 completed
 * lines" undermines the seriousness of everything around it.
 */
export function overrideActionLabel(conflictCount: number): string {
  return `Apply anyway - override ${conflictCount} completed ${conflictCount === 1 ? "line" : "lines"}`;
}

/** "R60SK-A" when the line is coded, its description otherwise -- never a row that identifies itself as nothing. */
export function conflictLabel(conflict: ScopeReductionConflict): string {
  return conflict.itemCode?.trim() || conflict.description;
}

/** "12 m2" -- the quantity actually recorded, with the line's own unit. A unitless line just reads "12". */
export function conflictQuantity(conflict: ScopeReductionConflict): string {
  const qty = conflict.recordedQty.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return conflict.unit?.trim() ? `${qty} ${conflict.unit.trim()}` : qty;
}
