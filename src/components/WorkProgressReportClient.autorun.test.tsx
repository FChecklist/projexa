/// <reference types="bun-types" />
// R67 E-03 (R-072/R-073/R-076/R-077), implementing binding decision D-02: the
// Work Progress Report RUNS ON ARRIVAL. Correction C-04 records the defect
// being fixed -- "Pick a date range and click Run Report." was shown over a
// range that was already filled, so reaching the report cost three clicks the
// screen had every parameter to avoid.
//
// This is the item's own acceptance, run for real: mount with tab=report and a
// fetch stub whose rows all carry FALSE touched flags, assert the report fetch
// fired with no click, that "No progress recorded between" is rendered, and
// that every money cell carries the org currency.
//
// A separate file from WorkProgressReportClient.test.tsx on purpose: that one
// renders markup through react-dom/server and must not have a DOM installed
// under it, while this one needs a real one to run effects.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- guarded, like every other happy-dom suite here.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
// NOT `screen`: @testing-library/dom binds its queries to document.body at
// MODULE-EVALUATION time, and this file's static imports are hoisted above
// GlobalRegistrator.register(), so `screen` would capture a document that does
// not exist yet. render()'s own returned queries are bound per render, after
// the DOM exists, which is why every query below comes from there.

// The component reads and WRITES the URL (the parameters are the state), so
// both hooks have to exist before it is imported. `replace` is captured so the
// "writes the resolved parameters back" behaviour can be asserted rather than
// assumed.
const replaced: string[] = [];
const pushed: string[] = [];
const searchParams = new URLSearchParams({ tab: "report", projectId: "p-1" });
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => { pushed.push(url); },
    replace: (url: string) => { replaced.push(url); },
    prefetch: () => {},
    refresh: () => {},
  }),
  useSearchParams: () => searchParams,
}));

// Dynamically imported so this module -- and its transitive
// @radix-ui/react-tabs chain, which decides real-vs-noop useLayoutEffect from
// a module-scope `globalThis?.document` check -- is evaluated AFTER
// GlobalRegistrator.register() has created `document`. Same reason
// ProcurementClient.test.tsx documents for its own dynamic import.
const WorkProgressReportClient = (await import("./WorkProgressReportClient")).default;

afterEach(() => {
  cleanup();
  replaced.length = 0;
  pushed.length = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Every line item untouched in every bucket -- the exact fixture the acceptance names. */
const UNTOUCHED_ROW = {
  lineItemId: "l-1", code: "1.01", description: "Partition wall", categoryName: "Partitions",
  unit: "Sqm", rate: 108, qtyTotal: 472, amtTotal: 50976, parentLineItemId: null,
  qty: { prev: 0, current: 0, total: 0, balance: 472 },
  amt: { prev: 0, current: 0, total: 0, balance: 50976 },
  percentage: { prev: 0, current: 0, total: 0, balance: 100 },
  touched: { prev: false, current: false, total: false },
};

const REPORT = {
  boqTitle: "Tower B Fit-out", boqId: "boq-1",
  availableBoqs: [{ id: "boq-1", title: "Tower B Fit-out", status: "approved", version: 2 }],
  rows: [UNTOUCHED_ROW],
  byCategory: [{ name: "Partitions", amtTotal: 50976, amt: { prev: 0, current: 0, total: 0, balance: 50976 }, percentage: { prev: 0, current: 0, total: 0, balance: 100 } }],
  byManpower: [], byVendor: [], availableCategories: ["Partitions"],
};

/** Records every URL the component asks for, so "it fired with no click" is a fact rather than an inference. */
function stubFetch(calls: string[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/api/currencies")) return jsonRes({ currencies: [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true }] });
    if (url.includes("/api/work-progress/report")) return jsonRes(REPORT);
    if (url.includes("/api/work-progress?")) return jsonRes({ entries: [{ entryDate: "2026-01-15" }, { entryDate: "2026-03-02" }] });
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

describe("WorkProgressReportClient runs on arrival (R67 E-03 / D-02)", () => {
  test("the report fetch fires with NO click, and the idle prompt is gone from the product", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { queryByText } = render(<WorkProgressReportClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    await waitFor(() => expect(calls.some((u) => u.includes("/api/work-progress/report"))).toBe(true));
    // The sentence correction C-04 is about must not exist anywhere on screen.
    expect(queryByText(/Pick a date range and click Run Report/i)).toBeNull();
  });

  test("the From date comes from the EARLIEST recorded entry, not the 1st of the month", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    render(<WorkProgressReportClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    await waitFor(() => expect(calls.some((u) => u.includes("/api/work-progress/report"))).toBe(true));
    const reportCall = calls.find((u) => u.includes("/api/work-progress/report"))!;
    expect(reportCall).toContain("from=2026-01-15");
  });

  test("the resolved parameters are written BACK into the URL, so the run is shareable", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    render(<WorkProgressReportClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    await waitFor(() => expect(replaced.length).toBeGreaterThan(0));
    const url = replaced[0];
    expect(url).toContain("/work-progress?");
    expect(url).toContain("tab=report");
    expect(url).toContain("projectId=p-1");
    expect(url).toContain("from=2026-01-15");
    expect(url).toContain("view=scope");
    // replace, not push: the reader did not navigate, so Back must still leave
    // the screen rather than undoing a parameter they never chose.
    expect(pushed).toHaveLength(0);
  });

  test("rows with nothing recorded say so in words, above a table that stays visible", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { findByTestId, getByTestId } = render(<WorkProgressReportClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    const notice = await findByTestId("wpr-no-progress");
    expect(notice.textContent).toContain("No progress recorded between");
    // The table is STILL THERE -- a QS needs the line items even when no
    // progress was logged; hiding them would answer a different question.
    expect(getByTestId("grand-total-row")).toBeDefined();
  });

  test("every money cell carries the org currency -- 'AED 50,976.00', never a bare number", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { findByTestId, getAllByTestId } = render(<WorkProgressReportClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    await findByTestId("grand-total-row");
    await waitFor(() => {
      const cells = [
        ...getAllByTestId("rate"),
        ...getAllByTestId("amt-total"),
        ...getAllByTestId("grand-total-amount"),
      ].map((el) => el.textContent ?? "");
      expect(cells.length).toBeGreaterThan(0);
      for (const text of cells) expect(text.startsWith("AED ")).toBe(true);
    });
  });

  test("the caption names the range, the BOQ revision and the third-column choice", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { findByTestId } = render(<WorkProgressReportClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    const caption = await findByTestId("wpr-caption");
    expect(caption.textContent).toContain("Showing 15 Jan 2026");
    expect(caption.textContent).toContain("BOQ Tower B Fit-out v2");
    expect(caption.textContent).toContain("Third column: Total");
  });

  test("the PO Qty column -- the BOQ quantity every progress figure is read against -- is present with no further click", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { findByTestId, getByText, getAllByTestId } = render(<WorkProgressReportClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    await findByTestId("grand-total-row");
    expect(getByText("PO Qty")).toBeDefined();
    expect(getAllByTestId("po-qty")[0].textContent).toBe("472");
  });

  // R67 E-18 (R-178): the five header buttons became ONE Export word-button
  // with a menu, shared with every other report screen. Export PDF is inside
  // it, and it is a real href into the relay -- PROJEXA has no PDF library.
  test("Export is enabled once a report has run, and its menu carries PDF, XLSX and CSV", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { findByTestId, getByTestId } = render(<WorkProgressReportClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />);

    await findByTestId("grand-total-row");
    const exportButton = getByTestId("export-menu-button") as HTMLButtonElement;
    expect(exportButton.disabled).toBe(false);

    exportButton.click();
    const pdf = await findByTestId("export-pdf");
    expect(pdf.getAttribute("href")).toContain("/api/work-progress/report/pdf?projectId=p-1");
    // R67 E-20 (R-208): the XLSX, over VERIDIAN's own rowsToXLSXBuffer.
    expect(getByTestId("export-xlsx").getAttribute("href")).toContain("/api/work-progress/report/xlsx?projectId=p-1");
    // The CSV stays client-built from the rows on screen -- a button, not a link.
    expect(getByTestId("export-csv").tagName).toBe("BUTTON");
  });

  // R67 E-20 (R-209): every Code links to the LINE, naming the revision.
  test("a Code links to /scope?boqId=...#line-<id>, not merely to the BOQ screen", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { findByTestId, getAllByTestId } = render(<WorkProgressReportClient projectId="p-1" />);
    await findByTestId("grand-total-row");

    const href = getAllByTestId("scope-code-link")[0].getAttribute("href") ?? "";
    expect(href).toContain("/scope?projectId=p-1");
    expect(href).toContain("boqId=");
    expect(href).toMatch(/#line-.+$/);
  });

  // R67 E-20 (R-209): the legend under the table, in words.
  test("the table carries a legend saying what Previous, Current and the third column mean", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { findByTestId } = render(<WorkProgressReportClient projectId="p-1" />);
    const legend = await findByTestId("scope-table-legend");
    expect(legend.textContent).toContain("Previous = done before");
    expect(legend.textContent).toContain("Total = everything done to date");
  });

  // R67 E-17 (R-175): the period is named chips, and the grey line says which.
  test("the period renders as named chips with one lit, and the grey line names the window", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { findByTestId, getByTestId, queryByTestId } = render(<WorkProgressReportClient projectId="p-1" />);
    await findByTestId("grand-total-row");

    expect(getByTestId("wpr-period-chips")).toBeDefined();
    expect(getByTestId("wpr-period-line").textContent).toContain("Showing ");
    expect(getByTestId("wpr-period-line").textContent).toContain("Change dates");
    // The two date fields are NOT sitting there by default -- Custom... reveals
    // them. (This fixture's window is "since first entry", which is a preset.)
    expect(queryByTestId("wpr-custom-dates")).toBeNull();
    (getByTestId("wpr-period-custom") as HTMLButtonElement).click();
    expect(await findByTestId("wpr-custom-dates")).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // R67 E-20 (R-194/R-208/R-209/R-223) ACCEPTANCE, all three clauses in one
  // test because the item states them as one arrival: open the report's URL
  // and, WITH NO CLICK, a row renders, the idle prompt is absent, and a
  // control offering the PDF is on screen.
  //
  // The Playwright half (a real browser at :3100 against the demo project) is
  // not run here -- this worktree starts no dev server, per the programme's
  // own rules -- but every clause it asserts is asserted here against the real
  // component and a real DOM.
  // -------------------------------------------------------------------------
  test("ACCEPTANCE: arriving at the report URL renders a row, no idle prompt, and an Export offering PDF -- with no click", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { findByTestId, getByTestId, queryByText } = render(
      <WorkProgressReportClient projectId="p-1" projectName="Cedar Heights Villa - Phase 1" />
    );

    // 1. At least one report row, without pressing anything.
    const grandTotal = await findByTestId("grand-total-row");
    expect(grandTotal).toBeDefined();
    expect(getByTestId("po-qty").textContent).toBe("472");

    // 2. The sentence correction C-04 is about is gone from the product.
    expect(queryByText(/Pick a date range and click Run Report/i)).toBeNull();

    // 3. A control that offers the PDF. After item E-18 that is ONE Export
    //    button with the formats inside it and named in its accessible text --
    //    a second "Export PDF" button beside it would rebuild the row R-178
    //    exists to remove.
    const exportButton = getByTestId("export-menu-button");
    expect(exportButton.textContent).toContain("Export PDF");
    expect((exportButton as HTMLButtonElement).disabled).toBe(false);

    // ...and the PDF really goes to the relay that reaches VERIDIAN's
    // generateWorkProgressReportPdf, carrying the parameters this run used.
    (exportButton as HTMLButtonElement).click();
    const pdf = await findByTestId("export-pdf");
    expect(pdf.getAttribute("href")).toContain("/api/work-progress/report/pdf");
    expect(pdf.getAttribute("href")).toContain("projectId=p-1");
    expect(pdf.getAttribute("href")).toContain("from=2026-01-15");
    // The XLSX sits beside it, over VERIDIAN's own rowsToXLSXBuffer -- PROJEXA
    // builds neither format itself.
    expect((await findByTestId("export-xlsx")).getAttribute("href")).toContain("/api/work-progress/report/xlsx");
  });

  // R67 E-20 (R-209): every item code links to the LINE, not just to the screen.
  test("each Code is a link carrying the BOQ revision and the line's own fragment", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { findByTestId } = render(<WorkProgressReportClient projectId="p-1" />);
    const link = await findByTestId("scope-code-link");
    expect(link.getAttribute("href")).toBe("/scope?projectId=p-1&boqId=boq-1#line-l-1");
  });

  // R67 E-17 (R-175): Table | Chart, and the chart is a sorted bar list.
  test("the output toggle offers a sorted horizontal bar chart, never a pie", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const { findByTestId, getByTestId, queryByTestId } = render(<WorkProgressReportClient projectId="p-1" />);
    await findByTestId("grand-total-row");

    expect(queryByTestId("sorted-bar-list")).toBeNull();
    (getByTestId("wpr-output-chart") as HTMLButtonElement).click();
    expect(await findByTestId("sorted-bar-list")).toBeDefined();
    // The table is gone while the chart is up; the grand total belongs to the table.
    expect(queryByTestId("grand-total-row")).toBeNull();
  });
});
