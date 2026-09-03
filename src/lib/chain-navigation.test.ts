/// <reference types="bun-types" />
// R67 WS-A (A-09). The rule the composer applies on every navigation, asserted
// on its own: which of the three outcomes each situation produces. The whole
// point of extracting it is that "does the strip still describe the screen I am
// looking at" is not a question a reader can answer by eye from inside an
// effect.
import { describe, test, expect } from "bun:test";
import { navigationOutcome } from "./chain-navigation";

describe("navigationOutcome", () => {
  test("an ordinary navigation clears the segments and KEEPS the typed draft", () => {
    // A-06: words a person typed are theirs. Deleting them because they
    // navigated is the composer editing the user's own input.
    expect(navigationOutcome({ loaded: null, nextPathname: "/permits" })).toBe("clear-segments");
  });

  test("arriving at a loaded chain's own route keeps it -- that IS the navigation it asked for", () => {
    expect(
      navigationOutcome({ loaded: { route: "/work-progress", pinned: false }, nextPathname: "/work-progress" })
    ).toBe("keep");
  });

  test("a loaded chain does not follow the user to another screen", () => {
    // This is the exact defect: "Work Progress x > New entry x" under a
    // Permits heading, describing a task that belongs somewhere else.
    expect(
      navigationOutcome({ loaded: { route: "/work-progress", pinned: false }, nextPathname: "/permits" })
    ).toBe("clear-all");
  });

  test("a PINNED loaded chain survives any navigation -- that is what pinning means", () => {
    expect(
      navigationOutcome({ loaded: { route: "/work-progress", pinned: true }, nextPathname: "/permits" })
    ).toBe("keep");
    expect(navigationOutcome({ loaded: { route: null, pinned: true }, nextPathname: "/budgets" })).toBe("keep");
  });

  test("a loaded chain with no route of its own is cleared on any navigation", () => {
    // A history row that named no destination cannot claim the screen the user
    // has just opened, so it must not stay and describe it.
    expect(navigationOutcome({ loaded: { route: null, pinned: false }, nextPathname: "/permits" })).toBe(
      "clear-all"
    );
  });

  test("a create route is not the list route -- a loaded list chain does not follow", () => {
    expect(
      navigationOutcome({ loaded: { route: "/permits", pinned: false }, nextPathname: "/permits/new" })
    ).toBe("clear-all");
  });

  test("only three outcomes exist, and every combination produces one of them", () => {
    const outcomes = new Set<string>();
    for (const loaded of [null, { route: "/permits", pinned: false }, { route: "/permits", pinned: true }, { route: null, pinned: false }]) {
      for (const nextPathname of ["/permits", "/work-progress"]) {
        outcomes.add(navigationOutcome({ loaded, nextPathname }));
      }
    }
    expect([...outcomes].sort()).toEqual(["clear-all", "clear-segments", "keep"]);
  });
});
