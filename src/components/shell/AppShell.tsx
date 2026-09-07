"use client";

// FORKED from @fchecklist/veridian-ui-kit/shell/AppShell.tsx -- 2026-09-07,
// per the owner's explicit direction after extensive mockup review (this is
// the "just fixing the chat box position and how it is used, rest dont
// recreate, use existing as features, file path, objects etc" instruction).
//
// WHY A FORK AND NOT A KIT CHANGE (same reasoning as every other fork in this
// directory -- see Composer.tsx/ControlStrip.tsx/TopRail.tsx/PillStrip.tsx's
// own header comments): @fchecklist/veridian-ui-kit is a pinned git
// dependency whose source is not in this repo and is not published; a
// node_modules edit is erased by CI's `bun install --frozen-lockfile`.
//
// THE ONE THING THIS FILE CHANGES: where the composer renders. The kit's own
// AppShell docks the composer as a full-width overlay spanning BOTH panes at
// the bottom (see the kit file's own comment: "COMPOSER docked full width
// across both"). The owner's direction was the opposite: the composer
// belongs INSIDE the left (Task Master) pane, not floating over the right
// (ERP screen) pane at all -- a report, a Gantt, a BOQ table should never
// have the composer's box growing up over it.
//
// EVERYTHING ELSE THE KIT BUILT IS KEPT EXACTLY AS IS, on explicit
// instruction not to recreate what already works:
//   - LEFT_PANE_PERCENT (30/70 split) -- unchanged.
//   - Composer.tsx itself -- NOT forked further. Its root element already
//     uses `absolute inset-x-0 bottom-0` (see that file); moving WHICH
//     element it is now a child of is enough to relocate it, because
//     `inset-x-0` resolves against whatever positioned ancestor contains it.
//     Making that ancestor the aside (30% wide) instead of the full frame is
//     the entire mechanism -- Composer.tsx required zero edits.
//   - ControlStrip.tsx, TaskMaster (kit), PillStrip.tsx, TopRail.tsx -- all
//     reused exactly as already forked/shipped. Nothing in this file touches
//     their behaviour, only where the composer's existing DOM subtree mounts.
//   - The svh viewport-unit choice, the scrollbar-gutter fix, the h-full
//     min-h-0 flex plumbing -- all unchanged.
//
// WHAT HAD TO MOVE, and why, to make the relocation actually work:
//   - The aside gains `position: relative` (was static) -- this is what makes
//     Composer.tsx's own `absolute inset-x-0 bottom-0` resolve against the
//     aside's 30%-wide box instead of the full-width frame. Composer.tsx's
//     own file needed no change for this; only its new parent does.
//   - `overflow-hidden` moves OFF the aside itself and onto only the aside's
//     inner Task Master content div (as `overflow-y-auto`, matching what
//     `main` already does) -- the aside itself must allow the composer,
//     which is deliberately meant to grow UPWARD as an overlay past its
//     resting height, to overflow visually without being clipped. The kit's
//     original aside used `overflow-hidden` because it never had to host an
//     overlay of its own; the composer used to grow over the OUTER
//     relative container instead, which had no overflow constraint on it.
//   - The bottom-padding reservation for the composer's resting height
//     (COMPOSER_RESTING_HEIGHT + composerReserveExtra) moves from the shared
//     aside+main row onto the aside's own inner content only. The right pane
//     no longer needs to reserve ANY space for a composer that no longer
//     overlays it at all, and gets its full height back -- a real, positive
//     side effect of this change: the ERP screen (schedule, scope, reports,
//     every routed page) now has more usable vertical room than before.
//
// See platform.crr_ruling / the change document this session produced for
// the full before/after reasoning and the mockup iterations that led here.
//
// ADDENDUM 2, 2026-09-07 -- ONE SHARED CARD. The owner's own words,
// comparing the shipped shell against the frozen mock: "apply frozen mock
// ... keep functionality and flow of existing so that filepath are same."
// The frozen mock's left pane is ONE continuous white card -- Frequent
// actions, the chip row, the control bar and the input all share one
// border/background, nothing floats over anything else. What had shipped
// instead was two visually disconnected pieces: TaskMaster (kit) on a plain
// cream background, with Composer.tsx's OWN separately-carded white
// rounded-border box floating over it lower down -- correct data, correct
// controls, but reading as two stacked panels rather than the mock's one.
// Fixed by moving the card chrome UP a level: this aside now wraps
// {taskMaster} and {composer} together in ONE rounded/bordered white
// container; TaskMaster.tsx's own background changed from
// --color-ct-cream to transparent so it blends into that shared card
// (functionality untouched -- see that file's own note); Composer.tsx's
// root lost its OWN border/shadow/white-background (now redundant/doubled)
// but kept its `position:absolute inset-x-0 bottom-0` growth mechanism
// unchanged, anchored to this new wrapper instead of the aside directly.
// The wrapper deliberately has NO overflow-hidden, for the same reason the
// aside itself never did (see below): the composer is meant to grow
// upward past its resting height while composing a long message, and
// clipping it here would cut that off. Its own inner scrollable content
// (TaskMaster's list) already contains itself via its own overflow-y-auto,
// so nothing else needs the clip.
//
// ADDENDUM, 2026-09-07 -- `chainRail`. The mockup discussion that produced
// the composer relocation above kept going past it, through 16 more
// iterations, to one more explicit decision: the composer's chain-so-far
// (the same sentence ControlStrip.tsx already shows on the left, e.g. "All
// modules / Work progress / By activity", each segment removable) should
// ALSO be visible at the top of the right (ERP) pane -- the owner's own
// words, verbatim: "Merge it into the right panel's top rail." The first
// pass at this fork stopped short of that: it moved the composer correctly
// but never added this, which is the gap the owner flagged when comparing
// the shipped shell against the frozen mock. `chainRail` is that slot --
// optional, rendered by the caller (see ChainRail.tsx, which hides itself
// whenever the chain is empty or just the project root, so a page with no
// in-progress composer selection shows nothing extra here and its own
// existing breadcrumb/PageHeading stays the only navigation line, avoiding
// a duplicate project name in the common case). It reuses the SAME `chain`
// state M24Shell.tsx already threads to <Composer> -- no new state, no
// change to any of the ~90 individual page files under src/app/(app).
import type { ReactNode } from "react";
// COMPOSER_RESTING_HEIGHT is defined in the KIT's own Composer.tsx, not this
// repo's fork of it (that file only re-imports the constant, it does not
// define or re-export it) -- so this import goes straight to the kit, same
// as this repo's own Composer.tsx does for the same constant.
import { COMPOSER_RESTING_HEIGHT } from "@fchecklist/veridian-ui-kit/shell";

// ADDENDUM 3, 2026-09-07 -- see Composer.tsx's own header for why
// `composerReserveExtra` is now measured live rather than a fixed constant
// passed in from M24Shell.tsx. This file's own math (paddingBottom =
// COMPOSER_RESTING_HEIGHT + composerReserveExtra) is unchanged -- only what
// the caller now puts into composerReserveExtra changed.

export type AppShellProps = {
  /** <TopRail />. Always visible, never covered by the composer. */
  topRail: ReactNode;
  /** <TaskMaster />. The LEFT 30% -- now also hosts the composer. */
  taskMaster: ReactNode;
  /** The routed ERP screen -- the RIGHT 70%. No longer covered by the
   *  composer at any point; it keeps its full height at rest. */
  children: ReactNode;
  /** <Composer />. Docked at the bottom of the LEFT pane only, growing
   *  upward over the Task Master pane -- never over the ERP screen. */
  composer: ReactNode;
  /**
   * Additional px added on top of COMPOSER_RESTING_HEIGHT when reserving
   * space for the composer's own static resting footprint inside the left
   * pane (see COMPOSER_PILLS_BAND_RESERVE in Composer.tsx for why a caller
   * that always renders the pills band needs this). Zero by default.
   */
  composerReserveExtra?: number;
  /**
   * See the ADDENDUM above. A thin, optional strip rendered at the very top
   * of the RIGHT (ERP) pane, above `children` -- the composer's chain, made
   * visible from the right side too. Renders nothing (undefined/null) on a
   * screen with no in-progress composer chain, so it adds zero height and
   * zero visual noise on the common path.
   */
  chainRail?: ReactNode;
};

/** M24: LEFT 30% / RIGHT 70%. Unchanged from the kit. */
export const LEFT_PANE_PERCENT = 30;

export function AppShell({
  topRail,
  taskMaster,
  children,
  composer,
  composerReserveExtra = 0,
  chainRail,
}: AppShellProps) {
  return (
    // h-[100svh], not h-dvh -- unchanged from the kit; see its own comment on
    // why svh is the stable choice against a mobile URL bar.
    <div className="flex h-[100svh] flex-col overflow-hidden" style={{ background: "var(--color-ct-cream)" }}>
      {topRail}

      <div className="flex min-h-0 flex-1">
        {/* position: relative -- the ONLY structural addition this fork makes
            to the aside. It is what lets the composer (an unmodified child
            now, using its own existing `absolute inset-x-0 bottom-0`) anchor
            to THIS 30%-wide box instead of the full frame. No overflow
            constraint on the aside itself, so the composer may grow upward
            past its resting height without being clipped. */}
        <aside
          className="flex min-h-0 shrink-0 flex-col border-r p-2"
          style={{
            width: `${LEFT_PANE_PERCENT}%`,
            borderColor: "var(--color-ct-border)",
          }}
          aria-label="Task Master"
        >
          {/* ADDENDUM 2 above -- the one shared card. `position:relative` moved
              here (off the aside) so Composer.tsx's `absolute inset-x-0
              bottom-0` anchors to THIS box -- the card's own width, not the
              aside's padded outer edge. Deliberately no overflow-hidden: see
              the ADDENDUM for why clipping here would break the composer's
              grow-upward behaviour. */}
          <div
            className="relative flex min-h-0 flex-1 flex-col rounded-xl border"
            style={{ background: "#fff", borderColor: "var(--color-ct-border2)" }}
          >
            {/*
                ADDENDUM 4, 2026-09-07 -- A REAL HEIGHT, NOT SCROLL PADDING.
                This reserved the composer's space as `paddingBottom` inside
                the scrollable box, which only clears the composer once the
                list is scrolled all the way to ITS OWN end -- it does nothing
                for a list with more content than fits one screen (this one
                routinely has 30-40+ rows), because at a resting scroll
                position (top, or anywhere before the very end) whatever rows
                fall in the composer's fixed on-screen region render right
                behind it and the composer's z-index wins, covering their
                "Pick line"/"Dismiss"/"Choose project" buttons. Measured live:
                a scroll position showing rows 2-6 had SIX real action buttons
                sitting directly underneath the composer, completely
                unreachable. This predates today's unified-card change (the
                very first AppShell fork used the same paddingBottom
                technique) -- it read as "the composer floats over stuff"
                before, and reads as a broken merged card now, but the root
                cause and the fix are the same either way: give the list box
                itself a real, physically shorter height (not virtual
                scroll-end padding), so at ANY scroll position its own content
                never extends into the region the composer occupies.
            */}
            <div
              className="min-h-0 overflow-y-auto rounded-t-xl"
              style={{
                height: `calc(100% - ${COMPOSER_RESTING_HEIGHT + composerReserveExtra}px)`,
                scrollbarGutter: "stable",
              }}
            >
              {taskMaster}
            </div>
            {composer}
          </div>
        </aside>

        {/* The ERP pane: no bottom padding reserved any more -- the composer
            never overlays this pane, so it gets its full height back.
            chainRail sits inside the SAME scroll container as `children`
            (not a sibling with its own scroll region -- there is no reason
            to add a second one) but pinned via position:sticky so it reads
            as a top rail, staying visible while the routed screen's own
            content scrolls beneath it. It renders nothing on the common
            path (no in-progress chain), so it costs zero height then. */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
          {chainRail ? (
            <div className="sticky top-0 z-10" style={{ background: "var(--color-ct-cream)" }}>
              {chainRail}
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
