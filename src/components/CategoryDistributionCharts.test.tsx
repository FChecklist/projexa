/// <reference types="bun-types" />
// Proves a failed category-distribution fetch (network error or non-2xx,
// e.g. the 502 the category-boq-amounts VERIDIAN dependency gap causes)
// renders a distinct "couldn't load" error state rather than being
// indistinguishable from a genuinely empty category list.
//
// R67 E-23 (R-206) extends this suite: the capped pie is gone, so the tests
// now also hold the two properties that replaced it -- EVERY category gets a
// bar (the cap was hiding trades), and each bar's share is printed after its
// label in words rather than being left to a slice angle.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Guarded, like the ten other happy-dom suites in this repo. `bun test` runs
// every file in ONE process and a second register() throws ("Happy DOM has
// already been globally registered"), so an UNGUARDED call only works while
// this file happens to be the first registrant in alphabetical order.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), refresh: mock(() => {}), replace: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/hierarchy",
}));

import { cleanup, render, waitFor } from "@testing-library/react";
import { CategoryDistributionCharts, CategoryDistributionChartsView, type CategoryEntry } from "./CategoryDistributionCharts";
import { formatMoney } from "@/lib/format-money";

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function category(name: string, totalAmount: number, sharePercent: number, percentComplete = 0) {
  return {
    categoryId: name.toLowerCase(),
    name,
    totalAmount,
    sharePercent,
    percentComplete,
    completedAmount: totalAmount * (percentComplete / 100),
  };
}

/** Answers the category-distribution call and the currency call useOrgMoney makes. */
function stubFetch(body: unknown, status = 200) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/currencies")) {
      return new Response(JSON.stringify({ currencies: [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: null, isBaseCurrency: true }] }), { status: 200 });
    }
    return new Response(body === null ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe("CategoryDistributionCharts", () => {
  test("a fetch failure (e.g. 502 from the category-boq-amounts dependency) shows a real error state with a Retry", async () => {
    stubFetch(null, 502);
    const { getByText, queryByText, getByRole } = render(<CategoryDistributionCharts companyId="c-1" projectId="p-1" />);
    await waitFor(() => expect(getByText(/couldn't load category data/i)).toBeDefined());
    expect(getByRole("button", { name: "Retry" })).toBeDefined();
    expect(queryByText(/no boq line items/i)).toBeNull();
  });

  test("a genuinely empty category list shows the distinct empty state and the action that fixes it", async () => {
    stubFetch({ categories: [] });
    const { getByText, queryByText, getByRole } = render(<CategoryDistributionCharts companyId="c-1" projectId="p-1" />);
    await waitFor(() => expect(getByText(/No BOQ line items for this project yet/i)).toBeDefined());
    expect(getByRole("link", { name: "Import BOQ" }).getAttribute("href")).toBe("/scope?projectId=p-1");
    expect(queryByText(/couldn't load category data/i)).toBeNull();
  });

  test("the share is printed after the label, in words -- 'Civil - 40% of BOQ'", async () => {
    stubFetch({ categories: [category("Civil", 400, 40, 50), category("Gypsum", 600, 60)] });
    const { container } = render(<CategoryDistributionCharts companyId="c-1" projectId="p-1" />);
    await waitFor(() => expect(container.textContent).toContain("Civil - 40% of BOQ"));
    expect(container.textContent).toContain("Gypsum - 60% of BOQ");
  });

  test("EVERY category gets a bar -- the capped pie used to hide the long tail", async () => {
    const many = ["A", "B", "C", "D", "E", "F", "G"].map((n, i) => category(n, 100 - i, 10));
    stubFetch({ categories: many });
    const { container, getAllByRole } = render(<CategoryDistributionCharts companyId="c-1" projectId="p-1" />);
    await waitFor(() => expect(container.textContent).toContain("A - 10% of BOQ"));
    // One link per category bar, and every name is present.
    const links = getAllByRole("link").filter((a) => (a.getAttribute("href") ?? "").includes("tab=analytics"));
    expect(links).toHaveLength(many.length);
    for (const c of many) expect(container.textContent).toContain(`${c.name} - `);
    // Only the label LIST folds, and it says so.
    expect(container.textContent).toContain("7 categories in this BOQ");
  });

  test("a bar is a door: it opens Work Progress analytics filtered to that category", async () => {
    stubFetch({ categories: [category("Civil", 400, 40)] });
    const { getByRole, container } = render(<CategoryDistributionCharts companyId="c-1" projectId="p-1" />);
    await waitFor(() => expect(container.textContent).toContain("Civil - 40% of BOQ"));
    const link = getByRole("link", { name: /Civil - 40% of BOQ/ });
    expect(link.getAttribute("href")).toBe("/work-progress?projectId=p-1&tab=analytics&category=Civil");
  });

  test("the bars are sorted by amount descending", async () => {
    stubFetch({ categories: [category("Small", 100, 10), category("Big", 900, 90)] });
    const { container } = render(<CategoryDistributionCharts companyId="c-1" projectId="p-1" />);
    await waitFor(() => expect(container.textContent).toContain("Big - 90% of BOQ"));
    const text = container.textContent ?? "";
    expect(text.indexOf("Big -")).toBeLessThan(text.indexOf("Small -"));
  });

  test("no pie is rendered any more", async () => {
    stubFetch({ categories: [category("Civil", 400, 40)] });
    const { container } = render(<CategoryDistributionCharts companyId="c-1" projectId="p-1" />);
    await waitFor(() => expect(container.textContent).toContain("Civil - 40% of BOQ"));
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).not.toContain("Category share of total BOQ");
  });

  // R67 E-33 (R-265): the same chart, two destinations. The dashboards send a
  // reader to this category's progress entries; the Analytics tab -- which IS
  // that screen -- sends them to the Work Progress Report instead (D-02).
  test("by default a bar opens the category's progress entries", async () => {
    stubFetch({ categories: [category("Civil", 400, 40)] });
    const { container } = render(<CategoryDistributionCharts projectId="p-1" />);
    await waitFor(() => expect(container.textContent).toContain("Civil - 40% of BOQ"));
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/work-progress?projectId=p-1&tab=analytics&category=Civil"
    );
  });

  test("drillTo='report' opens the Work Progress Report filtered to that category", async () => {
    stubFetch({ categories: [category("Civil", 400, 40)] });
    const { container } = render(<CategoryDistributionCharts projectId="p-1" drillTo="report" />);
    await waitFor(() => expect(container.textContent).toContain("Civil - 40% of BOQ"));
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/work-progress?projectId=p-1&tab=report&view=category&category=Civil"
    );
    // ...and the instruction above the bars says where the click goes.
    expect(container.textContent).toContain("open the Work Progress Report for that category");
  });

  test("an ariaLabel names the whole chart, for a mount where its heading is not adjacent", async () => {
    stubFetch({ categories: [category("Civil", 400, 40)] });
    const { findByRole } = render(
      <CategoryDistributionCharts projectId="p-1" ariaLabel="Budget vs completed by category" />
    );
    expect(await findByRole("group", { name: "Budget vs completed by category" })).toBeTruthy();
  });
});
// R67 E-40 (R-272 / R-297). ONE BAR IS NOT A DISTRIBUTION.
//
// A lone "Uncategorized" bar and a project that genuinely has one trade looked
// identical, and only the first has a fix. The bar still renders -- that money
// is real -- but the reason is stated and the fix is linked.
describe("R67 E-40: every BOQ line uncategorised", () => {
  test("says so, and links to where categories are assigned", async () => {
    stubFetch({ categories: [
      { categoryId: "uncategorized", name: "Uncategorized", totalAmount: 4000, sharePercent: 100, percentComplete: 0, completedAmount: 0 },
    ] });
    const { container } = render(<CategoryDistributionCharts projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("All BOQ lines are uncategorised"));

    const link = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent === "Assign categories in Scope"
    );
    expect(link?.getAttribute("href")).toBe("/scope?projectId=p1");
    // The bar is still there -- this is a note, not an empty state.
    expect(container.textContent).toContain("Uncategorized");
  });

  test("a real single category is NOT called uncategorised", async () => {
    stubFetch({ categories: [
      { categoryId: "c1", name: "Civil", totalAmount: 4000, sharePercent: 100, percentComplete: 40, completedAmount: 1600 },
    ] });
    const { container } = render(<CategoryDistributionCharts projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("Civil"));
    expect(container.textContent).not.toContain("All BOQ lines are uncategorised");
  });

  test("an Uncategorized bucket ALONGSIDE real categories is not the all-uncategorised case", async () => {
    stubFetch({ categories: [
      { categoryId: "c1", name: "Civil", totalAmount: 4000, sharePercent: 50, percentComplete: 40, completedAmount: 1600 },
      { categoryId: "uncategorized", name: "Uncategorized", totalAmount: 4000, sharePercent: 50, percentComplete: 0, completedAmount: 0 },
    ] });
    const { container } = render(<CategoryDistributionCharts projectId="p1" />);
    await waitFor(() => expect(container.textContent).toContain("Civil"));
    expect(container.textContent).not.toContain("All BOQ lines are uncategorised");
  });
});

// R67 MERGE (2026-09-03): CategoryDistributionChartsView exercised directly,
// the way DashboardProjectClient.tsx actually uses it -- with its own bound
// `money` prop and no fetch of its own (see the component file's own MERGE
// note for why the split exists). Covers what lane E1's R67 E-02 (R-012)
// suite covered for the presentational half -- the money labels and the
// link destination -- now against the no-pie (E-23) rendering.
const money = (v: number | string | null | undefined) => formatMoney(v, { currency: "AED" });

function categoryEntry(i: number, overrides: Partial<CategoryEntry> = {}): CategoryEntry {
  return {
    categoryId: `cat-${i}`,
    name: `Category ${i}`,
    totalAmount: 1000 * i,
    sharePercent: 10 * i,
    percentComplete: 40,
    completedAmount: 400 * i,
    ...overrides,
  };
}

describe("CategoryDistributionChartsView, called directly with a bound money prop", () => {
  test("every category is labelled with the money, not just a percentage", () => {
    const { getByText } = render(
      <CategoryDistributionChartsView categories={[categoryEntry(1, { name: "Civil" })]} projectId="p-1" money={money} />
    );
    expect(getByText(/Civil - 10% of BOQ/)).toBeDefined();
    expect(getByText(/AED 400\.00 of AED 1,000\.00/)).toBeDefined();
  });

  test("every category is a link into Work Progress > Analytics, filtered to it -- never a dead end", () => {
    const { getByText } = render(
      <CategoryDistributionChartsView categories={[categoryEntry(1, { name: "Civil" })]} projectId="p-1" money={money} />
    );
    const link = getByText(/Civil - 10% of BOQ/).closest("a");
    expect(link?.getAttribute("href")).toBe("/work-progress?projectId=p-1&tab=analytics&category=Civil");
  });

  test("no categories at all: the empty state says what to do next, and offers the link to do it", () => {
    const { getByText } = render(<CategoryDistributionChartsView categories={[]} projectId="p-1" money={money} />);
    expect(getByText(/No BOQ line items for this project yet/)).toBeDefined();
    expect(getByText("Import BOQ").closest("a")?.getAttribute("href")).toBe("/scope?projectId=p-1");
  });
});
