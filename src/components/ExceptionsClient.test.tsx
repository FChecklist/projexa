/// <reference types="bun-types" />
// Sumeet requirement (new): the 28-item exceptions report, real UI over a
// mocked /api/exceptions, same convention as BudgetsClient.test.tsx.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// Real drill-down navigation (fixed 2026-09-21) -- same next/navigation
// router mock convention AttendanceSheetClient.test.tsx/BillingMilestonesClient.test.tsx
// already use, so these tests can assert the REAL target route.push() was
// called with, not just that a click handler exists.
const push: string[] = [];
mock.module("next/navigation", () => ({ useRouter: () => ({ push: (url: string) => { push.push(url); }, prefetch: () => {} }) }));

const ExceptionsClient = (await import("./ExceptionsClient")).default;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderClient(checks: unknown[]) {
  globalThis.fetch = (async () => jsonRes({ checks })) as typeof fetch;
  return render(<ExceptionsClient projectId="proj-1" />);
}

afterEach(() => {
  cleanup();
  push.length = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

const CLEAR_CHECK = { item: 1, title: "Extra work done, never captured", flagged: false, count: 0, records: [], formula: "Diary vs progress entry" };
const FLAGGED_CHECK = { item: 5, title: "Approvals stuck", flagged: true, count: 1, records: [{ id: "co1", detail: "CO-1 pending 10 days", recordType: "change_order" }], formula: "Change order pending_approval past the threshold" };

describe("ExceptionsClient", () => {
  test("all-clear project shows the honest all-clear summary", async () => {
    const { getByText } = renderClient([CLEAR_CHECK]);
    await waitFor(() => expect(getByText(/all 1 checks are clear/)).toBeDefined());
  });

  test("a flagged check shows the real count in the summary and its own badge", async () => {
    const { getAllByText, getByText } = renderClient([CLEAR_CHECK, FLAGGED_CHECK]);
    await waitFor(() =>
      expect(getAllByText((_, node) => node?.textContent === "1 of 2 checks are flagged on this project.").length).toBeGreaterThan(0)
    );
    expect(getByText("1 flagged")).toBeDefined();
    expect(getByText("Clear")).toBeDefined();
  });

  test("clicking a flagged check expands its real records", async () => {
    const { getByText } = renderClient([FLAGGED_CHECK]);
    await waitFor(() => expect(getByText(/Approvals stuck/)).toBeDefined());
    fireEvent.click(getByText(/Approvals stuck/));
    await waitFor(() => expect(getByText("CO-1 pending 10 days")).toBeDefined());
  });

  test("a failed load shows the real error, not a silent blank screen", async () => {
    globalThis.fetch = (async () => jsonRes({ error: "No organisation on this account" }, 400)) as typeof fetch;
    const { getByText } = render(<ExceptionsClient projectId="proj-1" />);
    await waitFor(() => expect(getByText(/No organisation on this account/)).toBeDefined());
  });

  // Regression coverage for a real bug (fixed 2026-09-21): this component
  // used to have ZERO Link/href/onClick navigation from a flagged record to
  // the real record it names, despite the record id already being in the
  // payload -- see this file's own header comment. Each test below drives a
  // REAL click and asserts the REAL route.push() target, for a record type
  // that DOES have a real object screen and one (#20/#26, a bare date, not a
  // record) that deliberately does not.
  describe("drill-down navigation", () => {
    test("clicking a change-order record navigates to its real object screen", async () => {
      const { getByText } = renderClient([FLAGGED_CHECK]);
      await waitFor(() => expect(getByText(/Approvals stuck/)).toBeDefined());
      fireEvent.click(getByText(/Approvals stuck/));
      const recordButton = await waitFor(() => getByText("CO-1 pending 10 days"));
      fireEvent.click(recordButton);
      expect(push).toEqual(["/change-orders/co1"]);
    });

    test("a material-issue record navigates using linkId (the MATERIAL id), not the issue's own id", async () => {
      const check = {
        item: 18, title: "Material ordered without scope of work and BOQ", flagged: true, count: 1,
        records: [{ id: "issue-1", detail: "Material issued 2026-09-01 (qty 10) with no BOQ line recorded", recordType: "material_issue", linkId: "mat-42" }],
        formula: "Material issue with no boqLineItemId recorded",
      };
      const { getByText } = renderClient([check]);
      await waitFor(() => expect(getByText(/Material ordered without scope/)).toBeDefined());
      fireEvent.click(getByText(/Material ordered without scope/));
      const recordButton = await waitFor(() => getByText(/Material issued 2026-09-01/));
      fireEvent.click(recordButton);
      expect(push).toEqual(["/materials/mat-42"]);
    });

    test("a merged #24 check (fixed off-by-one) navigates each record to ITS OWN correct screen -- snag vs interim bill", async () => {
      const check = {
        item: 24, title: "Snags lost, retention held", flagged: true, count: 2,
        records: [
          { id: "snag-1", detail: 'Snag #1 ("Paint touch-up") was due 2026-08-01 and is still not verified closed', recordType: "punch_list_item" },
          { id: "bill-1", detail: "Interim bill #3 still holds 500 retention, despite every snag on this project being verified closed", recordType: "interim_bill" },
        ],
        formula: "Overdue snags OR retention held despite snags closed",
      };
      const { getByText } = renderClient([check]);
      await waitFor(() => expect(getByText(/Snags lost, retention held/)).toBeDefined());
      fireEvent.click(getByText(/Snags lost, retention held/));
      fireEvent.click(await waitFor(() => getByText(/Paint touch-up/)));
      expect(push).toEqual(["/punch-list/snag-1"]);
      fireEvent.click(await waitFor(() => getByText(/Interim bill #3/)));
      expect(push).toEqual(["/punch-list/snag-1", "/invoices?highlight=bill-1"]);
    });

    test("a missing-daily-report record (#20/#26, a bare date -- not a real record) renders plain text, no dead link", async () => {
      const check = {
        item: 20, title: "The daily report never arrives", flagged: true, count: 1,
        records: [{ id: "2026-09-01", detail: "No site diary filed for 2026-09-01", recordType: "date" }],
        formula: "A calendar day with no site diary filed",
      };
      const { getByText } = renderClient([check]);
      await waitFor(() => expect(getByText(/The daily report never arrives/)).toBeDefined());
      fireEvent.click(getByText(/The daily report never arrives/));
      const recordText = await waitFor(() => getByText("No site diary filed for 2026-09-01"));
      expect(recordText.tagName).toBe("LI"); // plain text, not a <button>
      expect(recordText.querySelector("button")).toBeNull(); // no fabricated dead link
      fireEvent.click(recordText);
      expect(push).toEqual([]); // no navigation fired
    });
  });
});
