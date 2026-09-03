"use client";

// R67 D-13 / D-29. "A spinner that has been spinning for twenty seconds is not
// a loading state, it is an unanswered question."
//
// Two of this lane's items ask for the same mechanism in slightly different
// words: the Documents list must add the line "Still loading documents from
// VERIDIAN…" once a load has been running for 3 s (D-13), and the Work Progress
// Daily Entry list must add the elapsed seconds once a load has been running for
// 5 s -- "Still loading progress entries… (12 s)" (D-29). D-13 says to use "the
// shared 3 s budget helper from WS-F/D-04 when it exists, otherwise a local
// timer". It does not exist in this repo yet (nothing exports a load budget --
// the only 3 s-shaped constant anywhere is veridian-client's 20 s fetch
// timeout), so this is that local timer, written once for both screens rather
// than twice.
//
// The pure half is separated from the hook on purpose: what the user reads is a
// pure function of "how long has this been running", so it can be asserted in a
// unit test without rendering anything or advancing a real clock.

import { useEffect, useState } from "react";

/**
 * D-04's budget: a read that has not answered in 3 s is late enough that the
 * screen owes the user a word about it. Deliberately far below veridian-client's
 * own 20 s fetch timeout -- this is the point at which we SAY something, not the
 * point at which we give up.
 */
export const SLOW_LOAD_BUDGET_MS = 3_000;

/** D-29's budget for the Daily Entry list, where the elapsed count is shown too. */
export const ELAPSED_LOAD_BUDGET_MS = 5_000;

/** Whole seconds, floored -- "(12 s)" must never read "(12.4 s)". */
export function elapsedSeconds(elapsedMs: number): number {
  return Math.max(0, Math.floor(elapsedMs / 1000));
}

/**
 * The line a still-running load owes the user, or null while it is still inside
 * its budget. `withElapsed` appends "(12 s)" -- D-29's form; D-13's form is the
 * sentence alone.
 */
export function slowLoadNotice(
  text: string,
  elapsedMs: number,
  options: { afterMs?: number; withElapsed?: boolean } = {}
): string | null {
  const afterMs = options.afterMs ?? SLOW_LOAD_BUDGET_MS;
  if (elapsedMs < afterMs) return null;
  return options.withElapsed ? `${text} (${elapsedSeconds(elapsedMs)} s)` : text;
}

/**
 * Milliseconds since `active` last became true, ticking once a second; 0 while
 * inactive. One interval per mount, cleared on unmount and on every restart, so
 * a screen that reloads twice does not end up with two timers racing.
 *
 * Starts at 0 rather than reading the clock during render: a value read in the
 * render body differs between the server pass and the first client pass, which
 * is the hydration-mismatch class format-date.ts's header documents at length.
 */
export function useElapsedMs(active: boolean, tickMs: number = 1000): number {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedMs(0);
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), tickMs);
    return () => clearInterval(timer);
  }, [active, tickMs]);

  return elapsedMs;
}
