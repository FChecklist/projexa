/// <reference types="bun-types" />
// R67 E-16 (R-150). The three places this screen could quietly lie, asserted.
import { describe, expect, test } from "bun:test";
import {
  COST_ANALYSIS_SECTIONS,
  NO_BUDGET_LINES,
  NO_HOURS_LOGGED,
  barScale,
  barWidthPercent,
  costAnalysisSection,
  currentMonth,
  sectionEmptyMessage,
  sortByVariance,
  varianceVerdict,
  type CostAnalysisRow,
  type DesignerTimesheetPayload,
} from "./design-studio-cost-analysis";

const PAYLOAD: DesignerTimesheetPayload = {
  period: { from: "2026-09-01", to: "2026-09-03" },
  projectScoped: {
    byUser: [{ userId: "u1", userName: "Alice", totalHours: 12 }],
    byCategory: [
      { category: "Concept", hours: 8, actual: 400, budget: null },
      { category: "Drawings", hours: 4, actual: 200, budget: null },
    ],
    byDesignerStatus: [
      { status: "active", budget: 1000, actual: 600, variance: 400 },
      { status: "inactive", budget: 0, actual: 0, variance: 0 },
    ],
    overallBudget: 1000,
    overallActual: 600,
    overallVariance: 400,
  },
  orgWide: {
    byDesigner: [
      { userId: "u1", userName: "Alice", hours: 30, budget: 1000, actual: 1500, variance: -500 },
      { userId: "u2", userName: "Bob", hours: 5, budget: 800, actual: 200, variance: 600 },
    ],
    byProject: [
      { projectId: "p1", projectName: "Cedar Heights", budget: 1000, actual: 600, variance: 400 },
      { projectId: "p2", projectName: "Marina Tower", budget: 500, actual: 900, variance: -400 },
    ],
  },
};

describe("the four sections are the ones the item names, in its order", () => {
  test("headings, verbatim", () => {
    expect(COST_ANALYSIS_SECTIONS.map((s) => s.heading)).toEqual([
      "By Category",
      "By Designer",
      "By Project",
      "Designer Status",
    ]);
  });
});

describe("a row with no budget is never drawn as 100% under", () => {
  test("byCategory carries budget null, because the source has no per-category budget dimension", () => {
    const rows = costAnalysisSection(PAYLOAD, "category");
    expect(rows.map((r) => r.budget)).toEqual([null, null]);
    expect(rows[0].actual).toBe(400);
    expect(rows[0].hours).toBe(8);
  });

  test("its verdict says so in words rather than claiming a saving", () => {
    const verdict = varianceVerdict({ key: "c", label: "Concept", budget: null, actual: 400, hours: 8 });
    expect(verdict.kind).toBe("no-budget");
    expect(verdict.word).toBe("no budget set");
    expect(verdict.amount).toBe(0);
  });

  test("and its bar has no width, rather than a full track", () => {
    expect(barWidthPercent(null, 1000)).toBe(0);
  });
});

describe("direction is carried by a word and a glyph, never by colour alone", () => {
  const row = (budget: number | null, actual: number): CostAnalysisRow => ({ key: "k", label: "L", budget, actual, hours: null });

  test("over budget", () => {
    const v = varianceVerdict(row(1000, 1500));
    expect(v.word).toBe("over");
    expect(v.glyph).toBe("▲");
    expect(v.amount).toBe(500);
  });

  test("under budget", () => {
    const v = varianceVerdict(row(1000, 600));
    expect(v.word).toBe("under");
    expect(v.glyph).toBe("▼");
    expect(v.amount).toBe(400);
  });

  test("exactly on budget is its own state, not a rounding of 'under'", () => {
    const v = varianceVerdict(row(1000, 1000));
    expect(v.word).toBe("on budget");
    expect(v.amount).toBe(0);
  });
});

describe("sorting puts the worst overrun first", () => {
  test("by variance descending, with no-budget rows last in their own order", () => {
    const rows: CostAnalysisRow[] = [
      { key: "a", label: "Under", budget: 1000, actual: 400, hours: null },
      { key: "b", label: "Zulu", budget: null, actual: 90, hours: null },
      { key: "c", label: "Over", budget: 1000, actual: 1900, hours: null },
      { key: "d", label: "Alpha", budget: null, actual: 10, hours: null },
    ];
    expect(sortByVariance(rows).map((r) => r.label)).toEqual(["Over", "Under", "Alpha", "Zulu"]);
  });

  test("the input array is never mutated", () => {
    const rows: CostAnalysisRow[] = [
      { key: "a", label: "A", budget: 1, actual: 9, hours: null },
      { key: "b", label: "B", budget: 1, actual: 0, hours: null },
    ];
    sortByVariance(rows);
    expect(rows.map((r) => r.label)).toEqual(["A", "B"]);
  });
});

describe("bars are scaled inside their own section", () => {
  test("the scale is the largest figure in that section, budget or actual", () => {
    expect(barScale(costAnalysisSection(PAYLOAD, "designer"))).toBe(1500);
    expect(barScale(costAnalysisSection(PAYLOAD, "project"))).toBe(1000);
  });

  test("a width is clamped to its track", () => {
    expect(barWidthPercent(1500, 1500)).toBe(100);
    expect(barWidthPercent(750, 1500)).toBe(50);
    expect(barWidthPercent(9999, 1500)).toBe(100);
    expect(barWidthPercent(100, 0)).toBe(0);
  });
});

describe("the designer cut shows the hours logged on THIS project where it has them", () => {
  test("byUser's project-scoped hours win over the org-wide figure", () => {
    const rows = costAnalysisSection(PAYLOAD, "designer");
    expect(rows.find((r) => r.key === "u1")!.hours).toBe(12); // not 30, the org-wide total
    // A designer with no entry on this project keeps the org-wide figure rather
    // than being shown as zero hours, which would be a different claim.
    expect(rows.find((r) => r.key === "u2")!.hours).toBe(5);
  });
});

describe("the designer-status cut names its two buckets in words", () => {
  test("active / inactive become readable labels", () => {
    expect(costAnalysisSection(PAYLOAD, "status").map((r) => r.label)).toEqual([
      "Active designers",
      "Inactive designers",
    ]);
  });
});

describe("an empty section says WHY it is empty", () => {
  test("no budget lines at all", () => {
    expect(sectionEmptyMessage([], false)).toBe(NO_BUDGET_LINES);
  });

  test("budgets exist but nothing was logged in the period -- a different fact", () => {
    expect(sectionEmptyMessage([], true)).toBe(NO_HOURS_LOGGED);
  });

  test("a section with rows says nothing", () => {
    expect(sectionEmptyMessage([{ key: "k", label: "L", budget: 1, actual: 1, hours: null }], true)).toBeNull();
  });
});

describe("the default period is the current month to date", () => {
  test("from the 1st to today, in UTC so it cannot drift by a time zone", () => {
    expect(currentMonth(new Date("2026-09-03T22:00:00.000Z"))).toEqual({ from: "2026-09-01", to: "2026-09-03" });
  });
});
