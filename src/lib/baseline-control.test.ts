/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { baselineControlState, mayConfirmBaseline, missingSidesSentence, emptyFigureLabel, missingLinesHref, contractLockNotice } from "./baseline-control";

describe("baselineControlState", () => {
  test("no baseline -> first", () => expect(baselineControlState({ hasBaseline: false })).toBe("first"));
  test("baseline without cost figures -> refresh (the control used to vanish here)", () => expect(baselineControlState({ hasBaseline: true, baselineHasFigures: false })).toBe("refresh"));
  test("baseline with figures, or an older server that does not say -> none", () => {
    expect(baselineControlState({ hasBaseline: true, baselineHasFigures: true })).toBe("none");
    expect(baselineControlState({ hasBaseline: true })).toBe("none");
  });
});

describe("mayConfirmBaseline", () => {
  test("owner, admin, pm and VERIDIAN manager may; unknown role is offered (server decides); site engineer and client viewer may not", () => {
    for (const r of ["owner", "admin", "pm", "manager", null, "senior_professional"]) expect(mayConfirmBaseline(r)).toBe(true);
    for (const r of ["site_engineer", "client_viewer", "member"]) expect(mayConfirmBaseline(r)).toBe(false);
  });
});

describe("R-100 missing-side guidance", () => {
  const st = (c: number, k: number) => ({ contractMissingLines: c, costMissingLines: k, contractMissingLineIds: ["a"], costMissingLineIds: ["b"] });
  test("sentence names each missing side with counts", () => {
    expect(missingSidesSentence(st(3, 1))).toBe("Contract quantity/rate missing on 3 lines; cost quantity/rate missing on 1 line.");
    expect(missingSidesSentence(st(0, 2))).toBe("Cost quantity/rate missing on 2 lines.");
    expect(missingSidesSentence(st(0, 0))).toBeNull();
    expect(missingSidesSentence(null)).toBeNull();
  });
  test("label names the side; old servers keep the old wording", () => {
    expect(emptyFigureLabel({ hasBaseline: true, baselineFigureStatus: st(2, 0) })).toBe("No contract figures yet");
    expect(emptyFigureLabel({ hasBaseline: true, baselineFigureStatus: st(2, 2) })).toBe("No figures yet");
    expect(emptyFigureLabel({ hasBaseline: true })).toBe("No cost figures yet");
    expect(emptyFigureLabel({ hasBaseline: false })).toBe("Not yet baselined");
  });
  test("links point at the grid row", () => {
    expect(missingLinesHref("b1", ["x", "y"])).toBe("/scope/b1?focus=boq-grid-row-x");
    expect(missingLinesHref("b1", [])).toBe("/scope/b1");
  });
  test("lock notice only when locked and contract figures are what is missing", () => {
    expect(contractLockNotice({ boqId: "b1", contractSideLocked: true, contractLockedByVersion: 3, baselineFigureStatus: st(2, 0) })?.reviseHref).toBe("/scope/b1/revise");
    expect(contractLockNotice({ boqId: "b1", contractSideLocked: false, baselineFigureStatus: st(2, 0) })).toBeNull();
    expect(contractLockNotice({ boqId: "b1", contractSideLocked: true, baselineFigureStatus: st(0, 2) })).toBeNull();
  });
});
