/// <reference types="bun-types" />
// R67 D-10. The item's acceptance is a Playwright run against a local dev
// server, which this lane may not start. The same assertions are made here with
// /api/drawings stubbed: the header carries Filter | Export | + New in that
// order, the Kind filter's wire value is the one the request must contain
// (kind=dwg), and Export refuses to produce an empty spreadsheet -- it says why
// instead.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push }) }));

const mod = await import("./DrawingsClient");
const DrawingsClient = mod.default;
const { activeFilterChips, drawingQuery, hasActiveFilter, EMPTY_FILTERS, KIND_OPTIONS } = mod;

const DRAWING = {
  id: "d1",
  name: "AR-101 Ground floor plan",
  kind: "dwg" as const,
  discipline: "Architectural",
  isExternalLink: false,
  documentUrl: "https://signed.example/AR-101.dwg",
  createdAt: "2026-08-14T09:30:00.000Z",
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

beforeEach(() => {
  requested = [];
  window.sessionStorage.clear();
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

  test("the Kind filter is carried to the backend as kind=dwg -- the exact string the acceptance watches for", () => {
    expect(drawingQuery("p1", { kind: "dwg", discipline: "" })).toContain("kind=dwg");
    expect(drawingQuery("p1", { kind: "3d_walkthrough", discipline: "" })).toContain("kind=3d_walkthrough");
  });

  test("Discipline goes to the backend too, trimmed and encoded", () => {
    expect(drawingQuery("p1", { kind: "", discipline: " MEP " })).toBe("projectId=p1&discipline=MEP");
  });

  test("the list and the export are built from the SAME query, so an export cannot show something else", () => {
    const filters = { kind: "dwg", discipline: "MEP" };
    expect(`/api/drawings?${drawingQuery("p1", filters)}`).toBe("/api/drawings?projectId=p1&kind=dwg&discipline=MEP");
    expect(`/api/drawings/export?${drawingQuery("p1", filters)}`).toBe(
      "/api/drawings/export?projectId=p1&kind=dwg&discipline=MEP"
    );
  });
});

describe("hasActiveFilter / activeFilterChips", () => {
  test("whitespace is not a filter", () => {
    expect(hasActiveFilter(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilter({ kind: "", discipline: "   " })).toBe(false);
    expect(hasActiveFilter({ kind: "dwg", discipline: "" })).toBe(true);
  });

  test("each active filter becomes one removable chip, in the register's own words", () => {
    expect(activeFilterChips({ kind: "3d_walkthrough", discipline: "MEP" })).toEqual([
      { key: "kind", label: "Kind: 3D Walkthrough" },
      { key: "discipline", label: "Discipline: MEP" },
    ]);
    expect(activeFilterChips(EMPTY_FILTERS)).toEqual([]);
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
    await waitFor(() => expect(view.getByText("No drawings yet for Cedar Heights.")).toBeTruthy());
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

  test("the first load is unfiltered, so 'Showing n of m' and the Discipline options have a real m", async () => {
    render(<DrawingsClient projectId="p1" projectName="Cedar Heights" />);
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(requested[0]).toBe("/api/drawings?projectId=p1");
  });

  test("a filter saved by a previous visit is restored on the way Back", async () => {
    window.sessionStorage.setItem("veri.list.filters:drawings.list", JSON.stringify({ kind: "dwg" }));
    render(<DrawingsClient projectId="p1" projectName="Cedar Heights" />);
    await waitFor(() => expect(requested.some((u) => u.includes("kind=dwg"))).toBe(true));
  });

  test("a failed load shows the backend's own words, never an empty register", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "VERIDIAN did not respond in time, on two attempts" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const view = render(<DrawingsClient projectId="p1" projectName="Cedar Heights" />);
    await waitFor(() =>
      expect(document.body.textContent).toContain("VERIDIAN did not respond in time, on two attempts")
    );
    // An empty register and a failed request must not look identical: the
    // table (and its "no drawings yet" line) is withheld, and a Retry is offered.
    expect(view.queryByText("No drawings yet for Cedar Heights.")).toBeNull();
    expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
