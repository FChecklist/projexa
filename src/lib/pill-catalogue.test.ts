/// <reference types="bun-types" />
// R67 WS-A (A-11, A-12, A-14). Three properties are worth guarding here,
// because all three are invisible to a reader and all three have regressed in
// this composer before:
//
//  1. THE LIST IS FROZEN AND IS HANDED OUT BY IDENTITY (A-14). The defect this
//     replaces pulled the last-clicked pill to the front and kept that order
//     across routes, so the same control sat somewhere different on every
//     screen. Asserting "two calls agree" is not enough -- a future caller
//     could still sort a copy. Asserting the SAME FROZEN ARRAY is.
//  2. EVERY PILL GOES SOMEWHERE (A-11/A-12). No entry renders without a
//     destination, and the four kit pills with no PROJEXA screen are gone.
//  3. THE SHORTCUTS ARE UNIQUE AND NEED THE MODIFIER (A-12). A bare letter
//     would make the composer's textarea unusable.

import { describe, test, expect } from "bun:test";
import {
  PILL_CATALOGUE,
  SHORTCUT_MODIFIER,
  matchPillShortcut,
  pillCatalogue,
  pillEntryById,
  shortcutLabel,
} from "./pill-catalogue";
import { SUMEET_MODULE_ORDER } from "./card-catalogue";
import { MODULE_CATALOGUE } from "./module-catalogue";

describe("PILL_CATALOGUE -- fixed, frozen, and handed out by identity", () => {
  test("pillCatalogue() returns the very same array every time", () => {
    expect(pillCatalogue()).toBe(PILL_CATALOGUE);
    expect(pillCatalogue()).toBe(pillCatalogue());
  });

  test("the array and every entry in it are frozen", () => {
    expect(Object.isFrozen(PILL_CATALOGUE)).toBe(true);
    for (const entry of PILL_CATALOGUE) expect(Object.isFrozen(entry)).toBe(true);
  });

  test("a caller cannot push, splice or re-order it in place", () => {
    const before = PILL_CATALOGUE.map((e) => e.id);
    // A frozen array rejects mutation silently in sloppy mode and throws in
    // strict mode; either way the order must survive the attempt.
    try {
      (PILL_CATALOGUE as PillEntryArray).push({ id: "x" });
    } catch {
      /* expected under strict mode */
    }
    try {
      (PILL_CATALOGUE as PillEntryArray).reverse();
    } catch {
      /* expected under strict mode */
    }
    expect(PILL_CATALOGUE.map((e) => e.id)).toEqual(before);
  });

  test("Sumeet's eleven modules come first, in his order (A-14: never usage)", () => {
    expect(PILL_CATALOGUE.slice(0, 11).map((e) => e.moduleId)).toEqual([...SUMEET_MODULE_ORDER]);
    expect(PILL_CATALOGUE[0].label).toBe("Permits");
    expect(PILL_CATALOGUE[10].label).toBe("Reports");
  });

  test("'Other — type it' is the twelfth entry and its destination is the box", () => {
    expect(PILL_CATALOGUE[11].id).toBe("other");
    expect(PILL_CATALOGUE[11].destination).toBe("input");
  });
});

describe("every pill has a wired destination (A-11 / A-12)", () => {
  test("nothing renders without one", () => {
    for (const entry of PILL_CATALOGUE) {
      expect(["route", "rail", "input"]).toContain(entry.destination);
    }
  });

  test("the four universal pills with no PROJEXA screen are dropped, not disabled", () => {
    for (const label of ["Email", "Policies", "Department", "Teams"]) {
      expect(PILL_CATALOGUE.some((e) => e.label === label)).toBe(false);
    }
  });

  test("a route pill points at a module that exists", () => {
    const broken = PILL_CATALOGUE.filter(
      (e) => e.destination === "route" && !MODULE_CATALOGUE.some((m) => m.id === e.moduleId)
    ).map((e) => e.id);
    expect(broken).toEqual([]);
  });

  test("D-10: a demoted universal pill still reaches the same destination", () => {
    // The Platform group is what makes the demotion safe -- these names must
    // still be here, and still resolve to a real module.
    expect(pillEntryById("platform.customers")?.moduleId).toBe("customers");
    expect(pillEntryById("platform.vendors")?.moduleId).toBe("vendors");
    expect(pillEntryById("platform.minutes_of_meeting")?.moduleId).toBe("moms");
    expect(pillEntryById("platform.calendar")?.moduleId).toBe("schedule");
  });

  test("'Projects' survives as a pointer at the rail, not as a dead end", () => {
    const projects = pillEntryById("platform.projects");
    expect(projects?.destination).toBe("rail");
    expect(projects?.note).toBe("pick one in the top rail");
    // The disabling flag is the caller's ("you are here"), never set here.
    expect(projects?.unavailable).toBeUndefined();
  });

  test("no entry is listed twice", () => {
    const ids = PILL_CATALOGUE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("key hints (A-12)", () => {
  test("every pill has one and no two share a letter", () => {
    const hints = PILL_CATALOGUE.map((e) => e.keyHint);
    expect(hints.every((h) => typeof h === "string" && h.length === 1)).toBe(true);
    expect(new Set(hints).size).toBe(hints.length);
  });

  test("the obvious ones are the obvious letters", () => {
    expect(pillEntryById("permits")?.keyHint).toBe("P");
    expect(pillEntryById("drawings")?.keyHint).toBe("D");
    expect(pillEntryById("moms")?.keyHint).toBe("M");
    expect(pillEntryById("scope")?.keyHint).toBe("S");
  });

  test("the rendered hint names the modifier, because the chord needs it", () => {
    expect(shortcutLabel({ keyHint: "P" })).toBe(`${SHORTCUT_MODIFIER}+P`);
    expect(shortcutLabel({ keyHint: null })).toBeNull();
  });

  test("Alt+P is Permits", () => {
    expect(matchPillShortcut({ key: "p", altKey: true })?.id).toBe("permits");
    expect(matchPillShortcut({ key: "P", altKey: true })?.id).toBe("permits");
  });

  test("a BARE letter is never a shortcut -- the box must stay typeable", () => {
    expect(matchPillShortcut({ key: "p", altKey: false })).toBeNull();
  });

  test("Ctrl+Alt and Cmd+Alt are the browser's, not ours", () => {
    expect(matchPillShortcut({ key: "p", altKey: true, ctrlKey: true })).toBeNull();
    expect(matchPillShortcut({ key: "p", altKey: true, metaKey: true })).toBeNull();
  });

  test("a non-letter key matches nothing", () => {
    expect(matchPillShortcut({ key: "Enter", altKey: true })).toBeNull();
    expect(matchPillShortcut({ key: "1", altKey: true })).toBeNull();
  });
});

/** Only so the frozen-array test can attempt a mutation without `any`. */
type PillEntryArray = { push: (x: unknown) => number; reverse: () => unknown };
