/// <reference types="bun-types" />
// R67 E-09 (R-128) + E-10 (R-129). A run is addressable: what the URL says is
// what the screen shows, and what the screen shows is what the URL gets back.
import { describe, expect, test } from "bun:test";
import {
  readReportRunParams,
  reportRunSearchParams,
  reportTitleBlock,
  periodLabel,
  monthToDateRange,
  isStaleRun,
  runningLine,
  STALE_AFTER_MS,
  RUN_TIMEOUT_MESSAGE,
  NO_PROJECT_MESSAGE,
  UNKNOWN_REPORT_MESSAGE,
} from "./report-run";
import { WHOLE_PROJECT_PERIOD } from "./report-parameters";

const TODAY = new Date("2026-09-02T10:15:00.000Z");

describe("a run lives in the URL (R67 E-09)", () => {
  test("reads every parameter a run is made of", () => {
    const run = readReportRunParams(
      new URLSearchParams("report=project-status&projectId=p-1&from=2026-01-01&to=2026-09-02&weekStart=2026-08-31"),
      { report: "project-status", projectId: null, today: TODAY }
    );
    expect(run).toEqual({ report: "project-status", projectId: "p-1", from: "2026-01-01", to: "2026-09-02", weekStart: "2026-08-31", category: null, vendorId: null });
  });

  // R67 E-11 (R-130): a Category and a Vendor choice are part of a run too, so
  // a filtered run is exactly as shareable as an unfiltered one.
  test("carries the Category and Vendor choices, and 'All' is the ABSENCE of one rather than a value", () => {
    const filtered = readReportRunParams(
      new URLSearchParams("report=vendor-cost&projectId=p-1&category=Civil&vendorId=v-2"),
      { report: "project-status", projectId: null, today: TODAY }
    );
    expect(filtered.category).toBe("Civil");
    expect(filtered.vendorId).toBe("v-2");

    const unfiltered = readReportRunParams(new URLSearchParams(), { report: "kpi", projectId: "p-1", today: TODAY });
    expect(unfiltered.category).toBeNull();
    expect(unfiltered.vendorId).toBeNull();
    expect(reportRunSearchParams(unfiltered).get("category")).toBeNull();
  });

  // R67 E-11: NOT defaulted to today. The weekly report's backend hard-rejects
  // a week start that is not a Monday, so inventing one here is what would make
  // the primary pressable into a 400.
  test("an absent week start stays absent, so the primary can say what is missing", () => {
    expect(readReportRunParams(new URLSearchParams(), { report: "weekly-project", projectId: "p-1", today: TODAY }).weekStart).toBe("");
    expect(reportRunSearchParams({ report: "weekly-project", projectId: "p-1", from: "2026-08-01", to: "2026-08-31", weekStart: "", category: null, vendorId: null }).get("weekStart")).toBeNull();
  });

  test("an absent period is month-to-date, so the screen runs on arrival instead of waiting for a click", () => {
    const run = readReportRunParams(new URLSearchParams(), { report: "project-status", projectId: "p-1", today: TODAY });
    expect(run.from).toBe("2026-09-01");
    expect(run.to).toBe("2026-09-02");
  });

  test("the project falls back to the one the rail has selected", () => {
    expect(readReportRunParams(new URLSearchParams(), { report: "kpi", projectId: "p-rail", today: TODAY }).projectId).toBe("p-rail");
  });

  test("round-trips: writing a run back and reading it again gives the same run", () => {
    const run = { report: "weekly-project", projectId: "p-1", from: "2026-08-01", to: "2026-08-31", weekStart: "2026-08-03", category: "Civil", vendorId: "v-2" };
    expect(readReportRunParams(reportRunSearchParams(run), { report: "project-status", projectId: null, today: TODAY })).toEqual(run);
  });

  test("weekStart is only carried for the report that needs it -- an irrelevant parameter in a shared URL is noise", () => {
    const qs = reportRunSearchParams({ report: "project-status", projectId: "p-1", from: "2026-08-01", to: "2026-08-31", weekStart: "2026-08-03", category: null, vendorId: null });
    expect(qs.get("weekStart")).toBeNull();
    expect(qs.get("report")).toBe("project-status");
  });
});

describe("reportTitleBlock (R67 E-09)", () => {
  test("names the report, the project, the period and the time it ran", () => {
    const block = reportTitleBlock({
      reportLabel: "Project Status",
      projectName: "Cedar Heights Villa - Phase 1",
      from: "2026-01-01",
      to: "2026-09-02",
      ranAt: new Date(2026, 8, 2, 14, 32),
    });
    expect(block).toBe("Project Status Report · Cedar Heights Villa - Phase 1 · 01 Jan to 02 Sep 2026 · run 14:32");
  });

  test("an org-wide run with no project still reads as a sentence, with no empty gap", () => {
    const block = reportTitleBlock({ reportLabel: "Revenue", projectName: null, from: "2026-09-01", to: "2026-09-02", ranAt: new Date(2026, 8, 2, 9, 5) });
    expect(block).toBe("Revenue Report · 01 Sep to 02 Sep 2026 · run 09:05");
  });

  // R67 E-11: most of these reports take a projectId and nothing else, so
  // printing the From/To window above one said the run covered that window when
  // it covered the whole project -- a false statement in the one line whose job
  // is to make a screenshot self-describing.
  test("a report the period does not touch is captioned with what it DOES cover", () => {
    const block = reportTitleBlock({
      reportLabel: "Project Status",
      projectName: "Cedar Heights Villa - Phase 1",
      from: "2026-01-01",
      to: "2026-09-02",
      ranAt: new Date(2026, 8, 2, 14, 32),
      periodText: WHOLE_PROJECT_PERIOD,
    });
    expect(block).toBe("Project Status Report · Cedar Heights Villa - Phase 1 · whole project to date · run 14:32");
  });
});

describe("periodLabel", () => {
  test("prints the year once, on the end date, where it belongs in a period", () => {
    expect(periodLabel("2026-01-01", "2026-09-02")).toBe("01 Jan to 02 Sep 2026");
  });

  test("a period that crosses a year prints both years", () => {
    expect(periodLabel("2025-12-28", "2026-01-04")).toBe("28 Dec 2025 to 04 Jan 2026");
  });

  test("an unparseable date is shown as it is, never as 'NaN undefined'", () => {
    expect(periodLabel("not-a-date", "2026-01-04")).toBe("not-a-date to 2026-01-04");
  });
});

describe("staleness and the running line (R67 E-09 / E-10)", () => {
  test("a result older than five minutes is stale; one inside it is not", () => {
    const ranAt = new Date("2026-09-02T10:00:00.000Z");
    expect(isStaleRun(ranAt, new Date(ranAt.getTime() + STALE_AFTER_MS - 1))).toBe(false);
    expect(isStaleRun(ranAt, new Date(ranAt.getTime() + STALE_AFTER_MS + 1))).toBe(true);
  });

  test("a run that has never happened is not stale -- it is absent, which is a different state", () => {
    expect(isStaleRun(null)).toBe(false);
  });

  test("the running line names the report, the project and what normal looks like", () => {
    expect(runningLine("Project Status", "Cedar Heights Villa - Phase 1"))
      .toBe("Running Project Status for Cedar Heights Villa - Phase 1... usually 2-3 s");
  });

  test("with no project it still says what is running", () => {
    expect(runningLine("Revenue", null)).toBe("Running Revenue... usually 2-3 s");
  });
});

describe("the copy this screen is held to", () => {
  test("the timeout, the no-project and the unknown-slug sentences are the item's own words", () => {
    expect(RUN_TIMEOUT_MESSAGE).toBe("This report is taking too long. Retry, or open Work Progress > Report for the tabular WPR.");
    expect(NO_PROJECT_MESSAGE).toBe("Select a project in the top rail to run project reports.");
    expect(UNKNOWN_REPORT_MESSAGE).toBe("This report does not exist. Choose one from the list.");
  });

  test("month-to-date is a real month-to-date, not a two-day window", () => {
    expect(monthToDateRange(new Date("2026-09-02T00:00:00.000Z"))).toEqual({ from: "2026-09-01", to: "2026-09-02" });
    expect(monthToDateRange(new Date("2026-09-30T00:00:00.000Z"))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});
