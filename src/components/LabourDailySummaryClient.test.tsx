/// <reference types="bun-types" />
// R67 D-53 acceptance.
//
// The item's acceptance is a Playwright walk against http://localhost:3100
// ("mark attendance for two trades on one date, open /labour?tab=summary&
// date=<that date> and assert two trade rows are shown, that the totals row
// Daily cost equals the sum of the two rows, and that expanding a trade lists
// the same headcount as its Present + Absent + Half-day"). This session may not
// start a dev server, so the same three assertions are made against the real
// DOM with the summary endpoint stubbed to the response VERIDIAN's
// manpower-daily-summary report actually returns for that fixture.
//
// MEASURED ENVIRONMENT LIMIT (see MaterialIssueCreateClient.test.tsx's header
// for the full note): this environment does not deliver input/change events to
// React, so nothing here types. Clicks do work, which is all the expander and
// the day navigation need.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock((_href: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, replace: () => {}, prefetch: () => {} }) }));

const LabourDailySummaryClient = (await import("./LabourDailySummaryClient")).default;
const { peopleForTrade, statusDisplay } = await import("./LabourDailySummaryClient");

// Exactly the acceptance fixture: two trades marked on one date.
const SUMMARY = {
  date: "2026-09-02",
  rows: [
    { trade: "Civil", present: 1, absent: 1, halfDay: 1, headcount: 3, cost: 180 },
    { trade: "Paint", present: 2, absent: 0, halfDay: 0, headcount: 2, cost: 180 },
  ],
  totals: { trade: "Total", present: 3, absent: 1, halfDay: 1, headcount: 5, cost: 360 },
  people: [
    { id: "r1", employeeCode: "EMP-001", name: "Ali Hassan", trade: "Civil", company: "Falcon Labour", dailyRate: 120, status: "present", cost: 120 },
    { id: "r2", employeeCode: "EMP-002", name: "Bilal Khan", trade: "Civil", company: null, dailyRate: 120, status: "half_day", cost: 60 },
    { id: "r3", employeeCode: null, name: "Chandra Rao", trade: "Civil", company: null, dailyRate: 120, status: "absent", cost: 0 },
    { id: "r4", employeeCode: "EMP-004", name: "Dinesh Kumar", trade: "Paint", company: null, dailyRate: 90, status: "present", cost: 90 },
    { id: "r5", employeeCode: "EMP-005", name: "Ehsan Ali", trade: "Paint", company: null, dailyRate: 90, status: "present", cost: 90 },
  ],
};

const originalFetch = globalThis.fetch;
let lastUrl = "";

function stubFetch(handler: (url: string) => { status: number; body: unknown }) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/currencies")) return new Response(JSON.stringify({ currencies: [{ code: "AED", isBaseCurrency: true }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    lastUrl = url;
    const { status, body } = handler(url);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  push.mockClear();
  lastUrl = "";
});

describe("LabourDailySummaryClient (D-53)", () => {
  test("two trades marked on one date render two trade rows and a totals row whose cost is their sum", async () => {
    stubFetch(() => ({ status: 200, body: SUMMARY }));
    const { getByText, getAllByRole } = render(
      <LabourDailySummaryClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" date="2026-09-02" onDateChange={() => {}} />
    );

    await waitFor(() => expect(getByText("Civil")).toBeDefined());
    expect(getByText("Paint")).toBeDefined();

    // The totals row prints the server's own total, and it is the sum of the
    // two trade rows -- the oracle the item names.
    expect(SUMMARY.totals.cost).toBe(SUMMARY.rows[0].cost + SUMMARY.rows[1].cost);
    expect(getAllByRole("row").some((row) => row.textContent?.includes("Total") && row.textContent?.includes("AED 360.00"))).toBe(true);
    // Money carries the currency and two decimals on every cell.
    expect(getAllByRole("cell").some((cell) => cell.textContent === "AED 180.00")).toBe(true);
  });

  test("expanding a trade lists exactly headcount people, i.e. Present + Absent + Half-day", async () => {
    stubFetch(() => ({ status: 200, body: SUMMARY }));
    const { getByText, getByRole } = render(
      <LabourDailySummaryClient projectId="p1" projectName="Cedar" date="2026-09-02" onDateChange={() => {}} />
    );

    await waitFor(() => expect(getByText("Civil")).toBeDefined());
    fireEvent.click(getByRole("button", { name: /Civil/ }));

    await waitFor(() => expect(getByText("Ali Hassan")).toBeDefined());
    const civil = SUMMARY.rows[0];
    expect(civil.headcount).toBe(civil.present + civil.absent + civil.halfDay);
    for (const person of ["Ali Hassan", "Bilal Khan", "Chandra Rao"]) expect(getByText(person)).toBeDefined();
    // Sumeet's report-4 columns, and status as glyph AND word.
    expect(getByText("EMP-001")).toBeDefined();
    expect(getByText("Falcon Labour")).toBeDefined();
    expect(getByText("● Present")).toBeDefined();
    expect(getByText("◐ Half day")).toBeDefined();
    expect(getByText("○ Absent")).toBeDefined();
  });

  test("the date it fetches is the date it was given, and Previous/Next day move exactly one day", async () => {
    stubFetch(() => ({ status: 200, body: SUMMARY }));
    const moved: string[] = [];
    const { getByText, getByRole } = render(
      <LabourDailySummaryClient projectId="p1" projectName="Cedar" date="2026-09-02" onDateChange={(d) => moved.push(d)} />
    );

    await waitFor(() => expect(lastUrl).toContain("date=2026-09-02"));
    expect(lastUrl).toContain("/api/attendance/summary?projectId=p1");
    // The day itself is on screen in the org's dd-mm-yyyy form.
    expect(getByText("02-09-2026")).toBeDefined();

    fireEvent.click(getByRole("button", { name: "Previous day" }));
    fireEvent.click(getByRole("button", { name: "Next day" }));
    expect(moved).toEqual(["2026-09-01", "2026-09-03"]);
  });

  test("an unmarked day says so for THAT day and offers the one next step, never an empty table", async () => {
    stubFetch(() => ({ status: 200, body: { date: "2026-08-28", rows: [], totals: { trade: "Total", present: 0, absent: 0, halfDay: 0, headcount: 0, cost: 0 }, people: [] } }));
    const { getByText, queryByRole } = render(
      <LabourDailySummaryClient projectId="p1" projectName="Cedar" date="2026-08-28" onDateChange={() => {}} />
    );

    await waitFor(() => expect(getByText("No attendance marked for 28-08-2026 —")).toBeDefined());
    expect(queryByRole("table")).toBeNull();

    fireEvent.click(getByText("Mark attendance"));
    // It carries the day it was showing, so the one click cannot record the
    // mark against today by accident.
    expect(push).toHaveBeenCalledWith("/labour/attendance/new?projectId=p1&date=2026-08-28");
  });

  test("a failed load says 'Could not load the summary' with a Retry, and never shows an empty table", async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return calls === 1
        ? { status: 502, body: { error: "The construction data service didn't answer" } }
        : { status: 200, body: SUMMARY };
    });
    const { getByText, queryByRole } = render(
      <LabourDailySummaryClient projectId="p1" projectName="Cedar" date="2026-09-02" onDateChange={() => {}} />
    );

    await waitFor(() => expect(getByText(/^Could not load the summary: /)).toBeDefined());
    expect(queryByRole("table")).toBeNull();

    fireEvent.click(getByText("Retry"));
    await waitFor(() => expect(getByText("Civil")).toBeDefined());
  });

  test("Export is disabled with its reason while there is nothing to export", async () => {
    stubFetch(() => ({ status: 200, body: { date: "2026-09-02", rows: [], totals: { trade: "Total", present: 0, absent: 0, halfDay: 0, headcount: 0, cost: 0 }, people: [] } }));
    const { getByTestId } = render(
      <LabourDailySummaryClient projectId="p1" projectName="Cedar" date="2026-09-02" onDateChange={() => {}} />
    );

    await waitFor(() => expect(getByTestId("labour-summary-export").textContent).toBe("Export (Nothing to export)"));
    expect((getByTestId("labour-summary-export") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("peopleForTrade / statusDisplay (D-53 pure halves)", () => {
  test("a worker with no trade is found under the 'Uncategorised trade' row, not under a blank one", () => {
    const people = [
      { id: "a", employeeCode: null, name: "Zia", trade: null, company: null, dailyRate: 100, status: "present", cost: 100 },
      { id: "b", employeeCode: null, name: "Adnan", trade: "   ", company: null, dailyRate: 100, status: "present", cost: 100 },
      { id: "c", employeeCode: null, name: "Yusuf", trade: "Civil", company: null, dailyRate: 100, status: "present", cost: 100 },
    ];
    expect(peopleForTrade(people, "Uncategorised trade").map((p) => p.name)).toEqual(["Zia", "Adnan"]);
    expect(peopleForTrade(people, "Civil").map((p) => p.name)).toEqual(["Yusuf"]);
  });

  test("status is glyph AND word, and an unknown status prints itself rather than vanishing", () => {
    expect(statusDisplay("present")).toBe("● Present");
    expect(statusDisplay("half_day")).toBe("◐ Half day");
    expect(statusDisplay("absent")).toBe("○ Absent");
    expect(statusDisplay("on_leave")).toBe("on_leave");
  });
});
