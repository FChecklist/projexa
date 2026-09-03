/// <reference types="bun-types" />
// R67 F-19 (audit recommendation R-245) -- the exact words a create form's
// dropdown says in each of its three states.
//
// These strings are the whole point of the change: an empty dropdown is
// indistinguishable from a failed lookup, and "Loading…" on its own does not
// say WHAT is loading. The wording is asserted here so it cannot drift back to
// silence, and so the Playwright acceptance ("Couldn't load subcontractors —
// Retry") has a unit-level twin that runs in CI.

import { describe, expect, test } from "bun:test";
import { lookupPlaceholder, requiredLookupFailure, seedIsUsable, type Lookup } from "./use-lookup";

function lookup(status: Lookup<unknown>["status"], label = "tasks"): Lookup<unknown> {
  return { options: [], status, placeholder: lookupPlaceholder(status, label), retry: () => {}, label };
}

describe("lookupPlaceholder", () => {
  test("says WHAT is loading, not just that something is", () => {
    expect(lookupPlaceholder("loading", "subcontractors")).toBe("Loading subcontractors…");
    expect(lookupPlaceholder("loading", "tasks")).toBe("Loading tasks…");
  });

  test("a failed lookup never looks like an empty one", () => {
    expect(lookupPlaceholder("error", "subcontractors")).toBe("Couldn't load subcontractors");
  });

  test("a ready lookup prompts for the choice", () => {
    expect(lookupPlaceholder("ready", "task types")).toBe("Select task types");
  });
});

describe("requiredLookupFailure", () => {
  test("a failed REQUIRED lookup becomes the primary button's reason", () => {
    // Rendered by ObjectScreen as "Save (Task list failed to load)".
    expect(requiredLookupFailure(lookup("error"), "Task list")).toBe("Task list failed to load");
  });

  test("a lookup that is still loading or has answered blocks nothing", () => {
    expect(requiredLookupFailure(lookup("loading"), "Task list")).toBeNull();
    expect(requiredLookupFailure(lookup("ready"), "Task list")).toBeNull();
  });
});

// R67 F-25 (R-241): a create form reached from a screen that already loaded the
// same list must not ask for it again.
describe("seedIsUsable -- when the session store already has the answer", () => {
  test("a populated seed is the answer, so no request is made", () => {
    expect(seedIsUsable([{ id: "v1" }])).toBe(true);
  });

  test("an EMPTY array is not an answer -- 'this org has no subcontractors' and 'the store has not loaded' look identical from here, and rendering the second as the first would state a fact about the user's data that nobody established", () => {
    expect(seedIsUsable([])).toBe(false);
  });

  test("null and undefined mean the store has nothing -- the lookup fetches exactly as before", () => {
    expect(seedIsUsable(null)).toBe(false);
    expect(seedIsUsable(undefined)).toBe(false);
  });
});
