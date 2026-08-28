/// <reference types="bun-types" />
// R62 B7 regression test for R46S11_02 (High).
//
// THE DEFECT: /dashboard/overview conflated "the request failed" with "there
// are no projects". `bars.length === 0` was checked without first asking WHY
// the list was empty -- on a VERIDIAN timeout, fetchProjectProgressBars
// returned `bars: []` TOGETHER WITH a real errorMessage, so this screen told
// the user "No active projects yet." for an organisation server-proven (via
// /api/projects retry, same session) to have five real active projects. A
// false zero on the portfolio overview screen is worse than an error --
// it reads as an answer. The empty state also offered no Retry and no way
// to create a project, unlike /dashboard which at least had a Create
// Project button.
//
// THE FIX (PR #167, r52/fn-error-not-empty): the two states are now
// mutually exclusive -- a non-null errorMessage always wins over the
// bars-empty check, so a real failure can never be read as "zero projects".
// The failure branch also carries the two affordances this fault recorded
// as missing: Retry (router.refresh(), which re-runs the SERVER component
// that actually fetched the data, not a client no-op) and a path to
// /dashboard. The genuine empty state (no error, zero bars) now mounts the
// real CreateProjectDialog, not just a link to the page that has one.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

// ProjectsOverviewClient (via its Retry button) and CreateProjectDialog
// (mounted in the empty state) both call useRouter() from next/navigation,
// which throws outside a real Next.js App Router tree. bun:test's
// mock.module is process-global (bun test runs every file in one process),
// so this exports the same full shape every other test file's
// next/navigation mock in this repo uses -- whichever mock.module call
// happens to win the race must still satisfy every component under test.
let refreshCalls = 0;
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => { refreshCalls++; }, push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

const ProjectsOverviewClient = (await import("./ProjectsOverviewClient")).default;

afterEach(() => {
  cleanup();
  refreshCalls = 0;
});

describe("ProjectsOverviewClient (R46S11_02)", () => {
  test("a real backend failure with an empty bars list shows the FAILURE, never the false 'No active projects yet.' empty state", () => {
    const { getByRole, queryByText, getByText } = render(
      <ProjectsOverviewClient bars={[]} errorMessage="VERIDIAN request timed out after 20000ms: https://veridian-compliance-ai.vercel.app/api/v1/projexa/dashboard" />
    );

    expect(getByRole("alert").textContent).toMatch(/Could not load live data: VERIDIAN request timed out/);
    // The exact false-zero this fault reported must be gone.
    expect(queryByText("No active projects yet.")).toBeNull();
    // Both affordances the fault recorded as missing must be present.
    expect(getByText("Retry")).toBeDefined();
    expect(getByText("Go to Dashboard")).toBeDefined();
  });

  test("Retry calls router.refresh() -- re-running the server fetch, not a client-side no-op re-render of the same empty array", () => {
    const { getByText } = render(<ProjectsOverviewClient bars={[]} errorMessage="some failure" />);
    getByText("Retry").click();
    expect(refreshCalls).toBe(1);
  });

  test("a genuinely empty project list (no error) shows the real empty state WITH a working Create Project affordance -- /dashboard had this, this screen previously did not", () => {
    const { getByRole, queryByRole, getByText } = render(<ProjectsOverviewClient bars={[]} errorMessage={null} />);

    expect(getByText("No active projects yet.")).toBeDefined();
    expect(queryByRole("alert")).toBeNull();
    // The real CreateProjectDialog (not a link to /dashboard) is mounted
    // directly in this empty state.
    expect(getByRole("button", { name: /Create Project/i })).toBeDefined();
  });

  test("real project data renders normally, with neither the error nor the empty state", () => {
    const { getByText, queryByRole, queryByText } = render(
      <ProjectsOverviewClient
        bars={[{ id: "p1", name: "Oakwood Residence", progressPercent: 42 }]}
        errorMessage={null}
      />
    );

    expect(getByText("Oakwood Residence")).toBeDefined();
    expect(getByText("42%")).toBeDefined();
    expect(queryByRole("alert")).toBeNull();
    expect(queryByText("No active projects yet.")).toBeNull();
  });
});
