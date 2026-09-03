/// <reference types="bun-types" />
// R67 MERGE (lane D0/F2's D-71 x lane D1's D-10 / D-12). Both lanes wrote a
// suite for this screen; both survive here.
//
// WHY LANE D1'S SUITE IS THE BULK OF IT. The merged DrawingsClient is lane D1's
// screen, not the shared list archetype: this register is a genuine superset
// (a tab strip, removable filter chips, a default "Current only" filter, and a
// "Showing n of m" whose m comes from a SECOND unfiltered read), which
// PaneState's shape cannot express. Per the programme's own rule, where lane
// D1's screen is a superset the screen survives and the shared work folds into
// IT. So the assertions about the record count and about PaneState's wording,
// which lane D0's suite made, are NOT restated -- this screen has no record
// count and never had one, and saying otherwise would be a test asserting a
// component that does not exist.
//
// WHAT LANE D0'S SUITE CONTRIBUTED, and is kept below as its own describe
// block: the failure branch. D-71's requirement is that a 5xx says it could not
// load, offers Retry, and never prints the empty-state sentence -- and, the
// half that mattered most, that "supabaseKey is required." never reaches a
// user. The merged component satisfies both through paneError(), the same
// dictionary PaneState uses; see DrawingsClient's own import comment for why
// that call replaced errorMessage() and how it keeps lane D1's requirement
// (the backend's REAL reason stays visible) at the same time.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
// R67 lane A merge: the real module is spread in rather than replaced. Lane A
// mounts <ObjectContext>/<ScreenContext> inside these screens, and those call
// usePathname() -- a mock that returned only useRouter made the whole module
// lose every other export and the file failed to load at all
// ("Export named 'usePathname' not found in module .../next/navigation.js").
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/drawings",
}));

const mod = await import("./DrawingsClient");
const DrawingsClient = mod.default;
const { activeFilterChips, drawingQuery, hasActiveFilter, DEFAULT_FILTERS, EMPTY_FILTERS, KIND_OPTIONS } = mod;

const CURRENT_ONLY_EMPTY =
  "No current drawings yet. Remove the Current only filter to see revisions awaiting approval.";

const DRAWING = {
  id: "d1",
  name: "AR-101 Ground floor plan",
  kind: "dwg" as const,
  discipline: "Architectural",
  isExternalLink: false,
  documentUrl: "https://signed.example/AR-101.dwg",
  createdAt: "2026-08-14T09:30:00.000Z",
  drawingNo: "AR-101",
  rev: "A",
  status: "current",
  supersedesId: null,
};

const realFetch = globalThis.fetch;
let requested: string[] = [];

function stubDrawings(rows: unknown[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response(JSON.stringify({ drawings: rows }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function stubFailure(status: number, error: string) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response(JSON.stringify({ error }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  requested = [];
  try {
    window.sessionStorage.clear();
  } catch {
    // The register keeps its filters here; a clean slate per test.
  }
  stubDrawings([DRAWING]);
});

afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = realFetch;
});

describe("drawingQuery", () => {
  test("an unfiltered register asks for the project alone", () => {
    expect(drawingQuery("p1", EMPTY_FILTERS)).toBe("projectId=p1");
  });

  test("the Status filter is carried too", () => {
    expect(drawingQuery("p1", { kind: "", discipline: "", status: "superseded" })).toBe(
      "projectId=p1&status=superseded"
    );
  });

  test("the Kind filter is carried to the backend as kind=dwg -- the exact string the acceptance watches for", () => {
    expect(drawingQuery("p1", { kind: "dwg", discipline: "", status: "" })).toContain("kind=dwg");
    expect(drawingQuery("p1", { kind: "3d_walkthrough", discipline: "", status: "" })).toContain(
      "kind=3d_walkthrough"
    );
  });

  test("Discipline goes to the backend too, trimmed and encoded", () => {
    expect(drawingQuery("p1", { kind: "", discipline: " MEP ", status: "" })).toBe("projectId=p1&discipline=MEP");
  });

  test("the list and the export are built from the SAME query, so an export cannot show something else", () => {
    const filters = { kind: "dwg", discipline: "MEP", status: "" };
    expect(`/api/drawings?${drawingQuery("p1", filters)}`).toBe("/api/drawings?projectId=p1&kind=dwg&discipline=MEP");
    expect(`/api/drawings/export?${drawingQuery("p1", filters)}`).toBe(
      "/api/drawings/export?projectId=p1&kind=dwg&discipline=MEP"
    );
  });
});

describe("hasActiveFilter / activeFilterChips", () => {
  test("whitespace is not a filter", () => {
    expect(hasActiveFilter(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilter({ kind: "", discipline: "   ", status: "" })).toBe(false);
    expect(hasActiveFilter({ kind: "dwg", discipline: "", status: "" })).toBe(true);
    expect(hasActiveFilter(DEFAULT_FILTERS)).toBe(true); // "Current only" IS a filter
  });

  test("each active filter becomes one removable chip, in the register's own words", () => {
    expect(activeFilterChips({ kind: "3d_walkthrough", discipline: "MEP", status: "current" })).toEqual([
      { key: "kind", label: "Kind: 3D Walkthrough" },
      { key: "discipline", label: "Discipline: MEP" },
      { key: "status", label: "Current only" },
    ]);
    expect(activeFilterChips(EMPTY_FILTERS)).toEqual([]);
  });

  // R67 D-12: the register opens on the build set, and says so with a chip the
  // user can remove -- nothing is hidden silently.
  test("the default filter is 'Current only', and it is a removable chip", () => {
    expect(DEFAULT_FILTERS.status).toBe("current");
    expect(activeFilterChips(DEFAULT_FILTERS)).toEqual([{ key: "status", label: "Current only" }]);
    expect(drawingQuery("p1", DEFAULT_FILTERS)).toBe("projectId=p1&status=current");
  });

  test("the Kind options are All / DWG / 3D Walkthrough", () => {
    expect(KIND_OPTIONS.map((o) => o.label)).toEqual(["All", "DWG", "3D Walkthrough"]);
  });
});

describe("DrawingsClient", () => {
  function headerButtonNames(container: HTMLElement): string[] {
    return [...container.querySelectorAll("header button")].map((b) => (b.textContent ?? "").trim());
  }

  test("the header is Filter | Export | + New, in that order", async () => {
    const view = render(<DrawingsClient projectId="p1" projectName="Cedar Heights" />);
    await waitFor(() => expect(view.container.querySelector("table")).toBeTruthy());
    expect(headerButtonNames(view.container)).toEqual(["Filter", "Export", "New"]);
  });

  test("Export is disabled with its reason when there is nothing to export", async () => {
    stubDrawings([]);
    const view = render(<DrawingsClient projectId="p1" projectName="Cedar Heights" />);
    await waitFor(() => expect(view.getByText(CURRENT_ONLY_EMPTY)).toBeTruthy());
    const exportButton = view.getByRole("button", { name: "Export (No rows to export)" }) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);
  });

  test("the 3D builder is a tab with one line saying what it is for -- not a rival primary action", async () => {
    const view = render(<DrawingsClient projectId="p1" projectName="Cedar Heights" />);
    await waitFor(() => expect(view.container.querySelector("table")).toBeTruthy());
    expect(view.getByRole("tab", { name: "Drawings" })).toBeTruthy();
    expect(view.getByRole("tab", { name: "Floor plans (3D builder)" })).toBeTruthy();
    expect(
      view.getByText(
        "Build a walkable 3D model from room layouts. To add a walkthrough file or link, use + New and choose 3D Walkthrough."
      )
    ).toBeTruthy();
    // The old outlined "Floor Plans / 3D Walkthrough" button is gone: no
    // CONTROL on the resting screen carries those words any more.
    const controlTexts = [...view.container.querySelectorAll("button, a")].map((el) => (el.textContent ?? "").trim());
    expect(controlTexts.filter((t) => t.includes("3D Walkthrough"))).toEqual([]);
  });

  // R67 D-12: the rows are filtered from the first load ("Current only" is on
  // by default), so the "of m" figure and the Discipline options come from a
  // separate unfiltered read -- once per project, not once per filter change.
  test("asks for the build set, and separately for the unfiltered register behind 'of m'", async () => {
    render(<DrawingsClient projectId="p1" projectName="Cedar Heights" />);
    await waitFor(() => expect(requested.length).toBeGreaterThan(1));
    expect(requested).toContain("/api/drawings?projectId=p1&status=current");
    expect(requested).toContain("/api/drawings?projectId=p1");
  });

  test("a filter saved by a previous visit is restored on the way Back", async () => {
    window.sessionStorage.setItem("veri.list.filters:drawings.list", JSON.stringify({ kind: "dwg" }));
    render(<DrawingsClient projectId="p1" projectName="Cedar Heights" />);
    await waitFor(() => expect(requested.some((u) => u.includes("kind=dwg"))).toBe(true));
  });
});

describe("DrawingsClient -- the failure branch (R67 D-71, folded onto lane D1's screen)", () => {
  test("THE ACCEPTANCE: a 5xx says it could not load, offers Retry, and never prints the empty sentence", async () => {
    stubFailure(502, "VERIDIAN did not respond in time, on two attempts");
    const view = render(<DrawingsClient projectId="p1" projectName="Cedar Heights" />);

    await waitFor(() => expect(view.container.textContent).toContain("Couldn't load drawings"));
    // Lane D1's half: the backend's REAL reason is still on screen, not
    // swallowed behind a generic sentence.
    expect(view.container.textContent).toContain("VERIDIAN did not respond in time, on two attempts");
    // An empty register and a failed request must not look identical: the table
    // (and its empty-state line) is withheld, and a Retry is offered.
    expect(view.queryByText(CURRENT_ONLY_EMPTY)).toBeNull();
    expect(view.container.textContent).not.toContain("No drawings yet");
    expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  test("'supabaseKey is required' is translated, never shown", async () => {
    stubFailure(500, "supabaseKey is required.");
    const view = render(<DrawingsClient projectId="p1" projectName="Cedar Heights" />);

    await waitFor(() =>
      expect(view.container.textContent).toContain("file storage is not configured for this environment")
    );
    expect(view.container.textContent).not.toContain("supabaseKey");
  });

  test("only a 200 with zero rows shows an empty sentence, and it is the one that names the filter", async () => {
    stubDrawings([]);
    const view = render(<DrawingsClient projectId="p1" projectName="Cedar Heights" />);

    await waitFor(() => expect(view.getByText(CURRENT_ONLY_EMPTY)).toBeTruthy());
    expect(view.container.textContent).not.toContain("Couldn't load drawings");
  });

  test("rows render rather than any empty state", async () => {
    const view = render(<DrawingsClient projectId="p1" projectName="Cedar Heights" />);

    await waitFor(() => expect(view.getByText("AR-101 Ground floor plan")).toBeTruthy());
    expect(view.queryByText(CURRENT_ONLY_EMPTY)).toBeNull();
  });
});
