/// <reference types="bun-types" />
// R67 F-03 (R-041/R-046/R-052/R-057) acceptance test.
//
// THE BUG. resolveSelectedProject() is called by ~50 page.tsx files -- every
// project-scoped screen in PROJEXA -- and it resolved the project by calling
// VERIDIAN's GET /dashboard, i.e. getOrgDashboard(): the earned-value/BOQ/
// invoice aggregate, measured at 1.4-4.0 s. Every one of those pages awaited
// that aggregate before sending a single byte of HTML, purely to learn a
// project's id and name. /documents measured TTFB 1951 ms and /moms 1983 ms;
// /budgets, which does not call this, painted at 580 ms.
//
// THE CONTRACT NOW. It calls GET /projects -- one indexed read server-side --
// and never /dashboard. The two assertions below are the ones that would
// have caught the regression: the URL, and that an explicitly requested id
// wins over projects[0] (the old fallback silently ignored the request when
// the requested project was not the first row).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveSelectedProject } from "./project-selection";

const realFetch = globalThis.fetch;
let requestedUrls: string[] = [];

function stubFetch(body: unknown, status = 200) {
  requestedUrls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrls.push(typeof input === "string" ? input : input.toString());
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(() => {
  // No organizationId is passed below, so resolveApiKey() takes the shared-key
  // branch and never touches the database -- see veridian-client.ts's AR-04
  // comment for why an org-scoped call may never fall back to this key.
  process.env.VERIDIAN_API_KEY = "vk_test_only";
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const TWO_PROJECTS = {
  projects: [
    { id: "p1", name: "Marina Tower", status: "active" },
    { id: "p2", name: "Business Bay Fit-out", status: "active" },
  ],
};

describe("resolveSelectedProject -- the cheap projects endpoint, never /dashboard", () => {
  test("requests /api/v1/projexa/projects", async () => {
    stubFetch(TWO_PROJECTS);

    await resolveSelectedProject("p2");

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("/api/v1/projexa/projects");
  });

  test("never requests /dashboard", async () => {
    stubFetch(TWO_PROJECTS);

    await resolveSelectedProject("p2");

    for (const url of requestedUrls) expect(url).not.toContain("/dashboard");
  });

  test("resolves the REQUESTED id, not projects[0]", async () => {
    stubFetch(TWO_PROJECTS);

    const { project, projects } = await resolveSelectedProject("p2");

    expect(project?.id).toBe("p2");
    expect(project?.name).toBe("Business Bay Fit-out");
    expect(projects).toHaveLength(2);
  });

  test("falls back to the first project when nothing was requested", async () => {
    stubFetch(TWO_PROJECTS);

    const { project } = await resolveSelectedProject();

    // Unchanged behaviour for bookmarked/pre-switcher URLs.
    expect(project?.id).toBe("p1");
  });

  test("an unknown requested id falls back rather than returning nothing", async () => {
    stubFetch(TWO_PROJECTS);

    const { project } = await resolveSelectedProject("deleted-project");

    expect(project?.id).toBe("p1");
  });

  test("an empty org resolves to a null project with no error", async () => {
    stubFetch({ projects: [] });

    const { project, projects, errorMessage } = await resolveSelectedProject("p1");

    // "this org has no projects" is a real answer, not a failure.
    expect(project).toBeNull();
    expect(projects).toEqual([]);
    expect(errorMessage).toBeNull();
  });

  test("a backend failure surfaces the backend's own words, not an invented message", async () => {
    stubFetch({ error: "No organisation on this account" }, 400);

    const { project, errorMessage } = await resolveSelectedProject("p1");

    expect(project).toBeNull();
    expect(errorMessage).toBe("No organisation on this account");
  });
});
