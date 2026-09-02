/// <reference types="bun-types" />
// R67 D-20 -- "stop the silent wrong-project fallback".
//
// THE DEFECT this file exists to keep dead: resolveSelectedProject() used to
// end in `|| projects[0] || null`, so a screen opened with no ?projectId=
// resolved to the org's FIRST project while the top rail above it still read
// "All projects". Minutes typed into a Villa 21 meeting could therefore be
// saved -- and then locked by Publish, which is irreversible -- under Cedar
// Heights, with nothing on screen ever having claimed Cedar Heights was
// selected.
//
// The fallback itself is NOT deleted (about fifty module pages still depend
// on it and old links must keep working); it is made visible (`fellBack`)
// and refusable (`allProjectsWhenUnset`).
import { describe, expect, mock, test } from "bun:test";
import { chooseProject, type SelectableProject } from "./project-selection";

const PROJECTS: SelectableProject[] = [
  { id: "p-cedar", name: "Cedar Heights Villa - Phase 1" },
  { id: "p-villa21", name: "Villa 21" },
];

describe("chooseProject -- the honest all-projects mode (opted in)", () => {
  test("no projectId asked for => { project: null, mode: 'all' } and projects[0] is NOT returned", () => {
    const result = chooseProject(PROJECTS, undefined, { allProjectsWhenUnset: true });
    expect(result.project).toBeNull();
    expect(result.mode).toBe("all");
    expect(result.fellBack).toBe(false);
    // The whole point: the first project must not leak out as an answer.
    expect(result.project).not.toBe(PROJECTS[0]);
  });

  test("a projectId that this org cannot see is the same question, not an invitation to guess", () => {
    const result = chooseProject(PROJECTS, "p-from-another-org", { allProjectsWhenUnset: true });
    expect(result).toEqual({ project: null, mode: "all", fellBack: false });
  });

  test("a real projectId still resolves to that exact project, never to the first one", () => {
    const result = chooseProject(PROJECTS, "p-villa21", { allProjectsWhenUnset: true });
    expect(result.project).toEqual({ id: "p-villa21", name: "Villa 21" });
    expect(result.mode).toBe("project");
    expect(result.fellBack).toBe(false);
  });

  test("an org with no projects at all is 'all' with an empty list, not an error", () => {
    expect(chooseProject([], undefined, { allProjectsWhenUnset: true })).toEqual({
      project: null,
      mode: "all",
      fellBack: false,
    });
  });
});

describe("chooseProject -- the legacy fallback the other ~50 callers still use", () => {
  test("no projectId still resolves to projects[0], exactly as before, so old links keep working", () => {
    const result = chooseProject(PROJECTS, undefined);
    expect(result.project).toEqual(PROJECTS[0]);
    expect(result.mode).toBe("project");
  });

  test("...but the fallback is no longer SILENT -- fellBack says so, which is what lets a screen print '(auto-selected)'", () => {
    expect(chooseProject(PROJECTS, undefined).fellBack).toBe(true);
    expect(chooseProject(PROJECTS, "p-villa21").fellBack).toBe(false);
  });

  test("an unknown projectId falls back with fellBack true rather than pretending the link resolved", () => {
    const result = chooseProject(PROJECTS, "p-gone");
    expect(result.project).toEqual(PROJECTS[0]);
    expect(result.fellBack).toBe(true);
  });

  test("an empty project list cannot fall back to anything, so fellBack is false", () => {
    expect(chooseProject([], undefined)).toEqual({ project: null, mode: "project", fellBack: false });
  });

  test("the returned project is the array's own object, so a caller comparing identity keeps working", () => {
    expect(chooseProject(PROJECTS, "p-cedar").project).toBe(PROJECTS[0]);
  });
});

// The acceptance criterion in its literal form: the whole function, with the
// VERIDIAN call stubbed, asked for nothing. @/lib/veridian-client is mocked
// rather than the network so this test never touches the database module the
// real client imports.
describe("resolveSelectedProject (VERIDIAN stubbed)", () => {
  test("a two-project response and no projectId argument yields { project: null, mode: 'all' }", async () => {
    mock.module("@/lib/veridian-client", () => ({
      callVeridian: async () => ({ projects: PROJECTS }),
      VeridianApiError: class VeridianApiError extends Error {
        constructor(message: string, public status: number) {
          super(message);
        }
      },
      VERIDIAN_SCREEN_BUDGET_MS: 8000,
    }));
    const { resolveSelectedProject } = await import("./project-selection");

    const result = await resolveSelectedProject(undefined, "org-1", { allProjectsWhenUnset: true });
    expect(result.project).toBeNull();
    expect(result.mode).toBe("all");
    expect(result.errorMessage).toBeNull();
    // The org list is still returned -- "all projects" needs to know which.
    expect(result.projects.map((p) => p.id)).toEqual(["p-cedar", "p-villa21"]);
  });

  test("a failed read is never reported as an all-projects result with data -- projects stays empty and the backend's words come through", async () => {
    mock.module("@/lib/veridian-client", () => ({
      callVeridian: async () => {
        throw new Error("boom");
      },
      VeridianApiError: class VeridianApiError extends Error {
        constructor(message: string, public status: number) {
          super(message);
        }
      },
      VERIDIAN_SCREEN_BUDGET_MS: 8000,
    }));
    const { resolveSelectedProject } = await import("./project-selection");

    const result = await resolveSelectedProject(undefined, "org-1", { allProjectsWhenUnset: true });
    expect(result.project).toBeNull();
    expect(result.projects).toEqual([]);
    expect(result.errorMessage).toBe("Failed to load projects from VERIDIAN");
    expect(result.fellBack).toBe(false);
  });
});
