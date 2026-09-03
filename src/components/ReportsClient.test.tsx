/// <reference types="bun-types" />
// R67 F-10 (R-134) acceptance test — the frontend half.
//
// /reports is a screen with one select and one button, and it took eight
// blocking calls to become usable. Then every Run Report was a full round trip
// with a spinner in place of the result -- including re-running the SAME report
// on the SAME project a moment later.
//
// What is pinned here is that the cache is FAST WITHOUT BEING DISHONEST:
//   * a remembered result paints immediately, and is labelled as remembered;
//   * a live run replaces it and drops the label;
//   * a FAILED live run leaves the last real answer on screen (still labelled)
//     rather than blanking a panel that had something true in it;
//   * the cache is keyed per report, so switching reports cannot show the
//     previous report's figures under the new report's name.
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

// The org-wide catalog tab makes its own unrelated calls; this file is about
// the Project Reports panel's data path.
mock.module("@/components/ReportCatalogSection", () => ({
  ReportCatalogSection: () => <div data-testid="catalog-stub" />,
}));

const ReportsClient = (await import("./ReportsClient")).default;
const { reportCacheKey, readCachedReport, writeCachedReport, clearCachedReports } =
  await import("@/lib/report-result-cache");
const { __resetCurrenciesCacheForTests } = await import("@/lib/currency");

afterEach(() => {
  cleanup();
  clearCachedReports();
  __resetCurrenciesCacheForTests();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const LIVE = { projectName: "Marina Tower", taskCount: 12 };
const CACHED = { projectName: "Marina Tower", taskCount: 7 };

function stubFetch(handler?: (url: string) => Response) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (handler) return handler(url);
    if (url.includes("/api/reports/")) return jsonRes(LIVE);
    if (url.includes("/api/currencies")) return jsonRes({ currencies: [] });
    return jsonRes({});
  }) as typeof fetch;
  return calls;
}

describe("ReportsClient — remembered results, honestly labelled", () => {
  test("a remembered result paints on mount, labelled as the last result", async () => {
    stubFetch();
    writeCachedReport(reportCacheKey("project-status", "p1"), CACHED);

    const { getByText } = render(<ReportsClient projectId="p1" />);

    await waitFor(() => expect(getByText(/Showing the last result/)).toBeDefined());
    // The remembered figure, not the live one -- nothing has been run yet.
    expect(getByText("7")).toBeDefined();
  });

  test("with nothing remembered the panel says what to do, and makes no report request", async () => {
    const calls = stubFetch();

    const { getByText } = render(<ReportsClient projectId="p1" />);

    expect(getByText("Pick a report and click Run Report.")).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.filter((u) => u.includes("/api/reports/"))).toHaveLength(0);
  });

  test("Run Report replaces the remembered figure with the live one and drops the label", async () => {
    stubFetch();
    writeCachedReport(reportCacheKey("project-status", "p1"), CACHED);

    const { getByText, queryByText } = render(<ReportsClient projectId="p1" />);
    await waitFor(() => expect(getByText("7")).toBeDefined());

    fireEvent.click(getByText("Run Report"));

    await waitFor(() => expect(getByText("12")).toBeDefined());
    expect(queryByText(/Showing the last result/)).toBeNull();
    // And the live answer is what a later visit will paint from.
    expect(readCachedReport(reportCacheKey("project-status", "p1"))).toEqual(LIVE);
  });

  test("a FAILED run leaves the last real answer on screen rather than blanking the panel", async () => {
    stubFetch((url) => (url.includes("/api/reports/") ? jsonRes({ error: "Reports are not enabled for this organisation" }, 403) : jsonRes({ currencies: [] })));
    writeCachedReport(reportCacheKey("project-status", "p1"), CACHED);

    const { getByText } = render(<ReportsClient projectId="p1" />);
    await waitFor(() => expect(getByText("7")).toBeDefined());

    fireEvent.click(getByText("Run Report"));

    // Still there, still labelled as remembered -- and NOT replaced by
    // "Could not generate this report.", which would have thrown away a true
    // figure the user was reading.
    await waitFor(() => expect(getByText(/Showing the last result/)).toBeDefined());
    expect(getByText("7")).toBeDefined();
  });

  test("the cache is keyed per report -- one report's figures can never appear under another's name", async () => {
    stubFetch();
    writeCachedReport(reportCacheKey("attendance", "p1"), { attendanceOnly: 999 });

    const { getByText, queryByText } = render(<ReportsClient projectId="p1" />);

    // project-status is the default selection and has nothing remembered.
    expect(getByText("Pick a report and click Run Report.")).toBeDefined();
    expect(queryByText("999")).toBeNull();
  });

  test("a report run for one project is never shown for another", async () => {
    stubFetch();
    writeCachedReport(reportCacheKey("project-status", "p1"), CACHED);

    const { getByText } = render(<ReportsClient projectId="p2" />);

    expect(getByText("Pick a report and click Run Report.")).toBeDefined();
  });
});
