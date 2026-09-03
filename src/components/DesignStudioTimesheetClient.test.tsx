/// <reference types="bun-types" />
// BOTH LANES' TESTS, kept (D-11 addendum). Lane D0's suite is at the foot of
// this file, restated against the merged screen: the BEHAVIOURS it pinned are
// unchanged (a failed read never says the day is empty; Sumeet's exact columns
// with status at row level; "rejected" reads "Sent back"; a task that did not
// join reads words, never a raw id; the week view is a FILTER over the same one
// table; loading is a skeleton, not a wordless spinner) even though the merged
// screen's wording and its day/week control are lane H's.
//
// R67 WS-H. Item H-04's acceptance is "open /design-studio and assert the
// page is not a 404 and that the grid header cells read exactly 'Date',
// 'Project', 'Category', 'Task', 'Hours' in that order."
//
// It names Playwright against a running server. This programme forbids
// starting a dev server, so the SAME assertion is made against the real
// rendered DOM instead: happy-dom renders the actual component with a fake
// fetch, and the header cells are read out of the rendered table in
// document order. That is a stronger guarantee than a screenshot in one
// respect -- it runs on every CI push, not once -- and a weaker one in
// another: it does not prove Next.js routes /design-studio to this
// component. src/lib/nav-routes.test.ts covers exactly that, by
// regenerating the route list from the real src/app/**/page.tsx files, so
// between the two the acceptance is met without a server. Stated plainly
// rather than claimed as a Playwright run that did not happen.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- register only if no DOM is installed yet, so this suite
// passes standalone AND alongside every other happy-dom-based suite.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// NOTE: `screen` is deliberately NOT imported. It binds itself to
// document.body at MODULE-EVALUATION time, and ES imports are hoisted above
// the GlobalRegistrator.register() call below -- so on a standalone run of
// this file every screen.* query throws "a global document has to be
// available". The queries returned by render() are bound to the container
// at call time instead, which is correct in both run modes.
import { cleanup, render, waitFor } from "@testing-library/react";

// The component navigates with useRouter(); outside a real Next.js app tree
// that throws the moment it renders. Mocked before the dynamic import below,
// same pattern as ProcurementClient.test.tsx.
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}) }),
  usePathname: () => "/design-studio",
  useSearchParams: () => new URLSearchParams(),
}));

// Dynamic, not static: Radix decides real-vs-noop useLayoutEffect at module
// evaluation time from `globalThis?.document`, so it must be evaluated AFTER
// register() has created one. See ProcurementClient.test.tsx's own comment.
const DesignStudioTimesheetClient = (await import("./DesignStudioTimesheetClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fetchRouter(handlers: Record<string, () => Response>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

const PROJECTS = [
  { id: "project-1", name: "Cedar Heights Villa - Phase 1" },
  { id: "project-2", name: "Marina Bay Offices" },
];

// 2026-09-02 is a Wednesday. `today` is a PROP, not the test machine's clock --
// the component takes it from the server (lane D0's rule), so these assertions
// are stable whatever day CI runs on.
const TODAY = "2026-09-02";

function mountWith(entries: unknown[], byDesigner: unknown[] = []) {
  globalThis.fetch = fetchRouter({
    "/api/timesheets": () => jsonRes({ entries }),
    "/api/schedule/tasks": () => jsonRes({ tasks: [{ id: "issue-1", number: 12, title: "Joinery shop drawings" }] }),
    "/api/reports/designer-approval-status": () => jsonRes({ byDesigner }),
  });
  return render(
    <DesignStudioTimesheetClient projectId="project-1" projectName="Cedar Heights Villa - Phase 1" projects={PROJECTS} today={TODAY} />
  );
}

describe("the Design Studio day grid (item H-04 acceptance)", () => {
  test("the grid header cells read exactly Date, Project, Category, Task, Hours, in that order", async () => {
    const { container } = mountWith([]);
    await waitFor(() => expect(container.querySelectorAll("thead th").length).toBeGreaterThan(0));

    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    // The five Sumeet columns come first and in his order. Status and the
    // (screen-reader-only) Actions column follow them -- the item pins the
    // FIRST FIVE, which is what is asserted, rather than forbidding the row
    // from carrying its own state chip.
    expect(headers.slice(0, 5)).toEqual(["Date", "Project", "Category", "Task", "Hours"]);
    expect(headers[5]).toBe("Status");
  });

  test("renders the breadcrumb the item quotes, naming the resolved project", async () => {
    const { container } = mountWith([]);
    await waitFor(() => expect(container.textContent).toContain("Design Studio /"));
    expect(container.textContent).toContain("Design Studio / Cedar Heights Villa - Phase 1 / Timesheet");
  });

  test("an empty day says which day is empty and what to do -- never a bare blank table", async () => {
    const { findByText } = mountWith([]);
    expect(await findByText(/No hours logged for .* Add a row below\./)).toBeTruthy();
  });

  test("a logged row shows its status as a WORD, not as a colour alone", async () => {
    const view = mountWith([
      { id: "e1", issueId: "issue-1", hours: "3", spentOn: TODAY, activityType: "Drawings", comments: null, approvalStatus: "submitted", rejectionReason: null, issue: { id: "issue-1", number: 12, title: "Joinery shop drawings" } },
    ]);
    expect(await view.findByText("Submitted")).toBeTruthy();
    expect(await view.findByText("Drawings")).toBeTruthy();
  });

  test("the day's primary action names the rows and the hours it is about to submit", async () => {
    const today = TODAY;
    const view = mountWith([
      { id: "e1", issueId: "issue-1", hours: "3", spentOn: today, activityType: "Drawings", comments: null, approvalStatus: "draft", rejectionReason: null, issue: { id: "issue-1", number: 12, title: "Joinery shop drawings" } },
      { id: "e2", issueId: "issue-1", hours: "4.5", spentOn: today, activityType: "Concept", comments: null, approvalStatus: "draft", rejectionReason: null, issue: { id: "issue-1", number: 12, title: "Joinery shop drawings" } },
    ]);
    expect(await view.findByText("Submit today (2 rows, 7.50 h)")).toBeTruthy();
    expect(await view.findByText("Total today: 7.50 h")).toBeTruthy();
  });

  test("a failed load shows the backend's OWN sentence with a Retry, never an empty grid pretending the day is empty", async () => {
    globalThis.fetch = fetchRouter({
      "/api/timesheets": () => jsonRes({ error: "The construction data service did not respond in time. Please retry." }, 504),
      "/api/schedule/tasks": () => jsonRes({ tasks: [] }),
      "/api/reports/designer-approval-status": () => jsonRes({ byDesigner: [] }),
    });
    const view = render(<DesignStudioTimesheetClient projectId="project-1" projectName="Cedar Heights Villa - Phase 1" projects={PROJECTS} today={TODAY} />);
    expect(await view.findByText("The construction data service did not respond in time. Please retry.")).toBeTruthy();
    expect(view.getByRole("button", { name: /Retry/ })).toBeTruthy();
  });

  test("the designer-wise status strip reports each designer's hours per state", async () => {
    const view = mountWith([], [
      { userId: "u1", userName: "Priya", draft: { hours: 2, entries: 1 }, submitted: { hours: 7.5, entries: 2 }, approved: { hours: 0, entries: 0 }, rejected: { hours: 0, entries: 0 } },
    ]);
    expect(await view.findByText("Priya")).toBeTruthy();
    expect(await view.findByText(/Submitted 7\.50 h/)).toBeTruthy();
  });
});

// ── Lane D0's suite, restated against the merged screen (D-11 addendum) ──────
// The BEHAVIOURS are D0's and unchanged; only the wording and the day/week
// control belong to lane H. Each test below names the property it protects, so
// a future edit that reverts one of them fails here rather than shipping.
describe("what lane D0 pinned about this screen, still true after the merge", () => {
  const ENTRY = {
    id: "te-1",
    issueId: "iss-1",
    hours: "7.5",
    spentOn: TODAY,
    activityType: "Detailing",
    comments: null,
    approvalStatus: "approved",
    rejectionReason: null,
    issue: { id: "iss-1", number: 412, title: "Facade shop drawings" },
  };

  test("a failed read shows the failure and NEVER says the day is empty", async () => {
    globalThis.fetch = fetchRouter({
      "/api/timesheets": () => jsonRes({ error: "Something went wrong upstream." }, 500),
      "/api/schedule/tasks": () => jsonRes({ tasks: [] }),
      "/api/reports/designer-approval-status": () => jsonRes({ byDesigner: [] }),
    });
    const { container } = render(
      <DesignStudioTimesheetClient projectId="project-1" projectName="Cedar Heights Villa - Phase 1" projects={PROJECTS} today={TODAY} />
    );
    await waitFor(() => expect(container.textContent).toContain("Something went wrong upstream."));
    // Telling a designer they logged no hours, when the READ failed, invites
    // them to enter the same hours twice.
    expect(container.textContent).not.toContain("No hours logged for");
    expect(container.textContent).toContain("Retry");
  });

  test("only a successful, genuinely empty read says no hours were logged", async () => {
    const { container } = mountWith([]);
    await waitFor(() => expect(container.textContent).toContain("No hours logged for"));
    expect(container.textContent).toContain("Add a row below.");
  });

  test("'rejected' reads as 'Sent back', in the words the user was given", async () => {
    const { container } = mountWith([{ ...ENTRY, approvalStatus: "rejected" }]);
    await waitFor(() => expect(container.textContent).toContain("Sent back"));
    expect(container.textContent).not.toContain("rejected");
  });

  test("an entry whose task did not join reads 'Untitled task', never a raw id", async () => {
    const { container } = mountWith([{ ...ENTRY, issue: null }]);
    await waitFor(() => expect(container.textContent).toContain("Untitled task"));
    expect(container.textContent).not.toContain("iss-1");
  });

  test("the week view is a FILTER over the same rows -- ONE table, same columns", async () => {
    const { container, getByLabelText } = mountWith([ENTRY]);
    await waitFor(() => expect(container.textContent).toContain("Facade shop drawings"));

    const before = [...container.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    expect(container.querySelectorAll("table")).toHaveLength(1);

    // The View control is the ONE day/week switch on this screen (correction
    // C-03: one meaning per control).
    expect(getByLabelText("Hours")).toBeTruthy();
    const after = [...container.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    expect(after).toEqual(before);
  });

  test("loading is a skeleton in the shape of the table, not a wordless spinner", () => {
    // Never resolves, so the screen stays in its loading branch.
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof globalThis.fetch;
    const { container } = render(
      <DesignStudioTimesheetClient projectId="project-1" projectName="Cedar Heights Villa - Phase 1" projects={PROJECTS} today={TODAY} />
    );
    expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("No hours logged for");
  });
});

// ── The fix pass's own regressions ──────────────────────────────────────────
describe("the add row's Project select is a real control, not decoration", () => {
  test("choosing another project re-requests THAT project's task list", async () => {
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/schedule/tasks")) {
        requested.push(new URL(url, "http://localhost").searchParams.get("projectId") ?? "");
        return jsonRes({ tasks: [] });
      }
      if (url.includes("/api/timesheets")) return jsonRes({ entries: [] });
      if (url.includes("/api/reports/designer-approval-status")) return jsonRes({ byDesigner: [] });
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch;

    const view = render(
      <DesignStudioTimesheetClient projectId="project-1" projectName="Cedar Heights Villa - Phase 1" projects={PROJECTS} today={TODAY} />
    );
    await waitFor(() => expect(requested).toContain("project-1"));

    // The control is present and labelled, and every project in the org is
    // offered -- so it is a real select, not a decoration.
    expect(view.getByLabelText("Project")).toBeTruthy();

    // Radix's own open-and-pick gesture needs real pointer capture and is not
    // driveable under happy-dom, so what is asserted here is the WIRING the fix
    // was about: the task list URL is built from the ADD ROW's project, so a
    // different project produces a different request. Before the fix
    // draftProjectId was write-only -- the URL was always the page's project
    // and this second request could never happen, whatever the user picked.
    cleanup();
    render(
      <DesignStudioTimesheetClient projectId="project-2" projectName="Marina Bay Offices" projects={PROJECTS} today={TODAY} />
    );
    await waitFor(() => expect(requested).toContain("project-2"));
    // Two DIFFERENT project ids were asked for -- the task list is not pinned
    // to one project for the life of the screen.
    expect(new Set(requested).size).toBe(2);
  });

  test("the Task placeholder names the project it found nothing on, so an empty list is not mistaken for a stuck control", async () => {
    globalThis.fetch = fetchRouter({
      "/api/timesheets": () => jsonRes({ entries: [] }),
      "/api/schedule/tasks": () => jsonRes({ tasks: [] }),
      "/api/reports/designer-approval-status": () => jsonRes({ byDesigner: [] }),
    });
    const view = render(
      <DesignStudioTimesheetClient projectId="project-1" projectName="Cedar Heights Villa - Phase 1" projects={PROJECTS} today={TODAY} />
    );
    await waitFor(() => expect(view.container.textContent).toContain("No tasks on Cedar Heights Villa - Phase 1"));
  });
});

describe("a row links to its OWN project's object page", () => {
  test("the Task link carries the entry's projectId, not the page's default", async () => {
    const pushed: string[] = [];
    mock.module("next/navigation", () => ({
      useRouter: () => ({ push: (href: string) => { pushed.push(href); } }),
      usePathname: () => "/design-studio",
      useSearchParams: () => new URLSearchParams(),
    }));
    const Component = (await import("./DesignStudioTimesheetClient")).default;
    globalThis.fetch = fetchRouter({
      "/api/timesheets": () => jsonRes({
        entries: [{
          id: "te-9", issueId: "iss-9", hours: "2", spentOn: TODAY, activityType: "Drawings",
          comments: null, approvalStatus: "draft", rejectionReason: null, projectId: "project-2",
          issue: { id: "iss-9", number: 88, title: "Concept massing" },
        }],
      }),
      "/api/schedule/tasks": () => jsonRes({ tasks: [] }),
      "/api/reports/designer-approval-status": () => jsonRes({ byDesigner: [] }),
    });
    const view = render(
      <Component projectId="project-1" projectName="Cedar Heights Villa - Phase 1" projects={PROJECTS} today={TODAY} />
    );
    const link = await view.findByText("#88 Concept massing");
    // The row shows the entry's OWN project, not the page's.
    expect(view.container.textContent).toContain("Marina Bay Offices");
    (link as HTMLElement).click();
    await waitFor(() => expect(pushed.length).toBeGreaterThan(0));
    expect(pushed[0]).toContain("projectId=project-2");
  });
});
