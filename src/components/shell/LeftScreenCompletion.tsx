"use client";

// LEFT SCREEN COMPLETION -- Box 1 of PROJEXA's 2-box left panel.
//
// OWNER DIRECTIVE, 2026-09-14 (compiled by the orchestrating session from
// several live messages, relayed as a direct task assignment -- see that
// task's own prompt for the full quotes): "just keep two boxes / top left
// box - Modules, Tasks, Frequent Action, Reports, Dashboard, Home, Back /
// when the respective button pressed, the mode pill option selection
// changes dynamically / and similarly the right screen changes / WIRE IT
// PROPERLY / the bottom left box - is the chat box ... MAKE BOTH TOP LEFT
// BOX AND BOTTOM LEFT BOX OF EQUAL SIZES ... LETS CALL IT 'LEFT SCREEN
// COMPLETION'".
//
// WHAT THIS COMPONENT OWNS: the top box only -- the 7-control row (6
// selectable views + Back, with Reset kept as an 8th, de-emphasised control
// so the existing "clear everything" action is not lost -- see this file's
// own note on Reset below) and the single content region beneath it, which
// renders EXACTLY ONE view's content at a time. This is what makes the
// PillStrip/Composer overlap bug class (R80-BUGFIX 2026-09-14, fixed once
// already by mutual exclusivity + a scroll clip -- see M24Shell.tsx's
// `toggleAllPills`/`toggleTasks` and Composer.tsx's own history) impossible
// BY CONSTRUCTION rather than by another guard on top of two panels that can
// still both want space: there is only ever one content region here, full
// stop.
//
// WHAT THIS COMPONENT DOES NOT OWN: which of the 7 views is active, what
// each view's content actually is, and what pressing Back/Reset actually
// does. All of that is M24Shell.tsx's job -- this is a thin, presentational
// shell so the 7-view mechanism can be unit-tested on its own (see
// LeftScreenCompletion.test.tsx) independently of M24Shell's real bootstrap.
//
// THE CHAIN SENTENCE AND "LOADED FROM HISTORY" BANNER are reused here in
// simplified form (words only, no per-segment Remove buttons -- see
// ControlStrip.tsx for the fuller version this is adapted from). The
// per-segment (x) is not reproduced: the new Back control already walks
// back through a chain one segment at a time (M24Shell.tsx's `onLeftBack`
// reuses the exact same, already-tested cutChainFrom mechanism
// ControlStrip's own Back used), so nothing here loses the ability to
// remove a step -- only the "jump straight to segment N" shortcut is gone,
// traded for a much smaller, focused component.
import type { ReactNode } from "react";

export type LeftViewId = "modules" | "tasks" | "frequent" | "reports" | "dashboard" | "home";

export type LeftViewButton = { id: LeftViewId; label: string };

/** The 6 SELECTABLE views, in the order the owner named them. "Back" is the
 *  7th named control but is not a persistent view -- see this file's header
 *  -- so it is rendered as its own dedicated button, not a 7th tab. */
export const LEFT_VIEWS: readonly LeftViewButton[] = [
  { id: "modules", label: "Modules" },
  { id: "tasks", label: "Tasks" },
  { id: "frequent", label: "Frequent Action" },
  { id: "reports", label: "Reports" },
  { id: "dashboard", label: "Dashboard" },
  { id: "home", label: "Home" },
];

export type LeftScreenCompletionProps = {
  active: LeftViewId;
  onSelect: (view: LeftViewId) => void;
  /**
   * ALWAYS ENABLED, deliberately. The old ControlStrip Back was disabled
   * when there was nothing to cut (canGoBack/canCutAt) -- correct for its
   * narrower job, but this Back's job is now "step back through whatever
   * was just selected, or go Home", which per the owner's own spec text
   * ("a fall back to Home when there's no prior view") is ALWAYS a
   * meaningful action. A control that is sometimes a well-explained no-op
   * is worse here than the M24 rule this codebase already enforces
   * elsewhere: never leave a control dead with no explanation.
   */
  onBack: () => void;
  onReset: () => void;
  /** Words describing the chain built so far, e.g.
   *  "Cedar Heights Villa - Phase 1 › Permits › New". Null/empty renders no
   *  sentence line at all -- M24: "empty states must prompt, never look
   *  broken", but an EMPTY box asks for nothing prematurely. */
  chainSentence?: string | null;
  loaded?: {
    from: string | null;
    pinned: boolean;
    onTogglePin: () => void;
  } | null;
  /** A real backend-failure notice (shellErrors in M24Shell.tsx). Rendered
   *  above everything else, regardless of which view is active -- a failure
   *  must never be hidden behind a view the user has to think to open. */
  banner?: ReactNode;
  /** The active view's own content -- exactly one view's worth, never two. */
  children: ReactNode;
};

export function LeftScreenCompletion({
  active,
  onSelect,
  onBack,
  onReset,
  chainSentence,
  loaded,
  banner,
  children,
}: LeftScreenCompletionProps) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="left-screen-completion">
      {banner}

      {(chainSentence || loaded) && (
        <div
          className="flex shrink-0 items-center gap-2 border-b px-2 py-1 text-[11px]"
          style={{ borderColor: "var(--color-ct-border)" }}
        >
          {chainSentence && (
            <span
              className="min-w-0 flex-1 truncate"
              style={{ color: "var(--color-ct-navy)" }}
              title={chainSentence}
              data-testid="left-chain-sentence"
            >
              {chainSentence}
            </span>
          )}
          {/* A-09, carried over verbatim from ControlStrip.tsx: a sentence
              restored from history says so, and offers the one control that
              changes what happens next. */}
          {loaded && (
            <span className="flex shrink-0 items-center gap-1" style={{ color: "var(--color-ct-muted)" }}>
              <span>{loaded.pinned && loaded.from ? `from ${loaded.from}` : "Loaded from history"}</span>
              <button
                type="button"
                onClick={loaded.onTogglePin}
                aria-pressed={loaded.pinned}
                aria-label={
                  loaded.pinned
                    ? "Pinned: this loaded chain is kept when you navigate"
                    : "Pin this loaded chain so it survives navigation"
                }
                title={loaded.pinned ? "Pinned — kept across screens" : "Pin — keep across screens"}
                className="veri-view-tab"
                style={{ minWidth: 32, minHeight: 24 }}
              >
                {loaded.pinned ? "Pinned" : "Pin"}
              </button>
            </span>
          )}
        </div>
      )}

      {/* THE 7-CONTROL ROW. role="tablist"/"tab" on the 6 selectable views --
          exactly one is ever active, which is the real ARIA semantics for
          "pick one of these panels" (the same pattern TaskMaster.tsx's own
          status tabs already use in this codebase). Back and Reset are
          real buttons, not tabs: neither one is a panel that stays selected. */}
      {/* COMPACTED, 2026-09-14 (live-browser report: at a ~410px Box 1 width
          the 8 controls -- 6 views + Back + Reset, "Frequent Action" alone
          being the widest label -- wrapped to 3-4 lines under
          `.veri-view-tab`'s shared 5px/10px padding and 12px type, eating a
          large slice of the box's height before any content even started.
          `.veri-view-tab` itself is a shared, kit-wide class (used well
          beyond this one row) and is deliberately NOT touched here -- the
          buttons below override just their own padding/font-size/min-height
          inline, which wins over the shared class without changing it
          anywhere else it is used. This measurably reduces the wrap, it does
          not guarantee a single row at every width -- fitting all 8 on one
          line at ~410px would need a real content decision (shorter labels,
          icon-only controls with a tooltip, or an overflow menu), which is
          out of scope here and left for a follow-up design pass. */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-0.5 gap-y-0.5 border-b px-1.5 py-1"
        role="tablist"
        aria-label="Left panel views"
        style={{ borderColor: "var(--color-ct-border)" }}
      >
        {LEFT_VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={active === view.id}
            onClick={() => onSelect(view.id)}
            className={`veri-view-tab shrink-0 whitespace-nowrap${active === view.id ? " active" : ""}`}
            style={{ minHeight: 28, padding: "3px 7px", fontSize: 11 }}
          >
            {view.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onBack}
          aria-label="Back one step"
          title="Back one step"
          className="veri-view-tab shrink-0 whitespace-nowrap"
          style={{ minHeight: 28, padding: "3px 7px", fontSize: 11 }}
        >
          <span aria-hidden className="mr-1">
            ‹
          </span>
          Back
        </button>
        {/* RESET -- not one of the owner's 7 named controls, kept as an 8th,
            de-emphasised one rather than dropped outright: it is the only
            control in this codebase that clears an armed card/draft/prompt
            in one step (see M24Shell.tsx's onReset), which repeated Back
            presses do not reproduce (Back walks the chain back one segment
            at a time; it does not clear a typed draft or an armed function
            id). Removing a real, working, differently-scoped control to hit
            an exact count of 7 would be a regression the owner's own spec
            never asked for ("MOST CAN BE TAKEN FROM EXISTING"). */}
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset the chain"
          title="Reset the chain"
          className="veri-view-tab shrink-0 whitespace-nowrap"
          style={{ minHeight: 28, padding: "3px 7px", fontSize: 11, opacity: 0.75 }}
        >
          <span aria-hidden className="mr-1">
            ↺
          </span>
          Reset
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1" data-testid="left-view-content">
        {children}
      </div>
    </div>
  );
}
