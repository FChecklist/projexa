"use client";

// R67 WS-A (A-01, A-05) -- PROJEXA'S FORK of the kit's shell/ControlStrip.
//
// WHY A FORK AND NOT A KIT CHANGE (decision D-09): @fchecklist/veridian-ui-kit
// is a pinned git dependency whose source is not on this machine and is not
// published; a node_modules edit is erased by CI's `bun install
// --frozen-lockfile`. So the components whose BEHAVIOUR this programme changes
// are copied into this repo and imported from here, while everything the
// programme does not change (AppShell, TopRail, TaskMaster, the screens, the
// tokens) keeps coming from the kit.
//
// WHAT CHANGED FROM THE KIT COPY, and why:
//
//  1. THE MODE TAB ROW IS GONE. Projects | Customers | Vendors sat at the head
//     of every strip and, on PROJEXA, changed nothing but its own colour: the
//     chain is always project-rooted here, and the three words already exist
//     as pills, so the row was one control answering a question the product
//     never asks. (Customers and Vendors survive as ordinary catalogue
//     entries, so each word still appears exactly once on screen.) The
//     ChainMode type is untouched, so the POST /api/tasks body is unchanged.
//
//  2. THE "HISTORY" BUTTON IS GONE. Two controls named History on one screen
//     is a duplicate control (correction C-03 withdrew only the z-index/
//     "covering" claim; the duplicate-name finding stands). The one History
//     is now the Task Master's own History tab, which keeps the same contract:
//     a row click LOADS the chain and stops.
//
//  3. ONE INSTRUCTION, NOT TWO. The kit hard-coded "Select a module to begin"
//     here while the product wrote "Pick a project or a module first" beside
//     the Send button -- two sentences telling the user two different things
//     about the same state. The strip now renders ONE caller-supplied,
//     state-derived `prompt`, and the composer reuses that same string as the
//     Send button's tooltip rather than printing it a second time.
//
// UNCHANGED AND DELIBERATELY SO: the (x) still routes through cutChainFrom()
// via the caller, canCutAt() still refuses to offer one on the root, and the
// grammar is still ENTITY > ACTION > STEP read as one sentence.

import { canCutAt, type Chain } from "@fchecklist/veridian-ui-kit/shell";

export type ControlStripProps = {
  chain: Chain;
  /** Cut the chain from this segment onward. The parent MUST route this
   *  through cutChainFrom(), which refuses to reach into the root. */
  onCutFrom: (index: number) => void;
  onSegmentClick?: (index: number) => void;
  onHome: () => void;
  onReset: () => void;
  /**
   * The ONE state-derived instruction (A-01). Rendered alone when the chain is
   * empty, and after the last segment when there is one -- so the strip always
   * says what the next step is, and never contradicts the Send button.
   */
  prompt?: string;
};

export function ControlStrip({ chain, onCutFrom, onSegmentClick, onHome, onReset, prompt }: ControlStripProps) {
  const empty = chain.segments.length === 0;

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-[12px]">
      {/* THE CHAIN, as one sentence. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {empty ? (
          // M24: "EMPTY STATES MUST PROMPT, NEVER LOOK BROKEN." The prompt is
          // the caller's state-derived sentence, not a fixed string, so it can
          // name the actual missing step.
          <span className="truncate" style={{ color: "var(--color-ct-muted)" }} data-testid="composer-prompt">
            {prompt}
          </span>
        ) : (
          <>
            {chain.segments.map((seg, i) => {
              const cuttable = canCutAt(chain, i);
              const isLast = i === chain.segments.length - 1;
              return (
                <span key={seg.id} className="flex min-w-0 items-center gap-1">
                  {i > 0 && (
                    <span aria-hidden style={{ color: "var(--color-ct-border2)" }}>
                      ›
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onSegmentClick?.(i)}
                    className="max-w-[22ch] truncate rounded px-1 py-0.5"
                    style={{
                      // ONE SIZE, THREE WEIGHTS (M24): root bold, current step
                      // heaviest, earlier steps lighter. You read your POSITION
                      // without reading the WORDS.
                      color: "var(--color-ct-navy)",
                      fontWeight: seg.kind === "root" ? 600 : isLast ? 700 : 400,
                      opacity: seg.kind === "root" || isLast ? 1 : 0.72,
                    }}
                    title={seg.label}
                  >
                    {seg.label}
                  </button>
                  {cuttable && (
                    // Shown on the thing being removed, per M24. Rendered only
                    // where canCutAt() allows -- the root never gets one, so the
                    // project cannot be removed even by a misdirected click.
                    <button
                      type="button"
                      onClick={() => onCutFrom(i)}
                      aria-label={`Remove ${seg.label} and everything after it`}
                      title={`Remove ${seg.label} and everything after it`}
                      className="veri-icon-btn"
                      style={{ width: 18, height: 18, fontSize: 11 }}
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
            {prompt && (
              <span className="flex min-w-0 items-center gap-1">
                <span aria-hidden style={{ color: "var(--color-ct-border2)" }}>
                  ›
                </span>
                <span className="truncate" style={{ color: "var(--color-ct-muted)" }} data-testid="composer-prompt">
                  {prompt}
                </span>
              </span>
            )}
          </>
        )}
      </div>

      {/* WORDS, not icons. HISTORY is deliberately absent -- see the header. */}
      <button type="button" onClick={onHome} className="veri-view-tab shrink-0" style={{ letterSpacing: "0.02em" }}>
        HOME
      </button>

      {/* (reset): the quiet glyph, at the FAR END. Labelled for assistive tech
          even though it is drawn quiet. */}
      <button
        type="button"
        onClick={onReset}
        aria-label="Reset the chain"
        title="Reset the chain"
        className="veri-icon-btn shrink-0"
        style={{ width: 22, height: 22 }}
      >
        ↺
      </button>
    </div>
  );
}
