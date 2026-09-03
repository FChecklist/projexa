/// <reference types="bun-types" />
// R67 D-32 / D-30 / D-53 acceptance for LabourClient.
//
// WHY THIS IS A SECOND FILE. LabourClient.test.tsx belongs to lane D0 (item
// D-65, the PaneState adoption) and is already on main. Both lanes wrote a
// first test file for this component from no common ancestor, so the merge saw
// an add/add. Decision D-11 makes the version already on main canonical, and
// its four assertions stay exactly as they are; this lane's assertions live
// beside them rather than replacing them. Same shape as the
// KitObjectScreen.test.tsx / KitObjectScreen.fork.test.tsx split.
//
// WHAT THIS LANE'S ORIGINAL ACCEPTANCE ASKED FOR THAT IS NO LONGER ASSERTED
// HERE, and why -- all three are cases where another lane shipped the SAME
// requirement through a shared component, so asserting D3's own markup would
// pin a design that lost:
//
//   * "the heading carries the module name and the project". The <h1> is now
//     the PAGE's (labour/page.tsx), deliberately outside every Suspense
//     boundary so it paints at TTFB (F-30). There is no heading inside this
//     component to assert. What D-32 actually needed from it -- that the screen
//     never presents an unchosen project as a decision -- is asserted below.
//   * "the three header actions are Filter | Export | + New Worker". Lane
//     D-79's ListHeaderActions owns that band now, in that fixed order, on
//     every module; ListHeaderActions.test.tsx is where the order is pinned.
//     "+ New Worker" became a "+ New" split button offering Worker first.
//   * "the skeleton names what is loading". F-30's ModuleListSkeletonBody and
//     D-65's PaneState do that, from the same MANPOWER_LIST_COLUMNS this table
//     renders, and carry the 3 s / 8 s waiting words besides.
//
// The item's own acceptance is a Playwright walk against a running app; these
// assert the same strings against the real component, which is checkable in CI
// without a server. NOTE (measured, not assumed): this environment does not
// deliver input/change events to React, so no test here types into a field --
// the filter's rule is asserted through the exported pure filterRoster() and
// its URL-restored form through the initialFilter prop.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock(() => {});
mock.module("next/navigation", () => ({
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/labour",
}));

const LabourClientModule = await import("./LabourClient");
const LabourClient = LabourClientModule.default;
const { filterRoster } = LabourClientModule;

const ROSTER = [
  { id: "w1", name: "Ali Hassan", employeeCode: "W-0001", trade: "Civil", skillLevel: null, vendorId: "v1", dailyRate: "300", isActive: true },
  { id: "w2", name: "Bina Rao", employeeCode: "W-0002", trade: "Paint", skillLevel: null, vendorId: null, dailyRate: "250", isActive: true },
  { id: "w3", name: "Retired Ravi", employeeCode: "W-0003", trade: "Civil", skillLevel: null, vendorId: null, dailyRate: "200", isActive: false },
];

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function router(handlers: Record<string, () => Response>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

const DEFAULTS: Record<string, () => Response> = {
  "/api/labour-roster": () => jsonRes({ roster: ROSTER }),
  "/api/attendance": () => jsonRes({ attendance: [] }),
  "/api/vendors": () => jsonRes({ vendors: [{ id: "v1", vendorName: "Falcon Contracting" }] }),
  "/api/currencies": () => jsonRes({ currencies: [{ id: "c1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] }),
};

const PROJECT = "Cedar Heights Villa - Phase 1";

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = realFetch;
});

/** The header button carrying `label`, from lane D-79's shared action band. */
function headerButton(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
  if (!found) throw new Error(`no header button labelled ${label}`);
  return found as HTMLButtonElement;
}

describe("the screen admits to a project nobody chose (D-32, audit R-084)", () => {
  test("a fallback project is named, with where to change it", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(
      <LabourClient projectId="p1" projectName={PROJECT} resolvedByFallback />
    );
    expect(getByText(`Showing ${PROJECT} — pick a project in the top rail to change`)).toBeDefined();
  });

  test("a project the user actually picked gets no such line", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { queryByText } = render(<LabourClient projectId="p1" projectName={PROJECT} />);
    expect(queryByText(/pick a project in the top rail/)).toBeNull();
  });

  test("the page's answer wins over the rail's, so the two cannot disagree", async () => {
    globalThis.fetch = router(DEFAULTS);
    // No ProjectContext provider here, so context supplies nothing: the name on
    // screen can only have come from the prop the page resolved.
    const { getByText } = render(
      <LabourClient projectId="p1" projectName="Marina Tower" resolvedByFallback />
    );
    expect(getByText(/Showing Marina Tower/)).toBeDefined();
  });
});

describe("disabled controls carry their reason (D-32, audit R-092)", () => {
  test("Export says why it cannot run when the filter leaves nothing to export", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/labour-roster": () => jsonRes({ roster: [] }) });
    const { container } = render(<LabourClient projectId="p1" projectName={PROJECT} />);

    // The shared band puts the reason in `title` rather than in the visible
    // label -- a disabled control's accessible NAME stays the bare verb.
    await waitFor(() => expect(headerButton(container, "Export").disabled).toBe(true));
    expect(headerButton(container, "Export").title).toBe("No rows");
  });

  test("with rows to export, Export is enabled and carries no reason", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { container } = render(<LabourClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(headerButton(container, "Export").disabled).toBe(false));
    expect(headerButton(container, "Export").title).toBe("");
  });
});

describe("money is formatted once, through the shared formatter (D-57)", () => {
  test("a daily rate renders with the org currency and two decimals", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(<LabourClient projectId="p1" projectName={PROJECT} />);
    await waitFor(() => expect(getByText("AED 300.00")).toBeDefined());
    expect(getByText("AED 250.00")).toBeDefined();
  });
});

describe("the roster filter (D-32)", () => {
  test("defaults to Active, so a deactivated worker is not in the list until the filter asks for them", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, queryByText } = render(<LabourClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(getByText("Ali Hassan")).toBeDefined());
    expect(queryByText("Retired Ravi")).toBeNull();
  });

  test("an initial filter from the URL is applied on arrival, so Back restores the list as it was", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, queryByText } = render(
      <LabourClient projectId="p1" projectName={PROJECT} initialFilter={{ trade: "Paint" }} />
    );

    await waitFor(() => expect(getByText("Bina Rao")).toBeDefined());
    expect(queryByText("Ali Hassan")).toBeNull();
  });
});

describe("filterRoster (pure)", () => {
  const vendorName = (id: string | null) => (id === "v1" ? "Falcon Contracting" : "—");

  test("matches a name or an ID, case-insensitively", () => {
    expect(filterRoster(ROSTER, { q: "ali", trade: "", company: "", status: "active" }, vendorName).map((r) => r.id)).toEqual(["w1"]);
    expect(filterRoster(ROSTER, { q: "W-0002", trade: "", company: "", status: "active" }, vendorName).map((r) => r.id)).toEqual(["w2"]);
  });

  test("status 'all' includes deactivated workers; 'inactive' shows only them", () => {
    expect(filterRoster(ROSTER, { q: "", trade: "", company: "", status: "all" }, vendorName)).toHaveLength(3);
    expect(filterRoster(ROSTER, { q: "", trade: "", company: "", status: "inactive" }, vendorName).map((r) => r.id)).toEqual(["w3"]);
  });

  test("trade and company narrow independently", () => {
    expect(filterRoster(ROSTER, { q: "", trade: "Civil", company: "", status: "active" }, vendorName).map((r) => r.id)).toEqual(["w1"]);
    expect(filterRoster(ROSTER, { q: "", trade: "", company: "Falcon Contracting", status: "active" }, vendorName).map((r) => r.id)).toEqual(["w1"]);
  });
});

describe("the whole-day sheet is reachable from the Attendance tab (D-30)", () => {
  test("'Mark the whole day' opens the sheet for the day the pane is showing", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { container } = render(
      <LabourClient projectId="p1" projectName={PROJECT} initialTab="attendance" />
    );

    await waitFor(() => expect(headerButton(container, "Mark the whole day").disabled).toBe(false));
    fireEvent.click(headerButton(container, "Mark the whole day"));

    // The day control's own value -- the sheet must open on the day being read,
    // not on a second opinion about what "today" is.
    const day = (container.querySelector("#attendance-day") as HTMLInputElement).value;
    expect(push).toHaveBeenCalledWith(`/labour/attendance/${day}?projectId=p1`);
  });

  test("with an empty roster it says why instead of opening an unmarkable sheet", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/labour-roster": () => jsonRes({ roster: [] }) });
    const { container } = render(
      <LabourClient projectId="p1" projectName={PROJECT} initialTab="attendance" />
    );

    await waitFor(() => expect(headerButton(container, "Mark the whole day").disabled).toBe(true));
    expect(headerButton(container, "Mark the whole day").title).toBe("Add a worker to the roster first");
  });
});

describe("the Daily Summary tab (D-53)", () => {
  test("the module offers Sumeet's report 4 as its own tab", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByRole } = render(<LabourClient projectId="p1" projectName={PROJECT} />);
    expect(getByRole("tab", { name: "Daily Summary" })).toBeDefined();
  });
});
