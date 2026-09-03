/// <reference types="bun-types" />
// R67 D-29. The rules a screen with more than one data source has to follow.
import { describe, expect, test } from "bun:test";
import {
  SOURCE_LOADING,
  SOURCE_OK,
  errorTexts,
  isLoading,
  mayShowFigure,
  sourceError,
} from "./source-status";

describe("sourceError", () => {
  test("keeps the backend's own words, behind what the user was doing", () => {
    expect(sourceError(new Error("The construction data service did not respond in time"), "Could not load the BOQ")).toEqual({
      state: "error",
      text: "Could not load the BOQ: The construction data service did not respond in time",
    });
  });

  test("a thrown non-Error still produces a usable sentence, never 'undefined'", () => {
    expect(sourceError("boom", "Could not load the BOQ")).toEqual({ state: "error", text: "Could not load the BOQ" });
  });
});

describe("isLoading / errorTexts", () => {
  test("one source still running keeps the screen in its loading state", () => {
    expect(isLoading(SOURCE_OK, SOURCE_LOADING)).toBe(true);
    expect(isLoading(SOURCE_OK, SOURCE_OK)).toBe(false);
  });

  test("a screen with two outages reports both, in source order", () => {
    const a = sourceError(new Error("a failed"), "Entries");
    const b = sourceError(new Error("b failed"), "Activities");
    expect(errorTexts(a, SOURCE_OK, b)).toEqual(["Entries: a failed", "Activities: b failed"]);
    expect(errorTexts(SOURCE_OK, SOURCE_LOADING)).toEqual([]);
  });
});

describe("mayShowFigure", () => {
  test("a KPI may only be shown when every read behind it SUCCEEDED", () => {
    expect(mayShowFigure(SOURCE_OK, SOURCE_OK)).toBe(true);
    expect(mayShowFigure(SOURCE_OK, SOURCE_LOADING)).toBe(false);
    expect(mayShowFigure(SOURCE_OK, sourceError(new Error("x"), "y"))).toBe(false);
  });
});
