/// <reference types="bun-types" />
// R67 MERGE (lane D1's D-29 x lane D0's D-55/D-65 and lane F2's F-24).
//
// THIS FILE WAS NOT A MERGE CONFLICT, AND THAT IS WHY IT NEEDED REWRITING.
// git auto-merged it -- main never touched it -- so it arrived intact,
// asserting a component that no longer exists. Three of its five tests were
// pinned to lane D1's own implementation rather than to D-29's requirement:
//
//   * "a rejecting /api/scope produces a Retry" and the "Could not load the BOQ
//     line names" sentence. There is no /api/scope read on this screen any
//     more. F-24 (compliance-tracker #1579) made VERIDIAN send activityName /
//     boqItemCode / boqDescription WITH each entry, so the two scope calls that
//     existed only to translate one column are gone -- which is a stronger
//     answer to D-29's third defect ("the table waited on the BOQ") than
//     reordering the awaits was. A test that a removed request fails gracefully
//     is a test of nothing.
//   * "no KPI figure is on screen while the read behind it is still running",
//     asserting the tag LABELS are absent. The merged screen keeps every label
//     in place and renders the VALUE as an en-dash until a 200 established it
//     (metricLabel(), unit-tested in src/lib/pane-state.test.ts). D-29's actual
//     requirement is that a figure is never minted from a read that has not
//     answered, and the en-dash satisfies it without the tag row changing size
//     under the reader. Restated as: the value is an en-dash, never a number.
//
// D-29's other two findings are asserted below exactly as the item asked, and
// both are things main did NOT have -- they are what lane D1 folded in:
// ONE Filter and ONE Export on a screen that had two of each, and the caption
// that says the two figures beside each other are measured differently.
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
  boqItemCode: "1.1",
  boqDescription: "Blockwork",
  activityName: "Blockwork",
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
function stub(options: { failing?: string[] } = {}) {
  const failing = options.failing ?? [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (failing.some((f) => url.includes(f))) {
      return new Response(JSON.stringify({ error: "The construction data service did not respond in time" }), {
        status: 504,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/api/work-progress/activities")) {
      return ok({ activities: [{ id: "a1", name: "Blockwork", categoryId: "c1" }] });
    }
    if (url.includes("/api/work-progress")) return ok({ entries: [ENTRY] });
    if (url.includes("/api/reports/category-progress")) {
      return ok({ categories: [{ categoryId: "c1", name: "Structure", percentComplete: 40 }] });
    }
    return ok({});
  }) as unknown as typeof fetch;
}

/** The value rendered beside a KPI tag's label. */
function kpiValue(container: HTMLElement, label: string): string | null {
  const labelEl = [...container.querySelectorAll("div")].find((d) => d.textContent === label);
  return labelEl?.nextElementSibling?.textContent ?? null;
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
  test("once the reads succeed the figures appear, with the caption that says how they differ", async () => {
    const view = render(<WorkProgressAnalyticalClient projectId="p1" />);

    await waitFor(() => expect(kpiValue(view.container, "Total entries")).toBe("1"));
    expect(kpiValue(view.container, "Categories")).toBe("1");
    expect(kpiValue(view.container, "Avg % Complete (Activity Log)")).toBe("40%");
    expect(view.getByText(KPI_CAPTION)).toBe(
      view.getByText("Avg % is a flat average of entries; the bar is value-weighted per category")
    );
  });

  test("THE ACCEPTANCE, restated: a figure is never minted from a read that has not answered", async () => {
    stub({ failing: ["/api/work-progress?"] });
    const view = render(<WorkProgressAnalyticalClient projectId="p1" />);

    // PaneState states a failure twice on purpose -- once in the card and once
    // in the persistent band below it, so the reason survives after the pane
    // scrolls out of view. Both are expected; neither is the assertion.
    await waitFor(() => expect(view.getAllByText(/Couldn't load progress entries/).length).toBeGreaterThan(0));
    // The two entry-derived figures are en-dashes, NOT zeroes. This is the
    // defect D-29 and R-002/R-019 both name: "Total entries 0" over a 504 is a
    // false statement, and worse than a false empty list because a number
    // carries no hint that anything was ever asked for.
    expect(kpiValue(view.container, "Total entries")).toBe("—");
    expect(kpiValue(view.container, "Avg % Complete (Activity Log)")).toBe("—");
    // The category read succeeded, so ITS figure is real -- one failed read
    // does not blank the tags that another read established.
    expect(kpiValue(view.container, "Categories")).toBe("1");
  });

  test("the entries' own failure DOES withhold the table, with the reason and a Retry inside the pane", async () => {
    stub({ failing: ["/api/work-progress?"] });
    const view = render(<WorkProgressAnalyticalClient projectId="p1" />);

    // PaneState states a failure twice on purpose -- once in the card and once
    // in the persistent band below it, so the reason survives after the pane
    // scrolls out of view. Both are expected; neither is the assertion.
    await waitFor(() => expect(view.getAllByText(/Couldn't load progress entries/).length).toBeGreaterThan(0));
    // The backend's own words survive under the dictionary's sentence.
    expect(view.container.textContent).toContain("The construction data service did not respond in time");
    expect(view.getAllByRole("button", { name: /Retry/ }).length).toBeGreaterThan(0);
    // Never a confident empty state over a failed read.
    expect(view.queryByText("No progress entries logged yet.")).toBeNull();
  });

  test("the CHART's failure does not take the table down with it", async () => {
    stub({ failing: ["/api/reports/category-progress"] });
    const view = render(<WorkProgressAnalyticalClient projectId="p1" />);

    // The entries arrived, so the table renders and its figures are real...
    await waitFor(() => expect(kpiValue(view.container, "Total entries")).toBe("1"));
    // ...while the chart says what happened to its own read, and the figure
    // that depends on it stays an en-dash.
    expect(view.container.textContent).toContain("Couldn't load the category breakdown");
    expect(kpiValue(view.container, "Categories")).toBe("—");
  });

  test("a failed ACTIVITY lookup is reported without withholding anything, and offers a Retry", async () => {
    // R67 D-29's fourth finding, folded onto the merged read: the activity
    // lookup is not fatal -- the rows carry their own activity name now -- but
    // a lookup that failed SILENTLY is how a row renders a raw id with nothing
    // on screen admitting a read failed.
    stub({ failing: ["/api/work-progress/activities"] });
    const view = render(<WorkProgressAnalyticalClient projectId="p1" />);

    await waitFor(() => expect(view.container.textContent).toContain("Activity names may show as ids below"));
    // The table is NOT withheld: the entries answered.
    expect(kpiValue(view.container, "Total entries")).toBe("1");
    expect(view.getAllByRole("button", { name: /Retry/ }).length).toBeGreaterThan(0);
  });

  test("Filter and Export appear ONCE on this screen, not once per nested frame", async () => {
    const view = render(<WorkProgressAnalyticalClient projectId="p1" />);
    await waitFor(() => expect(kpiValue(view.container, "Total entries")).toBe("1"));

    // The whole point of the `framed={false}` fold: this screen draws the
    // header, and the list it reuses wholesale must not draw a second one.
    expect(view.getAllByRole("button", { name: /^Filter/ })).toHaveLength(1);
    expect(view.getAllByRole("button", { name: /^Export/ })).toHaveLength(1);
  });
});
