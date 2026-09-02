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
  object: null,
};

/** R67 A-21: what an object page publishes -- no project NAME (it has none to
 *  give), the record's own project id, and the record. */
const objectScreen: ShellScreen = {
  pathname: "/scope/b1",
  moduleId: "scope",
  project: null,
  source: "route",
  object: { moduleId: "scope", label: "R66 Audit BOQ 1009b", projectId: "p1" },
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

// R67 A-21. The record is part of the screen's identity, because the strip's
// second fixed segment is built from it: two publications that agree about the
// record must not re-render the shell, and any change to it must.
describe("sameScreen, with an object page's record", () => {
  test("the same record republished is the same screen", () => {
    expect(
      sameScreenForTest(objectScreen, {
        ...objectScreen,
        object: { moduleId: "scope", label: "R66 Audit BOQ 1009b", projectId: "p1" },
      })
    ).toBe(true);
  });

  test("a renamed record is a different screen -- the strip shows the title", () => {
    expect(
      sameScreenForTest(objectScreen, { ...objectScreen, object: { ...objectScreen.object!, label: "Villa Tower BOQ" } })
    ).toBe(false);
  });

  test("a record that moved project is a different screen -- the strip's root", () => {
    expect(
      sameScreenForTest(objectScreen, { ...objectScreen, object: { ...objectScreen.object!, projectId: "p2" } })
    ).toBe(false);
  });

  test("a record that has not loaded yet is a different screen from one that has", () => {
    expect(sameScreenForTest(objectScreen, { ...objectScreen, object: null })).toBe(false);
  });

  test("an explicit kind word changes the strip, so it changes the screen", () => {
    expect(
      sameScreenForTest(objectScreen, { ...objectScreen, object: { ...objectScreen.object!, kind: "Revision" } })
    ).toBe(false);
  });
});
