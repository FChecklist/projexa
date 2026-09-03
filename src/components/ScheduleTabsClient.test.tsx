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
// MERGE NOTE (D-79). The band was originally a fork of the kit's ScreenFrame,
// made only to fit a fourth action. Lane D-79's ListHeaderActions -- already on
// main and already carrying Manpower and Materials -- is the product's real
// answer to the same requirement, so the fork was retired and this screen now
// uses the shared control with Import passed through its `extraActions` slot.
// The ACCEPTANCE is unchanged and is what these tests still assert; two of the
// mechanics moved with the control and are called out where they are asserted:
//   * a disabled action states its reason in `title` (the shared control's
//     convention) rather than appending "(reason)" to the visible label;
//   * "+ New" is a MENU, so creating a task is open-then-choose -- which is
//     what D-79's own acceptance asks for, and what puts Sprint and Log time
//     within reach of the same control.
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
  return [...header.querySelectorAll("button")].map((b) =>
    (b.getAttribute("aria-label") ?? b.textContent ?? "").trim()
  );
}

/** One header button, by its accessible name. */
function headerButton(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelector("header")!.querySelectorAll("button")].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === name
  );
  if (!found) throw new Error(`no header button named ${name}`);
  return found as HTMLButtonElement;
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
    // The breadcrumb is the trail ABOVE the title, so it is read from its own
    // element rather than from the heading block, which also contains "Schedule"
    // as the title.
    const breadcrumb = container.querySelector("header h1")!.previousElementSibling!;
    expect(breadcrumb.textContent!.replace(/\s+/g, " ").trim()).toBe(`Schedule > ${PROJECT_NAME}`);
  });

  test("with no activities, Filter and Export say why, and + New stays enabled", async () => {
    const { container } = renderTabs({ "/api/schedule/tasks": () => jsonRes({ tasks: [] }) });
    await waitFor(() => expect(headerButton(container, "Filter").disabled).toBe(true));
    // The reason is stated, and it is the real one -- the shared control puts it
    // in `title` rather than in the visible label.
    expect(headerButton(container, "Filter").title).toBe(NO_ACTIVITIES_TO_FILTER);
    expect(headerButton(container, "Export").disabled).toBe(true);
    expect(headerButton(container, "Export").title).toBe(NO_ACTIVITIES_TO_EXPORT);
    // Creating the FIRST activity is exactly what an empty schedule needs, so
    // this one is never disabled for want of rows.
    expect(headerButton(container, "+ New").disabled).toBe(false);
  });

  test("Import holds its place but does not push a route that does not exist yet", async () => {
    const { container } = renderTabs();
    await waitFor(() => expect(container.querySelector("header")).not.toBeNull());
    const importButton = headerButton(container, "Import");
    expect(importButton.disabled).toBe(true);
    expect(importButton.title).toBe(IMPORT_UNAVAILABLE_REASON);
    fireEvent.click(importButton);
    expect(push).not.toHaveBeenCalled();
  });

  test("a failed activity load is reported in the footer, in the backend's own words", async () => {
    const { findByText } = renderTabs({
      "/api/schedule/tasks": () => jsonRes({ error: "Schedule service did not answer" }, 502),
    });
    await findByText("Couldn't load this project's activities: Schedule service did not answer");
  });

  test("+ New opens the module's create menu and Task carries the project", async () => {
    const { container, findByRole } = renderTabs();
    await waitFor(() => expect(container.querySelector("header")).not.toBeNull());
    // D-79: "+ New" opens the module's whole create list with the ACTIVE TAB's
    // own object first -- two clicks to any of them, and Sprint and Log time
    // stop being unreachable from the Gantt.
    fireEvent.click(headerButton(container, "+ New"));
    const menu = await findByRole("menu");
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);
    expect(items).toContain("Task");
    fireEvent.click([...menu.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent === "Task")!);
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

  test("creation sits outside the tab panels, so it exists on every tab", async () => {
    // The point of the item: "+ New Task" used to live inside the Board tab's
    // body, so on Timeline, Phases or Time there was no way to create an
    // activity at all. Wherever the control lives, it must not be inside a
    // panel that only one tab shows.
    const { container } = renderTabs();
    await waitFor(() => expect(container.querySelector("header")).not.toBeNull());
    expect(headerButton(container, "+ New").closest('[role="tabpanel"]')).toBeNull();
    expect(container.querySelector("header")!.closest('[role="tabpanel"]')).toBeNull();
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
    await waitFor(() => expect(headerButton(container, "Filter").disabled).toBe(false));
    fireEvent.click(headerButton(container, "Filter"));
    await waitFor(() => expect(container.querySelector("#schedule-filter-title")).not.toBeNull());
  });
});
