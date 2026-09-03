/// <reference types="bun-types" />
// R67 D-51. The Category list's own rules.
//
// D-51's acceptance is a Playwright walk ("expect the select to contain the
// option 'Joinery'"). This session may not start a dev server, so the option
// set is asserted here and again in ScheduleLogTimeClient.test.tsx against the
// rendered DOM.
import { describe, expect, test } from "bun:test";
import {
  OTHER_CATEGORY_VALUE,
  SEEDED_CATEGORIES,
  mergeCategoryNames,
  resolveCategoryValue,
} from "./time-categories";

describe("mergeCategoryNames", () => {
  test("a project with no categories still offers the seeded BOQ vocabulary", () => {
    expect(mergeCategoryNames([])).toEqual([...SEEDED_CATEGORIES]);
    expect(mergeCategoryNames([])).toContain("Joinery");
  });

  test("the project's own categories come first and the seed fills in behind them", () => {
    const merged = mergeCategoryNames(["Blockwork", "Waterproofing"]);
    expect(merged.slice(0, 2)).toEqual(["Blockwork", "Waterproofing"]);
    expect(merged).toContain("Joinery");
  });

  test("a collision keeps the project's OWN casing and is not listed twice", () => {
    const merged = mergeCategoryNames(["civil"]);
    expect(merged.filter((c) => c.toLowerCase() === "civil")).toEqual(["civil"]);
  });

  test("blank and non-string entries are dropped rather than becoming an empty option", () => {
    const merged = mergeCategoryNames(["", "   ", "Civil"]);
    expect(merged.filter((c) => c.trim() === "")).toHaveLength(0);
    expect(merged[0]).toBe("Civil");
  });

  test("whitespace around a real name is trimmed, so it cannot become a second category", () => {
    expect(mergeCategoryNames([" Joinery "])).toContain("Joinery");
    expect(mergeCategoryNames([" Joinery "]).filter((c) => c === "Joinery")).toHaveLength(1);
  });
});

describe("resolveCategoryValue", () => {
  test("a chosen category is stored verbatim", () => {
    expect(resolveCategoryValue("Joinery", "")).toBe("Joinery");
  });

  test("'Other' stores what was typed, never the sentinel", () => {
    expect(resolveCategoryValue(OTHER_CATEGORY_VALUE, "Snagging")).toBe("Snagging");
    expect(resolveCategoryValue(OTHER_CATEGORY_VALUE, "  Snagging  ")).toBe("Snagging");
  });

  test("'Other' with nothing typed is not a category", () => {
    expect(resolveCategoryValue(OTHER_CATEGORY_VALUE, "")).toBeNull();
    expect(resolveCategoryValue(OTHER_CATEGORY_VALUE, "   ")).toBeNull();
  });

  test("nothing chosen is null, so the required check can see it", () => {
    expect(resolveCategoryValue("", "Snagging")).toBeNull();
  });
});
