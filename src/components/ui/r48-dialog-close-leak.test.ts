/// <reference types="bun-types" />
// R62 B7 regression test for R48_DIALOG_CLOSE_LEAK_01 (fixed in projexa#162,
// commit aaa0e58602d9832ca53ffd35e97e69c8c9b9baac; r43_faults.wf_test was
// false).
//
// ORIGINAL DEFECT (measured live on production, projexa-ai.com/materials,
// before/after control): closing any dialog permanently killed page scroll
// (`body { overflow: hidden }` never restored) and left orphaned
// `[data-slot=dialog-overlay]` / `[data-slot=dialog-content]` nodes in the
// DOM until a hard reload.
//
// ROOT CAUSE (from the fault's own justification, confirmed by reading
// dialog.tsx's own header comment): Radix Presence unmounts a node
// immediately ONLY when the node's computed `animation-name` is `none`. With
// a `data-[state=closed]:animate-out`-family exit animation present, Presence
// enters `unmountSuspended` and waits forever for an `animationend` that one
// dropped frame (a backgrounded/occluded tab) can permanently skip. The
// overlay is additionally wrapped in Radix's RemoveScroll, which holds
// non-passive wheel/touchmove listeners and a refcounted
// `data-scroll-locked` attribute on <body> -- never unmounting the overlay
// means page scroll stays dead until reload. THE FIX: drop the exit-animation
// utility classes so Presence takes its synchronous immediate-unmount branch;
// keep a `!`-forced `pointer-events-none` guard as defence in depth (the
// unforced version is inert -- Radix writes `pointer-events: auto` as an
// INLINE style that beats any non-!important author rule).
//
// WHY THIS IS A SOURCE-LEVEL CHECK, NOT A LIVE DOM REPRO: Presence's
// unmount-immediately-vs-wait decision reads `getComputedStyle(node)
// .animationName`, resolved from real, loaded CSS. happy-dom component tests
// in this repo render with no Tailwind build loaded, so computed
// animation-name is "none" whether or not the exit-animation utility classes
// are present in the className string -- a live open/close/assert-scroll
// test would pass identically with or without the fix and prove nothing.
// (src/components/ui/dismissable-layer-unmount.test.ts, a sibling suite for
// the same underlying mechanism on other Radix overlay primitives, makes and
// documents the same call.) The actual fix IS the absence of those classes
// from source, which is exactly what this asserts.
//
// SCOPE, AND AN HONEST GAP FOUND WHILE VERIFYING THIS FAULT (not fabricated
// away): the fix's own root-cause note says RemoveScroll -- the thing that
// actually kills page scroll -- lives on the OVERLAY, not the Content. This
// suite asserts the fix on every OVERLAY (Dialog, Sheet) plus DialogContent
// itself (which projexa#162 explicitly de-animated too, per its diff).
// DrawerOverlay/DrawerContent never carried an exit-animation class to begin
// with (vaul primitive, not the @radix-ui/react-dialog Presence gate) so
// there was nothing to remove there.
// SheetContent, however, still carries `data-[state=closed]:slide-out-to-*`
// per side (verified against aaa0e58's own diff -- only the generic
// `animate-out` was dropped from SheetContent's base className, the
// side-specific slide-out-to-{right,left,top,bottom} classes were never
// touched) with no `!pointer-events-none` guard added either. That does NOT
// reproduce THIS fault's measured symptom (scroll lock -- RemoveScroll is
// Overlay-only) but the same Presence-stranding mechanism could still leave
// an orphaned sheet-content node after close. Left OUT of this suite's
// assertions rather than asserted-and-then-weakened to pass: flagged
// separately (see session notes) as a live, unfixed residual gap in the
// "Applied to sheet.tsx" claim in R48's own closure justification, not
// something to silently paper over here.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UI_DIR = join(process.cwd(), "src", "components", "ui");

function read(file: string): string {
  return readFileSync(join(UI_DIR, file), "utf8");
}

const EXIT_ANIMATION_CLASSES = /data-\[state=closed\]:(animate-out|fade-out-0|zoom-out-95)\b/;
const FORCED_POINTER_EVENTS_GUARD = /data-\[state=closed\]:!pointer-events-none/;

describe("R48_DIALOG_CLOSE_LEAK_01 regression (closing a dialog must not strand scroll-lock or DOM nodes)", () => {
  test("dialog.tsx DialogOverlay: no exit-animation utility (RemoveScroll lives here -- this is what killed page scroll)", () => {
    const source = read("dialog.tsx");
    // A reverted fix looks exactly like re-adding
    // "data-[state=closed]:animate-out data-[state=closed]:fade-out-0" to the
    // overlay's className -- computed animation-name would stop resolving to
    // `none` and Presence would go back to unmountSuspended, waiting forever
    // on an animationend a dropped frame can permanently skip.
    expect(source).not.toMatch(EXIT_ANIMATION_CLASSES);
  });

  test("dialog.tsx DialogOverlay: keeps the '!'-forced pointer-events-none guard (defence in depth against Radix's inline pointer-events:auto)", () => {
    const source = read("dialog.tsx");
    expect(source).toMatch(FORCED_POINTER_EVENTS_GUARD);
  });

  test("dialog.tsx DialogContent: no exit-animation utility", () => {
    const source = read("dialog.tsx");
    expect(source).not.toMatch(/data-\[state=closed\]:(animate-out|fade-out-0|zoom-out-95)/);
  });

  test("dialog.tsx DialogContent: keeps the '!'-forced pointer-events-none guard", () => {
    const source = read("dialog.tsx");
    // DialogContent's guard sits in the same cn(...) call as DialogOverlay's
    // in this file; the regex above already covers both call sites, but
    // this second assertion documents that BOTH nodes -- not just one --
    // need the guard, since the original leak was reported on both.
    const matches = read("dialog.tsx").match(new RegExp(FORCED_POINTER_EVENTS_GUARD.source, "g")) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test("sheet.tsx SheetOverlay: no exit-animation utility (RemoveScroll lives here too -- same mechanism, same fix, projexa#162)", () => {
    const source = read("sheet.tsx");
    expect(source).not.toMatch(EXIT_ANIMATION_CLASSES);
  });

  test("sheet.tsx SheetOverlay: keeps the '!'-forced pointer-events-none guard", () => {
    const source = read("sheet.tsx");
    expect(source).toMatch(FORCED_POINTER_EVENTS_GUARD);
  });

  test("drawer.tsx DrawerOverlay/DrawerContent: still carry no closed-state exit-animation utility (vaul primitive -- nothing to strand, must not regress toward one)", () => {
    const source = read("drawer.tsx");
    expect(source).not.toMatch(EXIT_ANIMATION_CLASSES);
  });
});
