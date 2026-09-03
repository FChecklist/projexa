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
import { dashboardScope, chooseProject, type SelectableProject } from "./project-selection";

const SCOPE_PROJECTS: SelectableProject[] = [
  { id: "p-cedar", name: "Cedar Heights Villa - Phase 1" },
  { id: "p-villa21", name: "Villa 21" },
];

describe("chooseProject -- the honest all-projects mode (opted in)", () => {
  test("no projectId asked for => { project: null, mode: 'all' } and projects[0] is NOT returned", () => {
    const result = chooseProject(SCOPE_PROJECTS, undefined, { allProjectsWhenUnset: true });
    expect(result.project).toBeNull();
    expect(result.mode).toBe("all");
    expect(result.fellBack).toBe(false);
    // The whole point: the first project must not leak out as an answer.
    expect(result.project).not.toBe(SCOPE_PROJECTS[0]);
  });

  test("a projectId that this org cannot see is the same question, not an invitation to guess", () => {
    const result = chooseProject(SCOPE_PROJECTS, "p-from-another-org", { allProjectsWhenUnset: true });
    // No source either: nothing was chosen, so there is nothing to explain.
    expect(result).toEqual({ project: null, mode: "all", fellBack: false, source: null });
  });

  test("a real projectId still resolves to that exact project, never to the first one", () => {
    const result = chooseProject(SCOPE_PROJECTS, "p-villa21", { allProjectsWhenUnset: true });
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
    const result = chooseProject(SCOPE_PROJECTS, undefined);
    expect(result.project).toEqual(SCOPE_PROJECTS[0]);
    expect(result.mode).toBe("project");
  });

  test("...but the fallback is no longer SILENT -- fellBack says so, which is what lets a screen print '(auto-selected)'", () => {
    expect(chooseProject(SCOPE_PROJECTS, undefined).fellBack).toBe(true);
    expect(chooseProject(SCOPE_PROJECTS, "p-villa21").fellBack).toBe(false);
  });

  test("an unknown projectId falls back with fellBack true rather than pretending the link resolved", () => {
    const result = chooseProject(SCOPE_PROJECTS, "p-gone");
    expect(result.project).toEqual(SCOPE_PROJECTS[0]);
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
    const result = chooseProject(SCOPE_PROJECTS, undefined, undefined, "p-villa21");
    expect(result.project).toEqual({ id: "p-villa21", name: "Villa 21" });
    expect(result.source).toBe("preference");
    expect(result.fellBack).toBe(false);
  });

  test("the URL still outranks the remembered choice", () => {
    const result = chooseProject(SCOPE_PROJECTS, "p-cedar", undefined, "p-villa21");
    expect(result.project).toEqual(SCOPE_PROJECTS[0]);
    expect(result.source).toBe("route");
    expect(result.fellBack).toBe(false);
  });

  test("a remembered project the user can no longer reach is ignored, not obeyed", () => {
    const result = chooseProject(SCOPE_PROJECTS, undefined, undefined, "p-from-another-org");
    expect(result.project).toEqual(SCOPE_PROJECTS[0]);
    // It fell through to the pick, and says so.
    expect(result.fellBack).toBe(true);
  });

  test("one project is not a choice -- it is not reported as automatic", () => {
    const one = [SCOPE_PROJECTS[0]];
    const result = chooseProject(one, undefined);
    expect(result.project).toEqual(SCOPE_PROJECTS[0]);
    expect(result.source).toBe("only");
    expect(result.fellBack).toBe(false);
  });

  test("the returned project is the array's own object, so a caller comparing identity keeps working", () => {
    expect(chooseProject(SCOPE_PROJECTS, "p-cedar").project).toBe(SCOPE_PROJECTS[0]);
  });
});

// The acceptance criterion in its literal form: the whole function, with the
// VERIDIAN call stubbed, asked for nothing. @/lib/veridian-client is mocked
// rather than the network so this test never touches the database module the
// real client imports.
describe("resolveSelectedProject (VERIDIAN stubbed)", () => {
  test("a two-project response and no projectId argument yields { project: null, mode: 'all' }", async () => {
    mock.module("@/lib/veridian-client", () => ({
      callVeridian: async () => ({ projects: SCOPE_PROJECTS }),
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
