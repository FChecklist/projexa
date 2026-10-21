/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { baselineControlState, mayConfirmBaseline } from "./baseline-control";

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
