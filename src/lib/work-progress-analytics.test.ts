import { describe, expect, test } from "bun:test";
import {
  MEASURE_LABEL,
  UNLINKED_PROGRESS_NOTE,
  defaultReportRange,
  measuresDisagree,
  mergeCategoryMeasures,
  sortByMeasure,
  type CategoryMeasureRow,
} from "./work-progress-analytics";

const LOGGED = [
  { categoryId: "c1", name: "Civil", percentComplete: 60 },
  { categoryId: "c2", name: "Gypsum", percentComplete: 42 },
];

describe("mergeCategoryMeasures", () => {
  test("carries BOTH measures on one row, matched by name", () => {
    const rows = mergeCategoryMeasures(LOGGED, [
      { name: "Civil", percentage: { total: 25 } },
      { name: "Gypsum", percentage: { total: 0 } },
    ]);
    expect(rows).toEqual([
      { categoryId: "c1", name: "Civil", loggedPercent: 60, earnedPercent: 25 },
      { categoryId: "c2", name: "Gypsum", loggedPercent: 42, earnedPercent: 0 },
    ]);
  });

  test("the name match is case-insensitive -- the two endpoints group by different keys", () => {
    const rows = mergeCategoryMeasures([{ categoryId: "c1", name: "Civil", percentComplete: 60 }], [
      { name: "civil", percentage: { total: 30 } },
    ]);
    expect(rows[0].earnedPercent).toBe(30);
  });

  test("earned is NULL, not 0, while the Work Progress Report has not answered", () => {
    const rows = mergeCategoryMeasures(LOGGED, null);
    expect(rows.every((r) => r.earnedPercent === null)).toBe(true);
  });

  test("a category only the BOQ knows about is still listed -- dropping it would hide BOQ value", () => {
    const rows = mergeCategoryMeasures(LOGGED, [{ name: "Joinery", percentage: { total: 12 } }]);
    const joinery = rows.find((r) => r.name === "Joinery")!;
    expect(joinery.loggedPercent).toBe(0);
    expect(joinery.earnedPercent).toBe(12);
    expect(joinery.categoryId).toBeNull();
  });

  test("a category present in both is not listed twice", () => {
    const rows = mergeCategoryMeasures(LOGGED, [{ name: "Civil", percentage: { total: 25 } }]);
    expect(rows.filter((r) => r.name === "Civil")).toHaveLength(1);
  });
});

describe("sortByMeasure", () => {
  const rows: CategoryMeasureRow[] = [
    { categoryId: "a", name: "A", loggedPercent: 10, earnedPercent: 80 },
    { categoryId: "b", name: "B", loggedPercent: 90, earnedPercent: 5 },
  ];

  test("the chosen measure decides the order", () => {
    expect(sortByMeasure(rows, "logged").map((r) => r.name)).toEqual(["B", "A"]);
    expect(sortByMeasure(rows, "earned").map((r) => r.name)).toEqual(["A", "B"]);
  });

  test("an unknown earned value sorts last -- unknown is not zero", () => {
    const withNull: CategoryMeasureRow[] = [
      { categoryId: "x", name: "X", loggedPercent: 1, earnedPercent: null },
      { categoryId: "y", name: "Y", loggedPercent: 1, earnedPercent: 0 },
    ];
    expect(sortByMeasure(withNull, "earned").map((r) => r.name)).toEqual(["Y", "X"]);
  });

  test("sorting does not mutate the caller's array", () => {
    const original = rows.map((r) => r.name);
    sortByMeasure(rows, "logged");
    expect(rows.map((r) => r.name)).toEqual(original);
  });
});

describe("measuresDisagree", () => {
  test("true only for the one disagreement that has a fix: real logged progress, nothing earned anywhere", () => {
    expect(measuresDisagree([{ categoryId: "a", name: "A", loggedPercent: 60, earnedPercent: 0 }])).toBe(true);
  });

  test("false when something is earned -- two measures that merely differ are expected", () => {
    expect(measuresDisagree([
      { categoryId: "a", name: "A", loggedPercent: 60, earnedPercent: 25 },
      { categoryId: "b", name: "B", loggedPercent: 42, earnedPercent: 0 },
    ])).toBe(false);
  });

  test("false when nothing has been logged either -- there is nothing to explain", () => {
    expect(measuresDisagree([{ categoryId: "a", name: "A", loggedPercent: 0, earnedPercent: 0 }])).toBe(false);
  });

  test("false while the report has not answered -- a pending read is not a disagreement", () => {
    expect(measuresDisagree([{ categoryId: "a", name: "A", loggedPercent: 60, earnedPercent: null }])).toBe(false);
  });

  test("false with no categories at all", () => {
    expect(measuresDisagree([])).toBe(false);
  });

  test("the sentence is fixed, and names the fix", () => {
    expect(UNLINKED_PROGRESS_NOTE).toBe(
      "Logged progress is not yet linked to BOQ lines, so earned value is 0% - link entries to BOQ lines when recording progress."
    );
    expect(MEASURE_LABEL.logged).toBe("Logged %");
    expect(MEASURE_LABEL.earned).toBe("Earned %");
  });
});

describe("defaultReportRange", () => {
  const today = new Date("2026-09-03T10:00:00.000Z");

  test("from = the project's earliest entry, to = today", () => {
    expect(defaultReportRange([{ entryDate: "2026-08-25" }, { entryDate: "2026-08-20" }], today)).toEqual({
      from: "2026-08-20",
      to: "2026-09-03",
    });
  });

  test("a timestamped entry date is read as its calendar day", () => {
    expect(defaultReportRange([{ entryDate: "2026-08-20T18:30:00.000Z" }], today).from).toBe("2026-08-20");
  });

  test("no entries at all gives today to today rather than an invalid window", () => {
    expect(defaultReportRange([], today)).toEqual({ from: "2026-09-03", to: "2026-09-03" });
  });

  test("an unparseable entry date is ignored, not turned into an invalid range", () => {
    expect(defaultReportRange([{ entryDate: "not a date" }, { entryDate: "2026-08-25" }], today).from).toBe("2026-08-25");
  });
});
