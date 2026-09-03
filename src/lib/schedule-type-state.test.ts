import { describe, expect, test } from "bun:test";
import {
  SCHEDULE_TYPE_HINT,
  SCHEDULE_TYPE_PLACEHOLDER,
  scheduleTypeDisabled,
  scheduleTypesState,
  type ScheduleTypesState,
} from "./schedule-type-state";

const ALL_STATES: ScheduleTypesState[] = ["loading", "ready", "empty", "error"];

describe("G-04 acceptance: 'Loading...' is never a value", () => {
  test("no state puts the word Loading in the control's value slot", () => {
    for (const state of ALL_STATES) {
      expect(SCHEDULE_TYPE_PLACEHOLDER[state].toLowerCase()).not.toContain("loading");
    }
  });

  test("the loading state shows no text at all -- the skeleton stands in for the control", () => {
    expect(SCHEDULE_TYPE_PLACEHOLDER.loading).toBe("");
  });

  test("the Type control is disabled while its options are still loading", () => {
    expect(scheduleTypeDisabled("loading")).toBe(true);
  });

  test("...and stays disabled whenever there is nothing to choose", () => {
    expect(scheduleTypeDisabled("empty")).toBe(true);
    expect(scheduleTypeDisabled("error")).toBe(true);
    expect(scheduleTypeDisabled("ready")).toBe(false);
  });
});

describe("the three situations the old code merged into one string", () => {
  test("in flight", () => {
    expect(scheduleTypesState({ loaded: null, failed: false })).toBe("loading");
  });

  test("loaded, with options", () => {
    expect(scheduleTypesState({ loaded: [{ id: "t1" }], failed: false })).toBe("ready");
    expect(SCHEDULE_TYPE_PLACEHOLDER.ready).toBe("Select a type");
  });

  test("loaded, genuinely empty", () => {
    expect(scheduleTypesState({ loaded: [], failed: false })).toBe("empty");
    expect(SCHEDULE_TYPE_PLACEHOLDER.empty).toBe("No task types - Add one");
  });

  test("failed -- and NOT reported as 'this org has no task types'", () => {
    // The old code let a non-OK response fall through to `data.types ?? []`,
    // so a 502 from VERIDIAN was displayed as an empty vocabulary.
    expect(scheduleTypesState({ loaded: null, failed: true })).toBe("error");
    expect(scheduleTypesState({ loaded: [], failed: true })).toBe("error");
    expect(SCHEDULE_TYPE_PLACEHOLDER.error).not.toBe(SCHEDULE_TYPE_PLACEHOLDER.empty);
  });
});

describe("exactly one instruction per state", () => {
  test("every state has at most one hint, and it is a sentence", () => {
    for (const state of ALL_STATES) {
      const hint = SCHEDULE_TYPE_HINT[state];
      if (hint === null) continue;
      expect(hint.trim()).toBe(hint);
      expect(hint.endsWith(".")).toBe(true);
      // One instruction, not a paragraph.
      expect(hint.split(". ").length).toBeLessThanOrEqual(2);
    }
  });

  test("the states where the control already says everything carry no hint", () => {
    expect(SCHEDULE_TYPE_HINT.loading).toBeNull();
    expect(SCHEDULE_TYPE_HINT.ready).toBeNull();
  });

  test("neither blocked state pretends Save is blocked -- the server applies a default", () => {
    expect(SCHEDULE_TYPE_HINT.empty).toContain("default type");
    expect(SCHEDULE_TYPE_HINT.error).toContain("default type");
  });

  test("the empty state names where task types actually come from", () => {
    // "Add one" with no destination inside PROJEXA would be a dead end; task
    // types are defined in VERIDIAN, and the hint says so.
    expect(SCHEDULE_TYPE_HINT.empty).toContain("VERIDIAN");
  });
});
