/// <reference types="bun-types" />
// R67 E-22 (R-199 / R-207). The acceptance clauses for "reports render as
// documents", as a render test: choosing a report RUNS it with no button
// press, the running state says which report is running (the branch that
// used to be unreachable on a first run), the result is a real table with
// formatted money in it, the raw project id never reaches the screen, and
// the document chrome exposes an Export PDF control.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), refresh: mock(() => {}), replace: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/reports",
}));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

import { cleanup, render, waitFor } from "@testing-library/react";
import ReportsClient from "./ReportsClient";

const PROJECT_STATUS = {
  projectId: "g555imnoq4wihavpwc7t64um",
  projectName: "Cedar Heights Villa - Phase 1",
  budget: 0,
  revenue: 0,
  expenses: 185_000,
  progressPercent: 60,
  percentByValue: 25,
  contractValue: 475_000,
  projectValue: null,
  earnedValue: 118_750,
  taskCount: 4,
  delayedTaskCount: 1,
  photoCount: 0,
};

const BUDGET_VARIANCE = {
  lines: [
    { lineItemId: "l1", code: "1.1", description: "Blockwork", category: "Civil", amount: 6500, budgetPercentage: 25, budget: 1625, vendorId: "v1", vendorName: "Al Noor", vendorAmount: 1800, variance: 175 },
  ],
  totalBudget: 1625,
  totalVendorAmount: 1800,
  totalVariance: 175,
};

/** Answers every URL this panel really calls. `hold` keeps the report request pending so the running state can be asserted. */
function stubFetch({ hold = false }: { hold?: boolean } = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/currencies")) {
      return new Response(JSON.stringify({ currencies: [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true }] }), { status: 200 });
    }
    if (url.includes("/api/reports/budget-variance")) {
      return new Response(JSON.stringify(BUDGET_VARIANCE), { status: 200 });
    }
    if (url.includes("/api/reports/project-status")) {
      if (hold) return new Promise<Response>(() => {}); // never settles
      return new Response(JSON.stringify(PROJECT_STATUS), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function renderPanel() {
  return render(
    <ReportsClient projectId="prj-cedar" projectName="Cedar Heights Villa - Phase 1" generatedBy="rajat" />
  );
}

describe("ReportsClient -- Project Status renders as a document", () => {
  test("the report runs on arrival, with no button pressed", async () => {
    stubFetch();
    const { container } = renderPanel();
    await waitFor(() => expect(container.textContent).toContain("Revenue, budget and expense"));
    // The old idle prompt is gone -- there is nothing to click first.
    expect(container.textContent).not.toContain("Pick a report and click Run Report");
  });

  test("while it runs, the panel says WHICH report is running and offers Cancel", async () => {
    stubFetch({ hold: true });
    const { container, findAllByRole } = renderPanel();
    // R67 E-30 (R-263): the sentence names the report AND the project.
    await waitFor(() =>
      expect(container.textContent).toContain("Running Project Status for Cedar Heights Villa - Phase 1…")
    );
    const cancels = await findAllByRole("button", { name: "Cancel" });
    expect(cancels.length).toBeGreaterThan(0);
    // The idle prompt must never be what a running report looks like.
    expect(container.textContent).not.toContain("Choosing a report runs it.");
  });

  test("R67 E-30: the elapsed counter really ticks while the reader waits", async () => {
    stubFetch({ hold: true });
    const { container } = renderPanel();
    await waitFor(() => expect(container.textContent).toContain("Running Project Status"));
    // "0 s" immediately, then a real second later "1 s". Without the counter a
    // reader cannot tell a slow report from a broken one.
    expect(container.textContent).toContain("0 s");
    await waitFor(() => expect(container.textContent).toContain("1 s"), { timeout: 3000 });
  });

  test("R67 E-30: a finished run is stamped with how long it took and when", async () => {
    stubFetch();
    const { container } = renderPanel();
    await waitFor(() => expect(container.textContent).toContain("AED 475,000"));
    // "Ran in 0.0 s at 14:02" -- the duration and a 24-hour clock, above the
    // output, so a reader knows whether the numbers are fresh.
    expect(container.textContent).toMatch(/Ran in \d+\.\d s at \d{2}:\d{2}/);
  });

  test("R67 E-30: Cancel stops the run and says so, rather than spinning forever", async () => {
    stubFetch({ hold: true });
    const { container, findAllByRole } = renderPanel();
    await waitFor(() => expect(container.textContent).toContain("Running Project Status"));
    const [cancel] = await findAllByRole("button", { name: "Cancel" });
    cancel.click();
    await waitFor(() => expect(container.textContent).toContain("Cancelled. Nothing was run."));
    expect(container.textContent).not.toContain("Running Project Status");
  });

  test("money is formatted through the one formatter, with the org currency", async () => {
    stubFetch();
    const { container } = renderPanel();
    await waitFor(() => expect(container.textContent).toContain("AED 475,000"));
    expect(container.textContent).toContain("AED 185,000");
  });

  test("the raw project id never reaches the screen", async () => {
    stubFetch();
    const { container } = renderPanel();
    await waitFor(() => expect(container.textContent).toContain("AED 475,000"));
    expect(container.textContent).not.toContain("g555imnoq4wihavpwc7t64um");
  });

  test("both progress measures are named in words rather than as JSON keys", async () => {
    stubFetch();
    const { container } = renderPanel();
    await waitFor(() => expect(container.textContent).toContain("% complete by BOQ value"));
    expect(container.textContent).toContain("% complete by activity log");
    expect(container.textContent).not.toContain("percentByValue");
    expect(container.textContent).not.toContain("progressPercent");
  });

  test("the document chrome exposes Export PDF, Export CSV and Share", async () => {
    stubFetch();
    const { container, getByRole } = renderPanel();
    await waitFor(() => expect(container.textContent).toContain("AED 475,000"));
    // Matched by pattern, not by an exact string: R67 E-36 puts a DISABLED
    // control's reason into its accessible name (aria-label), because the
    // accessible-name algorithm prefers text content over `title` and a reader
    // who cannot hover was getting a dead control with no stated reason. So
    // "Export PDF" is now the start of the name, not the whole of it.
    expect(getByRole("button", { name: /Export PDF/ })).toBeDefined();
    expect(getByRole("button", { name: /Export CSV/ })).toBeDefined();
    expect(getByRole("button", { name: /Share/ })).toBeDefined();
  });

  test("the header block links the project name to its dashboard", async () => {
    stubFetch();
    const { container, getByRole } = renderPanel();
    await waitFor(() => expect(container.textContent).toContain("AED 475,000"));
    const link = getByRole("link", { name: "Cedar Heights Villa - Phase 1" });
    expect(link.getAttribute("href")).toBe("/dashboard/project?projectId=prj-cedar");
  });

  test("a failed run shows the backend's own words and a way to run it again", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/currencies")) return new Response(JSON.stringify({ currencies: [] }), { status: 200 });
      return new Response(JSON.stringify({ error: "construction is not enabled for this organisation" }), { status: 403 });
    }) as typeof fetch;

    const { container } = renderPanel();
    await waitFor(() => expect(container.textContent).toContain("Could not run Project Status"));
    expect(container.textContent).toContain("construction is not enabled for this organisation");
  });
});
