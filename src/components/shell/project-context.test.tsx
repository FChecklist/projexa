/// <reference types="bun-types" />
// R67 D-66 -- ONE published project scope.
//
// WHAT THIS FILE NO LONGER TESTS, and why. It began as the assertions for this
// lane's own useUrlProjectId() -- the URL over the cookie, re-read on popstate,
// the cookie consulted once. That hook is retired: WS-A shipped the same rule
// in pickProject() (src/lib/project-preference.ts), applied by BOTH the browser
// shell and the server page, which is the property that actually stops the rail
// and the pane disagreeing -- and its precedence is asserted in
// src/lib/project-preference.test.ts, including "the URL wins over the
// remembered choice" and "a remembered project the user can no longer reach is
// ignored, not obeyed". Keeping a second set of assertions for a second
// resolution would have documented a rule the product does not follow.
//
// What is left is this module's own contract, which nothing else covers: the
// scope every component under the shell reads, and the one invariant that makes
// it safe -- `mode` is DERIVED from the project, so "project mode with no
// project" cannot be represented at all.

import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register({ url: "http://localhost:3100/" });

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ProjectScopeProvider, useProjectScope } from "./project-context";

afterEach(cleanup);

function ScopeProbe() {
  const scope = useProjectScope();
  return (
    <span data-testid="scope">
      {scope.mode}|{scope.project?.name ?? "(none)"}|{String(scope.projectsLoaded)}
    </span>
  );
}

describe("ProjectScopeProvider", () => {
  const base = {
    projects: [{ id: "p-cedar", name: "Cedar Heights Villa" }],
    projectId: "p-cedar",
    projectsLoaded: true,
    selectProject: () => {},
    openSwitcher: () => {},
  };

  test("mode is DERIVED from the project, so 'project mode with no project' is unrepresentable", () => {
    const { getByTestId } = render(
      <ProjectScopeProvider value={{ ...base, project: base.projects[0] }}>
        <ScopeProbe />
      </ProjectScopeProvider>
    );
    expect(getByTestId("scope").textContent).toBe("project|Cedar Heights Villa|true");
  });

  test("no project means all-projects mode -- never a silent fall back to the first one", () => {
    const { getByTestId } = render(
      <ProjectScopeProvider value={{ ...base, project: null, projectId: null }}>
        <ScopeProbe />
      </ProjectScopeProvider>
    );
    expect(getByTestId("scope").textContent).toBe("all|(none)|true");
  });

  test("a project in scope is reported with its id, so a consumer never re-derives it", () => {
    function IdProbe() {
      return <span data-testid="id">{useProjectScope().projectId ?? "(none)"}</span>;
    }
    const { getByTestId } = render(
      <ProjectScopeProvider value={{ ...base, project: base.projects[0] }}>
        <IdProbe />
      </ProjectScopeProvider>
    );
    expect(getByTestId("id").textContent).toBe("p-cedar");
  });

  test("outside the shell the default is honest about knowing nothing", () => {
    const { getByTestId } = render(<ScopeProbe />);
    // projectsLoaded false is the load-bearing half: a screen must be able to
    // tell "this org has no projects" from "we have not been told yet", which
    // is the difference between an empty state and a skeleton.
    expect(getByTestId("scope").textContent).toBe("all|(none)|false");
  });

  test("the default's controls are inert rather than absent, so a component outside the shell still renders", () => {
    function ActionProbe() {
      const scope = useProjectScope();
      return (
        <button onClick={() => { scope.selectProject(null); scope.openSwitcher(); }}>go</button>
      );
    }
    const { getByText } = render(<ActionProbe />);
    // Pressing them must not throw -- three routes deliberately get no shell.
    expect(() => getByText("go").click()).not.toThrow();
  });
});
