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
//
// MERGED WITH WS-A. The RULE this function applies is now pickProject()
// (src/lib/project-preference.ts), which WS-A shipped and which the browser
// shell applies too -- the URL, then the user's own remembered rail choice,
// then their only project, then a pick. That is why every result now also
// carries WS-A's `source`, and why `fellBack` is derived from it rather than
// computed a second time: "auto" and "fell back" are one fact, and two fields
// that can disagree about one fact is how the rail and the pane came to
// disagree in the first place. This lane's own contribution is the refusal --
// allProjectsWhenUnset -- which WS-A's rule has no opinion about.
import { describe, expect, mock, test } from "bun:test";
import { dashboardScope, chooseProject, type SelectableProject } from "./project-selection";

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
    // No source either: nothing was chosen, so there is nothing to explain.
    expect(result).toEqual({ project: null, mode: "all", fellBack: false, source: null });
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
      source: null,
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
    // ...and the mode is "all", not "project". An org with no projects has no
    // project in scope, and "project mode with no project" is the
    // contradictory state ProjectScopeProvider already refuses to represent --
    // it was reachable here only because the legacy branch stated the mode
    // instead of deriving it. Derived from the project now, in one place, so
    // the two halves cannot describe the same situation differently.
    expect(chooseProject([], undefined)).toEqual({
      project: null,
      mode: "all",
      fellBack: false,
      source: null,
    });
  });

  test("the remembered rail choice is honoured when the URL says nothing -- and is NOT a fallback", () => {
    // WS-A's tier between the URL and the pick. It is the user's own earlier
    // decision, so it must not be labelled "(auto-selected)".
    const result = chooseProject(PROJECTS, undefined, undefined, "p-villa21");
    expect(result.project).toEqual({ id: "p-villa21", name: "Villa 21" });
    expect(result.source).toBe("preference");
    expect(result.fellBack).toBe(false);
  });

  test("the URL still outranks the remembered choice", () => {
    const result = chooseProject(PROJECTS, "p-cedar", undefined, "p-villa21");
    expect(result.project).toEqual(PROJECTS[0]);
    expect(result.source).toBe("route");
    expect(result.fellBack).toBe(false);
  });

  test("a remembered project the user can no longer reach is ignored, not obeyed", () => {
    const result = chooseProject(PROJECTS, undefined, undefined, "p-from-another-org");
    expect(result.project).toEqual(PROJECTS[0]);
    // It fell through to the pick, and says so.
    expect(result.fellBack).toBe(true);
  });

  test("one project is not a choice -- it is not reported as automatic", () => {
    const one = [PROJECTS[0]];
    const result = chooseProject(one, undefined);
    expect(result.project).toEqual(PROJECTS[0]);
    expect(result.source).toBe("only");
    expect(result.fellBack).toBe(false);
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

// ─── R67 D-66: what /dashboard shows ──────────────────────────────────────
//
// Until this, /dashboard ALWAYS rendered the org portfolio, whatever the rail
// said -- so a user who picked Cedar Heights in the top bar and clicked HOME
// landed on a screen about every project, with the rail still naming one.
// Same split-brain as R-253's breadcrumb, in the place a user returns to most.
describe("dashboardScope -- R67 D-66", () => {
  const PROJECTS = [
    { id: "p-cedar", name: "Cedar Heights Villa - Phase 1" },
    { id: "p-villa", name: "Villa 21" },
  ];

  test("nothing asked for and nothing remembered is the portfolio, explicitly", () => {
    expect(dashboardScope(PROJECTS, undefined, null)).toEqual({ project: null, mode: "all" });
  });

  test("the URL wins over the remembered choice", () => {
    const scope = dashboardScope(PROJECTS, "p-villa", "p-cedar");
    expect(scope.mode).toBe("project");
    expect(scope.project?.id).toBe("p-villa");
  });

  test("the remembered choice is used when the URL says nothing", () => {
    expect(dashboardScope(PROJECTS, undefined, "p-cedar").project?.id).toBe("p-cedar");
  });

  test("a stale id -- deleted, or from another org -- is discarded, not followed", () => {
    // Following it would pin the user to a blank screen with no way out.
    expect(dashboardScope(PROJECTS, "p-gone", null)).toEqual({ project: null, mode: "all" });
    expect(dashboardScope(PROJECTS, undefined, "p-gone")).toEqual({ project: null, mode: "all" });
  });

  test("a stale URL id still falls through to a VALID remembered choice", () => {
    expect(dashboardScope(PROJECTS, "p-gone", "p-villa").project?.id).toBe("p-villa");
  });

  test("it NEVER falls back to projects[0] -- the fault D-20 removed", () => {
    // The home screen is the loudest possible place to re-introduce a silent
    // wrong-project selection.
    expect(dashboardScope(PROJECTS, undefined, undefined).project).toBeNull();
  });

  test("an org with no projects is the portfolio, not a crash", () => {
    expect(dashboardScope([], "p-cedar", "p-villa")).toEqual({ project: null, mode: "all" });
  });
});
