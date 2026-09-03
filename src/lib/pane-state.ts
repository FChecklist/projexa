// R67 D-65 (folding in D-59's "ScreenState" and D-55's four-state rule) --
// what a data pane is allowed to say, and when.
//
// ONE COMPONENT, NOT THREE. D-55, D-59 and D-65 each describe a state
// wrapper for the same thing: a screen that has asked a backend for rows and
// is waiting. Building three of them would be exactly the duplication this
// programme exists to remove, so there is one -- src/components/PaneState.tsx
// -- and this file is its rules, extracted so they are unit tests rather
// than a screenshot somebody re-takes.
//
// THE RULES:
//
//  1. A SKELETON, NOT A SPINNER. A spinner says "something is happening";
//     the skeleton says "a table with these columns is coming", and nothing
//     already on screen moves when it resolves.
//  2. WAITING IS NARRATED, LATE. Nothing at 0 ms (a fast read must not
//     flash text); the entity and the project at 2 s; the elapsed seconds
//     from 3 s; at 8 s an honest admission that this is slow, plus a way
//     out. The user is never left guessing whether the screen is broken.
//  3. AN EMPTY SENTENCE NEEDS A 200. `mayShowEmptyState()` is the only way
//     to reach it, and it takes the outcome, not the row count.
//  4. A COUNT WE DO NOT HAVE IS AN EN-DASH. "0 records" over a failed read
//     is a claim nobody made.
//  5. PREVIOUS ROWS SURVIVE A FAILED REFRESH, labelled with when they were
//     true. Blanking the screen loses information the user already had.

import { describeReadError, type ReadErrorDescription } from "@/lib/task-errors";

export type PaneStatus = "idle" | "loading" | "error" | "ready";

/** The three thresholds, named once so a caption and a test cannot disagree. */
export const PANE_NAMED_WAIT_MS = 2000;
export const PANE_ELAPSED_WAIT_MS = 3000;
export const PANE_SLOW_WAIT_MS = 8000;

export type LoadingCaption = {
  /** The line that names what is loading. Null while the wait is still short. */
  primary: string | null;
  /** The elapsed-time line, added underneath so nothing above it moves. */
  secondary: string | null;
  /** Whether the wait has gone on long enough to offer a way out. */
  showRetry: boolean;
};

/**
 * What a pane says while it waits, purely as a function of how long it has
 * been waiting. `entity` is the plural noun ("permits"); `projectName` is
 * the scope, omitted from the sentence when there is none.
 */
export function loadingCaption(
  elapsedMs: number,
  entity: string,
  projectName?: string | null
): LoadingCaption {
  const seconds = Math.floor(elapsedMs / 1000);
  if (elapsedMs >= PANE_SLOW_WAIT_MS) {
    return {
      primary:
        "Still working — the construction data service is slow right now. You can keep using other screens; this one will fill in.",
      secondary: `${seconds}s`,
      showRetry: true,
    };
  }
  const named = projectName ? `Loading ${entity} for ${projectName}…` : `Loading ${entity}…`;
  if (elapsedMs >= PANE_ELAPSED_WAIT_MS) {
    return { primary: named, secondary: `Still loading from VERIDIAN… ${seconds}s`, showRetry: false };
  }
  if (elapsedMs >= PANE_NAMED_WAIT_MS) {
    return { primary: named, secondary: null, showRetry: false };
  }
  // A read that answers inside two seconds shows the skeleton and nothing
  // else -- text that appears and vanishes is noise, not information.
  return { primary: null, secondary: null, showRetry: false };
}

/**
 * The empty state is reachable ONLY from a successful read. This takes the
 * outcome rather than the rows precisely so a caller cannot pass
 * `rows.length === 0` and accidentally assert emptiness over a 500 -- the
 * defect behind "No permits yet for this project." on a failed GET.
 */
export function mayShowEmptyState(status: PaneStatus, rowCount: number): boolean {
  return status === "ready" && rowCount === 0;
}

/** "12 records", or an en-dash whenever we have not been told. */
export function recordCountLabel(status: PaneStatus, rowCount: number | null): string {
  if (status !== "ready" || rowCount === null) return "—";
  return `${rowCount} record${rowCount === 1 ? "" : "s"}`;
}

/**
 * The same rule for a KPI tile rather than a row count (R-002, R-019, R-025:
 * "no screen may render a failed GET as zero, 0 % or an empty list").
 *
 * A tile reading "Total entries 0" or "Avg % Complete 0%" over a 500 is a
 * false statement, and it is MORE dangerous than a false empty list because a
 * number carries no hint that anything was ever asked for. Anything short of
 * a successful read renders the en-dash.
 */
export function metricLabel(status: PaneStatus, value: number | null, suffix = ""): string {
  if (status !== "ready" || value === null || Number.isNaN(value)) return "—";
  return `${value}${suffix}`;
}

/**
 * "as of 14:32" for rows that were true at some earlier moment and are still
 * on screen under a failed refresh. 24-hour and zone-explicit, for the same
 * hydration reason format-date.ts exists.
 */
export function asOfLabel(at: Date | null, timeZone = "Asia/Dubai"): string | null {
  if (!at || Number.isNaN(at.getTime())) return null;
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
  return `as of ${hhmm}`;
}

export type PaneErrorInput = { status?: number | null; message?: string | null };

/** The failed pane's whole story, from the one shared dictionary. */
export function paneError(entity: string, input: PaneErrorInput): ReadErrorDescription {
  return describeReadError(entity, input);
}
