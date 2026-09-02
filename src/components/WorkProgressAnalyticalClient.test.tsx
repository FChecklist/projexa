/// <reference types="bun-types" />
// R67 D-29. The item's own acceptance, verbatim: "with the /api/scope stub
// rejecting, assert a control named 'Retry' is rendered and that the KPI tag
// values are absent while the table status is loading."
//
// The defect being held closed: load() awaited four reads with no catch and set
// loading=false on the last line of the happy path, so a rejecting /api/scope
// left the table on "Loading…" for the rest of the session -- while the KPI tags
// above it were already showing figures derived from the reads that HAD
// succeeded.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
// `screen` binds to document.body at module init, before the registrator above
// has run under bun -- every query here comes from render()'s return value.
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
mock.module("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

const mod = await import("./WorkProgressAnalyticalClient");
const WorkProgressAnalyticalClient = mod.default;
const { KPI_CAPTION } = mod;

const ENTRY = {
  id: "e1",
  activityId: "a1",
  boqLineItemId: "l1",
  entryDate: "2026-08-14",
  quantityDone: "12",
  percentComplete: "40",
  entryBasis: "quantity",
  remarks: null,
};

const realFetch = globalThis.fetch;

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** Every read answers, except the ones named in `failing`. */
function stub(options: { failing?: string[]; hangEntries?: boolean } = {}) {
  const failing = options.failing ?? [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (failing.some((f) => url.includes(f))) {
      return new Response(JSON.stringify({ error: "The construction data service did not respond in time" }), {
        status: 504,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/api/work-progress/activities")) return ok({ activities: [{ id: "a1", name: "Blockwork", categoryId: "c1" }] });
    if (url.includes("/api/work-progress")) {
      if (options.hangEntries) return new Promise<Response>(() => {}) as unknown as Response;
      return ok({ entries: [ENTRY] });
    }
    if (url.includes("/api/reports/category-progress")) return ok({ categories: [{ categoryId: "c1", name: "Structure", percentComplete: 40 }] });
    if (url.includes("/api/scope/")) return ok({ lineItems: [{ id: "l1", itemCode: "1.1", description: "Blockwork" }] });
    if (url.includes("/api/scope")) return ok({ boqs: [{ id: "b1", version: 1, status: "approved" }] });
    return ok({});
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  stub();
  try {
    window.sessionStorage.clear();
  } catch {
    // ListScreen keeps its sort/page state here; a clean slate per test.
  }
});

afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = realFetch;
});

describe("WorkProgressAnalyticalClient -- R67 D-29", () => {
  test("THE ACCEPTANCE (half 1): a rejecting /api/scope produces a Retry, not a table stuck on 'Loading…'", async () => {
    stub({ failing: ["/api/scope"] });
    const view = render(<WorkProgressAnalyticalClient projectId="p1" />);

    await waitFor(() => expect(view.getByRole("button", { name: "Retry" })).toBeTruthy());
    // The backend's own words, and the consequence stated -- not a bare failure.
    expect(view.getByText(/Could not load the BOQ line names/)).toBeTruthy();
    // ...and the table is NOT withheld: the BOQ only supplies one column's
    // labels, so the entries that did arrive still render.
    expect(view.getByText("Blockwork")).toBeTruthy();
  });

  test("THE ACCEPTANCE (half 2): no KPI figure is on screen while the read behind it is still running", () => {
    stub({ hangEntries: true });
    const view = render(<WorkProgressAnalyticalClient projectId="p1" />);

    expect(view.queryByText("Total entries")).toBeNull();
    expect(view.queryByText("Avg % Complete (Activity Log)")).toBeNull();
    expect(view.getByText("Working out the figures…")).toBeTruthy();
    // The table says it is loading by SHOWING the shape of what is coming.
    expect(view.container.querySelector("[aria-busy='true']")).toBeTruthy();
    expect(view.getByText("% complete")).toBeTruthy();
  });

  test("once the reads succeed the figures appear, with the caption that says how they differ", async () => {
    const view = render(<WorkProgressAnalyticalClient projectId="p1" />);

    await waitFor(() => expect(view.getByText("Total entries")).toBeTruthy());
    expect(view.getByText("Categories")).toBeTruthy();
    expect(view.getByText(KPI_CAPTION)).toBe(
      view.getByText("Avg % is a flat average of entries; the bar is value-weighted per category")
    );
  });

  test("the entries' own failure DOES withhold the table, with the reason inside the entries card", async () => {
    stub({ failing: ["/api/work-progress?"] });
    const view = render(<WorkProgressAnalyticalClient projectId="p1" />);

    await waitFor(() => expect(view.getByText("Could not load live data")).toBeTruthy());
    expect(view.getByText(/Could not load progress entries/)).toBeTruthy();
    // Never a confident empty state over a failed read.
    expect(view.queryByText("No progress entries logged yet.")).toBeNull();
    expect(view.queryByText("Total entries")).toBeNull();
  });

  test("Filter and Export appear ONCE on this screen, not once per nested frame", async () => {
    const view = render(<WorkProgressAnalyticalClient projectId="p1" />);
    await waitFor(() => expect(view.getByText("Total entries")).toBeTruthy());

    expect(view.getAllByRole("button", { name: /^Filter/ })).toHaveLength(1);
    expect(view.getAllByRole("button", { name: /^Export/ })).toHaveLength(1);
  });
});
