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
