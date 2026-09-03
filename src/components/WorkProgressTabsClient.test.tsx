/// <reference types="bun-types" />
// R67 F-05 (R-075). This file exists for two structural reasons, and both are
// invisible on screen when they regress — which is why they are pinned here
// rather than left to the panels' own tests:
//
//   1. ONE WorkProgressDataProvider wraps all three panels. Before F-05 the
//      server page mounted the tabs directly, so each tab re-ran the project's
//      whole load; if a later edit moved the provider inside a single
//      <TabsContent>, the screen would look identical and the duplicate
//      loading would silently come back. The assertion is therefore the
//      OBSERVABLE property -- switching tabs issues no second request -- not
//      the presence of a wrapper element.
//   2. the Report tab warms its own request on hover/focus. Its handler fans
//      out five VERIDIAN calls, and it cannot share the provider because it is
//      a different query; the prewarm is the only thing making the click feel
//      like the remainder of a request rather than all of it. `onFocus` is not
//      decoration -- it is how a keyboard user gets the same head start.
//
// NOTHING BELOW MOCKS the provider, the panels or the prewarm module. `bun
// test` runs every file in ONE process and mock.module is process-wide, so
// stubbing @/lib/work-progress-report-prewarm here would replace the real
// module for its own test file too (it did, and broke three of its cases).
// The real modules are driven through a stubbed global fetch instead, which
// also makes these assertions about the actual wiring rather than about a
// stub. The two mocks that remain are the ones this suite already installs
// process-wide from WorkProgressPageClient.test.tsx, declared here as well so
// the file also passes on its own.
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

// The Daily Entry panel renders the form alongside the list, and the form has
// its own legitimate /api/scope need. Same stub, and same reason, as
// WorkProgressPageClient.test.tsx's.
mock.module("@/components/WorkProgressFormClient", () => ({
  default: () => <div data-testid="form-stub" />,
}));

const WorkProgressTabsClient = (await import("./WorkProgressTabsClient")).default;
const { __resetWorkProgressCacheForTests } = await import("./WorkProgressDataProvider");
const { __resetReportPrewarmForTests, defaultReportRange } = await import("@/lib/work-progress-report-prewarm");

afterEach(() => {
  cleanup();
  __resetWorkProgressCacheForTests();
  __resetReportPrewarmForTests();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

// bun test runs every file in ONE process, so under a full-suite run these
// renders share a machine with every other suite.
const WAIT = { timeout: 8_000 } as const;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ENTRY = {
  id: "e1",
  activityId: "act-1",
  boqLineItemId: "line-1",
  entryDate: "2026-09-01",
  quantityDone: "12",
  percentComplete: "40",
  entryBasis: "DELTA",
  remarks: null,
  activityName: "Blockwork",
  boqItemCode: "A-102",
  boqLineDescription: "230mm blockwork to walls",
  unit: "cum",
};

function stubFetch() {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/api/work-progress/activities")) return jsonRes({ activities: [{ id: "act-1", name: "Blockwork" }] });
    if (url.includes("/api/work-progress/report")) return jsonRes({ rows: [] });
    if (url.includes("/api/work-progress")) return jsonRes({ entries: [ENTRY] });
    return jsonRes({});
  }) as typeof fetch;
  return calls;
}

// Radix's TabsTrigger switches on mousedown, not on the click event that
// follows it, so a bare fireEvent.click() leaves the tab where it was.
function activateTab(trigger: HTMLElement) {
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.click(trigger);
}

const entryRequests = (calls: string[]) =>
  calls.filter((u) => u.includes("/api/work-progress?") || /\/api\/work-progress\?/.test(u));
const reportRequests = (calls: string[]) => calls.filter((u) => u.includes("/api/work-progress/report"));

describe("WorkProgressTabsClient — tab selection", () => {
  test("defaults to Daily Entry when no tab is requested", () => {
    stubFetch();
    const { getByRole } = render(<WorkProgressTabsClient projectId="p1" />);

    expect(getByRole("tab", { name: "Daily Entry" }).getAttribute("data-state")).toBe("active");
  });

  test("?tab=analytics lands directly on Analytics -- the dashboard's own destination", () => {
    stubFetch();
    const { getByRole } = render(<WorkProgressTabsClient projectId="p1" tab="analytics" />);

    expect(getByRole("tab", { name: "Analytics" }).getAttribute("data-state")).toBe("active");
  });

  test("?tab=report lands directly on Report", () => {
    stubFetch();
    const { getByRole } = render(<WorkProgressTabsClient projectId="p1" tab="report" />);

    expect(getByRole("tab", { name: "Report" }).getAttribute("data-state")).toBe("active");
  });

  test("an unrecognised ?tab= falls back to Daily Entry rather than an empty tab area", () => {
    stubFetch();
    const { getByRole } = render(<WorkProgressTabsClient projectId="p1" tab="nonsense" />);

    expect(getByRole("tab", { name: "Daily Entry" }).getAttribute("data-state")).toBe("active");
  });
});

describe("WorkProgressTabsClient — the three panels share one load", () => {
  test("switching Daily Entry -> Analytics issues no second work-progress request", async () => {
    const calls = stubFetch();

    const { getByRole } = render(<WorkProgressTabsClient projectId="p1" />);
    await waitFor(() => expect(entryRequests(calls)).toHaveLength(1), WAIT);

    activateTab(getByRole("tab", { name: "Analytics" }));
    await waitFor(() => expect(getByRole("tab", { name: "Analytics" }).getAttribute("data-state")).toBe("active"), WAIT);

    // The whole point of the shared provider. Before F-05 this was a second
    // full entries + activities + /api/scope + /api/scope/{id} chain.
    expect(entryRequests(calls)).toHaveLength(1);
    expect(calls.filter((u) => u.includes("/api/work-progress/activities"))).toHaveLength(1);
    // And no BOQ list is pulled for labels any more.
    expect(calls.filter((u) => u.includes("/api/scope"))).toHaveLength(0);
  });
});

describe("WorkProgressTabsClient — the Report tab warms its own request", () => {
  test("nothing is prewarmed until the Report tab is actually pointed at", async () => {
    const calls = stubFetch();

    const { getByRole } = render(<WorkProgressTabsClient projectId="p1" />);
    await waitFor(() => expect(entryRequests(calls)).toHaveLength(1), WAIT);

    expect(reportRequests(calls)).toHaveLength(0);
    expect(getByRole("tab", { name: "Report" })).toBeDefined();
  });

  test("hovering Report starts its request, with the project and the shared default range", async () => {
    const calls = stubFetch();
    const { getByRole } = render(<WorkProgressTabsClient projectId="p1" />);

    fireEvent.mouseEnter(getByRole("tab", { name: "Report" }));

    await waitFor(() => expect(reportRequests(calls)).toHaveLength(1), WAIT);
    const params = new URLSearchParams(reportRequests(calls)[0].split("?")[1]);
    const range = defaultReportRange();
    expect(params.get("projectId")).toBe("p1");
    // The range must be the SHARED default, or the prewarmed slot's key would
    // not match the key the panel asks for and the head start would be lost.
    expect(params.get("from")).toBe(range.from);
    expect(params.get("to")).toBe(range.to);
  });

  test("focusing Report warms it too -- a keyboard user gets the same head start", async () => {
    const calls = stubFetch();
    const { getByRole } = render(<WorkProgressTabsClient projectId="p1" />);

    fireEvent.focus(getByRole("tab", { name: "Report" }));

    await waitFor(() => expect(reportRequests(calls)).toHaveLength(1), WAIT);
  });

  test("hovering Report twice starts exactly one request", async () => {
    const calls = stubFetch();
    const { getByRole } = render(<WorkProgressTabsClient projectId="p1" />);
    const trigger = getByRole("tab", { name: "Report" });

    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(trigger);

    await waitFor(() => expect(reportRequests(calls)).toHaveLength(1), WAIT);
    expect(reportRequests(calls)).toHaveLength(1);
  });

  test("hovering the other two tabs warms nothing -- they read the shared provider", async () => {
    const calls = stubFetch();
    const { getByRole } = render(<WorkProgressTabsClient projectId="p1" />);
    await waitFor(() => expect(entryRequests(calls)).toHaveLength(1), WAIT);

    fireEvent.mouseEnter(getByRole("tab", { name: "Daily Entry" }));
    fireEvent.mouseEnter(getByRole("tab", { name: "Analytics" }));

    expect(reportRequests(calls)).toHaveLength(0);
  });
});
