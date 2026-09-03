/// <reference types="bun-types" />
// R67 D-47. The New Activity form's rules, exercised directly.
//
// D-47's acceptance is a Playwright walk: "open /schedule/tasks/new with an
// empty form and expect the primary button's accessible name to be exactly
// 'Save (2 required fields)'; fill Title and Start, set Due earlier than Start,
// blur, and expect the text 'Due date is before the start date - pick a later
// date' to be visible." The first half is asserted against the rendered DOM in
// ScheduleTaskCreateClient.test.tsx; the second half needs typing, which this
// environment cannot deliver to React, so the rule behind it is asserted here.
import { describe, expect, test } from "bun:test";
import {
  DUE_BEFORE_START_MESSAGE,
  activitySaveLabel,
  activitySaveReason,
  addDaysIso,
  dueDateError,
  dueDateFromDuration,
  durationFieldValue,
  missingActivityFields,
} from "./schedule-activity";

describe("missingActivityFields / activitySaveLabel", () => {
  test("an empty form reads exactly 'Save (2 required fields)'", () => {
    const missing = missingActivityFields({ title: "", startDate: "", dueDate: "" });
    expect(missing).toEqual(["Title", "Start date"]);
    expect(activitySaveLabel(missing)).toBe("Save (2 required fields)");
  });

  test("one field left is NAMED rather than counted", () => {
    expect(activitySaveLabel(missingActivityFields({ title: "Pour slab", startDate: "", dueDate: "" }))).toBe(
      "Save (Start date is required)"
    );
    expect(activitySaveLabel(missingActivityFields({ title: "", startDate: "2026-08-01", dueDate: "" }))).toBe(
      "Save (Title is required)"
    );
  });

  test("a complete form is a plain 'Save'", () => {
    expect(activitySaveLabel(missingActivityFields({ title: "Pour slab", startDate: "2026-08-01", dueDate: "" }))).toBe(
      "Save"
    );
  });

  test("a title of only whitespace is not a title", () => {
    expect(missingActivityFields({ title: "   ", startDate: "2026-08-01", dueDate: "" })).toEqual(["Title"]);
  });

  test("a complete-but-invalid form cannot look ready to save", () => {
    expect(activitySaveLabel([], { blocked: DUE_BEFORE_START_MESSAGE })).toBe(`Save (${DUE_BEFORE_START_MESSAGE})`);
  });

  test("in flight the button says what is happening", () => {
    expect(activitySaveReason(["Title"], { submitting: true })).toBe("Creating…");
  });
});

describe("dueDateError", () => {
  test("a due date before the start is refused with the sentence the item quotes", () => {
    expect(dueDateError("2026-08-10", "2026-08-01")).toBe(
      "Due date is before the start date — pick a later date"
    );
  });

  test("the same day is not an error -- a one-day activity is real", () => {
    expect(dueDateError("2026-08-10", "2026-08-10")).toBeNull();
  });

  test("a later due date passes", () => {
    expect(dueDateError("2026-08-10", "2026-08-20")).toBeNull();
  });

  test("an unfilled field is not an error", () => {
    expect(dueDateError("", "2026-08-01")).toBeNull();
    expect(dueDateError("2026-08-01", "")).toBeNull();
  });
});

describe("duration <-> finish date", () => {
  test("a duration derives the finish date", () => {
    expect(dueDateFromDuration("2026-08-01", "4")).toBe("2026-08-05");
    expect(dueDateFromDuration("2026-08-01", "0")).toBe("2026-08-01");
  });

  test("nothing to derive from leaves the date alone rather than clearing it", () => {
    expect(dueDateFromDuration("", "4")).toBeNull();
    expect(dueDateFromDuration("2026-08-01", "")).toBeNull();
    expect(dueDateFromDuration("2026-08-01", "abc")).toBeNull();
    expect(dueDateFromDuration("2026-08-01", "-2")).toBeNull();
  });

  test("a finish date derives the duration, and shows blank when it cannot", () => {
    expect(durationFieldValue("2026-08-01", "2026-08-05")).toBe("4");
    expect(durationFieldValue("2026-08-01", "")).toBe("");
    expect(durationFieldValue("", "2026-08-05")).toBe("");
  });

  test("the two are inverses across a DST boundary", () => {
    const due = dueDateFromDuration("2026-03-01", "31")!;
    expect(due).toBe("2026-04-01");
    expect(durationFieldValue("2026-03-01", due)).toBe("31");
  });

  test("addDaysIso refuses an unusable start rather than returning today", () => {
    expect(addDaysIso("", 4)).toBeNull();
    expect(addDaysIso("not-a-date", 4)).toBeNull();
  });
});
