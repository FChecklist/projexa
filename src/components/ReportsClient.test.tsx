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
/** R67 E-09: the panel writes the run back into the URL -- recorded so "addressable" is a fact. */
const replacedUrls: string[] = [];
// The selected report is part of the URL (?report=), which is what makes a run
// addressable -- and what lets this test select one without driving a Radix
// listbox, which does not open under happy-dom (probed: the shadcn Select
// renders no native <select> to change).
let searchParams = new URLSearchParams();
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (url: string) => { pushed.push(url); }, replace: (url: string) => { replacedUrls.push(url); }, prefetch: () => {}, refresh: () => {} }),
  useSearchParams: () => searchParams,
}));

// Dynamically imported so the @radix-ui/react-tabs chain -- which decides
// real-vs-noop useLayoutEffect from a module-scope `globalThis?.document`
// check -- is evaluated AFTER register() has created `document`.
const ReportsClient = (await import("./ReportsClient")).default;
const { ShellMessageProvider, ShellMessageStrip } = await import("./shell/shell-messages");

afterEach(() => {
  cleanup();
  pushed.length = 0;
  replacedUrls.length = 0;
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

describe("ReportsClient: the run lifecycle (R67 E-04, extended by E-10)", () => {
  test("while a report runs, the panel names the report AND the project, counts the seconds, and does NOT yet offer Cancel", async () => {
    const calls: string[] = [];
    let release: (() => void) | null = null;
    stubFetch(calls, () => new Promise<Response>((resolve) => {
      release = () => resolve(jsonRes({ projectName: "Cedar Heights Villa - Phase 1" }));
    }));

    const { queryByText, queryByTestId, findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    // R67 E-10: the report runs ON ARRIVAL -- no click.
    const running = await findByTestId("reports-running");
    expect(running.textContent).toContain("Running Project Status for Cedar Heights Villa - Phase 1... usually 2-3 s");
    expect(running.textContent).toMatch(/\d+ s/);
    // R67 E-10 CHANGED THIS: Cancel is revealed only after 5 s. Before that it
    // is noise on a run that is behaving normally.
    expect(queryByTestId("reports-cancel")).toBeNull();
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

  test("after 5 s of a hung run, Cancel appears and aborts it", async () => {
    const calls: string[] = [];
    stubFetch(calls, () => new Promise<Response>(() => { /* never resolves -- the hung report Cancel exists for */ }));

    const { findByTestId, queryByTestId } = render(<ReportsClient projectId="p-1" />);
    await findByTestId("reports-running");

    // Real time, deliberately: CANCEL_VISIBLE_AFTER_MS is a product promise
    // about what a reader sees after five seconds, and a faked clock would
    // prove the constant rather than the behaviour.
    const cancel = await findByTestId("reports-cancel", {}, { timeout: 9000 });
    fireEvent.click(cancel);
    await waitFor(() => expect(queryByTestId("reports-running")).toBeNull());
  }, 20000);
});

// ---------------------------------------------------------------------------
// R67 E-09 (R-128) + E-10 (R-129/R-133/R-137)
// ---------------------------------------------------------------------------
describe("ReportsClient: a run is addressable (R67 E-09)", () => {
  test("ACCEPTANCE: a URL that names a run renders the result with NO click, under a title block that names it", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({ projectName: "Cedar Heights Villa - Phase 1", budget: 2193.75 }));
    searchParams = new URLSearchParams({ report: "project-status", projectId: "p-1", from: "2026-01-01", to: "2026-09-02" });

    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    const title = await findByTestId("reports-title-block");
    expect(title.textContent).toContain("Project Status Report · Cedar Heights Villa - Phase 1");
    expect(title.textContent).toContain("01 Jan to 02 Sep 2026");
    expect(title.textContent).toMatch(/run \d{2}:\d{2}/);
    // The run really did happen, with the URL's own period.
    const call = calls.find((u) => u.includes("/api/reports/project-status"))!;
    expect(call).toContain("from=2026-01-01");
    expect(call).toContain("to=2026-09-02");
  });

  test("running writes the run back into the URL, so Back returns to the same run", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({ projectName: "Cedar Heights Villa - Phase 1" }));
    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);
    await findByTestId("reports-title-block");
    expect(replacedUrls.length).toBeGreaterThan(0);
    expect(replacedUrls[0]).toContain("report=project-status");
    expect(replacedUrls[0]).toContain("projectId=p-1");
  });

  test("Export offers CSV once there is a result, and says in words why PDF is not offered yet", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({ projectName: "Cedar Heights Villa - Phase 1" }));
    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    await findByTestId("reports-title-block");
    expect((await findByTestId("reports-export-csv")).hasAttribute("disabled")).toBe(false);
    const pdf = await findByTestId("reports-export-pdf");
    expect(pdf.hasAttribute("disabled")).toBe(true);
    expect((await findByTestId("reports-export-pdf-reason")).textContent).toBe("PDF export not yet available");
  });

  test("an unknown ?report= slug says so, and still selects a real report rather than a dead screen", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({ projectName: "Cedar Heights Villa - Phase 1" }));
    searchParams = new URLSearchParams({ report: "not-a-report" });

    const { findByTestId, getByTestId } = render(<ReportsClient projectId="p-1" />);
    expect((await findByTestId("reports-unknown-slug")).textContent).toBe("This report does not exist. Choose one from the list.");
    // The parameter card folds away once a run succeeds; Filter reopens it,
    // and the primary is the real, selectable default -- not nothing.
    fireEvent.click(getByTestId("reports-filter"));
    expect((await findByTestId("reports-run")).textContent).toContain("Run Report");
  });

  test("with no project in the rail, the screen says what to DO, at the control that does it", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({}));
    // With no project the screen opens on the Full Catalog, which needs none;
    // the sentence lives on the tab that DOES need one, which is where a
    // reader who goes looking for a project report will read it.
    const { findByTestId, getByText } = render(<ReportsClient projectId={null} />);
    const trigger = getByText("Project Reports");
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect((await findByTestId("reports-no-project")).textContent).toBe("Select a project in the top rail to run project reports.");
  });
});

describe("ReportsClient: the failure lives somewhere that does not vanish (R67 E-10)", () => {
  test("a failed run renders the backend's own sentence AND publishes it to the shell's message area", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({ error: "Construction is not enabled for this organisation" }, 403));

    const { findByTestId } = render(
      <ShellMessageProvider>
        <ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />
        <ShellMessageStrip />
      </ShellMessageProvider>
    );

    const errorCard = await findByTestId("reports-error");
    expect(errorCard.textContent).toContain("Could not run Project Status: Construction is not enabled for this organisation");

    // R-133: not a toast. It is still on screen, in the shell, with no timer
    // able to take it away.
    const strip = await findByTestId("shell-message-strip");
    expect(strip.textContent).toContain("Could not run Project Status: Construction is not enabled for this organisation");
  });

  test("a failure that comes back as a CODE is spoken as a sentence, never as the token (D-03)", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({ error: "PROJECT_REQUIRED" }, 400));

    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);
    const errorCard = await findByTestId("reports-error");
    expect(errorCard.textContent).toContain("Pick a project");
    expect(errorCard.textContent).not.toContain("PROJECT_REQUIRED");
  });

  test("a re-run keeps the last good result on screen, dimmed, instead of blanking it", async () => {
    const calls: string[] = [];
    let hold: (() => void) | null = null;
    let firstDone = false;
    stubFetch(calls, () => {
      if (!firstDone) {
        firstDone = true;
        return Promise.resolve(jsonRes({ projectName: "Cedar Heights Villa - Phase 1", budget: 2193.75 }));
      }
      return new Promise<Response>((resolve) => { hold = () => resolve(jsonRes({ projectName: "Cedar Heights Villa - Phase 1" })); });
    });

    const { findByTestId, getByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);
    await findByTestId("reports-title-block");

    // Re-run: the parameter card folded away after the first success, so Filter
    // is how a reader gets back to the primary -- which is the item's own
    // "Filter reopens the parameter card".
    fireEvent.click(getByTestId("reports-filter"));
    fireEvent.click(getByTestId("reports-run"));

    const previous = await findByTestId("reports-previous-result");
    expect(previous.className).toContain("opacity-50");
    hold?.();
  });
});
