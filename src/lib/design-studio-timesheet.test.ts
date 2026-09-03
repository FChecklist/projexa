/// <reference types="bun-types" />
// R67 WS-H. The audit specifies EXACT wording for the Design Studio
// timesheet, so the wording is asserted here rather than left to a
// screenshot: a reformat of the component cannot silently reword the
// primary button, the empty state or the delete confirmation without this
// file failing.
import { describe, expect, test } from "bun:test";
import {
  costRowsFor,
  DESIGN_STUDIO_CATEGORIES,
  dayTotalLabel,
  deleteConfirmation,
  emptyDayMessage,
  formatDayLabel,
  formatHours,
  formatVariancePercent,
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
  todayIso,
  totalHours,
  validateHours,
  variance,
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

  test("an unbudgeted line has NO percentage rather than 0% or Infinity", () => {
    expect(variance(0, 500).variancePercent).toBeNull();
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
