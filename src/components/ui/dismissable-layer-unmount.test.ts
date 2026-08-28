/// <reference types="bun-types" />
// R62 B7 regression test for R43 F_035 (RfisClient.tsx) and F_036
// (QuotationsClient.tsx), both closed via PR #176. Their own r43_faults
// justifications record that these two fault rows (plus F_037/F_009/F_011)
// were all misdiagnosed as component-level wiring bugs and are actually one
// mechanism, verified in src/components/ui/dialog.tsx's own DialogOverlay
// comment:
//
//   Radix Presence unmounts a portal node immediately ONLY when the
//   computed animation-name is `none`. With an exit animation present it
//   goes to unmountSuspended and waits for `animationend` FOREVER -- one
//   dropped frame (a backgrounded/occluded tab) strands the node
//   permanently. While a MODAL layer is open, Radix's DismissableLayer sets
//   document.body.style.pointerEvents = "none"; that is only ever restored
//   by the layer's own unmount cleanup. A stranded layer never runs that
//   cleanup, so `document.body { pointer-events: none }` sticks for the
//   rest of the session and EVERY control on the page -- inputs, links,
//   correctly-wired onClicks alike -- goes inert with no console error and
//   no network request.
//
// dialog.tsx/sheet's own fix (projexa#162) already dropped the exit
// animation there. #176 extended the SAME fix to the other five primitives
// that also mount a DismissableLayer and are used app-wide (the shell mounts
// DropdownMenu on every route via AccountMenu/NotificationBell) -- so any
// route, not just /rfis or /quotations, could be taken down by one of them.
//
// WHY THIS IS A SOURCE-LEVEL CHECK, NOT A LIVE DOM REPRO: Presence decides
// its unmount path from `getComputedStyle(node).animationName`, which is
// resolved from real, loaded CSS. These component tests render with no
// stylesheet loaded (happy-dom, no Tailwind build), so computed
// animation-name is "none" whether or not the "animate-out"/"zoom-out"/
// "fade-out"/"slide-out" utility classes are present in the className string
// -- a live open/close/assert-body-pointer-events test would pass identically
// with or without the fix in this environment, and would prove nothing. The
// actual fix is the ABSENCE of those exit-animation utility classes from
// these six files' source, which is exactly what this test asserts, the same
// approach src/lib/no-swallowed-http-errors.test.ts already uses in this repo
// for a different fix that is likewise not expressible as live DOM behavior
// in a stylesheet-less test.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UI_DIR = join(process.cwd(), "src", "components", "ui");

// The six primitives #176 fixed (F_035/F_036's own justification names all
// six explicitly), plus dialog.tsx as the already-fixed baseline that must
// not regress either.
const FILES = [
  "dialog.tsx",
  "alert-dialog.tsx",
  "select.tsx",
  "dropdown-menu.tsx",
  "context-menu.tsx",
  "menubar.tsx",
  "popover.tsx",
];

const EXIT_ANIMATION_CLASSES = /data-\[state=closed\]:(animate-out|fade-out-0|zoom-out-95|slide-out-to-\S+)/;

describe("Radix overlay primitives never reintroduce an exit animation that strands a DismissableLayer (R43 F_035/F_036)", () => {
  for (const file of FILES) {
    test(`${file}: no data-[state=closed]:animate-out (or fade-out/zoom-out/slide-out) exit-animation utility`, () => {
      const source = readFileSync(join(UI_DIR, file), "utf8");
      // A reverted fix looks exactly like re-adding
      // "data-[state=closed]:animate-out data-[state=closed]:fade-out-0" (or
      // the equivalent zoom-out/slide-out variants) to the overlay/content
      // className -- computed animation-name would stop resolving to `none`
      // and Presence would go back to unmountSuspended, waiting forever on
      // an animationend that a dropped frame can permanently skip.
      expect(source).not.toMatch(EXIT_ANIMATION_CLASSES);
    });

    test(`${file}: keeps the '!'-forced data-[state=closed]:pointer-events-none guard (defence in depth against a node stranded some other way)`, () => {
      const source = readFileSync(join(UI_DIR, file), "utf8");
      // Un-!-ed would be inert against Radix's own inline
      // `pointer-events: auto` (higher specificity) -- dialog.tsx's header
      // comment documents this was tried and measured to do nothing.
      expect(source).toMatch(/data-\[state=closed\]:!pointer-events-none/);
    });
  }
});
