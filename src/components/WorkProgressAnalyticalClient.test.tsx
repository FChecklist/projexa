/// <reference types="bun-types" />
// R67 E-24 (R-210). The item's own acceptance clauses, as a render test:
// EXACTLY ONE "Filter" and EXACTLY ONE "Export" on the screen (the nested
// ScreenFrame used to put two of each there), and both "Logged %" and
// "Earned %" labelled on the chart.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), refresh: mock(() => {}), replace: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/work-progress",
}));

import { cleanup, render, waitFor } from "@testing-library/react";
import WorkProgressAnalyticalClient from "./WorkProgressAnalyticalClient";

const ENTRIES = [
  { id: "e1", activityId: "a1", boqLineItemId: "l1", entryDate: "2026-08-25", quantityDone: "10", percentComplete: "60", entryBasis: "DELTA", remarks: null },
];
const ACTIVITIES = [{ id: "a1", name: "Blockwork", categoryId: "c1" }];
const CATEGORY_PROGRESS = { categories: [{ categoryId: "c1", name: "Civil", percentComplete: 60 }] };
const WPR = {
  rows: [{ lineItemId: "l1", code: "1.1", description: "Blockwork 200mm" }],
  byCategory: [{ name: "Civil", percentage: { total: 0 } }],
};

/** `holdReport` keeps the slow second round trip pending, which is the state the split load exists for. */
function stubFetch({ holdReport = false }: { holdReport?: boolean } = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/work-progress/report")) {
      if (holdReport) return new Promise<Response>(() => {});
      return new Response(JSON.stringify(WPR), { status: 200 });
    }
    if (url.includes("/api/work-progress/activities")) return new Response(JSON.stringify({ activities: ACTIVITIES }), { status: 200 });
    if (url.includes("/api/work-progress")) return new Response(JSON.stringify({ entries: ENTRIES }), { status: 200 });
    if (url.includes("/api/reports/category-progress")) return new Response(JSON.stringify(CATEGORY_PROGRESS), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function occurrences(text: string, needle: string) {
  return text.split(needle).length - 1;
}

describe("WorkProgressAnalyticalClient", () => {
  test("exactly ONE Filter and ONE Export control -- the nested frame is gone", async () => {
    stubFetch();
    const { container } = render(<WorkProgressAnalyticalClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("Civil"));
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent ?? "");
    expect(buttons.filter((t) => t.includes("Filter"))).toHaveLength(1);
    expect(buttons.filter((t) => t.includes("Export"))).toHaveLength(1);
  });

  test("both measures are labelled on the chart", async () => {
    stubFetch();
    const { container } = render(<WorkProgressAnalyticalClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("Civil"));
    expect(occurrences(container.textContent ?? "", "Logged %")).toBeGreaterThan(0);
    expect(occurrences(container.textContent ?? "", "Earned %")).toBeGreaterThan(0);
  });

  test("both figures are printed beside their bars", async () => {
    stubFetch();
    const { container } = render(<WorkProgressAnalyticalClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("60%"));
    expect(container.textContent).toContain("0%");
  });

  test("when the measures disagree in the way that has a fix, the screen names the fix", async () => {
    stubFetch();
    const { container } = render(<WorkProgressAnalyticalClient projectId="p1" />);
    await waitFor(() =>
      expect(container.textContent).toContain(
        "Logged progress is not yet linked to BOQ lines, so earned value is 0% - link entries to BOQ lines when recording progress."
      )
    );
  });

  test("the table renders on the FAST round trip, without waiting for the BOQ read", async () => {
    stubFetch({ holdReport: true });
    const { container } = render(<WorkProgressAnalyticalClient projectId="p1" />);
    // The entry row is on screen while the report call is still pending...
    await waitFor(() => expect(container.textContent).toContain("Blockwork"));
    // ...and the BOQ line shows its REFERENCE, not a claim that it has none.
    expect(container.textContent).toContain("l1");
    expect(container.textContent).not.toContain("Blockwork 200mm");
  });

  test("the BOQ line description fills in when the slower read returns", async () => {
    stubFetch();
    const { container } = render(<WorkProgressAnalyticalClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("1.1 -- Blockwork 200mm"));
  });

  test("both KPI tags are selectable, and the chosen one is marked", async () => {
    stubFetch();
    const { container, getByRole } = render(<WorkProgressAnalyticalClient projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("Civil"));
    // The kit's KpiTag carries the selection itself (`selected`), so there is
    // exactly one button per tag -- not a button wrapped in a button.
    const logged = getByRole("button", { name: /Logged %/ });
    const earned = getByRole("button", { name: /Earned %/ });
    expect(logged.className).toContain("border-ct-teal");
    expect(earned.className).not.toContain("border-ct-teal");
  });
});
