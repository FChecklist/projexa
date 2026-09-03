/// <reference types="bun-types" />
// R67 D-02 -- one Work Progress Report, its parameters in the URL, run on
// arrival (decision D-02, correction C-04).
import { describe, expect, test } from "bun:test";
import {
  defaultWprRange,
  isoDate,
  parseWprParams,
  projexaReportDestination,
  workProgressReportHref,
  wprSearchParams,
} from "./work-progress-report-params";

// A fixed local date so every assertion below is deterministic on any machine.
const TODAY = new Date(2026, 8, 2); // 2 September 2026, local calendar

describe("defaultWprRange", () => {
  test("opens on the first of the current month through today", () => {
    expect(defaultWprRange(TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-02" });
  });

  test("uses the local calendar, not UTC -- a date near midnight must not slide a day", () => {
    expect(isoDate(new Date(2026, 0, 1, 23, 30))).toBe("2026-01-01");
  });
});

describe("parseWprParams", () => {
  test("an empty URL yields the default month-to-date, scope view, server-picked BOQ", () => {
    expect(parseWprParams({}, TODAY)).toEqual({
      from: "2026-09-01",
      to: "2026-09-02",
      view: "scope",
      boqVersion: null,
    });
  });

  test("real parameters survive a round trip through the URL", () => {
    const parsed = parseWprParams(
      { from: "2026-07-01", to: "2026-07-31", view: "manpower", boqVersion: "3" },
      TODAY
    );
    expect(parsed).toEqual({ from: "2026-07-01", to: "2026-07-31", view: "manpower", boqVersion: 3 });
  });

  test("a malformed bookmark still shows the current month rather than failing to run", () => {
    const parsed = parseWprParams(
      { from: "01/07/2026", to: "not-a-date", view: "nonsense", boqVersion: "-2" },
      TODAY
    );
    expect(parsed).toEqual({ from: "2026-09-01", to: "2026-09-02", view: "scope", boqVersion: null });
  });
});

describe("wprSearchParams", () => {
  test("always carries tab=report, so a link never lands on Daily Entry", () => {
    const search = wprSearchParams(parseWprParams({}, TODAY), "proj-1");
    expect(search.get("tab")).toBe("report");
    expect(search.get("projectId")).toBe("proj-1");
    expect(search.get("from")).toBe("2026-09-01");
    expect(search.get("view")).toBe("scope");
  });

  test("omits boqVersion when the server is to pick the BOQ", () => {
    expect(wprSearchParams(parseWprParams({}, TODAY), null).has("boqVersion")).toBe(false);
    expect(wprSearchParams({ ...parseWprParams({}, TODAY), boqVersion: 2 }, null).get("boqVersion")).toBe("2");
  });
});

describe("workProgressReportHref", () => {
  test("is the /work-progress Report tab, with the parameters in the URL", () => {
    const href = workProgressReportHref("proj-1", { view: "category" }, TODAY);
    expect(href.startsWith("/work-progress?")).toBe(true);
    const search = new URLSearchParams(href.split("?")[1]);
    expect(search.get("projectId")).toBe("proj-1");
    expect(search.get("tab")).toBe("report");
    expect(search.get("view")).toBe("category");
  });
});

describe("projexaReportDestination", () => {
  test("the Reports picker entry navigates to the Work Progress Report tab", () => {
    const href = projexaReportDestination({ id: "work-progress" }, "proj-1");
    expect(href).not.toBeNull();
    expect(href!.startsWith("/work-progress?")).toBe(true);
    expect(new URLSearchParams(href!.split("?")[1]).get("tab")).toBe("report");
  });

  test("the Full Catalog row, which carries the human name, resolves to the same route", () => {
    expect(projexaReportDestination({ id: "static-42", name: "Work Progress Report" }, "proj-1")).toBe(
      projexaReportDestination({ id: "work-progress" }, "proj-1")
    );
  });

  test("every other report runs where it is", () => {
    expect(projexaReportDestination({ id: "attendance", name: "Attendance" }, "proj-1")).toBeNull();
    expect(projexaReportDestination({ id: "budget-vs-actual", name: "Budget vs Actual" }, null)).toBeNull();
  });
});
