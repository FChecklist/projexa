"use client";

// R67 F-31 (audit recommendation R-275) / decision D-04 -- THE LIST REGION.
//
// One projexa-side container that every module list renders its body inside,
// so all thirteen measured pages get the same two things:
//
//   * data-state="loading" | "ready" | "empty" | "error" and aria-busy on the
//     region itself. "ready" flips when the first row -- or the empty-state
//     sentence, which is equally an answer -- is actually on screen. That is
//     the mark the pass-2 latency script waits on, and the reason its `usable`
//     column was blank for all 13 pages before this existed.
//   * Words instead of a bare spinner. At 3 s the region says what it is
//     waiting for and for how long ("Still loading minutes… 4 s", counting);
//     at 8 s -- D-04's abort budget, the same instant veridian-client gives up
//     on the upstream -- it says "This is taking longer than usual" and offers
//     Retry.
//
// D-09: this WRAPS the kit's ObjectScreen/ListScreen slot rather than changing
// it. The kit is a pinned git dependency with no source on this machine, and
// nothing here needs to be inside it: the attribute belongs to the region a
// projexa screen owns, not to the kit's table renderer. If a later stream must
// put data-state inside ObjectScreen itself, that becomes a kit change; this
// item deliberately avoids one.

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
  listDataState,
  loadingWords,
  STILL_LOADING_AFTER_MS,
  type ListDataState,
} from "@/lib/list-loading";

/**
 * The elapsed time of the current wait, in ms, ticking once a second while
 * `active`. Restarts from zero every time a new wait begins, so a retry's
 * counter starts at 0 rather than continuing the previous one.
 *
 * The interval is only armed while `active` -- a list that is ready holds no
 * timer at all, which matters because this component is rendered on every list
 * screen in the app.
 */
function useElapsedMs(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    startedAt.current = Date.now();
    setElapsed(0);
    // Half-second ticks so the displayed whole-second counter never appears to
    // skip a number when the interval drifts.
    const timer = setInterval(() => setElapsed(Date.now() - startedAt.current), 500);
    return () => clearInterval(timer);
  }, [active]);

  return elapsed;
}

/**
 * The sentence a wait shows once it is no longer ordinary, and the Retry it
 * offers once it is abnormal. Exported on its own so a <Suspense> fallback --
 * where the wait is a server render, not a client fetch -- says exactly the
 * same words as a client-side load (see ModuleListSkeleton).
 *
 * Renders nothing at all for the first three seconds.
 */
export function ListLoadingWords({
  label,
  onRetry,
  active = true,
}: {
  /** What the user asked for, in their words: "minutes", "roster", "permits". */
  label: string;
  /** Re-issues the read. Omitted where the caller has no way to re-issue it. */
  onRetry?: () => void;
  active?: boolean;
}) {
  const elapsed = useElapsedMs(active);
  const words = loadingWords(label, elapsed);
  if (!words.text) return null;

  return (
    <p
      className="flex items-center justify-center gap-3 py-3 text-[13px] text-px-muted"
      // Announced, but not interruptively: the user is waiting, not being
      // alerted. aria-live="polite" reads it at the next pause.
      aria-live="polite"
    >
      <span>{words.text}</span>
      {words.showRetry && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[13px] text-px-ink"
          style={{ borderColor: "var(--color-ct-border)" }}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Retry
        </button>
      )}
    </p>
  );
}

/**
 * The bare region wrapper: the attribute and nothing else. For screens whose
 * bodies are early returns (the four Schedule tabs) rather than one
 * conditional tree.
 */
export function ListStateRegion({
  state,
  className,
  children,
}: {
  state: ListDataState;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div data-state={state} aria-busy={state === "loading"} className={className}>
      {children}
    </div>
  );
}

/**
 * A loading region: the spinner for the first three seconds, then the words.
 *
 * The spinner is kept -- something must move while the wait is still ordinary
 * -- but it is never alone for longer than STILL_LOADING_AFTER_MS, which is
 * the whole point of R-275.
 */
export function ListLoadingRegion({
  label,
  onRetry,
  className,
  children,
}: {
  label: string;
  onRetry?: () => void;
  className?: string;
  /** A skeleton to show in place of the default spinner, when the caller has
   *  one that matches the shape the rows will arrive into. */
  children?: React.ReactNode;
}) {
  return (
    <ListStateRegion state="loading" className={className}>
      {children ?? (
        <div className="grid h-32 place-items-center">
          <Loader2 className="size-5 animate-spin text-px-muted" aria-hidden />
        </div>
      )}
      <ListLoadingWords label={label} onRetry={onRetry} />
    </ListStateRegion>
  );
}

export type ListScreenFrameProps = {
  /** What the user asked for, in their words. Used in the waiting sentence. */
  label: string;
  loading: boolean;
  /** The backend's own sentence, or null. */
  error?: string | null;
  /** How many rows are on screen. 0 with no error is a real "there are none". */
  rowCount: number;
  /** Re-issues the read; drives the 8 s Retry. */
  onRetry?: () => void;
  className?: string;
  /** Shown instead of the default spinner while loading. */
  loadingBody?: React.ReactNode;
  /** The error / empty / rows body. Not rendered while loading. */
  children?: React.ReactNode;
};

/**
 * The container every module list body sits in.
 *
 * `children` renders the error sentence, the empty sentence or the table
 * exactly as each screen already did -- this does not take over the rendering
 * of any of them. It owns only the state attribute and the waiting words.
 */
export default function ListScreenFrame({
  label,
  loading,
  error = null,
  rowCount,
  onRetry,
  className,
  loadingBody,
  children,
}: ListScreenFrameProps) {
  const state = listDataState({ loading, error, rowCount });

  if (state === "loading") {
    return (
      <ListLoadingRegion label={label} onRetry={onRetry} className={className}>
        {loadingBody}
      </ListLoadingRegion>
    );
  }

  return (
    <ListStateRegion state={state} className={className}>
      {children}
    </ListStateRegion>
  );
}

export { STILL_LOADING_AFTER_MS };
