/// <reference types="bun-types" />
// R62 B7 regression test for R48_TWO_OF_THREE_PER_PAGE_500S_NEVER_SURFACED_01
// (High).
//
// THE DEFECT (R48 UAT session 2, re-opened after regressing onto the shell's
// replacement surface): every page load fires several shell-level reads --
// org, projects, ranked pill usage -- alongside the task read. The task read
// (tasksError) was already surfaced honestly, but the org/projects/pill-usage
// reads did `if (!res.ok) return;` -- the status WAS read, but the failure
// was then dropped on the floor with no user-facing trace. The top rail
// showed a nameless organisation (an em-dash) and an empty project switcher
// with nothing saying why, while the Task Master pane sat right below,
// showing only whatever tasksError itself reported -- a broken shell
// indistinguishable from a healthy, empty one.
//
// THE FIX: every one of those reads now calls noteFailure(what, detail) on a
// non-2xx status, and shellErrors renders as a named list ("Couldn't load
// your organisation: <backend message>") above the Task Master content --
// PR #201 (re-fix after a regression that dropped this between shell
// rewrites; original fix PR #171 regressed, re-fixed same day).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

// bun:test's mock.module is process-global (bun test runs every file in one
// process), so this exports the same full shape every other test file's
// next/navigation mock in this repo uses -- whichever mock.module call
// happens to win the race must still satisfy every component under test.
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}));

const M24Shell = (await import("./M24Shell")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function router(overrides: Record<string, () => Response>) {
  const defaults: Record<string, () => Response> = {
    "/api/organization": () => jsonRes({ organization: { id: "org-1", name: "Meridian Interiors" }, role: "owner", email: "farid@meridian-demo.ae" }),
    "/api/projects": () => jsonRes({ projects: [] }),
    "/api/tasks": () => jsonRes({ counts: {}, groups: {} }),
    "/api/pill-usage": () => jsonRes({ pills: [] }),
  };
  const handlers = { ...defaults, ...overrides };
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.startsWith(path)) return handler();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

describe("M24Shell (R48_TWO_OF_THREE_PER_PAGE_500S_NEVER_SURFACED_01)", () => {
  test("a failing /api/organization AND a failing /api/projects are BOTH named -- neither is dropped silently", async () => {
    globalThis.fetch = router({
      "/api/organization": () => jsonRes({ error: "No VERIDIAN credentials configured for organization 9165 (AR-04)" }, 502),
      "/api/projects": () => jsonRes({ error: "VERIDIAN request timed out after 20000ms" }, 504),
    });

    const { getByText } = render(<M24Shell>content</M24Shell>);

    // The regression this guards: the old `if (!res.ok) return;` read the
    // status and then dropped it -- nothing anywhere named either failure.
    await waitFor(() => expect(getByText(/This panel is showing less than it should\./)).toBeDefined());
    expect(getByText(/Couldn.t load your organisation: No VERIDIAN credentials configured/)).toBeDefined();
    expect(getByText(/Couldn.t load your projects: VERIDIAN request timed out after 20000ms/)).toBeDefined();
  });

  test("a failing /api/pill-usage is also named, not swallowed by an empty pill strip", async () => {
    globalThis.fetch = router({
      "/api/pill-usage": () => jsonRes({ error: "No VERIDIAN credentials configured (AR-04)" }, 502),
    });

    const { getByText } = render(<M24Shell>content</M24Shell>);

    await waitFor(() => expect(getByText(/This panel is showing less than it should\./)).toBeDefined());
    expect(getByText(/Couldn.t load your ranked modules: No VERIDIAN credentials configured/)).toBeDefined();
  });

  test("all shell reads healthy -- no false failure banner", async () => {
    globalThis.fetch = router({});

    const { getByText, queryByText } = render(<M24Shell>content</M24Shell>);

    await waitFor(() => expect(getByText("Meridian Interiors")).toBeDefined());
    expect(queryByText(/This panel is showing less than it should\./)).toBeNull();
  });
});
