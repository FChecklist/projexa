"use client";

// R67 lane D22 (item D-54, rec R-183) -- the ONE inline-edit write path both
// budget screens use.
//
// WHY IT IS SHARED: /budgets (the project Budget screen, item D-41) and
// Scope of Work / Budget (this item) print the same Sumeet columns over the
// same report and save through the same PATCH /api/scope/line-items/{id}.
// Two copies of that logic would be two places for the "which cell is saving,
// which one failed, and what does the row read now" rules to drift apart --
// and the arithmetic they drive (Budget = Amount x %, Actual = vendor +
// material + manpower) is exactly where a budget table goes quietly wrong.
// The pure half lives in src/lib/budget-lines.ts (applyLineItemPatch) and is
// unit-tested; this file owns only the fetch and the per-cell state.
import { useCallback, useState } from "react";
import { Check } from "lucide-react";
import { errorMessage } from "@/lib/fetch-json";

// "category" joins the set for R67 item D-76: the BOQ object page edits it in
// the same row, through the same PATCH, and it must report itself the same way
// -- one field left saving silently while its neighbours say "Saved" is
// exactly the inconsistency this shared hook exists to prevent.
export type BudgetFieldKey = "budgetPercentage" | "vendorId" | "vendorAmount" | "materialAmount" | "manpowerAmount" | "category";
export type CellState = { status: "saving" | "saved" | "error"; message?: string };

// The three real outcomes of an inline save, spelled out beside the cell that
// caused them -- never a corner toast the eye has already left, and never a
// silent revert. "Saved" clears itself after 3 s; an error stays until the
// next attempt, because a message you have to act on must not time out.
export const SAVED_VISIBLE_MS = 3000;

export function CellFeedback({ state }: { state: CellState | undefined }) {
  if (!state) return null;
  if (state.status === "saving") return <span className="block text-[10px] text-px-muted">Saving…</span>;
  if (state.status === "saved") {
    return (
      <span className="flex items-center justify-end gap-0.5 text-[10px] text-px-success">
        <Check className="size-3" aria-hidden="true" />Saved
      </span>
    );
  }
  return <span role="alert" className="block text-[10px] text-px-error">{state.message}</span>;
}

/** The one key under which a cell's state is filed. Exported so a caller's remount key cannot drift from it. */
export function cellStateKey(lineItemId: string, field: BudgetFieldKey): string {
  return `${lineItemId}:${field}`;
}

// ─── The state machine, as four pure transitions ──────────────────────────
//
// R67 lane D22 (review finding): three screens now depend on this hook, and
// none of its rules could be asserted -- they lived inside a useCallback that
// needs a DOM to drive, and @happy-dom is declared in package.json but is not
// installed in this environment. They are the same transitions, lifted out, so
// the guarantees below are provable rather than merely commented.

export function markCellSaving(prev: Record<string, CellState>, key: string): Record<string, CellState> {
  return { ...prev, [key]: { status: "saving" } };
}

export function markCellSaved(prev: Record<string, CellState>, key: string): Record<string, CellState> {
  return { ...prev, [key]: { status: "saved" } };
}

export function markCellError(prev: Record<string, CellState>, key: string, message: string): Record<string, CellState> {
  return { ...prev, [key]: { status: "error", message } };
}

/**
 * What the "Saved" timer does when it fires.
 *
 * GUARDED, not an unconditional delete: by the time a 3 s timer fires the cell
 * may have been edited again and be mid-save, or may have failed. Clearing it
 * then would wipe a message the reader still needs, or blank a "Saving…" that
 * is still true. Only a cell still reading "saved" is cleared.
 */
export function clearSavedCell(prev: Record<string, CellState>, key: string): Record<string, CellState> {
  if (prev[key]?.status !== "saved") return prev;
  const next = { ...prev };
  delete next[key];
  return next;
}

export type LineItemSaveOutcome =
  | { ok: true; patched: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * The write itself: one PATCH, and the backend's own sentence when it refuses.
 *
 * Separated from the hook so the request shape and the failure message are
 * testable with nothing but a stubbed fetch. It never touches state.
 */
export async function saveLineItemField(
  lineItemId: string,
  field: BudgetFieldKey,
  value: number | string | null
): Promise<LineItemSaveOutcome> {
  try {
    const res = await fetch(`/api/scope/line-items/${encodeURIComponent(lineItemId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Couldn't save");
    return { ok: true, patched: data as Record<string, unknown> };
  } catch (err) {
    // The BACKEND's own sentence, at the field that caused it -- not a
    // generic "Couldn't save".
    return { ok: false, message: errorMessage(err, "Couldn't save") };
  }
}

/**
 * Saves one cell of one BOQ line and reports what happened, per cell.
 *
 * `onPatched` receives the SERVER's response body, never the typed string, so
 * the recomputed budget and actual the row then shows are the ones the backend
 * agreed to -- the row and the totals beneath it move together or not at all.
 * On failure nothing is applied, so the row's stored value is unchanged.
 *
 * `onFailed` (R67 item D-76) is how a caller restores what the cell SHOWED.
 * The stored row is already intact -- but an uncontrolled <input> still holds
 * whatever was typed, so a screen that leaves it there is showing a number the
 * server rejected as if it had been accepted. Callers that render controlled
 * inputs need nothing; the BOQ object page, whose cells are uncontrolled,
 * passes this and remounts the failed cell back to its stored value.
 */
export function useLineItemSaver(
  onPatched: (lineItemId: string, patched: Record<string, unknown>) => void,
  onFailed?: (lineItemId: string, field: BudgetFieldKey) => void
) {
  const [cells, setCells] = useState<Record<string, CellState>>({});

  const saveField = useCallback(
    async (lineItemId: string, field: BudgetFieldKey, value: number | string | null) => {
      const key = cellStateKey(lineItemId, field);
      setCells((prev) => markCellSaving(prev, key));
      const outcome = await saveLineItemField(lineItemId, field, value);
      if (!outcome.ok) {
        setCells((prev) => markCellError(prev, key, outcome.message));
        onFailed?.(lineItemId, field);
        return;
      }
      onPatched(lineItemId, outcome.patched);
      setCells((prev) => markCellSaved(prev, key));
      setTimeout(() => setCells((prev) => clearSavedCell(prev, key)), SAVED_VISIBLE_MS);
    },
    [onPatched, onFailed]
  );

  return { cells, saveField };
}
