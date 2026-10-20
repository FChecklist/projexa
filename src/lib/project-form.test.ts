/// <reference types="bun-types" />
// R67 D-01 -- the create screen's Save must never be inert without saying why.
import { describe, expect, test } from "bun:test";
import { defaultProjectName, missingProjectFields, projectSaveDisabledReason, resolveProjectName } from "./project-form";

describe("missingProjectFields", () => {
  test("an untouched form is saveable: no field is required (a default name is used)", () => {
    expect(missingProjectFields({ name: "" })).toEqual([]);
  });

  test("whitespace-only is also saveable", () => {
    expect(missingProjectFields({ name: "   " })).toEqual([]);
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

describe("default project name", () => {
  test("is 'New project DD Mon YYYY' with a two-digit day", () => {
    expect(defaultProjectName(new Date(2026, 9, 5))).toBe("New project 05 Oct 2026");
    expect(defaultProjectName(new Date(2026, 0, 31))).toBe("New project 31 Jan 2026");
  });

  test("an empty or blank name resolves to the default; a typed name is trimmed and kept", () => {
    const now = new Date(2026, 9, 20);
    expect(resolveProjectName("", now)).toBe("New project 20 Oct 2026");
    expect(resolveProjectName("   ", now)).toBe("New project 20 Oct 2026");
    expect(resolveProjectName("  Cedar Villa ", now)).toBe("Cedar Villa");
  });
});
