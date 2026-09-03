/// <reference types="bun-types" />
// R67 WS-C (C-16) -- the walk band 2 performs.
//
// The claims under test are the ones C-16 makes in words:
//   1. a missing slot opens ITS OWN picker, not only the BOQ one;
//   2. a slot the route already answered is never asked (DE-30);
//   3. the Send button can name the LIVE question, before any Send;
//   4. "done" is a real predicate -- and an empty value field is not a zero.

import { describe, expect, test } from "bun:test";
import {
  chainConfirmTitle,
  chainDone,
  chainReceiptLine,
  chainRunFor,
  firstQuestion,
  levelForStep,
  levelPathForStep,
  openQuestionSlots,
  stepForSlot,
  unansweredSlots,
} from "./chain-walk";

describe("which picker answers which step", () => {
  test("a BOQ line opens the work-progress line level", () => {
    expect(levelForStep("boqLine")).toEqual(["work_progress", "record_progress"]);
  });

  test("a worker opens C-08's roster level -- the picker that already exists", () => {
    expect(levelForStep("worker")).toEqual(["manpower", "mark_attendance"]);
  });

  test("a number, a project and a task have no chip level, and say so with null", () => {
    expect(levelForStep("value")).toBeNull();
    expect(levelForStep("project")).toBeNull();
    expect(levelForStep("task")).toBeNull();
    expect(levelForStep(null)).toBeNull();
  });

  test("the level table is not shared state -- a caller cannot mutate the next caller's answer", () => {
    const first = levelForStep("boqLine")!;
    first.push("tampered");
    expect(levelForStep("boqLine")).toEqual(["work_progress", "record_progress"]);
  });

  test("slot names resolve however the server spells them", () => {
    expect(stepForSlot("itemCode")).toBe("boqLine");
    expect(stepForSlot("boq_line_item_id")).toBe("boqLine");
    expect(stepForSlot("percent")).toBe("value");
    expect(stepForSlot("workerId")).toBe("worker");
    expect(stepForSlot("somethingNew")).toBeNull();
  });
});

describe("DE-30 -- a question the route has already answered is not asked", () => {
  test("the project slot is dropped when the route carries a project", () => {
    expect(unansweredSlots(["projectId", "itemCode"], { projectId: "p1" })).toEqual(["itemCode"]);
  });

  test("and is kept when it genuinely has no answer yet", () => {
    expect(unansweredSlots(["projectId", "itemCode"], { projectId: null })).toEqual([
      "projectId",
      "itemCode",
    ]);
  });

  test("blank and non-string slots never become a question", () => {
    expect(unansweredSlots(["", "  ", "itemCode"])).toEqual(["itemCode"]);
    expect(unansweredSlots(null)).toEqual([]);
  });

  test("the first question on /work-progress?projectId= is the BOQ line, with its own chips", () => {
    const q = firstQuestion(["projectId", "itemCode", "percent"], { projectId: "p1" });
    expect(q).toEqual({
      slot: "itemCode",
      step: "boqLine",
      label: "Pick a BOQ line",
      levelPath: ["work_progress", "record_progress"],
    });
  });

  test("a worker question carries C-16's own sentence", () => {
    expect(firstQuestion(["workerId"])?.label).toBe("Pick a worker");
  });

  test("a value question carries D-03's sentence, and no picker when no line is known", () => {
    const q = firstQuestion(["percent"]);
    expect(q?.label).toBe("Type quantity or %");
    expect(q?.levelPath).toBeNull();
  });

  test("*** but a value question OPENS THE VALUE LEVEL of the line already resolved ***", () => {
    // When the server says only the value is missing, it has resolved the BOQ
    // line -- so "Type quantity or %" is a level with chips on it, not a
    // sentence with nothing underneath.
    const q = firstQuestion(["percent"], { projectId: "p1" }, { itemCode: "R66-1009b" });
    expect(q?.levelPath).toEqual(["work_progress", "record_progress", "R66-1009b"]);
    expect(levelPathForStep("value", { itemCode: "  " })).toBeNull();
    // Every other step ignores it -- a known line does not change which
    // picker answers "Pick a worker".
    expect(levelPathForStep("worker", { itemCode: "R66-1009b" })).toEqual(["manpower", "mark_attendance"]);
  });

  test("nothing outstanding is null -- the state the confirmation card belongs to", () => {
    expect(firstQuestion([], { projectId: "p1" })).toBeNull();
    expect(firstQuestion(["projectId"], { projectId: "p1" })).toBeNull();
  });

  test("an unmapped slot still gets a sentence a person can act on, never its own name", () => {
    const q = firstQuestion(["someNewSlot"]);
    expect(q?.label).toBe("Answer the question above");
    expect(q?.label).not.toContain("someNewSlot");
  });
});

describe("what band 2 is asking right now", () => {
  test("the line level asks for the line, so Send can say so before any Send", () => {
    expect(openQuestionSlots(["work_progress", "record_progress"], "")).toEqual(["itemCode"]);
  });

  test("a line picked with nothing typed asks for the value", () => {
    expect(openQuestionSlots(["work_progress", "record_progress", "R66-1009b"], "")).toEqual(["percent"]);
  });

  test("a complete walk asks for nothing", () => {
    expect(openQuestionSlots(["work_progress", "record_progress", "R66-1009b", "50"], "")).toEqual([]);
    expect(openQuestionSlots(["work_progress", "record_progress", "R66-1009b"], "37")).toEqual([]);
  });

  test("the attendance grid asks nothing of Send -- its own Save button writes", () => {
    expect(openQuestionSlots(["manpower", "mark_attendance"], "")).toEqual([]);
  });

  test("a closed walk asks nothing", () => {
    expect(openQuestionSlots([], "")).toEqual([]);
  });
});

describe("is the walk done", () => {
  test("a chip-picked line and a chip-picked value run", () => {
    expect(chainRunFor({ levelPath: ["work_progress", "record_progress", "R66-1009b", "50"], value: "" })).toEqual({
      functionId: "record_work_progress",
      params: { itemCode: "R66-1009b", percent: 50 },
    });
  });

  test("a typed value runs too, and the chip wins when both exist", () => {
    expect(
      chainRunFor({ levelPath: ["work_progress", "record_progress", "R66-1009b"], value: "37" })?.params.percent
    ).toBe(37);
    expect(
      chainRunFor({ levelPath: ["work_progress", "record_progress", "R66-1009b", "50"], value: "37" })?.params
        .percent
    ).toBe(50);
  });

  test("*** AN EMPTY VALUE FIELD IS NOT A ZERO ***", () => {
    // The shell used to compute Number(levelPath[3] ?? scalarValue) directly.
    // Number("") is 0 -- finite, in range -- so picking a BOQ line and
    // touching nothing else produced a runnable chain that would have
    // recorded 0 % against that line.
    expect(chainRunFor({ levelPath: ["work_progress", "record_progress", "R66-1009b"], value: "" })).toBeNull();
    expect(chainRunFor({ levelPath: ["work_progress", "record_progress", "R66-1009b"], value: "   " })).toBeNull();
    // A real, deliberate zero still runs: "we made no progress on this today"
    // is an answer a site engineer is allowed to give.
    expect(
      chainRunFor({ levelPath: ["work_progress", "record_progress", "R66-1009b"], value: "0" })?.params.percent
    ).toBe(0);
  });

  test("no line, no run -- and no other walk runs this write", () => {
    expect(chainRunFor({ levelPath: ["work_progress", "record_progress"], value: "50" })).toBeNull();
    expect(chainRunFor({ levelPath: ["manpower", "mark_attendance", "w1"], value: "50" })).toBeNull();
    expect(chainRunFor({ levelPath: [], value: "50" })).toBeNull();
  });

  test("a percentage outside 0-100, or words, does not run", () => {
    for (const value of ["101", "-1", "half", "50%"]) {
      expect(chainRunFor({ levelPath: ["work_progress", "record_progress", "R66-1009b"], value })).toBeNull();
    }
  });

  test("chainDone is the predicate C-16 keys the confirmation card off", () => {
    expect(chainDone({ levelPath: ["work_progress", "record_progress", "R66-1009b", "50"], value: "" })).toBe(true);
    expect(chainDone({ levelPath: ["work_progress", "record_progress", "R66-1009b"], value: "" })).toBe(false);
  });
});

describe("the confirmation card's sentence", () => {
  test("names the line and the value, and is NOT prefixed 'Understood:'", () => {
    const title = chainConfirmTitle({ lineLabel: "R66-1009b Excavation", percent: 50 });
    expect(title).toBe("Record Work Progress > New entry — R66-1009b Excavation · 50 %");
    expect(title).not.toContain("Understood");
  });

  test("a line with no label still reads as a sentence", () => {
    expect(chainConfirmTitle({ lineLabel: null, percent: 50 })).toBe("Record Work Progress > New entry — 50 %");
  });

  test("no camelCase parameter and no function id ever reaches the card", () => {
    const title = chainConfirmTitle({ lineLabel: "R66-1009b Excavation", percent: 50 });
    expect(title).not.toContain("itemCode");
    expect(title).not.toContain("record_work_progress");
    expect(title).not.toMatch(/[a-z][A-Z]/);
  });

  test("the receipt says what was recorded, against what", () => {
    expect(chainReceiptLine({ lineLabel: "R66-1009b Excavation", percent: 50 })).toBe(
      "Recorded 50% on R66-1009b Excavation"
    );
    expect(chainReceiptLine({ lineLabel: "  ", percent: 50 })).toBe("Recorded 50%");
  });
});
