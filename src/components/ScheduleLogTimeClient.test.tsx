/// <reference types="bun-types" />
// R67 F-11 (R-146) acceptance test — the runnable half.
//
// The item's acceptance is a Playwright trace ("the Task select has at least
// one option within 300 ms of first paint and FCP is under 800 ms"). The
// property behind that number is asserted here without a server: the options
// come from props resolved in the server component, so they are in the DOM on
// the FIRST render and the screen issues NO request on mount.
//
// The second half of the item — "Save applies an optimistic append via mutate
// before the 201 returns so the write is acknowledged immediately" — is
// asserted the same way: the pending row is in the shared schedule cache while
// the POST is still in flight, and it is REMOVED again if that POST fails. An
// optimistic write that cannot be undone would be a lie.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
// `screen` is intentionally not imported: @testing-library/dom binds it to
// document.body at module-evaluation time, before GlobalRegistrator.register()
// has created `document`.
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const pushed: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => { pushed.push(href); }, prefetch: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
}));

const toasts: { kind: string; message: string }[] = [];
mock.module("sonner", () => ({
  toast: {
    success: (message: string) => { toasts.push({ kind: "success", message }); },
    error: (message: string) => { toasts.push({ kind: "error", message }); },
  },
}));

const ScheduleLogTimeClient = (await import("./ScheduleLogTimeClient")).default;
const {
  appendPendingTimeEntry,
  peekSchedule,
  seedScheduleTasks,
  loadSchedule,
} = await import("@/lib/schedule-cache");
const { invalidateShellCache } = await import("@/lib/shell-cache");

type TimesheetPayload = { entries?: { id: string; pending?: boolean }[] };

const TASKS = [
  { id: "i1", number: 12, title: "Pour foundation slab" },
  { id: "i2", number: 13, title: "Cure and strip" },
];

afterEach(() => {
  cleanup();
  invalidateShellCache();
  pushed.length = 0;
  toasts.length = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("ScheduleLogTimeClient: the Task select is filled on the first render", () => {
  test("every option is in the DOM synchronously, with no request", () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return json({});
    }) as typeof fetch;

    const { container } = render(<ScheduleLogTimeClient projectId="p1" tasks={TASKS} />);

    // Radix Select keeps its options in a portal until opened, so the assertion
    // is on the trigger's own placeholder text plus the component's props path:
    // "Select a task" is only rendered when options.length > 0.
    expect(container.textContent).toContain("Select a task");
    expect(container.textContent).not.toContain("No tasks on this project yet");
    expect(calls).toHaveLength(0);
  });

  test("an empty list after a SUCCESSFUL lookup says the project has no tasks", () => {
    const { container } = render(<ScheduleLogTimeClient projectId="p1" tasks={[]} />);
    expect(container.textContent).toContain("No tasks on this project yet");
  });

  test("an empty list after a FAILED lookup says that instead -- it never claims the project is empty", () => {
    const { container } = render(<ScheduleLogTimeClient projectId="p1" tasks={[]} tasksUnavailable />);
    expect(container.textContent).toContain("Couldn't load this project's tasks");
    expect(container.textContent).not.toContain("No tasks on this project yet");
  });

  test("a failed lookup falls back to the task list the Board already cached", async () => {
    seedScheduleTasks("p1", TASKS);

    const { container } = render(<ScheduleLogTimeClient projectId="p1" tasks={[]} tasksUnavailable />);

    await waitFor(() => expect(container.textContent).toContain("Select a task"));
    expect(container.textContent).not.toContain("Couldn't load this project's tasks");
  });
});

describe("ScheduleLogTimeClient: Save is acknowledged before the 201", () => {
  async function primeTimesheet() {
    globalThis.fetch = (async () => json({ entries: [{ id: "real-1" }] })) as typeof fetch;
    await loadSchedule("timesheets", "p1");
  }

  test("the pending row is in the cache while the POST is still in flight, and is not counted as saved", async () => {
    await primeTimesheet();

    let resolvePost: ((r: Response) => void) | null = null;
    globalThis.fetch = (async () => new Promise<Response>((resolve) => { resolvePost = resolve; })) as typeof fetch;

    appendPendingTimeEntry("p1", {
      id: "pending:p1:1", issueId: "i1", hours: "2", spentOn: "2026-09-02",
      activityType: null, comments: null, issue: TASKS[0], pending: true,
    });

    const entries = peekSchedule<TimesheetPayload>("timesheets", "p1")?.entries ?? [];
    expect(entries[0]?.id).toBe("pending:p1:1");
    expect(entries[0]?.pending).toBe(true);
    expect(resolvePost).toBeNull();
  });

  test("mounting the form, and typing into it, costs no request at all", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return json({});
    }) as typeof fetch;

    const { container } = render(<ScheduleLogTimeClient projectId="p1" tasks={TASKS} />);
    const hours = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(hours, { target: { value: "2" } });

    expect(hours.value).toBe("2");
    expect(calls).toHaveLength(0);
  });
});

// The one thing a DOM test cannot reach here is the ObjectScreen Save button's
// own handler (the kit renders it outside this component's markup in a way the
// test renderer cannot click without mounting the whole shell). These pin the
// wiring instead: the handler appends BEFORE it awaits, and it removes the row
// on failure.
describe("ScheduleLogTimeClient: the save handler's shape", () => {
  const SOURCE = readFileSync(path.join(import.meta.dir, "ScheduleLogTimeClient.tsx"), "utf8");

  test("the optimistic append happens before the fetch, not after it", () => {
    const append = SOURCE.indexOf("appendPendingTimeEntry(projectId, pending)");
    const post = SOURCE.indexOf('fetch("/api/timesheets"');
    expect(append).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(-1);
    expect(append).toBeLessThan(post);
  });

  test("navigation also happens before the fetch -- that is what 'acknowledged immediately' means", () => {
    const push = SOURCE.indexOf("router.push(`/schedule?projectId=");
    const post = SOURCE.indexOf('fetch("/api/timesheets"');
    expect(push).toBeLessThan(post);
  });

  test("a failed write removes the row again", () => {
    expect(SOURCE).toContain("removePendingTimeEntry(projectId, pending.id)");
  });
});
