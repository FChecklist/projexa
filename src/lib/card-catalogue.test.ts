import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PERIOD,
  PERIOD_OPTIONS,
  REPORTS_ENTITY_SEGMENT,
  REPORT_LEAVES,
  formatReportRange,
  periodLabel,
  periodOptionsLevel,
  reportLeafById,
  reportOptionsLevel,
  reportReceiptLine,
  reportRoute,
  resolvePeriod,
} from "./card-catalogue";

const CEDAR = "Cedar Heights Villa - Phase 1";
const SEP_2 = new Date("2026-09-02T14:00:00.000Z");

describe("the report leaves are the reports the picker already runs", () => {
  test("six leaves, each with a real /api/reports path segment", () => {
    expect(REPORT_LEAVES).toHaveLength(6);
    // Every id is a value in ReportsClient's own DEFAULT_REPORT_COLUMNS.
    const pickerValues = [
      "project-status", "project-completion", "work-progress", "category-progress",
      "weekly-project", "attendance", "manpower-cost", "site-picture", "scope",
      "budget-summary", "budget-vs-actual", "material-consumption", "vendor-cost",
      "designer-timesheet", "kpi", "revenue", "expense",
    ];
    for (const leaf of REPORT_LEAVES) expect(pickerValues).toContain(leaf.id);
  });

  test("ids are unique and every leaf reads as a report name", () => {
    expect(new Set(REPORT_LEAVES.map((r) => r.id)).size).toBe(6);
    for (const leaf of REPORT_LEAVES) {
      expect(leaf.label).toMatch(/Report$/);
      expect(leaf.label).not.toContain("_");
    }
  });

  test("lookup by id", () => {
    expect(reportLeafById("work-progress")?.label).toBe("Work Progress Report");
    expect(reportLeafById("not-a-report")).toBeNull();
  });

  test("the strip is seeded with an entity segment, not a step", () => {
    expect(REPORTS_ENTITY_SEGMENT).toEqual({ id: "reports", label: "Reports", kind: "action" });
  });
});

describe("the period step", () => {
  test("it defaults to this month", () => {
    expect(DEFAULT_PERIOD).toBe("this-month");
    expect(periodLabel(DEFAULT_PERIOD)).toBe("this month");
    expect(PERIOD_OPTIONS[0].id).toBe(DEFAULT_PERIOD);
  });

  test("an open period ends today, never in the future", () => {
    expect(resolvePeriod("this-month", SEP_2)).toEqual({ from: "2026-09-01", to: "2026-09-02" });
    expect(resolvePeriod("this-quarter", SEP_2)).toEqual({ from: "2026-07-01", to: "2026-09-02" });
    expect(resolvePeriod("this-year", SEP_2)).toEqual({ from: "2026-01-01", to: "2026-09-02" });
  });

  test("a closed period ends on its own last day", () => {
    expect(resolvePeriod("last-month", SEP_2)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    // January's "last month" crosses the year boundary.
    expect(resolvePeriod("last-month", new Date("2026-01-15T00:00:00.000Z"))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  test("the quarter boundaries are the real ones", () => {
    expect(resolvePeriod("this-quarter", new Date("2026-01-05T00:00:00.000Z")).from).toBe("2026-01-01");
    expect(resolvePeriod("this-quarter", new Date("2026-06-30T00:00:00.000Z")).from).toBe("2026-04-01");
    expect(resolvePeriod("this-quarter", new Date("2026-12-31T00:00:00.000Z")).from).toBe("2026-10-01");
  });
});

describe("a leaf lands where the page's own button lands", () => {
  test("Work Progress goes to the one report screen D-02 names", () => {
    const url = reportRoute({ report: "work-progress", projectId: "p1", from: "2026-09-01", to: "2026-09-02" });
    expect(url.startsWith("/work-progress?")).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("tab")).toBe("report");
    expect(qs.get("projectId")).toBe("p1");
    expect(qs.get("from")).toBe("2026-09-01");
    expect(qs.get("to")).toBe("2026-09-02");
  });

  test("every other report opens the Reports screen with its picker set and told to run", () => {
    const url = reportRoute({ report: "attendance", projectId: "p1", from: "2026-09-01", to: "2026-09-02" });
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(url.startsWith("/reports?")).toBe(true);
    expect(qs.get("report")).toBe("attendance");
    expect(qs.get("run")).toBe("1");
    expect(qs.get("projectId")).toBe("p1");
  });

  test("with no project the URL simply omits it rather than sending 'null'", () => {
    const url = reportRoute({ report: "attendance", projectId: null, from: "2026-01-01", to: "2026-09-02" });
    expect(url).not.toContain("projectId");
  });
});

describe("the receipt line", () => {
  test("C-02's sentence, verbatim", () => {
    expect(
      reportReceiptLine({
        reportLabel: "Work Progress Report",
        projectName: CEDAR,
        from: "2026-01-01",
        to: "2026-09-02",
      })
    ).toBe("Ran Work Progress Report for Cedar Heights Villa - Phase 1, 01 Jan to 02 Sep 2026");
  });

  test("a range crossing a year prints both years", () => {
    expect(formatReportRange("2025-12-01", "2026-01-31")).toBe("01 Dec 2025 to 31 Jan 2026");
  });

  test("a receipt never omits which project it was for", () => {
    const line = reportReceiptLine({
      reportLabel: "Attendance Report",
      projectName: null,
      from: "2026-09-01",
      to: "2026-09-02",
    });
    expect(line).toBe("Ran Attendance Report for all projects, 01 Sep to 02 Sep 2026");
    expect(line).not.toContain("  ");
  });
});

describe("the levels the composer asks", () => {
  test("level 1 asks which report, and every option is a leaf", () => {
    const level = reportOptionsLevel();
    expect(level.legend).toBe("Which report?");
    expect(level.options).toHaveLength(6);
    expect(level.options.every((o) => o.isLeaf)).toBe(true);
    expect(level.options.map((o) => o.label)).toContain("Work Progress Report");
  });

  test("level 2 asks the period", () => {
    const level = periodOptionsLevel();
    expect(level.legend).toBe("Over what period?");
    expect(level.options.map((o) => o.id)).toEqual(["this-month", "last-month", "this-quarter", "this-year"]);
  });
});
