/// <reference types="bun-types" />
// R67 D-31 (R-090). THE FAULT: the trade-wise attendance numbers existed only
// in VERIDIAN's report catalogue, which PROJEXA renders as a read-only "Not yet
// viewable here" card -- so a site manager asking "how many people are on site
// today" got three answers and no screen. These render the real panel and
// assert what a user actually sees: that it is populated without pressing
// anything, that the grand total is there, and that a summary whose own
// aggregates disagree cannot be exported.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard PayrollClient.test.tsx documents.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

mock.module("@/lib/currency", () => ({
  currencyLabel: () => "AED ",
  useCurrencies: () => [],
}));

const AttendanceSummaryPanel = (await import("./AttendanceSummaryPanel")).default;
const { RECONCILIATION_BANNER, RECONCILIATION_EXPORT_REASON } = await import("@/lib/attendance-summary");

afterEach(() => {
  cleanup();
  requestedUrls.length = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

const requestedUrls: string[] = [];

const SUMMARY = {
  projectId: "proj-1",
  from: "2026-09-03",
  to: "2026-09-03",
  rows: [
    { trade: "Electrician", present: 4, halfDay: 2, absent: 0, workerDays: 5, cost: 750 },
    { trade: "Mason", present: 12, halfDay: 0, absent: 1, workerDays: 12, cost: 1440 },
  ],
  totals: { present: 16, halfDay: 2, absent: 1, workerDays: 17, cost: 2190 },
  headcount: 18,
  reconciliation: { ties: true, rowCountFromStatuses: 19, rowCountFromTrades: 19, costFromStatuses: 2190, costFromTrades: 2190 },
};

function mount(summary: unknown = SUMMARY) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    requestedUrls.push(url);
    return new Response(JSON.stringify(summary), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return render(<AttendanceSummaryPanel projectId="proj-1" />);
}

describe("AttendanceSummaryPanel (R67 D-31)", () => {
  test("loads on mount -- the panel is populated by pressing nothing", async () => {
    const { findByText } = mount();
    expect(await findByText(/people on site/)).toBeDefined();
    expect(requestedUrls.some((u) => u.startsWith("/api/attendance/summary?projectId=proj-1"))).toBe(true);
  });

  test("defaults to today: the loaded window is a single day, not a month", async () => {
    mount();
    await waitFor(() => expect(requestedUrls.length).toBeGreaterThan(0));
    const url = new URL(requestedUrls[0], "https://example.test");
    expect(url.searchParams.get("from")).toBe(url.searchParams.get("to"));
  });

  test("shows the headline sentence in the required form", async () => {
    const { findByText } = mount();
    expect(await findByText("18 people on site — Electrician 6 · Mason 12")).toBeDefined();
  });

  test("renders every required column and a grand-total row", async () => {
    const { findByText, getByText, container } = mount();
    await findByText("Electrician");
    for (const header of ["Trade", "Present", "Half day", "Absent", "Worker-days", "Cost"]) {
      expect(getByText(header)).toBeDefined();
    }
    expect(getByText("Total")).toBeDefined();
    // A real zero is a zero, and money carries the org currency.
    expect((container.textContent ?? "").includes("AED 2,190.00")).toBe(true);
  });

  test("a window with no attendance says so, and BOTH exports are disabled carrying the reason", async () => {
    const { findByText, getByRole, getAllByRole } = mount({
      ...SUMMARY, rows: [], totals: { present: 0, halfDay: 0, absent: 0, workerDays: 0, cost: 0 }, headcount: 0,
    });
    expect(await findByText("Nobody on site in this window")).toBeDefined();
    expect((getByRole("button", { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(true);
    // The reason is VISIBLE text beside the word, on both exports, not a
    // tooltip a mouse has to find.
    const withReason = getAllByRole("button").filter((b) => (b.textContent ?? "").includes("Nothing to export")) as HTMLButtonElement[];
    expect(withReason).toHaveLength(2);
    expect(withReason.every((b) => b.disabled)).toBe(true);
  });

  test("when the per-trade rows do not sum to the totals, a banner says so and BOTH exports are disabled with that reason", async () => {
    const { findByText, getAllByRole } = mount({
      ...SUMMARY,
      reconciliation: { ties: false, rowCountFromStatuses: 19, rowCountFromTrades: 20, costFromStatuses: 2190, costFromTrades: 2280 },
    });
    expect(await findByText(RECONCILIATION_BANNER)).toBeDefined();
    const disabledExports = getAllByRole("button")
      .filter((b) => (b.textContent ?? "").includes(RECONCILIATION_EXPORT_REASON)) as HTMLButtonElement[];
    expect(disabledExports).toHaveLength(2);
    expect(disabledExports.every((b) => b.disabled)).toBe(true);
  });

  test("a failed load shows the backend's own words with a Retry, never an empty table", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "The construction data service didn't answer" }), {
        status: 502, headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const { findByText, findByRole } = render(<AttendanceSummaryPanel projectId="proj-1" />);
    expect(await findByText(/The construction data service didn't answer/)).toBeDefined();
    expect(await findByRole("button", { name: /Retry/ })).toBeDefined();
  });
});
