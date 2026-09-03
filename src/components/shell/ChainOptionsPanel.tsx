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
  level: ChainOptionsLevel;
  /** The chip already chosen at this level, drawn checked. */
  selectedId?: string | null;
  /** Adds the picked option to the chain. Never runs it. */
  onAdvance: (segment: ChainSegment) => void;
  /** Where the user goes when the level is genuinely empty. */
  onEmptyAction?: (route: string) => void;
};

export function ChainOptionsPanel({ level, selectedId, onAdvance, onEmptyAction }: ChainOptionsPanelProps) {
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
