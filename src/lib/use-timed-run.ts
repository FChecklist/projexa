"use client";

// R67 E-30 (R-263), also used by E-28's Work Progress Report.
//
// WHAT WAS WRONG. A report run had no visible state at all. The reader pressed
// Run, the panel kept showing "Pick a report and click Run Report.", and
// nothing on the screen changed until the answer came back -- which for the
// Reports module's Work Progress entry was measured at 24.3 seconds. There was
// no elapsed counter, no way to cancel, and no upper bound: a request that was
// never going to answer left the reader looking at an idle prompt forever.
//
// WHAT THIS IS. One hook that owns the four things every run needs and that no
// screen should re-implement:
//
//   * an AbortController, so Cancel actually stops the request rather than
//     hiding its result;
//   * a one-second ticker, so the screen can say how long it has been -- "12 s"
//     is the difference between "slow" and "broken";
//   * a deadline, after which the run is abandoned and the panel says so in
//     words with something to do next;
//   * one state, so the screen cannot show a spinner and an idle prompt at the
//     same time (which is exactly what ReportsClient did).
//
// SIX STATES, NOT TWO. "failed" (the service answered badly), "timeout" (it did
// not answer at all) and "cancelled" (the reader stopped it) are three
// different facts with three different next actions, and collapsing them into
// one "error" is what made the old panel unable to say anything useful.

import { useCallback, useEffect, useRef, useState } from "react";

export type TimedRunState = "idle" | "running" | "done" | "failed" | "timeout" | "cancelled";

/** R-263's own number: a report that has not answered in 20 s is not going to. */
export const DEFAULT_RUN_TIMEOUT_MS = 20_000;

export type TimedRun<T> = {
  state: TimedRunState;
  /** Whole seconds since the current (or last) run started. Ticks once a second while running. */
  elapsedSeconds: number;
  /** The backend's own words on a failure, or null. Never a stack, never a URL. */
  error: string | null;
  /** The value of the last successful run, or null. */
  result: T | null;
  /** Epoch ms the last successful run finished, so a screen can print "as of 14:02". */
  ranAt: number | null;
  /** How long the last successful run took, so a screen can print "Ran in 2.7 s". */
  durationMs: number | null;
  /** Runs `task`, passing it a signal that Cancel and the deadline both abort. */
  run: (task: (signal: AbortSignal) => Promise<T>) => Promise<T | null>;
  cancel: () => void;
  /** Back to idle, keeping nothing. For a screen that changed subject entirely. */
  reset: () => void;
};

/**
 * The timeout is measured from the moment `run` is called and cancels the
 * request, so a screen never has to race its own timer against a fetch that is
 * still holding a connection open.
 */
export function useTimedRun<T = unknown>({ timeoutMs = DEFAULT_RUN_TIMEOUT_MS }: { timeoutMs?: number } = {}): TimedRun<T> {
  const [state, setState] = useState<TimedRunState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<T | null>(null);
  const [ranAt, setRanAt] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every run takes a generation. A late answer from a run that was cancelled,
  // timed out, or superseded by a newer run must never commit state -- that is
  // how a cancelled report reappears thirty seconds later.
  const generationRef = useRef(0);
  const timedOutRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (tickerRef.current) clearInterval(tickerRef.current);
    if (deadlineRef.current) clearTimeout(deadlineRef.current);
    tickerRef.current = null;
    deadlineRef.current = null;
  }, []);

  // A component that unmounts mid-run must not leave a ticker or a request
  // behind.
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      clearTimers();
      controllerRef.current?.abort();
    };
  }, [clearTimers]);

  const cancel = useCallback(() => {
    if (controllerRef.current === null) return;
    generationRef.current += 1;
    clearTimers();
    controllerRef.current.abort();
    controllerRef.current = null;
    setState("cancelled");
  }, [clearTimers]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    clearTimers();
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState("idle");
    setElapsedSeconds(0);
    setError(null);
    setResult(null);
    setRanAt(null);
    setDurationMs(null);
  }, [clearTimers]);

  const run = useCallback(
    async (task: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
      const generation = ++generationRef.current;
      clearTimers();
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      timedOutRef.current = false;

      const startedAt = Date.now();
      setState("running");
      setElapsedSeconds(0);
      setError(null);

      tickerRef.current = setInterval(() => {
        if (generationRef.current !== generation) return;
        setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);

      deadlineRef.current = setTimeout(() => {
        if (generationRef.current !== generation) return;
        timedOutRef.current = true;
        clearTimers();
        controller.abort();
        setElapsedSeconds(Math.round(timeoutMs / 1000));
        setState("timeout");
      }, timeoutMs);

      try {
        const value = await task(controller.signal);
        if (generationRef.current !== generation) return null;
        clearTimers();
        controllerRef.current = null;
        setResult(value);
        setRanAt(Date.now());
        setDurationMs(Date.now() - startedAt);
        setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
        setState("done");
        return value;
      } catch (err) {
        if (generationRef.current !== generation) return null;
        clearTimers();
        controllerRef.current = null;
        // An abort is never a failure of the service: it is either this hook's
        // own deadline or the reader pressing Cancel, and both already set
        // their own state.
        if (timedOutRef.current) return null;
        if (err instanceof DOMException && err.name === "AbortError") {
          setState("cancelled");
          return null;
        }
        setError(err instanceof Error && err.message ? err.message : "the service did not answer");
        setState("failed");
        return null;
      }
    },
    [clearTimers, timeoutMs]
  );

  return { state, elapsedSeconds, error, result, ranAt, durationMs, run, cancel, reset };
}

/** "This report did not answer in 20 s." -- R-263's own sentence, built from the real budget. */
export function timeoutSentence(timeoutMs: number = DEFAULT_RUN_TIMEOUT_MS): string {
  return `This report did not answer in ${Math.round(timeoutMs / 1000)} s.`;
}
