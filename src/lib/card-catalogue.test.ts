import { describe, expect, test } from "bun:test";
import {
  CARD_CATALOGUE,
  DEFAULT_PERIOD,
  DESIGN_STUDIO_CARD,
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
  cardForRoute,
  cardOwnsRoute,
  coldStartCards,
  matchTaskTitles,
  resolveTaskTitle,
  timesheetReceiptLine,
  timesheetRoute,
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

// --- R67 C-03 -------------------------------------------------------------

const TASKS = [
  { id: "i12", number: 12, title: "Joinery shop drawings" },
  { id: "i13", number: 13, title: "Joinery site survey" },
  { id: "i14", number: 14, title: "Facade cladding" },
];

describe("the Design Studio card", () => {
  test("it is an action card wired to the pipeline's second write", () => {
    expect(DESIGN_STUDIO_CARD.kind).toBe("action");
    expect(DESIGN_STUDIO_CARD.functionId).toBe("record_timesheet");
    expect(DESIGN_STUDIO_CARD.label).toBe("Design Studio");
    expect(CARD_CATALOGUE).toContain(DESIGN_STUDIO_CARD);
  });

  test("its placeholder is C-03's own example sentence", () => {
    expect(DESIGN_STUDIO_CARD.placeholder).toBe("e.g. 3 hours on #12 joinery shop drawings today");
  });

  test("it owns both the Design Studio route and the real log-time screen", () => {
    expect(cardOwnsRoute(DESIGN_STUDIO_CARD, "/schedule/log-time")).toBe(true);
    expect(cardOwnsRoute(DESIGN_STUDIO_CARD, "/design-studio")).toBe(true);
    expect(cardOwnsRoute(DESIGN_STUDIO_CARD, "/design-studio/timesheet")).toBe(true);
    expect(cardOwnsRoute(DESIGN_STUDIO_CARD, "/schedule")).toBe(false);
    // A route that merely starts with the same letters is NOT the card's.
    expect(cardOwnsRoute(DESIGN_STUDIO_CARD, "/design-studio-archive")).toBe(false);
  });

  test("cardForRoute finds the chain a route should seed", () => {
    expect(cardForRoute("/schedule/log-time")).toBe(DESIGN_STUDIO_CARD);
    expect(cardForRoute("/labour")).toBeNull();
    expect(cardForRoute("")).toBeNull();
  });

  test("it is cold-started for designer roles, and offered on its own screen to anyone", () => {
    expect(coldStartCards("designer", "/labour")).toEqual([DESIGN_STUDIO_CARD]);
    expect(coldStartCards("DESIGNER", "/labour")).toEqual([DESIGN_STUDIO_CARD]);
    expect(coldStartCards("member", "/labour")).toEqual([]);
    expect(coldStartCards("member", "/schedule/log-time")).toEqual([DESIGN_STUDIO_CARD]);
    expect(coldStartCards(null, "/labour")).toEqual([]);
  });
});

describe("matchTaskTitles mirrors the executor's own fuzzy match", () => {
  test("an issue number is exact", () => {
    expect(matchTaskTitles(TASKS, "#12").map((t) => t.id)).toEqual(["i12"]);
    expect(matchTaskTitles(TASKS, "12").map((t) => t.id)).toEqual(["i12"]);
  });

  test("words in any order find the real task", () => {
    expect(matchTaskTitles(TASKS, "joinery drawings").map((t) => t.id)).toEqual(["i12"]);
    expect(matchTaskTitles(TASKS, "shop drawings").map((t) => t.id)).toEqual(["i12"]);
  });

  test("*** an ambiguous needle returns every match so the caller can refuse ***", () => {
    expect(matchTaskTitles(TASKS, "joinery").map((t) => t.id)).toEqual(["i12", "i13"]);
    expect(resolveTaskTitle(TASKS, "joinery")).toBeNull();
    expect(resolveTaskTitle(TASKS, "joinery drawings")?.id).toBe("i12");
  });

  test("nothing matches nothing", () => {
    expect(matchTaskTitles(TASKS, "plumbing")).toEqual([]);
    expect(matchTaskTitles(TASKS, "")).toEqual([]);
    expect(resolveTaskTitle([], "joinery")).toBeNull();
  });
});

describe("the timesheet receipt", () => {
  test("C-03's line, with the hours to two places and the real task named", () => {
    expect(timesheetReceiptLine({ hours: "3", task: TASKS[0] })).toBe("Logged 3.00 h on #12 Joinery shop drawings");
    expect(timesheetReceiptLine({ hours: 2.5, task: TASKS[2] })).toBe("Logged 2.50 h on #14 Facade cladding");
  });

  test("with no resolved task it still reads as a sentence", () => {
    expect(timesheetReceiptLine({ hours: 1, task: null })).toBe("Logged 1.00 h on this task");
  });

  test("the right pane lands on the project's own timesheet tab", () => {
    expect(timesheetRoute("p1")).toBe("/schedule?projectId=p1&tab=timesheet");
    expect(timesheetRoute(null)).toBe("/schedule?tab=timesheet");
  });
});
