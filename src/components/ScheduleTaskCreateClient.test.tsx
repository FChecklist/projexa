/// <reference types="bun-types" />
// R67 D-47 acceptance, asserted against the real component rather than a
// Playwright walk (this session may not start a dev server).
//
// "open /schedule/tasks/new with an empty form and expect the primary button's
// accessible name to name what is missing" is asserted here against the
// rendered DOM. The second half of the acceptance needs a typed date, which
// this environment cannot deliver to React, so the rule behind it
// (dueDateError) is asserted in src/lib/schedule-activity.test.ts.
//
// MERGE NOTE (D-67 / G-04). This screen moved onto the shared create archetype.
// Two mechanics moved with it and are asserted in their new form:
//   * the primary NAMES the missing fields ("Save (Title, Start Date)") rather
//     than counting them ("Save (2 required fields)") -- one form across the
//     product, the one /labour/new established, and strictly more use to a
//     reader than a bare number;
//   * the Type control is a native <select>, and its four states (loading,
//     ready, empty, error) come from src/lib/schedule-type-state.ts, where they
//     are unit-tested. The rule D-47 cares about is unchanged and is still
//     asserted here: "Loading…" is never a VALUE.
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
  test("an empty form names both missing required fields", async () => {
    const { container } = renderClient();
    await waitFor(() => expect(saveButton(container)).toBeDefined());
    // The two D-47 added: a programme activity needs a title AND a start.
    expect(saveButton(container).textContent).toBe("Save (Title, Start Date)");
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
    const skeleton = container.querySelector('[data-testid="schedule-task-type-loading"]')!;
    expect(skeleton).not.toBeNull();
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
    // The old placeholder was literally "Loading…" sitting where a real type
    // would be. Nothing in the Type control may say that again.
    expect(skeleton.textContent).toBe("");
    // Once the list arrives the skeleton is replaced by the real select.
    await findByText("Task");
    expect(container.querySelector('[data-testid="schedule-task-type-loading"]')).toBeNull();
  });

  test("the org's default type is preselected once the list has arrived", async () => {
    const { container, findByText } = renderClient();
    await findByText("Task");
    // The archetype renders a native <select>, so the CHOSEN value is what is
    // asserted -- not the text of a trigger.
    await waitFor(() => expect((container.querySelector("#typeId") as HTMLSelectElement).value).toBe("type-task"));
  });

  test("a failed type lookup names the failure and offers Retry", async () => {
    let attempt = 0;
    const { findByText } = renderClient({
      "/api/schedule/types": () => {
        attempt += 1;
        return attempt === 1 ? jsonRes({ error: "types service is down" }, 502) : jsonRes({ types: TYPES });
      },
    });
    // G-04's own sentence for the error state, plus a way to ask again that
    // does not lose the title already typed.
    await findByText("Saving now uses your organisation's default type.");
    fireEvent.click((await findByText("Retry")).closest("button")!);
    await waitFor(() => expect(attempt).toBe(2));
  });
});

describe("D-47 the two new lookups", () => {
  test("Predecessor and BOQ item are real fields on the form", async () => {
    const { container } = renderClient();
    // Optional, so no required marker -- but real controls with real labels.
    await waitFor(() => expect(container.querySelector("#predecessorId")).not.toBeNull());
    expect(container.querySelector("#boqLineItemId")).not.toBeNull();
    // The archetype marks a non-required field "(optional)" in its own label,
    // which is why these are matched by their opening words.
    const labels = [...container.querySelectorAll("label")].map((l) => l.textContent!.trim());
    expect(labels.some((l) => l.startsWith("Predecessor"))).toBe(true);
    expect(labels.some((l) => l.startsWith("BOQ item"))).toBe(true);
  });

  test("a project with no BOQ says so rather than offering an empty dropdown", async () => {
    const { container } = renderClient({ "/api/scope": () => jsonRes({ boqs: [] }) });
    await waitFor(() => expect(container.textContent).toContain("No BOQ lines on this project yet"));
  });

  test("a failed BOQ lookup degrades that one field and offers Retry, leaving the rest usable", async () => {
    const { container, findByText } = renderClient({
      "/api/scope": () => jsonRes({ error: "scope service timed out" }, 504),
    });
    await findByText("scope service timed out");
    // ONE field degrades, and it says so on itself rather than blocking the form.
    expect(await findByText("Retry")).toBeDefined();
    // The form is still usable: the Title field and the Save button are intact.
    expect(saveButton(container)).toBeDefined();
    expect(container.querySelector("#title")).not.toBeNull();
  });

  test("a failed predecessor lookup is reported separately from the BOQ one", async () => {
    const { container, findByText } = renderClient({
      "/api/schedule/tasks": () => jsonRes({ error: "schedule service timed out" }, 504),
    });
    await findByText("schedule service timed out");
    // The BOQ field, which answered, is not implicated in the other's failure.
    expect(container.textContent).toContain("The scope line this activity earns its value against");
  });
});
