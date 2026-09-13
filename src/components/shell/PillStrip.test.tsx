/// <reference types="bun-types" />
// R-92 (platform.sumeet_requirements, Supabase project pcrjmlpuqsbocqfwoxod) --
// THE ONE "YOU ARE HERE" PILL IN THE EXPANDED "ALL MODULES" LIST.
//
// FOUND LIVE, PillStrip.tsx's expanded catalogue computed `entry.pressed`
// (from pill-routes.ts's isPillRouteOpen, itself driven by
// MODULE_CATALOGUE/PILL_ROUTES -- the existing single source of truth for
// modules/pills/routes, per the owner's own requirement that this stay
// data-driven rather than a new hardcoded per-route table) and rendered
// `aria-pressed` plus a `.active` CSS class from it, but:
//
//   1. never rendered `aria-current`, which is the ARIA attribute a
//      navigation-style "you are here" list is actually supposed to carry
//      (`aria-pressed` is a toggle-button state, a different thing to a
//      screen reader); and
//   2. applied `disabled:opacity-45` to EVERY non-pressed pill, unconditionally
//      -- including the one pill that WAS pressed, which washed its own
//      `.active` highlight (white background + shadow) down to 45% opacity,
//      visually cancelling the one highlight the class exists to draw.
//
// This asserts both halves of the fix directly against the real component:
// the pressed entry gets `aria-current="page"` and drops `disabled:opacity-45`
// from its className (while keeping `.active`); a non-pressed entry gets
// neither -- no `aria-current`, and it DOES still carry `disabled:opacity-45`
// (unchanged for every pill that is not "you are here").
//
// Nothing here hardcodes a route or a pill: `pressed` is passed in exactly as
// M24Shell.tsx computes it (via isPillRouteOpen), so this test is agnostic to
// which modules/pills exist.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard as every other happy-dom suite in this repo.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { PillStrip, type ModuleEntryView } from "./PillStrip";

afterEach(cleanup);

const PRESSED_ENTRY: ModuleEntryView = {
  id: "permits",
  label: "Permits",
  // A-12's own real shape: the "you are here" pill is also the one entry
  // `unavailable` is set for today (PillStrip.tsx's own comment) -- kept here
  // so this test exercises the SAME combination the live bug was found in,
  // not a simplified case that happens not to trigger it.
  unavailable: "you are here",
  pressed: true,
};

const OTHER_ENTRY: ModuleEntryView = {
  id: "scope",
  label: "Scope",
  pressed: false,
};

function renderExpanded(entries: readonly ModuleEntryView[]) {
  return render(
    <PillStrip
      cards={[]}
      onSelect={() => {}}
      expanded
      onToggleExpanded={() => {}}
      allModules={entries}
      onSelectModule={() => {}}
    />
  );
}

function pillFor(container: HTMLElement, label: string): HTMLElement {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  if (!button) throw new Error(`no pill button found for "${label}"`);
  return button;
}

describe("R-92: the active All-modules pill carries aria-current and keeps its highlight", () => {
  test("the pressed ('you are here') pill has aria-current=page and no disabled:opacity-45", () => {
    const { container } = renderExpanded([PRESSED_ENTRY, OTHER_ENTRY]);
    const pill = pillFor(container, "Permits");

    expect(pill.getAttribute("aria-current")).toBe("page");
    expect(pill.className).not.toContain("disabled:opacity-45");
    // .active still draws the real highlight -- untouched by this fix.
    expect(pill.className).toContain("active");
    // aria-pressed is kept alongside aria-current, not replaced by it.
    expect(pill.getAttribute("aria-pressed")).toBe("true");
  });

  test("a non-pressed pill has neither aria-current nor a dropped disabled:opacity-45", () => {
    const { container } = renderExpanded([PRESSED_ENTRY, OTHER_ENTRY]);
    const pill = pillFor(container, "Scope");

    expect(pill.getAttribute("aria-current")).toBeNull();
    // Unchanged behaviour for every pill that is NOT "you are here": it still
    // carries the class (the CSS pseudo-class only bites when `disabled` is
    // also true, which this entry's own `unavailable` being unset means it
    // is not -- but the class itself must still be present).
    expect(pill.className).toContain("disabled:opacity-45");
    expect(pill.className).not.toContain("active");
    // entry.pressed is `false` here, not absent -- `false ?? undefined` stays
    // `false` (only null/undefined fall through `??`), so this renders the
    // literal string "false", not an omitted attribute.
    expect(pill.getAttribute("aria-pressed")).toBe("false");
  });
});
