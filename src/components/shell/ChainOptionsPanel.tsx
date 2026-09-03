"use client";

// R67 WS-C (C-02, extended by C-04) -- BAND 2 OF THE COMPOSER, WHERE THE
// CHAIN IS BUILT.
//
// The kit already exports OptionChain -- legend / options / isLeaf /
// unavailableReason / onAdvance -- and it has had ZERO consumers since it
// shipped. This is the mount. The kit component is imported UNCHANGED (D-09
// only requires a fork when behaviour must change; nothing here does), so the
// one rule it enforces stays where it is enforced:
//
//   *** PICKING AN OPTION NEVER EXECUTES. *** onAdvance hands back a chain
//   segment. Building a chain is not running it. Execution is a separate,
//   explicit Send, re-checked server-side.
//
// What this file adds around it is the part a bare chip row cannot say: the
// question, and what to do when there is nothing to pick.

import { OptionChain, type ChainSegment } from "@fchecklist/veridian-ui-kit/shell";
import type { ChainOptionsLevel } from "@/lib/card-catalogue";

export type ChainOptionsPanelProps = {
  /** Null only while `loading` or `error` explain why there is no level. */
  level: ChainOptionsLevel | null;
  /** The chip already chosen at this level, drawn checked. */
  selectedId?: string | null;
  /** Adds the picked option to the chain. Never runs it. */
  onAdvance: (segment: ChainSegment) => void;
  /** Where the user goes when the level is genuinely empty. */
  onEmptyAction?: (route: string) => void;
  /** R67 C-04: the level is being fetched. Renders the legend and skeletons. */
  loading?: boolean;
  /** The legend to show while loading, so the question arrives before its answers. */
  loadingLegend?: string;
  /** The backend's OWN words when the level could not be read. */
  error?: string | null;
  onRetry?: () => void;
};

/** Three chips, so the shape of the answer arrives before the answer does. */
function SkeletonChips() {
  return (
    <span aria-hidden className="flex flex-wrap items-center gap-1.5">
      {[72, 108, 88].map((w, i) => (
        <span
          key={i}
          className="inline-block h-[22px] animate-pulse rounded-full"
          style={{ width: w, background: "var(--color-ct-cloud)" }}
        />
      ))}
    </span>
  );
}

export function ChainOptionsPanel({
  level,
  selectedId,
  onAdvance,
  onEmptyAction,
  loading = false,
  loadingLegend,
  error,
  onRetry,
}: ChainOptionsPanelProps) {
  // ERROR FIRST. A stale level rendered under a failed refetch is a list of
  // options that may no longer exist -- and a chip the user can click into a
  // write is exactly the wrong thing to leave on screen.
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span role="alert" style={{ color: "var(--color-veri-status-late)" }}>
          {error}
        </span>
        {onRetry && (
          <button type="button" className="veri-view-tab" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  if (loading || !level) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
          {loadingLegend ?? level?.legend ?? "Loading…"}
        </span>
        <SkeletonChips />
        <span className="sr-only" role="status">
          Loading the options for {loadingLegend ?? level?.legend ?? "this step"}
        </span>
      </div>
    );
  }

  if (level.options.length === 0) {
    // M24: "EMPTY STATES MUST PROMPT, NEVER LOOK BROKEN." An empty level is
    // not "nothing here" -- it is a precondition the user can go and satisfy,
    // so it states the fact AND offers the way out in the same breath.
    const prompt = level.emptyPrompt;
    return (
      <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: "var(--color-ct-muted)" }}>
        <span>{prompt?.text ?? "Nothing to choose here yet."}</span>
        {prompt?.actionLabel && prompt.route && (
          <button type="button" className="veri-view-tab" onClick={() => onEmptyAction?.(prompt.route!)}>
            {prompt.actionLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <OptionChain
      legend={level.legend}
      options={level.options}
      kind={level.kind}
      selectedId={selectedId ?? null}
      onAdvance={onAdvance}
    />
  );
}
