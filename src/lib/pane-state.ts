// R67 — ONE PANE MODULE. Two lanes wrote half of this file each and decision
// D-11 (addendum) unions them here rather than leaving two modules at two
// import paths: lane F2's state machine PRODUCES the state, lane D0's rules
// DECIDE WHAT THE SCREEN SAYS about it. Both lanes' tests are kept.
//
// ── PART 1 (lane F2, item F-25 / audit R-241): ONE TAB, ONE PANE, ONE LOAD ──
//
// THE MEASURED PROBLEM. A tabbed screen in this app fetched EVERY tab on
// landing, under ONE shared `loading` flag. MaterialsClient asked for the
// material master, the inbound receipts and the cost report the moment it
// mounted, although only Material Master is open; LabourClient asked for the
// roster, the vendor list and the WHOLE undated attendance log although it
// opens on Roster. So the tab the user is looking at waited on two answers
// they had not asked for, and one shared spinner meant a failure in any of
// them looked like a failure in all of them.
//
// A pane is therefore its own little state machine, and this file is that
// machine with no React in it, so the rules are testable directly:
//
//   idle     -- never asked for. A tab that has not been opened is idle, and
//               that is not an error or an empty result: it is "no question
//               has been asked yet".
//   loading  -- in flight. KEEPS the rows it already had, so a refresh or a
//               background revalidation never blanks a table that is correct
//               on screen.
//   ready    -- rows, plus WHEN they were read (`asOf`), so a pane filled by
//               an idle-time prefetch can say so rather than implying it is
//               live.
//   error    -- the backend's own words. Also keeps the last known-good rows:
//               "this is what we had, and here is why it did not refresh" is
//               more useful than an empty table.
//
// `rows` and `error` are independent on purpose. Empty rows with no error
// means "there are none"; empty rows WITH an error means "we could not find
// out" -- the distinction read-outcome.ts exists to protect.
//
// ── PART 2 (lane D0, items D-65 / D-59 / D-55): WHAT A PANE MAY SAY ──
//
// ONE COMPONENT, NOT THREE. D-55, D-59 and D-65 each describe a state
// wrapper for the same thing: a screen that has asked a backend for rows and
// is waiting. Building three of them would be exactly the duplication this
// programme exists to remove, so there is one -- src/components/PaneState.tsx
// -- and these are its rules, extracted so they are unit tests rather
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

export type PaneStatus = "idle" | "loading" | "ready" | "error";

// ---------------------------------------------------------------------------
// Part 1 — the state machine (lane F2)
// ---------------------------------------------------------------------------

export type Pane<T> = {
  status: PaneStatus;
  rows: T[];
  /** When `rows` was read, as an epoch ms. null when nothing has been read. */
  asOf: number | null;
  /** The backend's own sentence. null when the last read succeeded. */
  error: string | null;
};

/** A tab nobody has opened yet. */
export function idlePane<T>(): Pane<T> {
  return { status: "idle", rows: [], asOf: null, error: null };
}

/**
 * A pane the SERVER already filled (the D-04 server-component fetch, F-18).
 * `errorMessage` is the server's own failure text, which still counts as
 * "answered" -- the screen must say so rather than sit on a spinner that will
 * never resolve.
 */
export function seededPane<T>(rows: T[], errorMessage: string | null, at: number): Pane<T> {
  return errorMessage
    ? { status: "error", rows: [], asOf: null, error: errorMessage }
    : { status: "ready", rows, asOf: at, error: null };
}

/** In flight. Rows already on screen stay on screen. */
export function loadingPane<T>(previous: Pane<T>): Pane<T> {
  return { ...previous, status: "loading", error: null };
}

export function readyPane<T>(rows: T[], at: number): Pane<T> {
  return { status: "ready", rows, asOf: at, error: null };
}

/** Failed. The last known-good rows are kept, and the reason is stated. */
export function errorPane<T>(previous: Pane<T>, message: string): Pane<T> {
  return { ...previous, status: "error", error: message };
}

/** True only for a pane that has never been asked for. */
export function needsLoad(pane: Pane<unknown>): boolean {
  return pane.status === "idle";
}

/** True when there is genuinely nothing to show yet -- the only case that earns
 *  a spinner. A pane refreshing rows it already has must not show one. */
export function paneIsBusy(pane: Pane<unknown>): boolean {
  return (pane.status === "idle" || pane.status === "loading") && pane.rows.length === 0;
}

/**
 * The stamp a pane should carry, or null for none.
 *
 * Only a pane filled by a speculative/idle-time prefetch that is now older than
 * `freshForMs` needs to admit its age; a pane read a moment ago is simply
 * current, and a stamp on it would be noise.
 */
export function paneAsOf(pane: Pane<unknown>, now: number, freshForMs = 60_000): number | null {
  if (pane.status !== "ready" || pane.asOf === null) return null;
  return now - pane.asOf >= freshForMs ? pane.asOf : null;
}

// ---------------------------------------------------------------------------
// Part 2 — the presentation rules over that state (lane D0)
// ---------------------------------------------------------------------------

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
