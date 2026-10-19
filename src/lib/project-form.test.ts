/// <reference types="bun-types" />
// R67 D-01 -- the create screen's Save must never be inert without saying why.
import { describe, expect, test } from "bun:test";
import { missingProjectFields, projectSaveDisabledReason } from "./project-form";

describe("missingProjectFields", () => {
  test("an untouched form names the required field, in form order", () => {
    expect(missingProjectFields({ name: "" })).toEqual(["Project Name"]);
  });

  test("whitespace is not a value", () => {
    expect(missingProjectFields({ name: "   " })).toEqual(["Project Name"]);
  });

  test("a complete form is saveable", () => {
    expect(missingProjectFields({ name: "Cedar Heights Villa" })).toEqual([]);
  });
});

describe("projectSaveDisabledReason", () => {
  test("names what is missing rather than staying silent", () => {
    expect(projectSaveDisabledReason(["Project Name"], false)).toBe("Project Name");
  });

  test("a live button carries no reason", () => {
    expect(projectSaveDisabledReason([], false)).toBeUndefined();
  });

  test("an in-flight save says so, even when nothing is missing", () => {
    expect(projectSaveDisabledReason([], true)).toBe("Saving…");
  });
});
