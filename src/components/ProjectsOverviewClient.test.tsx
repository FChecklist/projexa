/// <reference types="bun-types" />
// R62 B7 regression tests for R43 F_026 (closed via PR #167 + PR #176/#178's
// sibling projexa#176 justification note; see that fault row's justification
// for the full two-route history: /dashboard/overview via this component,
// and /reports via ProjectLoadError -- both covered below).
//
// THE DEFECT (dashboard/overview half, fixed in this component): the error
// branch and the empty-state branch were tested independently --
// `bars.length === 0` was checked without asking WHY the list was empty. On
// a VERIDIAN timeout, fetchProjectProgressBars returns `bars: []` TOGETHER
// WITH a real errorMessage, so the page printed the error line AND then
// "No active projects yet." right under it -- a false zero on the CEO
// portfolio screen, worse than an error because it reads as an answer.
//
// THE FIX: the two states are now mutually exclusive -- errorMessage
// non-null excludes the empty-state branch entirely.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ProjectsOverviewClient calls useRouter() (for the Retry button) --
// next/navigation's App Router hook throws outside a real Next.js router
// context, so it's stubbed the same way src/lib/company-scope.test.ts stubs
// its own server-only modules via bun:test's mock.module.
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, back: () => {} }),
}));

const ProjectsOverviewClient = (await import("./ProjectsOverviewClient")).default;

afterEach(cleanup);

describe("ProjectsOverviewClient (R43 F_026, /dashboard/overview half)", () => {
  test("an errorMessage with an empty bars list shows the real error, never the false 'No active projects yet.' empty state", () => {
    const { getByRole, queryByText } = render(
      <ProjectsOverviewClient bars={[]} errorMessage="VERIDIAN request timed out after 20000ms" />
    );

    expect(getByRole("alert").textContent).toContain("VERIDIAN request timed out after 20000ms");
    // The exact fault: both branches used to render together.
    expect(queryByText("No active projects yet.")).toBeNull();
  });

  test("a genuinely empty bars list (no error) still shows the real empty state -- the fix must not turn every empty org into a false error", () => {
    const { getByText, queryByRole } = render(<ProjectsOverviewClient bars={[]} errorMessage={null} />);

    expect(getByText("No active projects yet.")).toBeDefined();
    expect(queryByRole("alert")).toBeNull();
  });

  test("real project data renders even when errorMessage is null", () => {
    const { getByText, queryByText } = render(
      <ProjectsOverviewClient
        bars={[{ id: "proj-1", name: "Marina Tower", progressPercent: 42 }]}
        errorMessage={null}
      />
    );
    expect(getByText("Marina Tower")).toBeDefined();
    expect(queryByText("No active projects yet.")).toBeNull();
  });
});

describe("reports/page.tsx (R43 F_026, /reports half)", () => {
  // This route's Server Component (async, DB/auth/VERIDIAN-backed) is not
  // practically unit-renderable here -- see ProjectLoadError.tsx's own
  // header comment for the shared defect this fixes across 23 project-scoped
  // pages. This structural check is what actually regresses if the old inert
  // "just print the message" Card pattern is reintroduced on this route.
  test("on a project-load error, the page renders ProjectLoadError (which carries a real Retry), not a bare inert error Card", () => {
    const source = readFileSync(join(process.cwd(), "src", "app", "(app)", "reports", "page.tsx"), "utf8");
    expect(source).toMatch(/import ProjectLoadError from ["']@\/components\/ProjectLoadError["']/);
    expect(source).toMatch(/errorMessage\s*&&\s*<ProjectLoadError/);
  });
});
