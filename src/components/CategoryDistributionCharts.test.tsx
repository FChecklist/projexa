/// <reference types="bun-types" />
// Proves a failed category-distribution fetch (network error or non-2xx,
// e.g. the 502 the category-boq-amounts VERIDIAN dependency gap causes)
// renders a distinct "unable to load" error state rather than being
// indistinguishable from a genuinely empty category list.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Guarded, like the ten other happy-dom suites in this repo. `bun test` runs
// every file in ONE process and a second register() throws ("Happy DOM has
// already been globally registered"), so an UNGUARDED call only works while
// this file happens to be the first registrant in alphabetical order. It was,
// until R67 lane I added src/components/BoqCategoriesCard.test.tsx -- "B"
// sorts before "C" -- at which point this line started throwing and took the
// whole suite's tests down with it. The guard makes the file order-independent
// rather than relying on nobody ever adding an earlier-sorting DOM test.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { CategoryDistributionCharts, CategoryDistributionChartsView, analyticsHref, PIE_MAX_SLICES, type CategoryEntry } from "./CategoryDistributionCharts";
import { formatMoney } from "@/lib/format-money";

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("CategoryDistributionCharts", () => {
  test("a fetch failure (e.g. 502 from the category-boq-amounts dependency) shows a real error state", async () => {
    globalThis.fetch = (async () => new Response(null, { status: 502 })) as typeof fetch;

    const { getByText, queryByText } = render(<CategoryDistributionCharts projectId="p-1" />);

    await waitFor(() => expect(getByText(/unable to load category data/i)).toBeDefined());
    expect(queryByText(/no boq line items found/i)).toBeNull();
  });

  test("a genuinely empty category list shows the distinct empty-state message, not the error state", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ categories: [] }), { status: 200 })) as typeof fetch;

    const { getByText, queryByText } = render(<CategoryDistributionCharts projectId="p-1" />);

    await waitFor(() => expect(getByText(/no boq line items yet/i)).toBeDefined());
    expect(queryByText(/unable to load category data/i)).toBeNull();
  });
});

// R67 E-02 (R-012), chart 2. The presentational half is exercised directly:
// its rules -- the pie cap, the money labels, the destination on every bar --
// are what the item asks for, and none of them is visible through the fetching
// wrapper's loading/error states.
// R67 D-61 (second-merge fix): the real formatMoney(), not a hand-rolled
// toLocaleString() -- money-format-rule.test.ts bans the method itself
// anywhere under src/components, test files included.
const money = (v: number | string | null | undefined) => formatMoney(v, { currency: "AED" });

function category(i: number, overrides: Partial<CategoryEntry> = {}): CategoryEntry {
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

describe("CategoryDistributionChartsView (R67 E-02)", () => {
  test("every category is labelled with the money, not just a percentage", () => {
    const { getByText } = render(
      <CategoryDistributionChartsView categories={[category(1, { name: "Civil" })]} projectId="p-1" money={money} />
    );
    expect(getByText(/Completed AED 400\.00 \/ Total AED 1,000\.00 \(40%\)/)).toBeDefined();
  });

  test("every category is a link into Work Progress > Analytics, filtered to it -- never a dead end", () => {
    const { getByText } = render(
      <CategoryDistributionChartsView categories={[category(1, { name: "Civil" })]} projectId="p-1" money={money} />
    );
    const link = getByText("Civil").closest("a");
    expect(link?.getAttribute("href")).toBe("/work-progress?projectId=p-1&tab=analytics&category=Civil");
  });

  test("five categories or fewer: the pie is drawn beside the bars", () => {
    const five = [1, 2, 3, 4, 5].map((i) => category(i));
    const { getByText } = render(<CategoryDistributionChartsView categories={five} projectId="p-1" money={money} />);
    expect(five.length).toBe(PIE_MAX_SLICES);
    expect(getByText("Category share of total BOQ")).toBeDefined();
  });

  test("more than five categories: BARS ONLY -- a pie with six segments answers nothing", () => {
    const six = [1, 2, 3, 4, 5, 6].map((i) => category(i));
    const { queryByText, getByText } = render(<CategoryDistributionChartsView categories={six} projectId="p-1" money={money} />);
    expect(queryByText("Category share of total BOQ")).toBeNull();
    expect(getByText("Completed vs total amount per category")).toBeDefined();
  });

  test("no categories at all: the empty state says what to do next, and offers the link to do it", () => {
    const { getByText } = render(<CategoryDistributionChartsView categories={[]} projectId="p-1" money={money} />);
    expect(getByText(/No BOQ line items yet/)).toBeDefined();
    expect(getByText("Import a BOQ").closest("a")?.getAttribute("href")).toBe("/scope?projectId=p-1");
  });
});

describe("analyticsHref", () => {
  test("encodes a category name containing a space or an ampersand", () => {
    expect(analyticsHref("p 1", "Civil & Structural")).toBe(
      "/work-progress?projectId=p%201&tab=analytics&category=Civil%20%26%20Structural"
    );
  });
});
