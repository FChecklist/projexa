/// <reference types="bun-types" />
// R67 D-50. The rules a component test cannot reach.
//
// D-50's acceptance reads: "after typing 0 into Hours and blurring expect the
// text 'Enter hours greater than 0, in steps of 0.25 (max 24)'". This
// environment does not deliver input events to React, so that exact case is
// asserted here against the function the field renders, and the component test
// asserts the states it CAN be driven into.
import { describe, expect, test } from "bun:test";
import {
  DATE_REQUIRED_MESSAGE,
  HOURS_INVALID_MESSAGE,
  TASK_REQUIRED_MESSAGE,
  hoursError,
  missingFields,
  saveLabel,
  saveReason,
  timeLoggedReceipt,
} from "./time-entry";

describe("hoursError", () => {
  test("0 is refused with the message the item quotes", () => {
    expect(hoursError("0")).toBe("Enter hours greater than 0, in steps of 0.25 (max 24)");
    expect(hoursError("0")).toBe(HOURS_INVALID_MESSAGE);
  });

  test("a negative value, a non-number and more than a day are all refused", () => {
    expect(hoursError("-1")).toBe(HOURS_INVALID_MESSAGE);
    expect(hoursError("abc")).toBe(HOURS_INVALID_MESSAGE);
    expect(hoursError("24.25")).toBe(HOURS_INVALID_MESSAGE);
  });

  test("a value off the quarter-hour step is refused", () => {
    expect(hoursError("1.1")).toBe(HOURS_INVALID_MESSAGE);
    expect(hoursError("0.3")).toBe(HOURS_INVALID_MESSAGE);
  });

  test("real quarter-hour values pass, including the ones binary floats round badly", () => {
    for (const value of ["0.25", "0.5", "1", "7.5", "8.75", "24"]) {
      expect(hoursError(value)).toBeNull();
    }
  });

  test("an empty field is not an error -- it is a field not reached yet", () => {
    expect(hoursError("")).toBeNull();
    expect(hoursError("   ")).toBeNull();
  });
});

describe("missingFields / saveLabel", () => {
  const full = { issueId: "t1", hours: "3", spentOn: "2026-09-02", category: "Joinery" };

  test("a complete draft has nothing missing and the button is a plain 'Save'", () => {
    expect(missingFields(full)).toEqual([]);
    expect(saveLabel(missingFields(full))).toBe("Save");
  });

  test("the label counts AND names, in the order the fields appear", () => {
    const draft = { ...full, issueId: "", hours: "" };
    expect(missingFields(draft)).toEqual(["Task", "Hours"]);
    expect(saveLabel(missingFields(draft))).toBe("Save (2 required: Task, Hours)");
  });

  test("every field missing is reported, not just the first", () => {
    expect(saveLabel(missingFields({ issueId: "", hours: "", spentOn: "", category: null }))).toBe(
      "Save (4 required: Task, Hours, Date, Category)"
    );
  });

  test("a filled-but-invalid form cannot look ready to save", () => {
    expect(saveLabel([], { blocked: HOURS_INVALID_MESSAGE })).toBe(`Save (${HOURS_INVALID_MESSAGE})`);
  });

  test("in flight the label says what is happening rather than what is missing", () => {
    expect(saveLabel(["Task"], { submitting: true })).toBe("Save (Logging…)");
    expect(saveReason(["Task"], { submitting: true })).toBe("Logging…");
  });

  test("saveReason is the bracket contents the kit's ObjectScreen renders itself", () => {
    expect(saveReason([])).toBeUndefined();
    expect(saveReason(["Task", "Hours"])).toBe("2 required: Task, Hours");
    expect(`Save (${saveReason(["Task", "Hours"])})`).toBe(saveLabel(["Task", "Hours"]));
  });

  test("whitespace in Hours does not count as filled in", () => {
    expect(missingFields({ ...full, hours: "  " })).toEqual(["Hours"]);
  });
});

describe("timeLoggedReceipt", () => {
  test("quotes the stored row: hours to two decimals, the task's number and title, the date", () => {
    expect(
      timeLoggedReceipt({ hours: "3", spentOn: "2026-09-02", taskNumber: 12, taskTitle: "Joinery shop drawings" })
    ).toBe("Time logged: 3.00 h on #12 Joinery shop drawings, 02 Sep 2026");
  });

  test("a numeric hours value from the DB formats identically to its string form", () => {
    const asString = timeLoggedReceipt({ hours: "7.5", spentOn: "2026-09-02", taskNumber: 1, taskTitle: "x" });
    const asNumber = timeLoggedReceipt({ hours: 7.5, spentOn: "2026-09-02", taskNumber: 1, taskTitle: "x" });
    expect(asString).toBe(asNumber);
    expect(asString).toContain("7.50 h");
  });

  test("falls back honestly when the response carries no task identity", () => {
    expect(timeLoggedReceipt({ hours: "2", spentOn: "2026-09-02" })).toBe(
      "Time logged: 2.00 h on the selected activity, 02 Sep 2026"
    );
  });
});

describe("the field messages are the ones the item quotes", () => {
  test("verbatim", () => {
    expect(TASK_REQUIRED_MESSAGE).toBe("Choose the task these hours were spent on");
    expect(HOURS_INVALID_MESSAGE).toBe("Enter hours greater than 0, in steps of 0.25 (max 24)");
    expect(DATE_REQUIRED_MESSAGE).toBe("Pick the date the work was done");
  });
});
