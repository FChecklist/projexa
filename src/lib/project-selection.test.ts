/// <reference types="bun-types" />
// R67 D-07. resolveSelectedProject() falls back to the org's FIRST project
// when the caller asked for none -- long-standing, deliberate behaviour that
// keeps old bookmarked URLs working. What was wrong is that it happened
// silently: the screen showed one project's rows while the top rail still
// said "All projects", and nothing on the page named the project it had
// actually queried.
//
// D-07 added a `fellBack` boolean to say so. Lane A's A-04/A-05 merged first
// with the richer `source`, which names WHICH of four rules chose the project:
// "route" (the URL), "preference" (the user's own last rail choice, read from
// the veri.rail.project cookie so the server agrees on the first render),
// "only" (their single project), or "auto" (the page choosing for them).
// D-07's question is exactly that last case, so it is asked of `source` and the
// duplicate flag is gone -- one fact, one name. These tests pin when the answer
// is "auto".
//
// The VERIDIAN call itself is stubbed at the module boundary (veridian-client),
// the same way this repo's other server-module tests do it -- no network, no
// API key, no live org.
import { afterEach, describe, expect, mock, test } from "bun:test";

const realClient = await import("./veridian-client");

async function loadWith(impl: () => Promise<unknown>) {
  await mock.module("./veridian-client", () => ({ ...realClient, callVeridian: mock(impl) }));
  return import("./project-selection");
}

afterEach(async () => {
  mock.restore();
  await mock.module("./veridian-client", () => realClient);
});

const PROJECTS = [
  { id: "p1", name: "Cedar Heights Villa - Phase 1" },
  { id: "p2", name: "Riverside Business Park" },
];

describe("resolveSelectedProject", () => {
  test("no project asked for: falls back to the first AND reports source 'auto'", async () => {
    const { resolveSelectedProject } = await loadWith(async () => ({ projects: PROJECTS }));
    const result = await resolveSelectedProject(undefined, "org-1");
    expect(result.project).toEqual(PROJECTS[0]);
    expect(result.source).toBe("auto");
  });

  test("the asked-for project is honoured and reports source 'route', not 'auto'", async () => {
    const { resolveSelectedProject } = await loadWith(async () => ({ projects: PROJECTS }));
    const result = await resolveSelectedProject("p2", "org-1");
    expect(result.project).toEqual(PROJECTS[1]);
    expect(result.source).not.toBe("auto");
  });

  test("a project id this org does not have is a fallback too -- the user asked for something else", async () => {
    const { resolveSelectedProject } = await loadWith(async () => ({ projects: PROJECTS }));
    const result = await resolveSelectedProject("not-this-orgs-project", "org-1");
    expect(result.project).toEqual(PROJECTS[0]);
    expect(result.source).toBe("auto");
  });

  test("an org with no projects has nothing to fall back TO, so source is null", async () => {
    const { resolveSelectedProject } = await loadWith(async () => ({ projects: [] }));
    const result = await resolveSelectedProject(undefined, "org-1");
    expect(result.project).toBeNull();
    expect(result.source).not.toBe("auto");
  });

  test("a failed read reports the backend's own words and never claims a project", async () => {
    const { resolveSelectedProject } = await loadWith(async () => {
      throw new realClient.VeridianApiError("upstream timed out", 504);
    });
    const result = await resolveSelectedProject(undefined, "org-1");
    expect(result.project).toBeNull();
    expect(result.projects).toEqual([]);
    expect(result.errorMessage).toBe("upstream timed out");
    expect(result.source).not.toBe("auto");
  });
});
