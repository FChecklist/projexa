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

// ─── R67 D-70 (audit R-262): what a create route says when this fails ────────
//
// These are pure functions, so unlike the block above they need no module stub.
describe("describeProjectListFailure", () => {
  test("a bare HTTP status phrase is replaced -- it is not the backend's words about anything", async () => {
    const { describeProjectListFailure } = await import("./project-selection");
    for (const raw of ["Internal Server Error", "internal server error.", "500", "Bad Gateway", "503"]) {
      expect(describeProjectListFailure(raw)).toBe("VERIDIAN answered with an internal error.");
    }
  });

  test("a real backend message is kept verbatim -- this is not a message filter", async () => {
    const { describeProjectListFailure } = await import("./project-selection");
    expect(
      describeProjectListFailure("The construction data service did not respond in time, on two attempts. Please retry.")
    ).toBe("The construction data service did not respond in time, on two attempts. Please retry.");
    expect(describeProjectListFailure("No veridian_credentials row for this organisation")).toBe(
      "No veridian_credentials row for this organisation"
    );
  });

  test("a message that merely CONTAINS the status phrase is not rewritten", async () => {
    const { describeProjectListFailure } = await import("./project-selection");
    expect(describeProjectListFailure("Project sync failed: Internal Server Error from the ERP")).toBe(
      "Project sync failed: Internal Server Error from the ERP"
    );
  });
});

describe("projectListFailureBanner", () => {
  test("leads with the item's own sentence, then the described cause", async () => {
    const { projectListFailureBanner } = await import("./project-selection");
    expect(projectListFailureBanner("Internal Server Error")).toBe(
      "Couldn't load your project list: VERIDIAN answered with an internal error."
    );
    expect(projectListFailureBanner("No veridian_credentials row for this organisation")).toBe(
      "Couldn't load your project list: No veridian_credentials row for this organisation"
    );
  });
});

describe("the outcome shape D-70 asks for", () => {
  test("a failure carries the upstream status for the caller's log, and never throws", async () => {
    class FakeApiError extends realClient.VeridianApiError {}
    const mod = await loadWith(async () => {
      throw new FakeApiError("Internal Server Error", 500);
    });
    const result = await mod.resolveSelectedProject(undefined, "org_1");
    expect(result.status).toBe(500);
    expect(result.project).toBeNull();
    expect(result.errorMessage).toBe("Internal Server Error");
  });

  test("a successful read reports no status at all", async () => {
    const mod = await loadWith(async () => ({ projects: [{ id: "p1", name: "Cedar Heights Villa - Phase 1" }] }));
    const result = await mod.resolveSelectedProject("p1", "org_1");
    expect(result.status).toBeNull();
    expect(result.project?.id).toBe("p1");
  });
});
