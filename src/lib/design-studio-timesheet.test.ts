/// <reference types="bun-types" />
// R67 D-07 -- Sumeet's exact columns, one grid, and a week view that is a
// FILTER over the same rows rather than a second grid.
import { describe, expect, test } from "bun:test";
import {
  TIMESHEET_STATUS_LABELS,
  filterToWeek,
  groupByDay,
  toTimesheetRows,
  totalHours,
  weekDates,
  weekStartOf,
  type TimesheetApiEntry,
} from "./design-studio-timesheet";

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
