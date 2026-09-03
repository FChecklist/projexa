/// <reference types="bun-types" />
// R67 WS-C (C-16) -- D-08's budget, as arithmetic rather than a claim.

import { describe, expect, test } from "bun:test";
import {
  CLICK_BUDGET,
  MARK_ATTENDANCE,
  RECORD_PROGRESS_BY_CHIPS,
  RECORD_PROGRESS_TYPED_VALUE,
  TYPED_VALUE_BUDGET,
  costOf,
  type FlowStep,
} from "./click-budget";

describe("the counting rule", () => {
  test("a selection and the final commit are both clicks; the entry is counted apart", () => {
    const cost = costOf([
      { label: "Record progress", kind: "entry" },
      { label: "a chip", kind: "select" },
      { label: "Save", kind: "commit" },
    ]);
    expect(cost.entry).toBe(1);
    expect(cost.clicks).toBe(2);
    expect(cost.total).toBe(3);
  });

  test("typing into one field is one typed value, not a click", () => {
    const cost = costOf([{ label: "37", kind: "type" }]);
    expect(cost.typedValues).toBe(1);
    expect(cost.clicks).toBe(0);
  });

  test("over budget says WHY, in words -- a bare false tells nobody what to remove", () => {
    const tooMany: FlowStep[] = [
      { label: "a", kind: "select" },
      { label: "b", kind: "select" },
      { label: "c", kind: "select" },
      { label: "Save", kind: "commit" },
    ];
    const cost = costOf(tooMany);
    expect(cost.withinBudget).toBe(false);
    expect(cost.reason).toBe(`4 clicks, budget ${CLICK_BUDGET}`);
  });

  test("two typed values is over budget too, and says so", () => {
    const cost = costOf([
      { label: "37", kind: "type" },
      { label: "nos", kind: "type" },
      { label: "Save", kind: "commit" },
    ]);
    expect(cost.withinBudget).toBe(false);
    expect(cost.reason).toBe(`2 typed values, budget ${TYPED_VALUE_BUDGET}`);
  });
});

describe("C-16's own flow", () => {
  test("record progress by chips: three clicks including Save, zero typed values", () => {
    const cost = costOf(RECORD_PROGRESS_BY_CHIPS);
    expect(cost.clicks).toBe(3);
    expect(cost.typedValues).toBe(0);
    expect(cost.withinBudget).toBe(true);
  });

  test("the fourth deliberate act is the entry, and it is reported rather than hidden", () => {
    // C-16's acceptance lists four selections and then says "three clicks".
    // Both numbers are true of different things, so both are returned.
    expect(costOf(RECORD_PROGRESS_BY_CHIPS).entry).toBe(1);
    expect(costOf(RECORD_PROGRESS_BY_CHIPS).total).toBe(4);
  });

  test("a value that is not one of the chips costs the one typed value D-08 allows", () => {
    const cost = costOf(RECORD_PROGRESS_TYPED_VALUE);
    expect(cost.typedValues).toBe(1);
    expect(cost.clicks).toBe(2);
    expect(cost.withinBudget).toBe(true);
  });

  test("a whole crew's attendance is the entry and the Save", () => {
    const cost = costOf(MARK_ATTENDANCE);
    expect(cost.clicks).toBe(1);
    expect(cost.withinBudget).toBe(true);
  });

  test("marking one man absent is one more selection and still fits", () => {
    const cost = costOf([...MARK_ATTENDANCE, { label: "Anil (absent)", kind: "select" }]);
    expect(cost.clicks).toBe(2);
    expect(cost.withinBudget).toBe(true);
  });
});
