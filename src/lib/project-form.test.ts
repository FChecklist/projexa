/// <reference types="bun-types" />
// R67 D-01 -- the create screen's Save must never be inert without saying why.
import { describe, expect, test } from "bun:test";
import { missingProjectFields, projectSaveDisabledReason } from "./project-form";

describe("missingProjectFields", () => {
  test("an untouched form names both required fields, in form order", () => {
    expect(missingProjectFields({ productId: "", name: "" })).toEqual(["Product", "Project Name"]);
  });

  test("whitespace is not a value", () => {
    expect(missingProjectFields({ productId: "  ", name: "   " })).toEqual(["Product", "Project Name"]);
  });

  test("a chosen product drops only that field from the list", () => {
    expect(missingProjectFields({ productId: "prod-1", name: "" })).toEqual(["Project Name"]);
  });

  test("a complete form is saveable", () => {
    expect(missingProjectFields({ productId: "prod-1", name: "Cedar Heights Villa" })).toEqual([]);
  });
});

describe("projectSaveDisabledReason", () => {
  test("names what is missing rather than staying silent", () => {
    expect(projectSaveDisabledReason(["Product", "Project Name"], false)).toBe("Product, Project Name");
  });

  test("a live button carries no reason", () => {
    expect(projectSaveDisabledReason([], false)).toBeUndefined();
  });

  test("an in-flight save says so, even when nothing is missing", () => {
    expect(projectSaveDisabledReason([], true)).toBe("Saving…");
  });
});
