/// <reference types="bun-types" />
// R67 WS-A (A-05). pickProject is the one rule the server page and the browser
// shell both apply, so every branch of it is asserted here -- a disagreement
// between those two halves is exactly the defect it exists to remove.
import { describe, test, expect } from "bun:test";
import { pickProject, pickRouteProject } from "./project-preference";

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

// R67 WS-A (A-13). The strict rule for a project's own screen: the URL wins,
// then the rail's own remembered choice (PROJEXA-E2E-001 section 5 item 6 --
// see project-preference.ts's own comment for why this is not the
// first-project GUESS A-13 forbids), and only then does the screen ask.
// Every branch matters because each one produces a different sentence on the
// page, and the defect being removed is a screen that silently rendered
// another project's data under the same heading.
describe("pickRouteProject", () => {
  test("the URL's project is used, and the source says where it came from", () => {
    expect(pickRouteProject({ requested: "p2", projects })).toEqual({
      project: projects[1],
      source: "route",
      missing: false,
      unreachable: false,
    });
  });

  test("an object page's own project counts as the route naming it", () => {
    expect(pickRouteProject({ objectProjectId: "p1", projects }).project).toEqual(projects[0]);
  });

  test("the URL outranks the object when both say something", () => {
    expect(pickRouteProject({ requested: "p2", objectProjectId: "p1", projects }).project).toEqual(projects[1]);
  });

  test("NOTHING named or remembered means the screen asks -- it never picks the first project", () => {
    expect(pickRouteProject({ projects })).toEqual({
      project: null,
      source: null,
      missing: true,
      unreachable: false,
    });
  });

  test("an empty or blank projectId is the same as none", () => {
    expect(pickRouteProject({ requested: "   ", projects }).missing).toBe(true);
  });

  test("a project the user cannot reach is NOT missing -- it is a different sentence", () => {
    expect(pickRouteProject({ requested: "gone", projects })).toEqual({
      project: null,
      source: null,
      missing: false,
      unreachable: true,
    });
  });

  test("the same URL resolves to the same project every time (ten reloads, A-13)", () => {
    for (let i = 0; i < 10; i += 1) {
      expect(pickRouteProject({ requested: "p1", projects }).project).toEqual(projects[0]);
    }
  });

  // ─── PROJEXA-E2E-001 section 5 item 6: the switcher's cookie, as a real tier ──
  test("the rail's remembered choice is used when the URL and the object say nothing", () => {
    expect(pickRouteProject({ preferred: "p2", projects })).toEqual({
      project: projects[1],
      source: "preference",
      missing: false,
      unreachable: false,
    });
  });

  test("the URL still outranks the remembered choice", () => {
    expect(pickRouteProject({ requested: "p1", preferred: "p2", projects }).project).toEqual(projects[0]);
  });

  test("the object still outranks the remembered choice", () => {
    expect(pickRouteProject({ objectProjectId: "p1", preferred: "p2", projects }).project).toEqual(projects[0]);
  });

  test("a remembered project the user can no longer reach is ignored, not obeyed -- and the screen still asks, not 'unreachable'", () => {
    expect(pickRouteProject({ preferred: "gone", projects })).toEqual({
      project: null,
      source: null,
      missing: true,
      unreachable: false,
    });
  });

  test("the remembered choice is STILL never the first-project guess -- an org with two projects and no preference asks", () => {
    // This is the one assertion that would fail if a future edit widened the
    // fallback back into A-13's forbidden territory.
    expect(pickRouteProject({ projects }).project).not.toEqual(projects[0]);
    expect(pickRouteProject({ preferred: undefined, projects }).missing).toBe(true);
  });
});
