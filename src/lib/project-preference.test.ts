/// <reference types="bun-types" />
// R67 WS-A (A-05). pickProject is the one rule the server page and the browser
// shell both apply, so every branch of it is asserted here -- a disagreement
// between those two halves is exactly the defect it exists to remove.
import { describe, test, expect } from "bun:test";
import { pickProject } from "./project-preference";

const projects = [
  { id: "p1", name: "Cedar Heights Villa - Phase 1" },
  { id: "p2", name: "Riverside Tower" },
];

describe("pickProject", () => {
  test("the URL wins over the remembered choice", () => {
    expect(pickProject({ requested: "p2", preferred: "p1", projects })).toEqual({
      project: projects[1],
      source: "route",
    });
  });

  test("the remembered choice is used when the URL says nothing", () => {
    expect(pickProject({ preferred: "p2", projects })).toEqual({ project: projects[1], source: "preference" });
  });

  test("a remembered project the user can no longer reach is ignored, not obeyed", () => {
    const result = pickProject({ preferred: "gone", projects });
    expect(result.project).toEqual(projects[0]);
    expect(result.source).toBe("auto");
  });

  test("a requested project the user cannot reach falls through rather than erroring", () => {
    const result = pickProject({ requested: "gone", preferred: "p2", projects });
    expect(result).toEqual({ project: projects[1], source: "preference" });
  });

  test("one project is not a choice", () => {
    expect(pickProject({ projects: [projects[0]] })).toEqual({ project: projects[0], source: "only" });
  });

  test("with nothing to go on the page still renders, and says the choice was automatic", () => {
    expect(pickProject({ projects })).toEqual({ project: projects[0], source: "auto" });
  });

  test("no projects at all resolves to nothing, with no source to explain", () => {
    expect(pickProject({ requested: "p1", preferred: "p2", projects: [] })).toEqual({
      project: null,
      source: null,
    });
  });
});
