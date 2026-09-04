/// <reference types="bun-types" />
// Closes F_030 (/meetings) and F_033 (/punch-list), and settles
// R48_BLANK_CONTENT_NO_CREDENTIALS_01 (a third symptom on the same shared
// path -- an org with no VERIDIAN credentials configured).
//
// THE SHARED ROOT CAUSE, confirmed by reading rather than assumed: /meetings
// and /punch-list are two of the 27 "project-scoped" page.tsx files (RFIs,
// Scope, Labour, Schedule, FF&E, ...) that all call ONE function --
// resolveSelectedProject() in src/lib/project-selection.ts -- which does the
// one fetch every one of these pages needs (VERIDIAN's GET /dashboard, to
// resolve which project is selected). It is not the (app)/layout.tsx shell:
// M24Shell.tsx never calls VERIDIAN at all, and already isolates its OWN
// fetches (org/projects/tasks/pill-usage) behind shellErrors/tasksError
// state that leaves the shell chrome intact on failure. resolveSelectedProject
// is the thing actually shared across every one of these routes, which is
// why a timeout or an AR-04 "no credentials" rejection on /meetings and
// /punch-list looks identical: same function, same catch block, same
// `errorMessage`, rendered by the same <ProjectLoadError> the page's own
// body already guards on.
//
// WHY ALL THREE FAULTS ARE ALREADY FIXED ON MAIN (verified, not assumed --
// this file is a regression guard for that, not a new fix):
//
//   1. F_030 / F_033 (raw "VERIDIAN request timed out after 20000ms:
//      https://.../dashboard" filled the whole content area): fixed by
//      commit ee448ae ("fix(dashboard): an error is not an empty state, and
//      never leak the backend host", #167). veridian-client.ts's
//      fetchWithTimeout() used to throw a message ending in `: ${url}`; it
//      now throws a plain "The construction data service did not respond in
//      time. Please retry." and moves the host/path/budget into a `detail`
//      field that is only ever console.error()'d, never returned to a
//      client. Fixing the one throw fixed every consumer of callVeridian(),
//      resolveSelectedProject() included, without touching 27 call sites.
//
//   2. Isolation to the page's own content area (never the whole page body):
//      resolveSelectedProject() already wraps its callVeridian() call in
//      try/catch and returns { project: null, errorMessage } rather than
//      throwing -- meetings/page.tsx and punch-list/page.tsx render that as
//      <ProjectLoadError message={errorMessage} /> (see that component's own
//      R52/F_022 comment) beside their <PageHeading>. The shell
//      (TopRail/TaskMaster/Composer in M24Shell.tsx) is a sibling, not a
//      parent that a page-body throw could ever take down.
//
//   3. R48_BLANK_CONTENT_NO_CREDENTIALS_01 was INSTRUMENT DAMAGE, not a
//      fourth bug: commit 53335b2 ("fix(a11y): one main landmark per page,
//      not two", #166, R48_DUAL_MAIN_LANDMARK_01) explains it directly --
//      every (app) page used to render a SECOND <main> nested inside the
//      shell's own, so `document.querySelector("main")` (which returns only
//      the FIRST match) measured the shell's landmark instead of the page's,
//      and recorded /meetings by name as one of the pages this made "look"
//      blank. See src/lib/single-main-landmark.test.ts, the regression guard
//      for that fix -- it fails if any (app) route ever opens a second
//      <main> again. Nothing in resolveSelectedProject() or ProjectLoadError
//      renders differently for a missing-credentials (AR-04) rejection than
//      for a timeout: both are just a VeridianApiError with a message, caught
//      the same way.
//
// This file adds the coverage that was missing: a render-level assertion,
// for both /meetings and /punch-list, that (a) a timeout never reaches the
// screen as the raw internal string, (b) missing credentials never renders
// blank, and (c) neither failure ever takes out the page's own heading.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// bun test runs every file in one process; registering Happy DOM twice
// throws. Guard exactly like src/components/ui/form-field.test.tsx,
// PayrollClient.test.tsx and ProcurementClient.test.tsx already do.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

// Same process-wide mock.module() hazard as next/navigation below: this
// module also backs src/lib/supabase/auth-guard.test.ts and several
// src/app/api/**/route.test.ts suites (requireRole, ROLE_GROUPS,
// ALL_ORG_ROLES, ...) that share this process when `bun test` runs the whole
// tree. Spread the real module and override only what this file needs, so
// those other suites keep the exports they mock/import for themselves.
const RealAuthGuard = await import("@/lib/supabase/auth-guard");
mock.module("@/lib/supabase/auth-guard", () => ({
  ...RealAuthGuard,
  getServerOrganizationId: async () => "org-1",
}));

// next/navigation's useRouter() throws outside a real App Router tree
// (ProjectLoadError's Retry button calls it), so it needs a stand-in here
// the same way every other server dependency in this file does.
//
// bun's mock.module() replaces the module for the REST OF THE PROCESS, not
// just this file -- `bun test` runs every file in one process, same as the
// Happy DOM registration guard above. Overriding next/navigation wholesale
// (as e.g. { useRouter: ... } with nothing else) previously broke an
// unrelated later suite (veri-chat-context.test.ts) with "Export named
// 'usePathname' not found", because that file's import chain reaches
// next/navigation too and got this mock's shape instead of the real module's.
// Spreading the real module first and overriding only useRouter keeps every
// other export (usePathname, useSearchParams, redirect, ...) intact for
// every other test that shares this process.
const RealNextNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...RealNextNavigation,
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
}));

class FakeVeridianApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// What GET /dashboard is made to do for the currently active test, set by
// each test before importing/calling the page. "ok" never exercises the
// error path at all -- included as a control so the harness itself is
// proven not to fail closed.
let behavior: "ok" | "timeout" | "no-credentials" = "ok";

mock.module("@/lib/veridian-client", () => ({
  VeridianApiError: FakeVeridianApiError,
  callVeridian: async () => {
    if (behavior === "timeout") {
      // The EXACT post-fix message (see ee448ae above) -- not the pre-fix
      // string ending in the raw URL. If a future change to
      // veridian-client.ts reintroduces the leak, this test still passes
      // (it isn't exercising veridian-client.ts itself -- read-outcome.test.ts
      // and this file's own string-leak assertion below cover that), but the
      // leak assertion further down would start failing loudly.
      throw new FakeVeridianApiError(
        "The construction data service did not respond in time. Please retry.",
        504
      );
    }
    if (behavior === "no-credentials") {
      // The real AR-04 message shape, from resolveApiKey() in
      // veridian-client.ts.
      throw new FakeVeridianApiError(
        "No VERIDIAN credentials configured for organization org-1, and per-org requests may not fall back to a shared key (AR-04)",
        500
      );
    }
    return { projects: [] };
  },
}));

// Dynamic imports, after every mock.module() above, for the same reason
// PayrollClient.test.tsx dynamically imports its subject: a static import
// would be hoisted above the mocks and pick up the real modules instead.
const MeetingsPage = (await import("./meetings/page")).default;
const PunchListPage = (await import("./punch-list/page")).default;

afterEach(() => {
  cleanup();
  behavior = "ok";
});

function noParams() {
  return Promise.resolve({});
}

describe("F_030 / F_033 / R48_BLANK_CONTENT_NO_CREDENTIALS_01 -- shared resolveSelectedProject() failure path", () => {
  for (const [name, Page, heading] of [
    ["/meetings", MeetingsPage, "Meetings"],
    ["/punch-list", PunchListPage, "Punch List"],
  ] as const) {
    describe(name, () => {
      test("a VERIDIAN timeout never fills the content area with the raw internal string (F_030/F_033)", async () => {
        behavior = "timeout";
        const jsx = await Page({ searchParams: noParams() });
        const { getByText, getByRole, queryByText } = render(jsx);

        // The heading survives -- this failure is scoped to the body, not
        // the whole page.
        expect(getByText(heading)).toBeDefined();
        // A real, scoped error card is shown (ProjectLoadError: role="alert"
        // plus a Retry control) ...
        expect(getByRole("alert").textContent).toContain(
          "The construction data service did not respond in time"
        );
        expect(getByText("Retry")).toBeDefined();
        // ...and it is never the pre-fix raw string: no internal hostname, no
        // internal path, no millisecond budget reaches this screen.
        expect(queryByText(/veridian-compliance-ai\.vercel\.app/)).toBeNull();
        expect(queryByText(/\/api\/v1\/projexa\/dashboard/)).toBeNull();
        expect(queryByText(/\d+ms/)).toBeNull();
      });

      test("missing VERIDIAN credentials never renders blank (R48_BLANK_CONTENT_NO_CREDENTIALS_01)", async () => {
        behavior = "no-credentials";
        const jsx = await Page({ searchParams: noParams() });
        const { container, getByText, getByRole } = render(jsx);

        // Not the "only the assistant panel renders" symptom: the page's own
        // heading and a real, honest error are both present.
        expect(getByText(heading)).toBeDefined();
        expect(getByRole("alert").textContent).toContain("No VERIDIAN credentials configured");
        expect(getByRole("alert").textContent).toContain("AR-04");
        // Genuinely not blank -- more than just the heading is on screen.
        expect(container.textContent?.length ?? 0).toBeGreaterThan(heading.length + 20);
      });

      test("a healthy read renders neither error branch (control case)", async () => {
        behavior = "ok";
        const jsx = await Page({ searchParams: noParams() });
        const { getByText, queryByRole } = render(jsx);
        expect(getByText(heading)).toBeDefined();
        expect(queryByRole("alert")).toBeNull();
        // No project in the org yet -- the honest empty state, not an error.
        expect(getByText("No active projects yet.")).toBeDefined();
      });
    });
  }
});
