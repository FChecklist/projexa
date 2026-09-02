/// <reference types="bun-types" />
// R67 WS-A (A-03). The two behaviours worth pinning down without a browser:
// a record is only about the screen it names, and republishing the same facts
// must not produce a new object (the shell renders on every one of these).
import { describe, test, expect } from "bun:test";
import { sameScreenForTest, type ShellScreen } from "./shell-screen-context";

const base: ShellScreen = {
  pathname: "/moms",
  moduleId: "moms",
  project: { id: "p1", name: "Cedar Heights Villa - Phase 1" },
  source: "route",
};

describe("sameScreen", () => {
  test("identical facts are the same screen, even as different objects", () => {
    expect(sameScreenForTest(base, { ...base, project: { id: "p1", name: "Cedar Heights Villa - Phase 1" } })).toBe(
      true
    );
  });

  test("a different pathname is a different screen", () => {
    expect(sameScreenForTest(base, { ...base, pathname: "/moms/new" })).toBe(false);
  });

  test("a different project is a different screen", () => {
    expect(sameScreenForTest(base, { ...base, project: { id: "p2", name: "Other" } })).toBe(false);
  });

  test("a renamed project is a different screen -- the rail shows the name", () => {
    expect(sameScreenForTest(base, { ...base, project: { id: "p1", name: "Cedar Heights Villa - Phase 2" } })).toBe(
      false
    );
  });

  test("how the project was resolved matters -- the rail says so", () => {
    expect(sameScreenForTest(base, { ...base, source: "auto" })).toBe(false);
  });

  test("losing the project is a different screen", () => {
    expect(sameScreenForTest(base, { ...base, project: null })).toBe(false);
  });
});
