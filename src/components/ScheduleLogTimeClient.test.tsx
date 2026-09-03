/// <reference types="bun-types" />
// R67 D-51 acceptance, asserted against the real component rather than a
// Playwright walk (this session may not start a dev server).
//
// The acceptance reads: "expect a label with the exact text 'Category *',
// expect the select to contain the option 'Joinery', expect the line
// 'Project: Cedar Heights Villa - Phase 1 - change in the top bar', and expect
// no input with the placeholder 'e.g. Development, Site Visit'." All four are
// asserted below.
//
// ONE SUBSTITUTION, and it is measured rather than assumed: Radix's Select
// commits its choice through a pointer sequence this environment does not
// deliver, so a test cannot pick an option. The options themselves ARE in the
// DOM and are asserted; the rule that decides what a choice STORES lives in
// src/lib/time-categories.ts and is exercised exhaustively there.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock((_href: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, prefetch: () => {}, back: () => {} }) }));

const logTimeModule = await import("./ScheduleLogTimeClient");
const ScheduleLogTimeClient = logTimeModule.default;
const { RAIL_NOT_ON_SCREEN, TASKS_EMPTY_LABEL, TASKS_FAILED_LABEL, TASKS_LOADING_LABEL, projectLine } = logTimeModule;

import { RAIL_PROJECT_KEY } from "@/lib/rail-project";

const PROJECT_NAME = "Cedar Heights Villa - Phase 1";

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Handler = () => Response | Promise<Response>;

function renderClient(over: Partial<Record<string, Handler>> = {}) {
  const handlers: Record<string, Handler> = {
    "/api/schedule/tasks": () => jsonRes({ tasks: [{ id: "t1", number: 12, title: "Joinery shop drawings" }] }),
    "/api/work-progress/activities": () => jsonRes({ activities: [], categories: [{ id: "c1", name: "Blockwork" }] }),
    ...over,
  } as Record<string, Handler>;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const path of Object.keys(handlers).sort((a, b) => b.length - a.length)) {
      if (url.includes(path)) return handlers[path]();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return render(<ScheduleLogTimeClient projectId="proj-cedar" projectName={PROJECT_NAME} />);
}

afterEach(() => {
  cleanup();
  push.mockClear();
  try {
    window.sessionStorage.clear();
  } catch {
    /* storage may be blocked; the component tolerates that too */
  }
});

describe("D-51 Category", () => {
  test("the label is 'Category' and it is marked required", async () => {
    const { container, findByText } = renderClient();
    const label = await findByText("Category");
    expect(label.tagName.toLowerCase()).toBe("label");
    // FormField renders the asterisk aria-hidden and the word for a screen
    // reader, so the visible text is "Category *" and the accessible name is
    // "Category (required)".
    expect(label.textContent).toContain("*");
    expect(label.textContent).toContain("(required)");
    expect(container.querySelector(`[aria-required="true"]`)).not.toBeNull();
  });

  test("the option list contains the seeded BOQ vocabulary and the project's own categories", async () => {
    const { container, findByText } = renderClient();
    await findByText("Category");
    // Radix renders the items only once the select is open; the trigger is
    // opened by keyboard, which this environment does deliver.
    const trigger = [...container.querySelectorAll('[role="combobox"]')].pop() as HTMLElement;
    fireEvent.keyDown(trigger, { key: "Enter" });
    await waitFor(() => expect(document.body.textContent).toContain("Joinery"));
    expect(document.body.textContent).toContain("Blockwork");
    expect(document.body.textContent).toContain("Other (specify)");
  });

  test("the developer-vocabulary free-text field is gone", async () => {
    const { container, findByText } = renderClient();
    await findByText("Category");
    expect(container.querySelector('input[placeholder="e.g. Development, Site Visit"]')).toBeNull();
    expect(container.textContent).not.toContain("Activity Type (optional)");
  });

  test("Category is one of the required fields the Save button names", async () => {
    const { findByText, container } = renderClient();
    await findByText("Category");
    const save = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Save"))!;
    expect(save.textContent).toContain("Category");
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("D-51 the form names its project", () => {
  test("prints the project and the one place it can be changed", async () => {
    const { findByTestId } = renderClient();
    const line = await findByTestId("log-time-project");
    expect(line.textContent).toBe(`Project: ${PROJECT_NAME} — change in the top bar`);
    expect(projectLine(PROJECT_NAME)).toBe(`Project: ${PROJECT_NAME} — change in the top bar`);
  });

  test("'Change project' focuses the rail's own switcher", async () => {
    const rail = document.createElement("header");
    rail.innerHTML = `<button aria-label="Project: ${PROJECT_NAME}. Click to switch project." id="rail">x</button>`;
    document.body.appendChild(rail);

    const { findByText } = renderClient();
    fireEvent.click(await findByText("Change project"));
    await waitFor(() => expect(document.activeElement?.id).toBe("rail"));
    rail.remove();
  });

  test("says so instead of doing nothing when the rail is not on screen", async () => {
    const { findByText } = renderClient();
    fireEvent.click(await findByText("Change project"));
    await findByText(RAIL_NOT_ON_SCREEN);
  });

  test("writes the resolved project into the rail so the two cannot disagree", async () => {
    const { findByTestId } = renderClient();
    await findByTestId("log-time-project");
    await waitFor(() => expect(window.sessionStorage.getItem(RAIL_PROJECT_KEY)).toBe("proj-cedar"));
  });

  test("a failed category lookup degrades to the seeded list, never to an empty required select", async () => {
    const { container, findByText } = renderClient({
      "/api/work-progress/activities": () => jsonRes({ error: "activities service is down" }, 502),
    });
    await findByText("Category");
    const trigger = [...container.querySelectorAll('[role="combobox"]')].pop() as HTMLElement;
    fireEvent.keyDown(trigger, { key: "Enter" });
    await waitFor(() => expect(document.body.textContent).toContain("Joinery"));
  });
});

describe("D-50 the task select is honest about its four states", () => {
  test("while loading, the select is disabled and says so", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { container } = renderClient({
      "/api/schedule/tasks": async () => { await gate; return jsonRes({ tasks: [] }); },
    });
    await waitFor(() => expect(container.textContent).toContain(TASKS_LOADING_LABEL));
    const trigger = container.querySelector('[role="combobox"]') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    release!();
  });

  test("a failed load shows the backend's own sentence and a Retry that re-runs the fetch", async () => {
    let attempt = 0;
    const { container, findByText } = renderClient({
      "/api/schedule/tasks": () => {
        attempt += 1;
        return attempt === 1
          ? jsonRes({ error: "Gateway timeout" }, 504)
          : jsonRes({ tasks: [{ id: "t1", number: 12, title: "Joinery shop drawings" }] });
      },
    });
    await findByText(`${TASKS_FAILED_LABEL}: Gateway timeout`);
    const trigger = container.querySelector('[role="combobox"]') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);

    fireEvent.click(await findByText("Retry"));
    await waitFor(() => expect((container.querySelector('[role="combobox"]') as HTMLButtonElement).disabled).toBe(false));
    expect(attempt).toBe(2);
  });

  test("a project with no tasks says so and offers the way to create one", async () => {
    const { container, findByText } = renderClient({ "/api/schedule/tasks": () => jsonRes({ tasks: [] }) });
    await waitFor(() => expect(container.textContent).toContain(TASKS_EMPTY_LABEL));
    fireEvent.click(await findByText("Create one"));
    expect(push).toHaveBeenCalledWith("/schedule/tasks/new?projectId=proj-cedar");
  });

  test("leaving Task without choosing one says which question was not answered", async () => {
    const { container, findByText } = renderClient();
    await waitFor(() => expect((container.querySelector('[role="combobox"]') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.blur(container.querySelector('[role="combobox"]') as HTMLElement);
    await findByText("Choose the task these hours were spent on");
  });
});

describe("D-50 the Save button counts and names what is missing", () => {
  test("on an untouched form (Date defaults to today) it names the other three", async () => {
    const { container, findByText } = renderClient();
    await findByText("Category");
    const save = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Save"))!;
    expect(save.textContent).toBe("Save (3 required: Task, Hours, Category)");
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });
});
