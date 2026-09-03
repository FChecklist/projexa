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
import { CategoryDistributionCharts } from "./CategoryDistributionCharts";

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("CategoryDistributionCharts", () => {
  test("a fetch failure (e.g. 502 from the category-boq-amounts dependency) shows a real error state", async () => {
    globalThis.fetch = (async () => new Response(null, { status: 502 })) as typeof fetch;

    const { getByText, queryByText } = render(<CategoryDistributionCharts companyId="c-1" projectId="p-1" />);

    await waitFor(() => expect(getByText(/unable to load category data/i)).toBeDefined());
    expect(queryByText(/no boq line items found/i)).toBeNull();
  });

  test("a genuinely empty category list shows the distinct empty-state message, not the error state", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ categories: [] }), { status: 200 })) as typeof fetch;

    const { getByText, queryByText } = render(<CategoryDistributionCharts companyId="c-1" projectId="p-1" />);

    await waitFor(() => expect(getByText(/no boq line items found/i)).toBeDefined());
    expect(queryByText(/unable to load category data/i)).toBeNull();
  });
});
