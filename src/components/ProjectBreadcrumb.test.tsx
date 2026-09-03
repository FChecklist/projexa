/// <reference types="bun-types" />
// R67 D-66 -- the breadcrumb and the ProjectContext it reads from.
//
// R-253's fault, restated: the rail said "All projects" while the breadcrumb
// underneath it said "Dashboard / Cedar Heights Villa - Phase 1". Two
// independent sources of the same fact. These assertions pin the shape that
// makes that impossible -- the breadcrumb takes no project prop at all, so
// there is nowhere for a second answer to come from -- and the behaviour that
// makes the tinted project name a real control rather than decoration.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// `screen` binds to document.body when @testing-library/dom is imported,
// which happens before GlobalRegistrator installs one. Every query here goes
// through render()'s own return value instead -- the same choice the other
// component tests in this repo made.
import { cleanup, fireEvent, render } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/permits",
}));

const { ProjectBreadcrumb } = await import("./ProjectBreadcrumb");
const { ProjectScopeProvider, useProjectScope } = await import("./shell/project-context");

afterEach(cleanup);

const CEDAR = { id: "p-cedar", name: "Cedar Heights Villa - Phase 1" };

function withScope(
  ui: React.ReactNode,
  overrides: Partial<Parameters<typeof ProjectScopeProvider>[0]["value"]> = {}
) {
  const value = {
    projects: [CEDAR],
    project: CEDAR as { id: string; name: string } | null,
    projectId: CEDAR.id as string | null,
    projectsLoaded: true,
    selectProject: () => {},
    openSwitcher: () => {},
    ...overrides,
  };
  return render(<ProjectScopeProvider value={value}>{ui}</ProjectScopeProvider>);
}

describe("ProjectBreadcrumb", () => {
  test("reads '{Project} / {Module}' from the context, not from a prop", () => {
    const { container } = withScope(<ProjectBreadcrumb module="Permits" moduleHref="/permits" />);
    expect(container.textContent).toContain("Cedar Heights Villa - Phase 1");
    expect(container.textContent).toContain("Permits");
  });

  test("under 'All projects' the scope is still stated, never left blank", () => {
    const { container } = withScope(<ProjectBreadcrumb module="Permits" moduleHref="/permits" />, {
      project: null,
      projectId: null,
    });
    expect(container.textContent).toContain("All projects");
  });

  test("the project segment opens the rail's switcher -- twice, when clicked twice", () => {
    let opened = 0;
    const { getByRole } = withScope(<ProjectBreadcrumb module="Permits" moduleHref="/permits" />, {
      openSwitcher: () => {
        opened += 1;
      },
    });
    const button = getByRole("button", { name: /Click to switch project/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(opened).toBe(2);
  });

  test("a create screen renders '← Back {Project} / {Module} / New {Object}'", () => {
    const { container } = withScope(
      <ProjectBreadcrumb module="Permits" moduleHref="/permits" trail={["New Permit"]} backHref="/permits" />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Back");
    expect(text.indexOf("Cedar Heights Villa - Phase 1")).toBeGreaterThan(text.indexOf("Back"));
    expect(text.indexOf("New Permit")).toBeGreaterThan(text.indexOf("Permits"));
  });

  test("outside the shell it still renders rather than throwing", () => {
    // Three routes deliberately get no shell (auth/callback, invite/[token],
    // share/report/[token]), and every unit test renders without one. A
    // context that throws when absent would make those cases crash.
    const { container } = render(<ProjectBreadcrumb module="Permits" moduleHref="/permits" />);
    expect(container.textContent).toContain("All projects");
  });
});

describe("ProjectScopeProvider", () => {
  test("mode is derived from the project, so 'project mode with no project' cannot exist", () => {
    // The contradictory state D-20 removed: a screen believing it is scoped
    // to a project while holding none.
    function Probe() {
      const { mode } = useProjectScope();
      return <span data-testid="mode">{mode}</span>;
    }
    const scoped = withScope(<Probe />);
    expect(scoped.getByTestId("mode").textContent).toBe("project");
    cleanup();
    const portfolio = withScope(<Probe />, { project: null, projectId: null });
    expect(portfolio.getByTestId("mode").textContent).toBe("all");
  });
});
