"use client";

// PROJEXA'S FORK of @fchecklist/veridian-ui-kit/shell/ControlStrip.tsx
// (kit 0.7.0, commit 8134e07), taken under programme decision D-09: the kit
// source is not on this machine and is not published, so a behaviour change
// is made by forking the one file and leaving every other kit import alone.
// Everything this file needs from the kit -- CHAIN_MODES, canCutAt and the
// Chain types -- is still imported from the kit, so the chain's two
// safety-critical rules stay the kit's.
//
// THE ONE CHANGE, R67 G-04 (R-231): the chain's ROOT segment no longer
// truncates. Every segment used to carry `max-w-[22ch] truncate`, which meant
// the project the user had just chosen rendered as
// "Cedar Heights Villa - Phas...". That is the worst possible thing to clip:
// it is the answer to "which project am I working in", it is the one segment
// the (x) may never remove, and two projects on the same estate can share the
// first 22 characters, so the strip could show an identical string for two
// different roots. The root now wraps to at most two lines and keeps its
// title on hover; every later segment keeps the original truncation, because
// there the sentence's SHAPE is what carries position, and a long step name
// clipping is a cost worth paying to keep the strip one line tall.
//
// ------------------------- the kit's own notes ---------------------------
// M24, the top line INSIDE the composer box (M24-A moved it inside):
//   Mode: Projects | Oakwood > Scope > Import BOQ (x) | HISTORY  HOME  (reset)
//
// THE GRAMMAR IS ENTITY > ACTION > STEP AND IT MUST READ AS ONE SENTENCE.
// M24: "TEST EVERY FUTURE CHANGE AGAINST: does it still read as one sentence?"
//
// M24: "NOTHING ON THE STRIP IS AN ICON-ONLY CONTROL. Every one is a word. An
// icon you must learn is a puzzle; a site engineer must read this on his first
// morning." HISTORY and HOME are words for exactly that reason. The single
// exception M24 itself writes as a glyph is (reset), which it calls "the quiet
// glyph at the FAR END - deliberately far from HISTORY, which is the
// most-clicked control on the strip". It still carries a real label for
// assistive tech and a title on hover, so it is quiet, not unlabelled.
//
// BAND RULE: this band answers "what task am I building". Screen controls
// (Filter / Export / + New) belong to RightPaneHeader and must never be added
// here -- M24 rejected putting the chain in both places: ONE CHAIN, ONE PLACE.

import { CHAIN_MODES, canCutAt, type Chain, type ChainMode } from "@fchecklist/veridian-ui-kit/shell";

export type ControlStripProps = {
  chain: Chain;
  onModeChange: (mode: ChainMode) => void;
  /** Cut the chain from this segment onward. The parent MUST route this
   *  through cutChainFrom(), which refuses to reach into the root. */
  onCutFrom: (index: number) => void;
  onSegmentClick?: (index: number) => void;
  onToggleHistory: () => void;
  onHome: () => void;
  onReset: () => void;
  historyOpen?: boolean;
};

export function ControlStrip({
  chain,
  onModeChange,
  onCutFrom,
  onSegmentClick,
  onToggleHistory,
  onHome,
  onReset,
  historyOpen = false,
}: ControlStripProps) {
  const empty = chain.segments.length === 0;

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-[12px]">
      {/* MODE -- the entity the chain roots on. Uses the kit's existing
          .veri-mode-pill, not a new class (M24-B: most of this UI is assembly
          of classes that already exist). */}
      <div className="flex shrink-0 items-center gap-0.5 rounded-full p-0.5" style={{ background: "var(--color-ct-cloud)" }}>
        {CHAIN_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onModeChange(m.id)}
            className={`veri-mode-pill${chain.mode === m.id ? " active" : ""}`}
            aria-pressed={chain.mode === m.id}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* THE DIVIDER AFTER MODE. M24 names this exact divider as the marker for
          the boundary (x) may never cross. It is load-bearing, not decoration. */}
      <span aria-hidden className="h-4 w-px shrink-0" style={{ background: "var(--color-ct-border2)" }} />

      {/* THE CHAIN, as one sentence. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {empty ? (
          // M24: "EMPTY STATES MUST PROMPT, NEVER LOOK BROKEN."
          <span className="truncate" style={{ color: "var(--color-ct-muted)" }}>
            Select a module to begin
          </span>
        ) : (
          chain.segments.map((seg, i) => {
            const cuttable = canCutAt(chain, i);
            const isLast = i === chain.segments.length - 1;
            const isRoot = seg.kind === "root";
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
                  className={
                    isRoot
                      ? // R67 G-04: the root wraps instead of truncating. Two
                        // lines is the cap -- beyond that the strip would grow
                        // without bound and push the composer's own bands
                        // down, which is the reflow class R48_LAYOUT_REFLOW_01
                        // was fixed to eliminate. `text-left` because a
                        // wrapped button's default centring would make a
                        // two-line project name read as a heading.
                        "max-w-[34ch] rounded px-1 py-0.5 text-left leading-[1.15] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden [overflow-wrap:anywhere]"
                      : "max-w-[22ch] truncate rounded px-1 py-0.5"
                  }
                  style={{
                    // ONE SIZE, THREE WEIGHTS (M24): root bold, current step
                    // heaviest, earlier steps lighter. You read your POSITION
                    // without reading the WORDS.
                    color: "var(--color-ct-navy)",
                    fontWeight: isRoot ? 600 : isLast ? 700 : 400,
                    opacity: isRoot || isLast ? 1 : 0.72,
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
          })
        )}
      </div>

      {/* WORDS, not icons. */}
      <button
        type="button"
        onClick={onToggleHistory}
        aria-expanded={historyOpen}
        className="veri-view-tab shrink-0"
        style={{ letterSpacing: "0.02em" }}
      >
        HISTORY
      </button>
      <button type="button" onClick={onHome} className="veri-view-tab shrink-0" style={{ letterSpacing: "0.02em" }}>
        HOME
      </button>

      {/* (reset): the quiet glyph, at the FAR END, deliberately far from
          HISTORY. Labelled for assistive tech even though it is drawn quiet. */}
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
