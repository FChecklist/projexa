/// <reference types="bun-types" />
// R67 E-04 (R-079). The item's own acceptance, run for real: select the "Work
// Progress" definition, press the primary, assert router.push was called with
// a URL containing "/work-progress?tab=report&projectId=", and assert the
// fetch spy recorded ZERO calls containing "/api/reports/work-progress".
//
// Plus the run lifecycle R-079 asks for: while a report is running the panel
// shows a running state with elapsed seconds and a Cancel, and the string
// "Pick a report and click Run Report." is absent from the DOM throughout --
// the old ranOnce/loading pair tested ranOnce FIRST, which made the running
// state unreachable on a first run and left that prompt on screen while the
// button span.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- guarded, like every other happy-dom suite here.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
// NOT `screen`: @testing-library/dom binds its queries to document.body at
// module-evaluation time, and this file's static imports are hoisted above
// GlobalRegistrator.register(). render()'s own queries are bound per render.

const pushed: string[] = [];
// The selected report is part of the URL (?report=), which is what makes a run
// addressable -- and what lets this test select one without driving a Radix
// listbox, which does not open under happy-dom (probed: the shadcn Select
// renders no native <select> to change).
let searchParams = new URLSearchParams();
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (url: string) => { pushed.push(url); }, replace: () => {}, prefetch: () => {}, refresh: () => {} }),
  useSearchParams: () => searchParams,
}));

// Dynamically imported so the @radix-ui/react-tabs chain -- which decides
// real-vs-noop useLayoutEffect from a module-scope `globalThis?.document`
// check -- is evaluated AFTER register() has created `document`.
const ReportsClient = (await import("./ReportsClient")).default;

afterEach(() => {
  cleanup();
  pushed.length = 0;
  searchParams = new URLSearchParams();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Records every fetched URL so "zero calls to the slow route" is a fact, not an inference. */
function stubFetch(calls: string[], reportHandler?: () => Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/api/currencies")) return jsonRes({ currencies: [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true }] });
    if (url.includes("/api/reports/catalog")) return jsonRes({ catalog: [] });
    if (url.includes("/api/companies")) return jsonRes({ companies: [] });
    if (url.includes("/api/reports/")) return reportHandler ? reportHandler() : jsonRes({ projectName: "Cedar Heights Villa - Phase 1", budget: 0 });
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

describe("ReportsClient: Work Progress navigates, it is never fetched here (R67 E-04 / D-02)", () => {
  test("pressing the primary for Work Progress pushes its own screen and fetches nothing", async () => {
    const calls: string[] = [];
    stubFetch(calls);
    searchParams = new URLSearchParams({ report: "work-progress" });

    const { getByTestId } = render(<ReportsClient projectId="p-1" />);

    // The primary says what pressing it does -- this report opens a screen, it
    // does not run here.
    expect(getByTestId("reports-run").textContent).toContain("Open Report");
    fireEvent.click(getByTestId("reports-run"));

    await waitFor(() => expect(pushed.length).toBe(1));
    expect(pushed[0]).toContain("/work-progress?tab=report&projectId=p-1");
    // THE assertion this item exists for: the 24.3 s path is never touched.
    expect(calls.filter((u) => u.includes("/api/reports/work-progress"))).toHaveLength(0);
  });

  test("an unknown ?report= slug falls back to the default rather than selecting nothing", async () => {
    const calls: string[] = [];
    stubFetch(calls);
    searchParams = new URLSearchParams({ report: "not-a-report" });

    const { getByTestId } = render(<ReportsClient projectId="p-1" />);
    expect(getByTestId("reports-run").textContent).toContain("Run Report");
  });

  test("the idle prompt 'Pick a report and click Run Report.' no longer exists in this screen at all", async () => {
    const calls: string[] = [];
    stubFetch(calls);
    const { queryByText } = render(<ReportsClient projectId="p-1" />);
    expect(queryByText(/Pick a report and click Run Report/i)).toBeNull();
  });
});

describe("ReportsClient: the run lifecycle (R67 E-04)", () => {
  test("while a report runs, the panel says so with elapsed seconds and offers Cancel", async () => {
    const calls: string[] = [];
    let release: (() => void) | null = null;
    stubFetch(calls, () => new Promise<Response>((resolve) => {
      release = () => resolve(jsonRes({ projectName: "Cedar Heights Villa - Phase 1" }));
    }));

    const { getByTestId, queryByText, findByTestId } = render(<ReportsClient projectId="p-1" />);
    fireEvent.click(getByTestId("reports-run"));

    const running = await findByTestId("reports-running");
    expect(running.textContent).toContain("Running Project Status");
    expect(running.textContent).toMatch(/\d+ s/);
    expect(getByTestId("reports-cancel")).toBeDefined();
    // Never both: an idle prompt must not sit on screen while a request is in
    // flight, which is exactly what the old ranOnce-before-loading order did.
    expect(queryByText(/Pick a report and click Run Report/i)).toBeNull();

    release?.();
    await waitFor(() => expect(calls.some((u) => u.includes("/api/reports/project-status"))).toBe(true));
  });

  test("a failed run shows the BACKEND's own sentence and a Retry, not a generic apology", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({ error: "Construction is not enabled for this organisation" }, 403));

    const { getByTestId, findByTestId } = render(<ReportsClient projectId="p-1" />);
    fireEvent.click(getByTestId("reports-run"));

    const errorCard = await findByTestId("reports-error");
    expect(errorCard.textContent).toContain("Could not run Project Status:");
    expect(errorCard.textContent).toContain("Construction is not enabled for this organisation");
    expect(getByTestId("reports-retry")).toBeDefined();
  });

  test("Cancel aborts the request and returns the panel to a state that is not 'running'", async () => {
    const calls: string[] = [];
    stubFetch(calls, () => new Promise<Response>(() => { /* never resolves -- the hung report Cancel exists for */ }));

    const { getByTestId, findByTestId, queryByTestId } = render(<ReportsClient projectId="p-1" />);
    fireEvent.click(getByTestId("reports-run"));

    await findByTestId("reports-running");
    fireEvent.click(getByTestId("reports-cancel"));
    await waitFor(() => expect(queryByTestId("reports-running")).toBeNull());
  });
});
