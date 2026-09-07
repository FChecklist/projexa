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

import type { ReactNode } from "react";
// COMPOSER_RESTING_HEIGHT is defined in the KIT's own Composer.tsx, not this
// repo's fork of it (that file only re-imports the constant, it does not
// define or re-export it) -- so this import goes straight to the kit, same
// as this repo's own Composer.tsx does for the same constant.
import { COMPOSER_RESTING_HEIGHT } from "@fchecklist/veridian-ui-kit/shell";

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
};

/** M24: LEFT 30% / RIGHT 70%. Unchanged from the kit. */
export const LEFT_PANE_PERCENT = 30;

export function AppShell({ topRail, taskMaster, children, composer, composerReserveExtra = 0 }: AppShellProps) {
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
          className="relative flex min-h-0 shrink-0 flex-col border-r"
          style={{
            width: `${LEFT_PANE_PERCENT}%`,
            borderColor: "var(--color-ct-border)",
          }}
          aria-label="Task Master"
        >
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            style={{
              paddingBottom: COMPOSER_RESTING_HEIGHT + composerReserveExtra,
              scrollbarGutter: "stable",
            }}
          >
            {taskMaster}
          </div>
          {composer}
        </aside>

        {/* The ERP pane: no bottom padding reserved any more -- the composer
            never overlays this pane, so it gets its full height back. */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
