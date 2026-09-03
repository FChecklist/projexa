/// <reference types="bun-types" />
// BOTH LANES' TESTS, kept (D-11 addendum: "the arriving lane folds its distinct
// capability into it and keeps both sets of tests").
//
//  - Lane D0 (already on main): Sumeet's exact columns, one grid, and a week
//    view that is a FILTER over the same rows rather than a second grid.
//  - Lane H: the audit specifies EXACT wording for the Design Studio timesheet,
//    so the wording is asserted here rather than left to a screenshot -- a
//    reformat of the component cannot silently reword the primary button, the
//    empty state or the delete confirmation without this file failing.
import { describe, expect, test } from "bun:test";
import {
  TIMESHEET_STATUS_LABELS,
  costRowsFor,
  DESIGN_STUDIO_CATEGORIES,
  dayTotalLabel,
  deleteConfirmation,
  emptyDayMessage,
  filterToWeek,
  formatDayLabel,
  formatHours,
  formatVariancePercent,
  groupByDay,
  groupSubmittedByDesignerDay,
  headerStatus,
  isResubmittable,
  HOURS_OVER_DAY,
  HOURS_TOO_SMALL,
  requiredReason,
  rowStatus,
  savedMessage,
  saveLabel,
  submitDayLabel,
  toTimesheetRows,
  todayIso,
  totalHours,
  validateHours,
  variance,
  weekDates,
  weekStartOf,
  type TimesheetApiEntry,
} from "./design-studio-timesheet";

describe("the fixed Category list (item H-03)", () => {
  test("is exactly the seven categories the item names, in its order", () => {
    expect([...DESIGN_STUDIO_CATEGORIES]).toEqual([
      "Concept", "Design development", "Drawings", "Site visit", "Client meeting", "Revisions", "Admin",
    ]);
  });
});

describe("status chips -- glyph plus word, never colour alone", () => {
  test("the row-level vocabulary is D-07's: Draft / Submitted / Approved / Sent back", () => {
    expect(rowStatus("draft").label).toBe("Draft");
    expect(rowStatus("submitted").label).toBe("Submitted");
    expect(rowStatus("approved").label).toBe("Approved");
    expect(rowStatus("rejected").label).toBe("Sent back");
  });

  test("the object page header states the decision instead: Rejected, not Sent back", () => {
    expect(headerStatus("rejected").label).toBe("Rejected");
    expect(headerStatus("approved").label).toBe("Approved");
  });

  test("every status maps to a distinct tone, so the glyphs differ and are not just recoloured", () => {
    const tones = ["draft", "submitted", "approved", "rejected"].map((s) => rowStatus(s).tone);
    expect(new Set(tones).size).toBe(4);
  });

  test("an unknown status is shown as itself rather than silently rendering as Draft", () => {
    expect(rowStatus("something_new").label).toBe("something_new");
  });
});

describe("hours formatting and totals", () => {
  test("always two decimals", () => {
    expect(formatHours(7.5)).toBe("7.50");
    expect(formatHours("3")).toBe("3.00");
    expect(formatHours(0.25)).toBe("0.25");
  });

  test("a non-numeric value is shown as-is rather than as NaN", () => {
    expect(formatHours("not-a-number")).toBe("not-a-number");
  });

  test("totalHours sums the day and ignores a row whose hours are unusable", () => {
    expect(totalHours([{ hours: "3" }, { hours: 4.5 }])).toBe(7.5);
    expect(totalHours([{ hours: "3" }, { hours: "" }])).toBe(3);
  });
});

describe("day labels", () => {
  test("formatDayLabel renders the item's own '2 Sep 2026' shape", () => {
    expect(formatDayLabel("2026-09-02")).toBe("2 Sep 2026");
    expect(formatDayLabel("2026-01-09")).toBe("9 Jan 2026");
  });

  test("an unparseable value is returned unchanged rather than becoming 'NaN undefined'", () => {
    expect(formatDayLabel("")).toBe("");
    expect(formatDayLabel("2026-13-01")).toBe("2026-13-01");
  });

  test("todayIso is the UTC calendar day, matching how spent_on is stored", () => {
    expect(todayIso(new Date("2026-09-02T23:30:00Z"))).toBe("2026-09-02");
  });

  test("the footer total says 'today' only when it really is today", () => {
    expect(dayTotalLabel(7.5, "2026-09-02", "2026-09-02")).toBe("Total today: 7.50 h");
    expect(dayTotalLabel(7.5, "2026-09-01", "2026-09-02")).toBe("Total for 1 Sep 2026: 7.50 h");
  });
});

describe("the primary action label", () => {
  test("renders the item's exact string", () => {
    expect(submitDayLabel(4, 7.5, "2026-09-02", "2026-09-02")).toBe("Submit today (4 rows, 7.50 h)");
  });

  test("one row is singular, and a past day says 'Submit day'", () => {
    expect(submitDayLabel(1, 3, "2026-09-02", "2026-09-02")).toBe("Submit today (1 row, 3.00 h)");
    expect(submitDayLabel(2, 5, "2026-09-01", "2026-09-02")).toBe("Submit day (2 rows, 5.00 h)");
  });
});

describe("the empty state names the day and says what to do", () => {
  test("renders the item's exact string", () => {
    expect(emptyDayMessage("2026-09-02")).toBe("No hours logged for 2 Sep 2026. Add a row below.");
  });
});

describe("Hours validation", () => {
  test("zero, blank and negative all get the exact per-field sentence", () => {
    expect(validateHours("0")).toBe(HOURS_TOO_SMALL);
    expect(validateHours("")).toBe(HOURS_TOO_SMALL);
    expect(validateHours("-1")).toBe(HOURS_TOO_SMALL);
    expect(validateHours("abc")).toBe(HOURS_TOO_SMALL);
  });

  test("a valid quarter-hour passes", () => {
    expect(validateHours("0.25")).toBeNull();
    expect(validateHours("7.5")).toBeNull();
  });

  test("the 24-hour rule is about the DAY, not about one row", () => {
    expect(validateHours("2", 23)).toBe(HOURS_OVER_DAY);
    expect(validateHours("2", 21)).toBeNull();
    expect(validateHours("25")).toBe(HOURS_OVER_DAY);
  });
});

describe("the create screen's disabled-with-reason primary", () => {
  test("names what is missing, in the item's exact shape", () => {
    expect(saveLabel(["Task", "Hours"])).toBe("Save (2 required: Task, Hours)");
    expect(saveLabel(["Hours"])).toBe("Save (1 required: Hours)");
  });

  test("is a plain Save once nothing is missing", () => {
    expect(saveLabel([])).toBe("Save");
  });

  test("the landing receipt names the entry", () => {
    expect(savedMessage("TS-000123")).toBe("Timesheet entry TS-000123 saved");
  });
});

describe("the delete confirmation states the blast radius, not 'Are you sure?'", () => {
  const base = { ref: "TS-000123", hours: "3", spentOn: "2026-09-02", issue: { number: 12, title: "Joinery shop drawings" } };

  test("a submitted entry names the manager who will lose sight of it -- the item's exact sentence", () => {
    expect(deleteConfirmation({ ...base, approvalStatus: "submitted" }))
      .toBe("Delete entry TS-000123 - 3.00 h on #12 Joinery shop drawings, 2 Sep 2026? It is Submitted; your manager will no longer see it.");
  });

  test("an approved entry names the cost that stops counting -- a different consequence, so a different sentence", () => {
    expect(deleteConfirmation({ ...base, approvalStatus: "approved" }))
      .toContain("the hours will stop counting towards this project's cost.");
  });

  test("a draft says plainly that nobody has seen it", () => {
    expect(deleteConfirmation({ ...base, approvalStatus: "draft" })).toContain("nobody else has seen it yet.");
  });

  test("an entry whose task could not be resolved still produces a readable sentence", () => {
    expect(deleteConfirmation({ ...base, issue: null, approvalStatus: "draft" }))
      .toContain("3.00 h on this task, 2 Sep 2026?");
  });
});

describe("Budget | Actual | Variance | Variance %", () => {
  test("variance is budget minus actual -- positive means under budget", () => {
    expect(variance(1000, 800)).toEqual({ variance: 200, variancePercent: 20 });
    expect(variance(1000, 1200)).toEqual({ variance: -200, variancePercent: -20 });
  });

  // FIX PASS: this used to feed budget: 0, a value the real endpoint never
  // returns for byCategory -- it returns NULL. The null case is covered in its
  // own describe at the foot of this file; both are asserted so neither can
  // regress.
  test("an unbudgeted line has NO percentage rather than 0% or Infinity", () => {
    expect(variance(0, 500).variancePercent).toBeNull();
    expect(variance(null, 500).variancePercent).toBeNull();
    expect(formatVariancePercent(null)).toBe("-");
  });

  test("the percentage is signed and one-decimal", () => {
    expect(formatVariancePercent(20)).toBe("+20.0%");
    expect(formatVariancePercent(-12.34)).toBe("-12.3%");
  });
});

describe("requiredReason -- what ObjectScreen appends to its own 'Save'", () => {
  test("is the reason only, so the rendered primary reads 'Save (2 required: Task, Hours)'", () => {
    expect(requiredReason(["Task", "Hours"])).toBe("2 required: Task, Hours");
    expect(`Save (${requiredReason(["Task", "Hours"])})`).toBe(saveLabel(["Task", "Hours"]));
  });

  test("is undefined when nothing is missing, so the button is not disabled with an empty reason", () => {
    expect(requiredReason([])).toBeUndefined();
  });
});

describe("groupSubmittedByDesignerDay -- the review queue's unit of decision", () => {
  const entry = (id: string, designer: string, spentOn: string, status: string, hours = "2") => ({
    id, spentOn, hours, approvalStatus: status, loggedBy: { id: designer.toLowerCase(), name: designer },
  });

  test("groups a designer's submitted rows into ONE day a manager can decide on", () => {
    const groups = groupSubmittedByDesignerDay([
      entry("a", "Priya", "2026-09-02", "submitted", "3"),
      entry("b", "Priya", "2026-09-02", "submitted", "4.5"),
      entry("c", "Arjun", "2026-09-02", "submitted"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].designerName).toBe("Arjun");
    expect(groups[1].designerName).toBe("Priya");
    expect(groups[1].entries).toHaveLength(2);
  });

  test("a designer's two different days stay two separate decisions", () => {
    const groups = groupSubmittedByDesignerDay([
      entry("a", "Priya", "2026-09-02", "submitted"),
      entry("b", "Priya", "2026-09-01", "submitted"),
    ]);
    expect(groups.map((g) => g.spentOn)).toEqual(["2026-09-02", "2026-09-01"]);
  });

  test("drafts and already-decided rows never reach the manager's queue", () => {
    expect(groupSubmittedByDesignerDay([
      entry("a", "Priya", "2026-09-02", "draft"),
      entry("b", "Priya", "2026-09-02", "approved"),
      entry("c", "Priya", "2026-09-02", "rejected"),
    ])).toEqual([]);
  });

  test("an entry with no resolvable designer is still shown, named honestly, not dropped", () => {
    const groups = groupSubmittedByDesignerDay([
      { id: "a", spentOn: "2026-09-02", hours: "2", approvalStatus: "submitted", loggedBy: null },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].designerName).toBe("Unknown designer");
  });
});

describe("costRowsFor -- relabels the report, never re-derives it", () => {
  const report = {
    projectScoped: { byCategory: [{ category: "Drawings", budget: 1000, actual: 800 }] },
    orgWide: {
      byDesigner: [{ userName: "Priya", budget: 2000, actual: 2200 }],
      byProject: [{ projectName: "Cedar Heights Villa", budget: 5000, actual: 4000 }],
    },
  };

  test("each grouping reads its own cut, with the report's own figures", () => {
    expect(costRowsFor(report, "category")).toEqual([{ label: "Drawings", budget: 1000, actual: 800 }]);
    expect(costRowsFor(report, "designer")).toEqual([{ label: "Priya", budget: 2000, actual: 2200 }]);
    expect(costRowsFor(report, "project")).toEqual([{ label: "Cedar Heights Villa", budget: 5000, actual: 4000 }]);
  });

  test("a bucket whose name is missing is labelled honestly rather than dropped -- a dropped row is money that stops adding up", () => {
    expect(costRowsFor({ projectScoped: { byCategory: [{ budget: 10, actual: 5 }] } }, "category")[0].label).toBe("Uncategorized");
    expect(costRowsFor({ orgWide: { byDesigner: [{ budget: 10, actual: 5 }] } }, "designer")[0].label).toBe("Unknown designer");
  });

  test("no report yet is an empty list, not a crash", () => {
    expect(costRowsFor(null, "category")).toEqual([]);
    expect(costRowsFor({}, "designer")).toEqual([]);
  });
});

describe("isResubmittable -- what a designer can still act on themselves", () => {
  test("a draft and a returned entry are both theirs to fix and send", () => {
    expect(isResubmittable("draft")).toBe(true);
    expect(isResubmittable("rejected")).toBe(true);
  });

  test("a submitted entry belongs to the manager, and an approved one has already been counted as cost", () => {
    expect(isResubmittable("submitted")).toBe(false);
    expect(isResubmittable("approved")).toBe(false);
  });
});

// ── Lane D0's suite, unchanged ──────────────────────────────────────────────
const PROJECT = "Cedar Heights Villa — Phase 1";

const ENTRIES: TimesheetApiEntry[] = [
  {
    id: "t1",
    issueId: "i1",
    hours: "2.5",
    spentOn: "2026-09-02",
    activityType: "Design",
    approvalStatus: "submitted",
    issue: { id: "i1", number: 14, title: "Lobby elevation" },
  },
  {
    id: "t2",
    issueId: "i2",
    hours: "4",
    spentOn: "2026-09-01",
    activityType: null,
    approvalStatus: "approved",
    issue: { id: "i2", number: 15, title: "FF&E schedule" },
  },
  {
    id: "t3",
    issueId: "i1",
    hours: "1.5",
    spentOn: "2026-09-02",
    activityType: "Coordination",
    approvalStatus: "rejected",
    issue: { id: "i1", number: 14, title: "Lobby elevation" },
  },
];

describe("the status vocabulary", () => {
  test('"rejected" reads as "Sent back", the word D-07 names', () => {
    expect(TIMESHEET_STATUS_LABELS).toEqual({
      draft: "Draft",
      submitted: "Submitted",
      approved: "Approved",
      rejected: "Sent back",
    });
  });
});

describe("toTimesheetRows -- Date | Project | Category | Task | Hours, status at row level", () => {
  const rows = toTimesheetRows(ENTRIES, PROJECT);

  test("newest day first", () => {
    expect(rows.map((r) => r.date)).toEqual(["2026-09-02", "2026-09-02", "2026-09-01"]);
  });

  test("every column comes from real data, none invented", () => {
    expect(rows[0]).toEqual({
      id: "t1",
      date: "2026-09-02",
      project: PROJECT,
      category: "Design",
      task: "#14 Lobby elevation",
      hours: 2.5,
      status: "submitted",
      issueId: "i1",
    });
  });

  test("an entry with no activity type shows the en-dash, never a blank cell", () => {
    expect(rows.find((r) => r.id === "t2")?.category).toBe("–");
  });

  test("hours arrive as a numeric string and become a number", () => {
    expect(rows.find((r) => r.id === "t2")?.hours).toBe(4);
  });

  test("an unknown or missing approval status is treated as Draft, the column's default", () => {
    const [row] = toTimesheetRows(
      [{ id: "x", issueId: "i9", hours: "1", spentOn: "2026-09-02", approvalStatus: null, issue: null }],
      PROJECT
    );
    expect(row.status).toBe("draft");
  });

  test("a row whose task did not join shows words, never the raw id", () => {
    const [row] = toTimesheetRows(
      [{ id: "x", issueId: "issue_01HZX", hours: "1", spentOn: "2026-09-02", issue: null }],
      PROJECT
    );
    expect(row.task).toBe("Untitled task");
    expect(row.task).not.toContain("issue_01HZX");
  });
});

describe("groupByDay -- the day grid", () => {
  const days = groupByDay(toTimesheetRows(ENTRIES, PROJECT));

  test("one group per date, newest first", () => {
    expect(days.map((d) => d.date)).toEqual(["2026-09-02", "2026-09-01"]);
  });

  test("each day carries its own hours total", () => {
    expect(days[0].totalHours).toBe(4);
    expect(days[1].totalHours).toBe(4);
  });

  test("one row per task, not one row per day", () => {
    expect(days[0].rows.map((r) => r.id)).toEqual(["t1", "t3"]);
  });
});

describe("totalHours", () => {
  test("adds up without a float artefact", () => {
    const rows = toTimesheetRows(
      [0.1, 0.2, 0.3].map((h, i) => ({ id: `f${i}`, issueId: "i1", hours: String(h), spentOn: "2026-09-02", issue: null })),
      PROJECT
    );
    expect(totalHours(rows)).toBe(0.6);
  });
});

describe("the week view is a filter over the same rows", () => {
  test("weekStartOf returns the Monday on or before the date", () => {
    expect(weekStartOf("2026-09-02")).toBe("2026-08-31"); // a Wednesday -> that Monday
    expect(weekStartOf("2026-08-31")).toBe("2026-08-31"); // a Monday is its own week start
    expect(weekStartOf("2026-09-06")).toBe("2026-08-31"); // a Sunday belongs to the week that began
  });

  test("weekDates spans exactly seven days", () => {
    expect(weekDates("2026-08-31")).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });

  test("filterToWeek keeps the rows inside the week and drops the rest -- same row objects", () => {
    const rows = toTimesheetRows(
      [...ENTRIES, { id: "old", issueId: "i1", hours: "8", spentOn: "2026-08-20", issue: null }],
      PROJECT
    );
    const week = filterToWeek(rows, "2026-08-31");
    expect(week.map((r) => r.id)).toEqual(["t1", "t3", "t2"]);
    expect(week[0]).toBe(rows[0]);
  });
});

// ── Lane H's regression for the fix pass ────────────────────────────────────
// The Cost analysis screen rendered "-Infinity%" on its DEFAULT tab. VERIDIAN's
// designerTimesheetReport returns projectScoped.byCategory[].budget as NULL by
// design ("No per-category budget dimension exists in pms_budget_line_items").
// The old 0-budget test passed while the real data path was broken, because
// null is not 0.
describe("an unbudgeted line reports NO variance, not -Infinity%", () => {
  test("variance(null, actual) -- the shape the real endpoint returns for a category", () => {
    expect(variance(null, 800)).toEqual({ variance: null, variancePercent: null });
    expect(formatVariancePercent(variance(null, 800).variancePercent)).toBe("-");
  });

  test("a zero budget is still no percentage, and still not a -0% claim", () => {
    expect(variance(0, 800)).toEqual({ variance: null, variancePercent: null });
  });

  test("a real budget still computes exactly as before", () => {
    expect(variance(1000, 800)).toEqual({ variance: 200, variancePercent: 20 });
    expect(variance(1000, 1200)).toEqual({ variance: -200, variancePercent: -20 });
  });

  test("costRowsFor carries a null budget through instead of coercing it to a 0 that was never real", () => {
    const rows = costRowsFor(
      { projectScoped: { byCategory: [{ category: "Drawings", budget: null, actual: 800 }] } },
      "category"
    );
    expect(rows).toEqual([{ label: "Drawings", budget: null, actual: 800 }]);
    expect(variance(rows[0].budget, rows[0].actual).variancePercent).toBeNull();
  });
});

// The merged totalHours(): D0's rounding, lane H's parameter type.
describe("totalHours accepts both lanes' inputs", () => {
  test("string hours straight off the API", () => {
    expect(totalHours([{ hours: "3" }, { hours: "4.5" }])).toBe(7.5);
  });

  test("a non-numeric value contributes nothing rather than making the whole total NaN", () => {
    expect(totalHours([{ hours: "3" }, { hours: "not a number" }])).toBe(3);
  });
});
