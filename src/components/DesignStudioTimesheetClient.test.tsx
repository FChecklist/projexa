/// <reference types="bun-types" />
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

const PROJECTS = [{ id: "project-1", name: "Cedar Heights Villa - Phase 1" }];

function mountWith(entries: unknown[], byDesigner: unknown[] = []) {
  globalThis.fetch = fetchRouter({
    "/api/timesheets": () => jsonRes({ entries }),
    "/api/schedule/tasks": () => jsonRes({ tasks: [{ id: "issue-1", number: 12, title: "Joinery shop drawings" }] }),
    "/api/reports/designer-approval-status": () => jsonRes({ byDesigner }),
  });
  return render(
    <DesignStudioTimesheetClient projectId="project-1" projectName="Cedar Heights Villa - Phase 1" projects={PROJECTS} />
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
      { id: "e1", issueId: "issue-1", hours: "3", spentOn: new Date().toISOString().slice(0, 10), activityType: "Drawings", comments: null, approvalStatus: "submitted", rejectionReason: null, issue: { id: "issue-1", number: 12, title: "Joinery shop drawings" } },
    ]);
    expect(await view.findByText("Submitted")).toBeTruthy();
    expect(await view.findByText("Drawings")).toBeTruthy();
  });

  test("the day's primary action names the rows and the hours it is about to submit", async () => {
    const today = new Date().toISOString().slice(0, 10);
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
    const view = render(<DesignStudioTimesheetClient projectId="project-1" projectName="Cedar Heights Villa - Phase 1" projects={PROJECTS} />);
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
