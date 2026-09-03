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
  // A test that overrode the breakup must not leak it into the next one -- the
  // suite runs in one process and in file order.
  breakupResponse = defaultBreakupResponse;
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
    // R67 E-11: the Category and Vendor selects are populated from the org's
    // real lists, so the card cannot offer a category nobody uses.
    if (url.includes("/api/scope/categories")) return jsonRes({ categories: [{ id: "cat-1", name: "Civil" }, { id: "cat-2", name: "Paint" }] });
    if (url.includes("/api/vendors")) return jsonRes({ vendors: [{ id: "v-1", vendorName: "Alpha Contracting" }] });
    // R67 E-12: the Project Status document's rows come from the budget-variance
    // report, fetched alongside the run -- a separate answer, so this stub gives
    // it one rather than handing it the report's own payload.
    if (url.includes("/api/reports/budget-variance")) return breakupResponse();
    if (url.includes("/api/reports/")) return reportHandler ? reportHandler() : jsonRes({ projectName: "Cedar Heights Villa - Phase 1", budget: 0 });
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

/** The BOQ budget breakup the Project Status document prints, overridable per test. */
const defaultBreakupResponse: () => Promise<Response> | Response = () =>
  jsonRes({
    boqId: "b-1",
    totalBudget: 6240,
    lines: [
      { lineItemId: "l-1", boqId: "b-1", isRootLine: true, category: "Civil", code: "1.1", description: "Excavation", budget: 4320, vendorName: "Alpha Contracting", vendorAmount: 4500 },
      { lineItemId: "l-2", boqId: "b-1", isRootLine: true, category: "Paint", code: "2.1", description: "Emulsion", budget: 1920, vendorName: null, vendorAmount: null },
    ],
  });

let breakupResponse: () => Promise<Response> | Response = defaultBreakupResponse;

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
    // R67 E-11 changed this line: projectStatusReport(ctx, projectId) takes no
    // dates, so captioning the run "01 Jan to 02 Sep 2026" claimed a period the
    // report does not apply. The period IS still sent and still in the URL --
    // the caption now says what the run really covers.
    expect(title.textContent).toContain("whole project to date");
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

  test("Export offers all three server-rendered formats once there is a result (R67 E-12)", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({ projectName: "Cedar Heights Villa - Phase 1" }));
    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    await findByTestId("reports-title-block");
    // Real links into the relay, not disabled stubs: PROJEXA gains no PDF or
    // XLSX library, VERIDIAN builds the bytes from the same schema.
    for (const [format, expected] of [
      ["pdf", "/api/reports/project-status/export?projectId=p-1&format=pdf"],
      ["xlsx", "/api/reports/project-status/export?projectId=p-1&format=xlsx"],
      ["csv", "/api/reports/project-status/export?projectId=p-1&format=csv"],
    ] as const) {
      const button = await findByTestId(`reports-export-${format}`);
      expect(button.querySelector("a")?.getAttribute("href") ?? button.getAttribute("href")).toBe(expected);
    }
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

// ---------------------------------------------------------------------------
// R67 E-11 (R-130): the parameter card
// ---------------------------------------------------------------------------
describe("ReportsClient: the parameter card (R67 E-11)", () => {
  test("ACCEPTANCE: with the rail on All projects the primary is disabled and reads exactly 'Run Report (select a project)'", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({}));

    const { findByTestId, getByText } = render(<ReportsClient projectId={null} />);
    const trigger = getByText("Project Reports");
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);

    const primary = await findByTestId("reports-run");
    // The accessible name of a button with an icon and a label is its text.
    expect(primary.textContent).toBe("Run Report (select a project)");
    expect(primary.hasAttribute("disabled")).toBe(true);
    // ...and nothing was fetched: the guard is real, not just visual.
    expect(calls.filter((u) => u.includes("/api/reports/project-status"))).toHaveLength(0);
  });

  test("ACCEPTANCE: the weekly report with no week start reads exactly 'Run Report (Week Start)'", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({}));
    searchParams = new URLSearchParams({ report: "weekly-project", projectId: "p-1" });

    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);
    const primary = await findByTestId("reports-run");
    expect(primary.textContent).toBe("Run Report (Week Start)");
    expect(primary.hasAttribute("disabled")).toBe(true);
    expect(calls.filter((u) => u.includes("/api/reports/weekly-project"))).toHaveLength(0);
  });

  test("a week start that is not a Monday is reported AT the field, and blocks the run", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({}));
    // 02 Sep 2026 is a Wednesday.
    searchParams = new URLSearchParams({ report: "weekly-project", projectId: "p-1", weekStart: "2026-09-02" });

    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);
    expect((await findByTestId("reports-week-start-error")).textContent).toBe("Week Start must be a Monday");
    expect((await findByTestId("reports-run")).hasAttribute("disabled")).toBe(true);
  });

  test("the project chip names the project and says where it is changed, so the card and the rail cannot disagree", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({ projectName: "Cedar Heights Villa - Phase 1" }));

    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);
    expect((await findByTestId("reports-project-chip")).textContent).toBe(
      "Project: Cedar Heights Villa - Phase 1 — change in the top rail"
    );
  });

  test("the description under the select changes with the selection, and is prose rather than a slug", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({ projectName: "Cedar Heights Villa - Phase 1" }));
    searchParams = new URLSearchParams({ report: "work-progress", projectId: "p-1" });

    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);
    expect((await findByTestId("reports-description")).textContent).toBe(
      "Work Progress: quantities and amounts done per BOQ line, previous / this period / to date."
    );
  });

  test("a report the period does not touch says so at the field, instead of leaving two dates that do nothing", async () => {
    const calls: string[] = [];
    stubFetch(calls, () => new Promise<Response>(() => { /* held open so the card stays on screen */ }));

    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);
    expect((await findByTestId("reports-period-note")).textContent).toBe(
      "Project Status covers the whole project — the From and To dates are not applied to it."
    );
  });

  test("a Category chosen for a report whose handler does not filter is applied here, and the total is left alone", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({
      total: 1000,
      rows: [
        { category: "Civil", amount: 600 },
        { category: "Paint", amount: 400 },
      ],
    }));
    searchParams = new URLSearchParams({ report: "category-progress", projectId: "p-1", category: "Civil" });

    const { findByText, queryByText } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);
    await findByText("Civil");
    expect(queryByText("Paint")).toBeNull();
    // The filter really did reach the backend too -- it is forwarded, then
    // applied here only because this handler ignores it.
    expect(calls.some((u) => u.includes("category=Civil"))).toBe(true);
  });

  test("a filter with no field to bite on leaves every row AND says why", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({ rows: [{ trade: "Mason", workerDays: 4 }] }));
    searchParams = new URLSearchParams({ report: "category-progress", projectId: "p-1", category: "Civil" });

    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);
    expect((await findByTestId("reports-filter-note")).textContent).toBe(
      'This report carries no category "Civil" — every row is shown.'
    );
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

// ---------------------------------------------------------------------------
// R67 E-12 (R-136): one report document, its exports and its share
// ---------------------------------------------------------------------------
describe("ReportsClient: the report document (R67 E-12)", () => {
  test("the Project Status run renders the schema's document, not the payload's keys", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({ projectName: "Cedar Heights Villa - Phase 1", contractValue: 475000 }));
    const { findByTestId, container } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    await findByTestId("report-document-title");
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["Category", "Code", "Description", "Budget (AED)", "Vendor", "Vendor amount (AED)"]);
    // The breakup came from the budget-variance report, fetched ALONGSIDE the
    // run rather than behind a second click.
    expect(calls.some((u) => u.includes("/api/reports/budget-variance?projectId=p-1"))).toBe(true);
  });

  test("the document's rows are not ALSO dumped as raw keys by the generic renderer", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes({ projectName: "Cedar Heights Villa - Phase 1" }));
    const { findByTestId, container } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    await findByTestId("report-document-title");
    // One table of lines, with schema headers -- not a second one headed
    // "lineItemId", "boqId", "isRootLine".
    expect(container.textContent).not.toContain("lineItemId");
    expect(container.textContent).not.toContain("isRootLine");
  });

  test("when the rows do not add up to the stated total, Export is disabled WITH that sentence", async () => {
    const calls: string[] = [];
    breakupResponse = () =>
      jsonRes({
        boqId: "b-1",
        // The report claims 6,120; its own rows add to 6,240.
        totalBudget: 6120,
        lines: [
          { lineItemId: "l-1", boqId: "b-1", isRootLine: true, category: "Civil", code: "1.1", description: "Excavation", budget: 4320, vendorName: "Alpha", vendorAmount: 4500 },
          { lineItemId: "l-2", boqId: "b-1", isRootLine: true, category: "Paint", code: "2.1", description: "Emulsion", budget: 1920, vendorName: null, vendorAmount: null },
        ],
      });
    stubFetch(calls, async () => jsonRes({ projectName: "Cedar Heights Villa - Phase 1" }));
    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    expect((await findByTestId("report-totals-banner")).textContent).toContain("Totals do not tie (difference AED 120.00)");
    expect((await findByTestId("reports-export-xlsx")).hasAttribute("disabled")).toBe(true);
    expect((await findByTestId("reports-export-reason")).textContent).toBe("Totals do not tie (difference AED 120.00)");
  });

  test("Share mints a REAL public link and WhatsApp carries the title and that link", async () => {
    const calls: string[] = [];
    const written: string[] = [];
    const opened: string[] = [];
    stubFetch(calls, async () => jsonRes({ projectName: "Cedar Heights Villa - Phase 1" }));
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/share")) {
        calls.push(url);
        return jsonRes({ url: "http://localhost/share/report/tok-1", expiresAt: "2026-09-10" }, 201);
      }
      return inner(input, init);
    }) as typeof fetch;
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => { written.push(t); } },
    });
    globalThis.open = ((url: string) => { opened.push(url); return null; }) as typeof globalThis.open;

    const { findByTestId, getByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);
    await findByTestId("report-document-title");

    fireEvent.click(getByTestId("reports-share"));
    await waitFor(() => expect(written).toContain("http://localhost/share/report/tok-1"));
    expect(calls.some((u) => u.includes("/api/reports/project-status/share"))).toBe(true);

    fireEvent.click(getByTestId("reports-whatsapp"));
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toStartWith("https://wa.me/?text=");
    expect(decodeURIComponent(opened[0])).toContain("http://localhost/share/report/tok-1");
  });
});

// ---------------------------------------------------------------------------
// R67 E-13 (R-131 / R-138): the Project Status card
// ---------------------------------------------------------------------------
describe("ReportsClient: the Project Status card (R67 E-13)", () => {
  const PAYLOAD = {
    projectId: "cm3x9k2p40001abcd1234wxyz",
    projectName: "Cedar Heights Villa - Phase 1",
    contractValue: 475000,
    projectValue: 475000,
    budget: 6240,
    ledgerBudget: 0,
    revenue: 0,
    expenses: 6500,
    earnedValue: null,
    percentByValue: 62,
    progressPercent: 41,
    taskCount: 12,
    delayedTaskCount: 3,
    photoCount: 8,
  };

  test("ONE money format on the card -- the three that used to sit side by side are gone", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes(PAYLOAD));
    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    expect((await findByTestId("project-status-contractValue")).textContent).toBe("AED 475,000");
    expect((await findByTestId("project-status-expenses")).textContent).toBe("AED 6,500");
    expect((await findByTestId("project-status-revenue")).textContent).toBe("AED 0");
  });

  test("an absent figure is the en dash carrying 'not recorded', never a zero", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes(PAYLOAD));
    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    const earned = await findByTestId("project-status-earnedValue");
    expect(earned.textContent).toBe("–");
    expect(earned.getAttribute("title")).toBe("not recorded");
  });

  test("the two progress figures are relabelled and carry the reason they disagree", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes(PAYLOAD));
    const { findByTestId, container } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    await findByTestId("project-status-percentByValue");
    expect(container.textContent).toContain("% complete (by BOQ value)");
    expect(container.textContent).toContain("% complete (by activity log)");
    expect(container.textContent).toContain("differs because activity logs are not weighted by BOQ value");
    // Neither camelCase key survives as a label.
    expect(container.textContent).not.toContain("percentByValue");
    expect(container.textContent).not.toContain("progressPercent");
  });

  test("the project's raw cuid is NOT printed on the card -- it stays in the URL, where it is an address", async () => {
    const calls: string[] = [];
    stubFetch(calls, async () => jsonRes(PAYLOAD));
    const { findByTestId, container } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    await findByTestId("project-status-card");
    expect((await findByTestId("project-status-card")).textContent).not.toContain(PAYLOAD.projectId);
  });

  test("a project with no BOQ budget lines gets a next step, not a blank table", async () => {
    const calls: string[] = [];
    breakupResponse = () => jsonRes({ boqId: null, totalBudget: null, lines: [] });
    stubFetch(calls, async () => jsonRes(PAYLOAD));
    const { findByTestId } = render(<ReportsClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    const empty = await findByTestId("report-empty");
    expect(empty.textContent).toContain("No budget lines yet — set budgets on the BOQ screen");
    expect(empty.querySelector("a")?.getAttribute("href")).toBe("/scope");
  });
});

// ---------------------------------------------------------------------------
// R67 E-14 (R-132 / R-139): the Full Catalog agrees with Project Reports
// ---------------------------------------------------------------------------
describe("ReportsClient: the Full Catalog and the picker are one screen (R67 E-14)", () => {
  const CATALOG = [
    // A construction report the picker really runs, reached by its ROUTE's last
    // segment -- which is what makes the two surfaces agree about one report.
    { id: "att", name: "Attendance Report", description: "Present/absent by trade", domain: "construction", route: "/api/construction/reports/attendance", routeNote: "", directlyNavigable: false, source: "static", status: "built" },
    // The Work Progress Report, which has a screen of its own (D-02).
    { id: "wpr", name: "Work Progress Report", description: "Quantities and amounts done per BOQ line", domain: "construction", route: "/work-progress?tab=report", routeNote: "", directlyNavigable: true, source: "static", status: "built" },
    // A report PROJEXA genuinely cannot render.
    { id: "gst", name: "GST Reconciliation", description: "GSTR-2B vs purchase register", domain: "ERP", route: "/erp/reports/gst", routeNote: "", directlyNavigable: false, source: "static", status: "built" },
    { id: "def", name: "Custom Margin Analysis", description: "A report_definitions row", domain: "custom", route: "/reports/definitions/def", routeNote: "", directlyNavigable: false, source: "definition", definitionId: "def", status: "built" },
  ];

  function stubWithCatalog(calls: string[]) {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      if (url.includes("/api/currencies")) return jsonRes({ currencies: [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true }] });
      if (url.includes("/api/reports/catalog")) return jsonRes({ catalog: CATALOG });
      if (url.includes("/api/companies")) return jsonRes({ companies: [] });
      if (url.includes("/api/scope/categories")) return jsonRes({ categories: [] });
      if (url.includes("/api/vendors")) return jsonRes({ vendors: [] });
      if (url.includes("/api/reports/budget-variance")) return breakupResponse();
      if (url.includes("/api/reports/")) return jsonRes({ projectName: "Cedar Heights Villa - Phase 1" });
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch;
  }

  async function openCatalog(projectId: string | null = "p-1") {
    const view = render(<ReportsClient projectId={projectId} projectName="Cedar Heights Villa - Phase 1" />);
    const trigger = view.getByText("Full Catalog");
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    await view.findByTestId("catalog-header-sentence");
    return view;
  }

  test("ACCEPTANCE: no card whose title matches a picker entry says 'Not yet viewable here'", async () => {
    const calls: string[] = [];
    stubWithCatalog(calls);
    const { container } = await openCatalog();
    // The phrase is gone from the component entirely, in both directions.
    expect(container.textContent).not.toContain("Not yet viewable here");
  });

  test("ACCEPTANCE: the 'Work Progress Report' card exposes a way in, and it is D-02's own destination", async () => {
    const calls: string[] = [];
    stubWithCatalog(calls);
    const { findByTestId } = await openCatalog();
    const open = await findByTestId("catalog-open-link");
    expect(open.getAttribute("href")).toContain("/work-progress?tab=report&projectId=p-1");
  });

  test("a picker report opens IN the Project Reports tab, preselected and already running", async () => {
    const calls: string[] = [];
    stubWithCatalog(calls);
    const { findByTestId, getByTestId } = await openCatalog();

    fireEvent.click(getByTestId("catalog-open-in-project-reports"));
    // The tab really switched, and the handed-over report really ran.
    await waitFor(() => expect(calls.some((u) => u.includes("/api/reports/attendance?projectId=p-1"))).toBe(true));
    expect((await findByTestId("reports-title-block")).textContent).toContain("Attendance Report");
  });

  test("a report PROJEXA cannot render names the surface that CAN, instead of only saying no", async () => {
    const calls: string[] = [];
    stubWithCatalog(calls);
    const { findByTestId, getByTestId } = await openCatalog();
    // ERP lives behind the closed disclosure; open it the way a reader would.
    const details = getByTestId("catalog-other-domains") as HTMLDetailsElement;
    details.open = true;
    expect((await findByTestId("catalog-not-available")).textContent).toContain(
      "Not available in PROJEXA yet — runs on the VERIDIAN dashboard"
    );
  });

  test("construction is the default view and everything else is ONE closed disclosure", async () => {
    const calls: string[] = [];
    stubWithCatalog(calls);
    const { getByTestId, container } = await openCatalog();
    const details = getByTestId("catalog-other-domains") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("Other platform reports (2)");
    // The header counts what is really in the catalog, never a typed number.
    // Both construction entries run here: attendance through the picker, the
    // WPR on its own screen. The number is counted, never typed.
    expect(getByTestId("catalog-header-sentence").textContent).toBe(
      "2 construction reports — 2 run here with your project; the rest run on the VERIDIAN dashboard."
    );
    expect(container.textContent).not.toContain("Run this report");
  });

  test("the 'Engine' badge is renamed to the fact a reader needs, wherever it is true", async () => {
    const calls: string[] = [];
    stubWithCatalog(calls);
    const { getByTestId, getAllByTestId, findByTestId } = await openCatalog();
    (getByTestId("catalog-other-domains") as HTMLDetailsElement).open = true;
    // Two cards carry it -- the picker report and the engine definition -- and
    // both say the same thing, which is the point.
    const badges = getAllByTestId("catalog-engine-badge");
    expect(badges.length).toBeGreaterThan(1);
    for (const badge of badges) expect(badge.textContent).toBe("Runs here");
    expect((await findByTestId("catalog-run-report")).textContent).toContain("Run Report");
  });
});
