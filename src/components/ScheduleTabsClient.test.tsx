/// <reference types="bun-types" />
// R67 D-44 acceptance, asserted against the real component rather than a
// Playwright walk (this session may not start a dev server, and projexa's
// playwright.config.ts targets production, not localhost).
//
// The acceptance reads: "goto /schedule, expect buttons with accessible names
// exactly 'Filter', 'Export', 'Import', '+ New' in that DOM order and the
// breadcrumb text 'Schedule > Cedar Heights Villa - Phase 1'". Both are
// asserted below against the rendered DOM.
//
// TWO MODULE MOCKS, and why each is unavoidable here:
//   * "@svar-ui/react-gantt/all.css" -- bun's test runner cannot import a CSS
//     file, and ScheduleGanttClient imports one at module scope.
//   * "@svar-ui/react-gantt" -- the chart is loaded through next/dynamic with
//     ssr:false, so it never renders in this environment anyway; mocking it
//     keeps the import graph resolvable without changing what is asserted.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

mock.module("@svar-ui/react-gantt/all.css", () => ({}));
mock.module("@svar-ui/react-gantt", () => ({
  Gantt: () => null,
  Willow: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

const push = mock((_href: string) => {});
mock.module("next/navigation", () => ({
  useRouter: () => ({ push, prefetch: () => {}, back: () => {} }),
}));

const { ScheduleTabsClient, IMPORT_UNAVAILABLE_REASON, NO_ACTIVITIES_TO_EXPORT, NO_ACTIVITIES_TO_FILTER } =
  await import("./ScheduleTabsClient");

const PROJECT_NAME = "Cedar Heights Villa - Phase 1";

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Handler = () => Response | Promise<Response>;

function router(handlers: Record<string, Handler>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const path of Object.keys(handlers).sort((a, b) => b.length - a.length)) {
      if (url.includes(path)) return handlers[path]();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

const TASKS = [
  { id: "t1", number: 12, title: "Joinery shop drawings", startDate: "2026-08-01", dueDate: "2026-09-05", completionPercentage: 40 },
];

function renderTabs(over: Partial<Record<string, Handler>> = {}, props: { initialQuery?: string } = {}) {
  globalThis.fetch = router({
    "/api/schedule/tasks": () => jsonRes({ tasks: TASKS }),
    "/api/schedule/gantt": () => jsonRes({ tasks: [], dependencies: [], milestones: [] }),
    ...over,
  } as Record<string, Handler>);
  return render(
    <ScheduleTabsClient
      projectId="proj-cedar"
      projectName={PROJECT_NAME}
      initialTab="timeline"
      initialQuery={props.initialQuery ?? ""}
      timelineColumns={null}
    />
  );
}

/** The header band's buttons, in DOM order, by their accessible name. */
function headerActionNames(container: HTMLElement): string[] {
  const header = container.querySelector("header")!;
  return [...header.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
}

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("D-44 header band", () => {
  test("renders Filter | Export | Import | + New in that DOM order, named exactly", async () => {
    const { container } = renderTabs();
    await waitFor(() => expect(container.querySelector("header")).not.toBeNull());
    expect(headerActionNames(container)).toEqual(["Filter", "Export", "Import", "+ New"]);
  });

  test("the breadcrumb names the module and the project", async () => {
    const { container } = renderTabs();
    await waitFor(() => expect(container.querySelector("header")).not.toBeNull());
    const breadcrumb = container.querySelector("header > div")!.textContent!.replace(/\s+/g, " ").trim();
    expect(breadcrumb).toBe(`Schedule > ${PROJECT_NAME}`);
  });

  test("with no activities, Filter and Export say why, and + New stays enabled", async () => {
    const { container, findByText } = renderTabs({ "/api/schedule/tasks": () => jsonRes({ tasks: [] }) });
    await findByText(`(${NO_ACTIVITIES_TO_FILTER})`);
    await findByText(`(${NO_ACTIVITIES_TO_EXPORT})`);
    const header = container.querySelector("header")!;
    const buttons = [...header.querySelectorAll("button")];
    expect(buttons.find((b) => b.getAttribute("aria-label") === "Filter")!.disabled).toBe(true);
    expect(buttons.find((b) => b.getAttribute("aria-label") === "Export")!.disabled).toBe(true);
    expect(buttons.find((b) => b.getAttribute("aria-label") === "+ New")!.disabled).toBe(false);
  });

  test("Import holds its place but does not push a route that does not exist yet", async () => {
    const { container, findByText } = renderTabs();
    await findByText(`(${IMPORT_UNAVAILABLE_REASON})`);
    const importButton = [...container.querySelector("header")!.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Import"
    )!;
    expect(importButton.disabled).toBe(true);
    fireEvent.click(importButton);
    expect(push).not.toHaveBeenCalled();
  });

  test("a failed activity load is reported in the footer, in the backend's own words", async () => {
    const { findByText } = renderTabs({
      "/api/schedule/tasks": () => jsonRes({ error: "Schedule service did not answer" }, 502),
    });
    await findByText("Couldn't load this project's activities: Schedule service did not answer");
  });

  test("+ New pushes the create route carrying the project", async () => {
    const { container } = renderTabs();
    await waitFor(() => expect(container.querySelector("header")).not.toBeNull());
    const newButton = [...container.querySelector("header")!.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "+ New"
    )!;
    fireEvent.click(newButton);
    expect(push).toHaveBeenCalledWith("/schedule/tasks/new?projectId=proj-cedar");
  });
});

describe("D-44 tabs", () => {
  test("shows the user's words while keeping the existing ?tab= values", async () => {
    const { container } = renderTabs();
    await waitFor(() => expect(container.querySelectorAll('[role="tab"]').length).toBe(4));
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["Timeline", "Board", "Phases", "Time"]);
    // The VALUES must not move -- every existing ?tab=sprints/?tab=timesheet
    // link in the wild still has to land on the same panel.
    expect(tabs.map((t) => t.getAttribute("value") ?? t.getAttribute("data-value") ?? "")).not.toContain("phases");
  });

  test("each tab carries its own caption", async () => {
    const { findByText, container } = renderTabs();
    await findByText(
      "Your programme. Import an Excel plan or add activities; bars show planned (grey) and actual (blue)."
    );
    const boardTab = [...container.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Board")!;
    // Radix's Tabs.Trigger activates on mousedown, not on the synthetic click
    // alone -- both are fired so the switch happens the way a real pointer
    // would cause it.
    fireEvent.mouseDown(boardTab);
    fireEvent.click(boardTab);
    await findByText("Move activities between statuses by dragging.");
  });

  test("'New Task' sits outside the tab panels, so creation exists on every tab", async () => {
    const { container } = renderTabs();
    await waitFor(() => expect(container.querySelector('[data-testid="schedule-new-task"]')).not.toBeNull());
    const button = container.querySelector('[data-testid="schedule-new-task"]')!;
    expect(button.closest('[role="tabpanel"]')).toBeNull();
    fireEvent.click(button);
    expect(push).toHaveBeenCalledWith("/schedule/tasks/new?projectId=proj-cedar");
  });
});

describe("D-44 filter", () => {
  test("an existing ?q= opens the filter bar so Back restores what the user had", async () => {
    const { container } = renderTabs({}, { initialQuery: "slab" });
    await waitFor(() => expect(container.querySelector("#schedule-filter-title")).not.toBeNull());
    expect((container.querySelector("#schedule-filter-title") as HTMLInputElement).value).toBe("slab");
  });

  test("the Filter action toggles the bar when there are activities", async () => {
    const { container } = renderTabs();
    await waitFor(() => expect(container.querySelector("header")).not.toBeNull());
    expect(container.querySelector("#schedule-filter-title")).toBeNull();
    const filterButton = [...container.querySelector("header")!.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Filter"
    )!;
    await waitFor(() => expect(filterButton.disabled).toBe(false));
    fireEvent.click(filterButton);
    await waitFor(() => expect(container.querySelector("#schedule-filter-title")).not.toBeNull());
  });
});
