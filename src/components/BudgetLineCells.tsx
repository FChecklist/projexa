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

export type BudgetFieldKey = "budgetPercentage" | "vendorId" | "vendorAmount" | "materialAmount" | "manpowerAmount";
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

/**
 * Saves one cell of one BOQ line and reports what happened, per cell.
 *
 * `onPatched` receives the SERVER's response body, never the typed string, so
 * the recomputed budget and actual the row then shows are the ones the backend
 * agreed to -- the row and the totals beneath it move together or not at all.
 * On failure nothing is applied, so the previous value is still on screen.
 */
export function useLineItemSaver(onPatched: (lineItemId: string, patched: Record<string, unknown>) => void) {
  const [cells, setCells] = useState<Record<string, CellState>>({});

  const saveField = useCallback(
    async (lineItemId: string, field: BudgetFieldKey, value: number | string | null) => {
      const key = `${lineItemId}:${field}`;
      setCells((prev) => ({ ...prev, [key]: { status: "saving" } }));
      try {
        const res = await fetch(`/api/scope/line-items/${encodeURIComponent(lineItemId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Couldn't save");
        onPatched(lineItemId, data as Record<string, unknown>);
        setCells((prev) => ({ ...prev, [key]: { status: "saved" } }));
        setTimeout(() => setCells((prev) => {
          if (prev[key]?.status !== "saved") return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        }), SAVED_VISIBLE_MS);
      } catch (err) {
        // The BACKEND's own sentence, at the field that caused it -- not a
        // generic "Couldn't save".
        setCells((prev) => ({ ...prev, [key]: { status: "error", message: errorMessage(err, "Couldn't save") } }));
      }
    },
    [onPatched]
  );

  return { cells, saveField };
}
