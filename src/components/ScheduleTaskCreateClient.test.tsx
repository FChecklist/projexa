/// <reference types="bun-types" />
// R67 D-47 acceptance, asserted against the real component rather than a
// Playwright walk (this session may not start a dev server).
//
// "open /schedule/tasks/new with an empty form and expect the primary button's
// accessible name to be exactly 'Save (2 required fields)'" is asserted here
// against the rendered DOM. The second half of the acceptance needs a typed
// date, which this environment cannot deliver to React, so the rule behind it
// (dueDateError) is asserted in src/lib/schedule-activity.test.ts.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock((_href: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, prefetch: () => {}, back: () => {} }) }));

const ScheduleTaskCreateClient = (await import("./ScheduleTaskCreateClient")).default;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Handler = () => Response | Promise<Response>;

const TYPES = [
  { id: "type-story", name: "Story", isDefault: false },
  { id: "type-task", name: "Task", isDefault: true },
];

function renderClient(over: Partial<Record<string, Handler>> = {}) {
  const handlers: Record<string, Handler> = {
    "/api/schedule/types": () => jsonRes({ types: TYPES }),
    "/api/schedule/tasks": () => jsonRes({ tasks: [{ id: "t1", number: 11, title: "Excavate" }] }),
    "/api/scope": () => jsonRes({ boqs: [{ id: "b1", lineItems: [{ id: "l1", itemCode: "A-1", description: "Blockwork" }] }] }),
    ...over,
  } as Record<string, Handler>;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const path of Object.keys(handlers).sort((a, b) => b.length - a.length)) {
      if (url.includes(path)) return handlers[path]();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return render(<ScheduleTaskCreateClient projectId="proj-cedar" />);
}

function saveButton(container: HTMLElement): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Save")) as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("D-47 the Save button", () => {
  test("an empty form reads exactly 'Save (2 required fields)'", async () => {
    const { container } = renderClient();
    await waitFor(() => expect(saveButton(container)).toBeDefined());
    expect(saveButton(container).textContent).toBe("Save (2 required fields)");
    expect(saveButton(container).disabled).toBe(true);
  });
});

describe("D-47 the Type select never renders a loading state as an option", () => {
  test("while loading, the control is a disabled skeleton, not the word 'Loading…'", async () => {
    // Asserted on the FIRST paint -- render() flushes the effect that starts
    // the fetch but nothing has resolved yet, so this is the real loading
    // state. (A never-resolving fetch would express the same thing and was
    // tried first: it leaves a pending promise that keeps bun's runner alive
    // after the assertions pass, so the file hangs rather than finishing.)
    const { container, findByText } = renderClient();
    const skeleton = container.querySelector('[data-testid="type-loading"]')!;
    expect(skeleton).not.toBeNull();
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
    // The old placeholder was literally "Loading…" sitting where a real type
    // would be. Nothing in the Type control may say that again.
    expect(skeleton.textContent).toBe("");
    // Once the list arrives the skeleton is replaced by the real select.
    await findByText("Task");
    expect(container.querySelector('[data-testid="type-loading"]')).toBeNull();
  });

  test("the org's default type is preselected once the list has arrived", async () => {
    const { container, findByText } = renderClient();
    await findByText("Task");
    const triggers = [...container.querySelectorAll('[role="combobox"]')];
    expect(triggers[0].textContent).toBe("Task");
  });

  test("a failed type lookup names the failure and offers Retry", async () => {
    let attempt = 0;
    const { findByText } = renderClient({
      "/api/schedule/types": () => {
        attempt += 1;
        return attempt === 1 ? jsonRes({ error: "types service is down" }, 502) : jsonRes({ types: TYPES });
      },
    });
    await findByText("Couldn't load the activity types: types service is down");
    fireEvent.click((await findByText("Retry")).closest("button")!);
    await waitFor(() => expect(attempt).toBe(2));
  });
});

describe("D-47 the two new lookups", () => {
  test("Predecessor and BOQ item are real fields on the form", async () => {
    const { findByText } = renderClient();
    await findByText("Predecessor (optional)");
    await findByText("BOQ item (optional)");
  });

  test("a project with no BOQ says so rather than offering an empty dropdown", async () => {
    const { container, findByText } = renderClient({ "/api/scope": () => jsonRes({ boqs: [] }) });
    await findByText("BOQ item (optional)");
    await waitFor(() => expect(container.textContent).toContain("No BOQ lines on this project yet"));
  });

  test("a failed BOQ lookup degrades that one field and offers Retry, leaving the rest usable", async () => {
    const { container, findByText } = renderClient({
      "/api/scope": () => jsonRes({ error: "scope service timed out" }, 504),
    });
    await findByText("Couldn't load this project's BOQ lines: scope service timed out");
    // The form is still usable: the Title field and the Save button are intact.
    expect(saveButton(container)).toBeDefined();
    expect(container.textContent).toContain("BOQ lines did not load");
  });

  test("a failed predecessor lookup is reported separately from the BOQ one", async () => {
    const { findByText } = renderClient({
      "/api/schedule/tasks": () => jsonRes({ error: "schedule service timed out" }, 504),
    });
    await findByText("Couldn't load this project's activities: schedule service timed out");
  });
});
