/// <reference types="bun-types" />
// R67 D-20 / D-66 -- THE URL WINS, asserted.
//
// This contract is the one D-04's and D-66's acceptances turn on, and until
// this file existed nothing exercised it: src/lib/project-selection.test.ts
// covers only the pure chooseProject()/dashboardScope() functions, and
// TopRail.test.tsx covers the switcher's menu, not the provider's precedence.
// A regression that let the px_project cookie win over ?projectId= would have
// shipped green -- and it is the most expensive regression this product
// offers, because acting against the wrong project is exactly what M24's
// always-visible-project rule exists to prevent.
//
// The rule, restated so the tests below can be read against it:
//   1. a ?projectId= in the URL always decides;
//   2. it decides again on a route change and on back/forward;
//   3. the cookie is consulted ONCE, and only while the URL has said nothing;
//   4. once the URL has spoken, the cookie is never consulted again.

import { GlobalRegistrator } from "@happy-dom/global-registrator";
// A REAL url, not happy-dom's default `about:blank`. Both halves of this
// contract are origin-dependent: history.replaceState cannot set a search
// string on about:blank, and a cookie carrying path/max-age/SameSite is
// rejected outright without a document origin -- so a test registered the
// default way would assert nothing while appearing to pass.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register({ url: "http://localhost:3100/" });

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { PROJECT_COOKIE } from "@/lib/project-selection";
import {
  ProjectScopeProvider,
  readProjectCookie,
  useProjectScope,
  useUrlProjectId,
  writeProjectCookie,
} from "./project-context";

/** Puts the window at a real URL, the way a navigation would. */
function at(url: string) {
  window.history.replaceState(null, "", url);
}

function Probe({ pathname }: { pathname: string }) {
  const [projectId] = useUrlProjectId(pathname);
  return <span data-testid="resolved">{projectId ?? "(none)"}</span>;
}

function clearCookie() {
  document.cookie = `${PROJECT_COOKIE}=; path=/; max-age=0`;
}

beforeEach(() => {
  clearCookie();
  at("/permits");
});

afterEach(() => {
  cleanup();
  clearCookie();
});

describe("useUrlProjectId -- the URL wins", () => {
  test("resolves to the URL's project on mount, even when the cookie names a different one", async () => {
    writeProjectCookie("p-marina");
    at("/permits?projectId=p-cedar");

    const { getByTestId } = render(<Probe pathname="/permits" />);

    await waitFor(() => {
      expect(getByTestId("resolved").textContent).toBe("p-cedar");
    });
    // ...and the cookie is updated to the URL's choice, so the next visit with
    // a quiet URL remembers what the user was actually looking at.
    expect(readProjectCookie()).toBe("p-cedar");
  });

  test("re-resolves to the URL's project after a popstate -- back/forward is a real navigation", async () => {
    at("/permits?projectId=p-cedar");
    const { getByTestId } = render(<Probe pathname="/permits" />);
    await waitFor(() => expect(getByTestId("resolved").textContent).toBe("p-cedar"));

    // Back to a page scoped to a different project.
    await act(async () => {
      at("/permits?projectId=p-marina");
      window.dispatchEvent(new Event("popstate"));
    });

    await waitFor(() => {
      expect(getByTestId("resolved").textContent).toBe("p-marina");
    });
  });

  test("falls back to the cookie only when the URL carries no projectId", async () => {
    writeProjectCookie("p-marina");
    at("/permits");

    const { getByTestId } = render(<Probe pathname="/permits" />);

    await waitFor(() => {
      expect(getByTestId("resolved").textContent).toBe("p-marina");
    });
  });

  test("with neither a URL parameter nor a cookie, it resolves to nothing rather than guessing", async () => {
    at("/permits");
    const { getByTestId } = render(<Probe pathname="/permits" />);
    await waitFor(() => {
      expect(getByTestId("resolved").textContent).toBe("(none)");
    });
  });

  test("once the URL has spoken, a quiet URL does NOT hand the screen back to the cookie", async () => {
    writeProjectCookie("p-marina");
    at("/permits?projectId=p-cedar");

    const { getByTestId, rerender } = render(<Probe pathname="/permits" />);
    await waitFor(() => expect(getByTestId("resolved").textContent).toBe("p-cedar"));

    // A route change to a screen that carries no ?projectId= must keep the
    // project the user is actually on. Re-adopting the cookie here is how the
    // rail and the page came to disagree in the first place (R-253).
    await act(async () => {
      at("/documents");
    });
    rerender(<Probe pathname="/documents" />);

    await waitFor(() => {
      expect(getByTestId("resolved").textContent).toBe("p-cedar");
    });
  });

  test("a project id with URL-unsafe characters survives the cookie round trip", () => {
    writeProjectCookie("p cedar/phase 1");
    expect(readProjectCookie()).toBe("p cedar/phase 1");
  });

  test("clearing the selection clears the cookie rather than leaving a stale memory", () => {
    writeProjectCookie("p-cedar");
    expect(readProjectCookie()).toBe("p-cedar");
    writeProjectCookie(null);
    expect(readProjectCookie()).toBeNull();
  });
});

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

  test("outside the shell the default is honest about knowing nothing", () => {
    const { getByTestId } = render(<ScopeProbe />);
    // projectsLoaded false is the load-bearing half: a screen must be able to
    // tell "this org has no projects" from "we have not been told yet".
    expect(getByTestId("scope").textContent).toBe("all|(none)|false");
  });
});
