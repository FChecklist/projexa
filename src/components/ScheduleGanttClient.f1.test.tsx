/// <reference types="bun-types" />
// R67 F-09 (R-122) acceptance test — the runnable half.
//
// The item's acceptance is a Playwright trace ("the 'All tasks' table has at
// least one row within 1500 ms of navigation start"). The property behind that
// number is asserted here without a server: with the gantt prefetched
// server-side and handed in as `initialGantt`, the tiles and the All-tasks
// table are present on the FIRST render and the component issues NO request at
// all on mount.
//
// THE FAULT. /schedule had a 2.1 s TTFB and then a client-side spinner: this
// panel only started fetching once it had hydrated, so the user waited for the
// server AND then for the browser, in series, for one screen.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// `screen` is intentionally not imported: @testing-library/dom binds it to
// document.body at module-evaluation time, before GlobalRegistrator.register()
// has created `document`.
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), prefetch: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
}));

// @svar-ui/react-gantt paints a real canvas-ish widget and reads layout APIs
// happy-dom does not implement (it throws on `a.translate`). It is a
// third-party chart and is not what this file tests -- the assertions are all
// about the component's OWN All-tasks table and its data path, which exist
// precisely because that widget's row virtualisation could not be relied on
// (see F_017 in the component's own comment).
mock.module("@svar-ui/react-gantt", () => ({
  Gantt: () => <div data-testid="svar-gantt-stub" />,
  Willow: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const ScheduleGanttClient = (await import("./ScheduleGanttClient")).default;
const { invalidateShellCache } = await import("@/lib/shell-cache");

afterEach(() => {
  cleanup();
  invalidateShellCache();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const GANTT = {
  tasks: [
    { id: "i1", title: "Pour foundation slab", startDate: "2026-09-01", dueDate: "2026-09-10", completionPercentage: 40, milestoneId: null, parentIssueId: null, isCritical: true, floatDays: 0 },
    { id: "i2", title: "Cure and strip", startDate: null, dueDate: null, completionPercentage: 0, milestoneId: null, parentIssueId: null, isCritical: false, floatDays: 3 },
  ],
  dependencies: [],
  milestones: [],
};

function stubFetch(handler?: (url: string) => Response) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    return handler ? handler(url) : jsonRes(GANTT);
  }) as typeof fetch;
  return calls;
}

describe("ScheduleGanttClient — server-prefetched first paint", () => {
  test("with initialGantt the All-tasks table has rows on the first render and NO request is made", async () => {
    const calls = stubFetch();

    const { getByText } = render(<ScheduleGanttClient projectId="p1" initialGantt={GANTT} />);

    // Synchronous: this is the first painted frame, not something awaited.
    expect(getByText("Pour foundation slab")).toBeDefined();
    expect(getByText("All tasks (2)")).toBeDefined();

    // Give any stray mount effect a turn to fire before asserting there was none.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.filter((u) => u.includes("/api/schedule/gantt"))).toHaveLength(0);
  });

  test("when the server prefetch failed (null) the client fetches once and then renders", async () => {
    const calls = stubFetch();

    const { getByText } = render(<ScheduleGanttClient projectId="p1" initialGantt={null} />);

    await waitFor(() => expect(getByText("Pour foundation slab")).toBeDefined());
    expect(calls.filter((u) => u.includes("/api/schedule/gantt"))).toHaveLength(1);
  });

  // R67 INTEGRATION (lane F1 onto main). CORRECTED, NOT WEAKENED. This used a
  // 403 to provoke the error card. The merged screen renders through
  // PaneErrorCard, whose dictionary makes NOT_AUTHORISED and NOT_FOUND
  // deliberately NON-retryable -- offering "Retry" on a permission error is an
  // invitation to click something that cannot work. So the retryable property
  // is asserted with a retryable failure (504), which is the case the Retry
  // button exists for. The assertion itself -- the backend's own words, and a
  // working Retry that then succeeds -- is unchanged.
  test("a failed load shows the backend's own words AND a Retry -- not an inert error card", async () => {
    let attempt = 0;
    stubFetch(() => {
      attempt += 1;
      return attempt === 1 ? jsonRes({ error: "The construction data service did not respond" }, 504) : jsonRes(GANTT);
    });

    const { getByText } = render(<ScheduleGanttClient projectId="p1" initialGantt={null} />);

    await waitFor(() => expect(getByText(/did not respond/)).toBeDefined());

    fireEvent.click(getByText("Retry"));
    await waitFor(() => expect(getByText("Pour foundation slab")).toBeDefined());
  });

  test("an unscheduled task still renders, with an em-dash rather than an invented date", () => {
    stubFetch();

    const { getByText, getAllByText } = render(<ScheduleGanttClient projectId="p1" initialGantt={GANTT} />);

    expect(getByText("Cure and strip")).toBeDefined();
    expect(getAllByText("—").length).toBeGreaterThan(0);
  });
});
