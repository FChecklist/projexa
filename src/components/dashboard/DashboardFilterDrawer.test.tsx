/// <reference types="bun-types" />
// R67 E-02 (R-012). /dashboard/hierarchy was retired as a destination and its
// Company / Department selects became this drawer on the home screen. The whole
// point of the move is that the filter lives in the URL rather than in React
// state -- the home page is a Server Component that fetches the payload itself,
// so a drawer-local useState could only ever filter rows that had already
// arrived, and Back would not undo it.
//
// These tests are therefore about the URL round trip in both directions:
// applying writes the parameters, and arriving at that URL restores the drawer
// showing them.
//
// TWO THINGS ARE NOT DRIVEN THROUGH THE WIDGETS, and it is worth saying why
// rather than leaving a reader to wonder what the coverage means. React's
// onChange does not fire for a CONTROLLED input under happy-dom in this repo's
// test setup -- verified directly, on a three-line component with a plain text
// input: fireEvent.change sets the DOM value and React's change plugin never
// runs, while a button click in the same render updates state fine. And the
// Radix Select portals its popover, so opening it would assert Radix's
// behaviour rather than this screen's. So the drawer's fields are seeded the
// way a reader really arrives at a filtered home screen -- from the URL -- and
// the assertions are that Apply writes exactly those parameters back out, and
// that buildDashboardFilterQuery (which is the whole of what Apply computes)
// turns fields into that querystring.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const pushed: string[] = [];
let searchParams = new URLSearchParams();
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (url: string) => { pushed.push(url); }, replace: () => {}, prefetch: () => {}, refresh: () => {} }),
  usePathname: () => "/dashboard",
  useSearchParams: () => searchParams,
}));

const { DashboardFilterDrawer, buildDashboardFilterQuery, dateRangeCaption } = await import("./DashboardFilterDrawer");

const originalFetch = globalThis.fetch;

beforeEach(() => {
  pushed.length = 0;
  searchParams = new URLSearchParams();
  // The two lookups the drawer makes when it opens -- the SAME endpoints the
  // retired DashboardHierarchyClient called.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/departments")) {
      return new Response(JSON.stringify({ departments: [{ id: "d-1", name: "Civil" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ companies: [{ id: "c-1", name: "Skyline Builders" }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

/**
 * Opens the drawer AND lets the two lookups it fires on open settle, so their
 * state updates land inside the test rather than after it.
 */
async function open(container: HTMLElement) {
  fireEvent.click(container.querySelector('[data-testid="dashboard-filter-toggle"]')!);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function dateInputs(container: HTMLElement) {
  return [...container.querySelectorAll('input[type="date"]')] as HTMLInputElement[];
}

describe("the drawer writes its state into the URL (R67 E-02)", () => {
  test("Apply pushes the company, the department AND the date range onto the home route, which is what re-runs the server fetch", async () => {
    searchParams = new URLSearchParams("companyId=c-1&departmentId=d-1&from=2026-08-01&to=2026-08-31");
    const { container } = render(<DashboardFilterDrawer />);
    await open(container);
    fireEvent.click(container.querySelector('[data-testid="dashboard-filter-apply"]')!);

    expect(pushed).toHaveLength(1);
    const applied = new URL(pushed[0], "http://test");
    // Same route, so the reader stays on the screen they filtered -- the
    // parameters are what makes the Server Component re-read.
    expect(applied.pathname).toBe("/dashboard");
    expect(applied.searchParams.get("companyId")).toBe("c-1");
    expect(applied.searchParams.get("departmentId")).toBe("d-1");
    expect(applied.searchParams.get("from")).toBe("2026-08-01");
    expect(applied.searchParams.get("to")).toBe("2026-08-31");
  });

  test("a filter with no company still writes the dates, and writes no empty company parameter", async () => {
    searchParams = new URLSearchParams("from=2026-08-01&to=2026-08-31");
    const { container } = render(<DashboardFilterDrawer />);
    await open(container);
    fireEvent.click(container.querySelector('[data-testid="dashboard-filter-apply"]')!);

    const applied = new URL(pushed[0], "http://test");
    expect(applied.searchParams.get("from")).toBe("2026-08-01");
    expect(applied.searchParams.get("to")).toBe("2026-08-31");
    expect(applied.searchParams.has("companyId")).toBe(false);
    expect(applied.searchParams.has("departmentId")).toBe(false);
  });

  test("Clear pushes the bare route -- an empty filter is an absent parameter, never an empty one", async () => {
    searchParams = new URLSearchParams("companyId=c-1&from=2026-08-01");
    const { container } = render(<DashboardFilterDrawer />);
    await open(container);
    fireEvent.click(container.querySelector('[data-testid="dashboard-filter-clear"]')!);

    expect(pushed).toEqual(["/dashboard"]);
  });
});

describe("arriving at a filtered URL restores the drawer showing that filter", () => {
  test("the toggle counts the active parameters before the drawer is even opened", () => {
    searchParams = new URLSearchParams("companyId=c-1&from=2026-08-01&to=2026-08-31");
    const { container } = render(<DashboardFilterDrawer />);
    expect(container.querySelector('[data-testid="dashboard-filter-toggle"]')?.textContent).toContain("Filter (3)");
  });

  test("with no filter the toggle is just 'Filter', with no count to decode", () => {
    const { container } = render(<DashboardFilterDrawer />);
    expect(container.querySelector('[data-testid="dashboard-filter-toggle"]')?.textContent?.trim()).toBe("Filter");
  });

  test("opening it shows the dates the URL carries, not empty fields", async () => {
    searchParams = new URLSearchParams("from=2026-08-01&to=2026-08-31");
    const { container } = render(<DashboardFilterDrawer />);
    await open(container);

    const [from, to] = dateInputs(container);
    expect(from.value).toBe("2026-08-01");
    expect(to.value).toBe("2026-08-31");
  });

  test("the two lookups are made only once the drawer is opened, not on the home page's first paint", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ companies: [], departments: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    searchParams = new URLSearchParams("companyId=c-1");
    const { container } = render(<DashboardFilterDrawer />);
    expect(urls).toHaveLength(0);

    await open(container);
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    expect(urls.some((u) => u.includes("/api/dashboard-hierarchy/companies"))).toBe(true);
    expect(urls.some((u) => u.includes("/companies/c-1/departments"))).toBe(true);
  });
});

describe("the pure rules the drawer is built on", () => {
  test("buildDashboardFilterQuery omits every unset field, and treats 'All' as unset", () => {
    expect(buildDashboardFilterQuery({})).toBe("");
    expect(buildDashboardFilterQuery({ companyId: "__all__", departmentId: "__all__" })).toBe("");
    expect(buildDashboardFilterQuery({ companyId: "c-1", from: "2026-08-01" })).toBe("companyId=c-1&from=2026-08-01");
  });

  test("dateRangeCaption says what a range really narrowed, and says nothing when nothing was filtered", () => {
    expect(dateRangeCaption(null, null)).toBeNull();
    // The caption exists because the range narrows revenue and spend ONLY --
    // contract value and the percentages are current figures for the live BOQ.
    expect(dateRangeCaption("2026-08-01", "2026-08-31")).toBe(
      "Revenue and spend shown for 2026-08-01 to 2026-08-31. Contract value and progress are current figures and are not date-filtered."
    );
    expect(dateRangeCaption("2026-08-01", null)).toContain("shown from 2026-08-01");
    expect(dateRangeCaption(null, "2026-08-31")).toContain("shown up to 2026-08-31");
  });
});
