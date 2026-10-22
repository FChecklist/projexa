// R-100: when the Project 360 "Confirm baseline" control is offered, and to whom. One place, used by the online screen and the laptop-first screen.
// A baseline is the snapshot of the BOQ lines at the moment someone confirms it. Two states need the control:
//   "first"   - nothing has been confirmed yet;
//   "refresh" - a baseline exists but it was taken before the BOQ had cost figures, so every profit figure still reads "no cost figures";
//               confirming again records a fresh version (the old one is kept; the profit answer reads the first version that has figures).
// An older server that does not send baselineHasFigures is treated as "has figures" (only the old rule applies), never as a reason to nag.
import { mayApproveBoq } from "@/lib/boq-helpers";

export type BaselineControlState = "none" | "first" | "refresh";

export function baselineControlState(row: { hasBaseline?: boolean | null; baselineHasFigures?: boolean | null }): BaselineControlState {
  if (row.hasBaseline === false) return "first";
  if (row.hasBaseline === true && row.baselineHasFigures === false) return "refresh";
  return "none";
}

/** The server gate is the same PM_OR_ABOVE list as approving a BOQ (POST /api/scope/[id]/revisions?action=baseline). true/null: offer it (null = role not known, the server decides). */
export function mayConfirmBaseline(role: string | null | undefined): boolean {
  return mayApproveBoq(role) !== false;
}

export const BASELINE_ROLE_REASON = "Only an owner, administrator or project manager can confirm a baseline. Ask one of them to open this screen and press Confirm baseline, giving the PO, signed proposal or e-mail as evidence.";

// R-100 (live dead end on the AUDIT BOQ): a baseline can hold the cost side but not the contract side, and once a baseline WITH figures exists the
// contract side is locked. The screen must say exactly which side is missing, link to the lines, and -- when the lock applies -- offer the one thing
// that works: a revision of the BOQ. Pure functions so every sentence is unit-tested.
export type BaselineFigureStatus = {
  hasFigures?: boolean;
  rootLineCount?: number;
  contractMissingLines: number;
  costMissingLines: number;
  contractMissingLineIds?: string[];
  costMissingLineIds?: string[];
};

export type FigureRow = {
  boqId?: string | null;
  baselineFigureStatus?: BaselineFigureStatus | null;
  contractSideLocked?: boolean | null;
  contractLockedByVersion?: number | null;
};

const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;

/** "Contract quantity/rate missing on 3 lines; cost quantity/rate missing on 1 line." or null when the server did not say. */
export function missingSidesSentence(status: BaselineFigureStatus | null | undefined): string | null {
  if (!status) return null;
  const parts: string[] = [];
  if (status.contractMissingLines > 0) parts.push(`Contract quantity/rate missing on ${lines(status.contractMissingLines)}`);
  if (status.costMissingLines > 0) parts.push(`${parts.length ? "cost" : "Cost"} quantity/rate missing on ${lines(status.costMissingLines)}`);
  return parts.length ? `${parts.join("; ")}.` : null;
}

/** The label for a figure that cannot be worked out, naming the side that is missing. */
export function emptyFigureLabel(row: { hasBaseline?: boolean | null; baselineFigureStatus?: BaselineFigureStatus | null }): string {
  if (!row.hasBaseline) return "Not yet baselined";
  const s = row.baselineFigureStatus;
  if (s && s.contractMissingLines > 0 && s.costMissingLines === 0) return "No contract figures yet";
  if (s && s.contractMissingLines > 0 && s.costMissingLines > 0) return "No figures yet";
  return "No cost figures yet";
}

/** Link to the first line missing a side (the BOQ grid row is found by ?focus=<data-testid>), or to the BOQ when no id is known. */
export function missingLinesHref(boqId: string, ids: string[] | undefined): string {
  const base = `/scope/${encodeURIComponent(boqId)}`;
  return ids && ids.length ? `${base}?focus=${encodeURIComponent(`boq-grid-row-${ids[0]}`)}` : base;
}

/** Shown only when the contract side is locked AND contract figures are what is missing. */
export function contractLockNotice(row: FigureRow): { text: string; reviseHref: string } | null {
  if (!row.boqId || !row.contractSideLocked) return null;
  if (!row.baselineFigureStatus || row.baselineFigureStatus.contractMissingLines <= 0) return null;
  const v = row.contractLockedByVersion;
  return {
    text: `Contract values are locked by baseline ${v ? `v${v}` : "that was already confirmed"}. To change them create a revision of this BOQ and confirm a baseline there.`,
    reviseHref: `/scope/${encodeURIComponent(row.boqId)}/revise`,
  };
}
