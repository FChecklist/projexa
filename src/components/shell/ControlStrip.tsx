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
//     a row click LOADS the chain and stops. R67 WS-C (C-10) independently
//     reached the same finding and kept a HISTORY shortcut on the strip,
//     wired to focus that same tab; this merge (D-11) keeps WS-A's fuller
//     removal, which is the deliberate, reasoned version -- adding the
//     shortcut back would be reopening a decision WS-A already made, not
//     folding in a distinct capability.
//
//  3. ONE INSTRUCTION, NOT TWO. The kit hard-coded "Select a module to begin"
//     here while the product wrote "Pick a project or a module first" beside
//     the Send button -- two sentences telling the user two different things
//     about the same state. The strip now renders ONE caller-supplied,
//     state-derived `prompt`, and the composer reuses that same string as the
//     Send button's tooltip rather than printing it a second time.
//
//  4. THE PROJECT NAME FOLDS AT A WORD (A-06). CSS `truncate` cuts wherever
//     the pixel budget runs out, so "Cedar Heights Villa - Phase 1" rendered
//     as "Cedar Heights Vil…" -- an unreadable half-name in the one place this
//     product cannot afford ambiguity about which project is being written to.
//     Fixed segments now fold at the last whole word and carry the full name
//     as a title, so nothing is lost, only folded.
//
//  5. A LOADED CHAIN SAYS SO (A-09). A sentence restored from the Task
//     Master's History tab is not one the user built here, and it is cleared
//     on the next navigation unless they pin it. The strip is where that fact
//     belongs, because the strip is what would otherwise be lying.
//
//  6. EVERY CONTROL CARRIES A WORD AND A 44 PX TARGET (A-18). "×" became
//     "Remove", "↺" became "Reset", and the loaded-chain star became
//     "Pin"/"Pinned". All three were glyphs under 24 px whose meaning had to be
//     guessed or discovered by pressing them -- on controls that DESTROY what
//     the user has built. The glyphs are kept beside the words as decoration
//     and the hover titles are kept as supplementary text; neither is the only
//     label any more, and the accessible names are unchanged.
//
// UNCHANGED AND DELIBERATELY SO: the (x) still routes through cutChainFrom()
// via the caller, canCutAt() still refuses to offer one on the root, and the
// grammar is still ENTITY > ACTION > STEP read as one sentence.

import { canCutAt, type Chain } from "@fchecklist/veridian-ui-kit/shell";
import { truncateSegmentLabel } from "@/lib/module-catalogue";

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
   *
   * Optional, but it FALLS BACK rather than rendering nothing (lane G, G-04):
   * M24's rule is "empty states must prompt, never look broken", and a strip
   * asked to render an empty chain with no prompt was rendering an empty box.
   * In the running app M24Shell always passes its own state-derived sentence,
   * so the fallback is the component keeping its own promise, not a string the
   * user is expected to meet.
   */
  prompt?: string;
  /**
   * A-09. Set only when the chain on screen was LOADED from history rather
   * than built here. It says so, in words, and offers the one control that
   * changes what happens next: a pin, which keeps the chain across a
   * navigation instead of letting it be cleared as another screen's task.
   */
  loaded?: {
    /** Where it came from, e.g. "Work Progress". */
    from: string | null;
    pinned: boolean;
    onTogglePin: () => void;
  } | null;
};

export function ControlStrip({
  chain,
  onCutFrom,
  onSegmentClick,
  onHome,
  onReset,
  prompt,
  loaded,
}: ControlStripProps) {
  const empty = chain.segments.length === 0;

  return (
    // A-18: the row's own padding comes down as the controls in it grow to
    // their 44 px minimum, so the strip stays one band rather than becoming two.
    <div className="flex items-center gap-2 px-3 py-1 text-[12px]">
      {/* THE CHAIN, as one sentence. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {empty ? (
          // M24: "EMPTY STATES MUST PROMPT, NEVER LOOK BROKEN." The prompt is
          // the caller's state-derived sentence, not a fixed string, so it can
          // name the actual missing step.
          //
          // The fallback is deliberately applied HERE and not as a default on
          // the prop: `prompt` is also rendered after the last segment below,
          // and a default there would print "Select a module to begin" at the
          // end of a chain the user has already built -- the contradictory
          // second instruction A-10 exists to remove. Empty chain only.
          <span className="truncate" style={{ color: "var(--color-ct-muted)" }} data-testid="composer-prompt">
            {prompt ?? "Select a module to begin"}
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
                    // REBASE RECONCILIATION, lane A (A-06) x lane G (G-04).
                    // Both lanes forked this file to stop the ROOT reading
                    // "Cedar Heights Vil...". A-06 folded the label at the last
                    // whole word; G-04 stopped cutting the root at all and let
                    // it wrap to two lines. G's is kept for the root because it
                    // serves A-06's OWN stated goal more completely: nothing is
                    // cut, so the full project name is in the DOM for a screen
                    // reader and for copy, and two projects sharing a 22-char
                    // prefix can no longer render as the same string. Two lines
                    // is a hard cap so the strip cannot push the bands down.
                    //
                    // LATER SEGMENTS KEEP BOTH MECHANISMS. G's reasoning holds
                    // -- there the sentence's shape carries position and one
                    // line matters more than the whole word -- but the fold and
                    // the CSS cap measure different things: the fold counts
                    // CHARACTERS and cuts at a word, `truncate` counts PIXELS
                    // and is the backstop for a label whose 22 characters are
                    // still too wide. Either alone leaves a case uncovered.
                    className={
                      seg.kind === "root"
                        ? "shrink-0 rounded px-1 py-0.5 text-left max-w-[34ch] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
                        : "shrink-0 rounded px-1 py-0.5 whitespace-nowrap truncate max-w-[22ch]"
                    }
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
                    {seg.kind === "root" ? seg.label : truncateSegmentLabel(seg.label, 22)}
                  </button>
                  {cuttable && (
                    // Shown on the thing being removed, per M24. Rendered only
                    // where canCutAt() allows -- the root never gets one, so the
                    // project cannot be removed even by a misdirected click.
                    //
                    // R67 A-18 -- THE WORD, NOT THE GLYPH. It was an 18 x 18
                    // "×". A multiplication sign is not a verb; it is read as
                    // "close" by some people and "delete this one item" by
                    // others, when what it actually does is cut the sentence
                    // from here to the end. And 18 px is under half the 44 px a
                    // finger needs, on a control that DESTROYS part of what the
                    // user has built. The accessible name still says exactly
                    // what will happen -- the visible word is its first word.
                    <button
                      type="button"
                      onClick={() => onCutFrom(i)}
                      aria-label={`Remove ${seg.label} and everything after it`}
                      title={`Remove ${seg.label} and everything after it`}
                      className="veri-view-tab"
                      style={{ minWidth: 44, minHeight: 44 }}
                    >
                      Remove
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

      {/* A-09 -- A LOADED CHAIN SAYS SO. A sentence restored from history is
          not one the user just built, and on the next navigation it would
          otherwise be silently cleared as another screen's task. The label
          admits where it came from, and the pin is the one control that
          changes that outcome. */}
      {loaded && (
        <span className="flex shrink-0 items-center gap-1 text-[11px]" style={{ color: "var(--color-ct-muted)" }}>
          <span>{loaded.pinned && loaded.from ? `from ${loaded.from}` : "Loaded from history"}</span>
          {/* A-18: the same pin, the same word. Two stars differing only by
              fill were the whole of the affordance here too. */}
          <button
            type="button"
            onClick={loaded.onTogglePin}
            aria-label={
              loaded.pinned
                ? "Pinned: this loaded chain is kept when you navigate"
                : "Pin this loaded chain so it survives navigation"
            }
            aria-pressed={loaded.pinned}
            title={loaded.pinned ? "Pinned — kept across screens" : "Pin — keep across screens"}
            className="veri-view-tab"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <span aria-hidden style={{ color: "var(--color-ct-saffron)" }}>
              {loaded.pinned ? "★" : "☆"}
            </span>
            {loaded.pinned ? "Pinned" : "Pin"}
          </button>
        </span>
      )}

      {/* WORDS, not icons. HISTORY is deliberately absent -- see the header.
          A-18: sized with the row, so the three controls at this end are one
          band rather than a 44 px button beside a 22 px one. */}
      <button
        type="button"
        onClick={onHome}
        className="veri-view-tab shrink-0"
        style={{ letterSpacing: "0.02em", minWidth: 44, minHeight: 44 }}
      >
        HOME
      </button>

      {/* R67 A-18 -- RESET IS A WORD NOW. It was "↺", a 22 x 22 glyph whose
          meaning had to be guessed at or discovered by pressing it -- and what
          it does is throw away everything the user has built in the strip and
          in the box (A-09 widened it to exactly that), which is the last
          control in this composer that should be discoverable only by trying
          it. The hover title is kept, but as supplementary text: it is no
          longer the only label. */}
      <button
        type="button"
        onClick={onReset}
        aria-label="Reset the chain"
        title="Reset the chain"
        className="veri-view-tab shrink-0"
        style={{ minWidth: 44, minHeight: 44 }}
      >
        <span aria-hidden className="mr-1" style={{ color: "var(--color-ct-muted)" }}>
          ↺
        </span>
        Reset
      </button>
    </div>
  );
}
