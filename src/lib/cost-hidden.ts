// R-50 (Sumeet audit 2026-10-20): ONE answer to "did the server withhold cost from this viewer?", shared by every screen that draws
// cost columns, headers or summary lines. VERIDIAN removes the keys outright (redactCostSideFields) for a role without cost
// visibility, e.g. client_viewer; a viewer WITH visibility gets the keys back even when their value is null ("not costed yet").
// So absence of the KEY, never a null value, is the signal.

/** The per-line budget overlay: the server strips these for a viewer without cost visibility. */
export function budgetOverlayHidden(rows: ReadonlyArray<{ computedBudget?: number | null; budgetPercentage?: string | null }>): boolean {
  return rows.length > 0 && rows.every((r) => r.budgetPercentage === undefined && r.computedBudget === undefined);
}

/** The project-side (cost) figures of the dual-view money model: qtyProject/rateProject per line, projectValue in the roll-up. */
export function projectSideHidden(boq: {
  lineItems: ReadonlyArray<Record<string, unknown>>;
  moneyView?: Record<string, unknown> | null;
}): boolean {
  if (boq.lineItems.length > 0) return boq.lineItems.every((l) => !("qtyProject" in l) && !("rateProject" in l));
  if (boq.moneyView) return !("projectValue" in boq.moneyView);
  return false;
}
