import { describe, expect, test } from "bun:test";
import {
  budgetCardModel,
  cumulativeProgressSeries,
  oneDayAxis,
  oneDayCaption,
  primaryTrendLabel,
} from "./project-dashboard-charts";

const money = (v: number | null) => (v === null ? "–" : `AED ${v.toLocaleString("en-US")}`);

describe("cumulativeProgressSeries", () => {
  test("groups by DAY and accumulates across days, oldest first", () => {
    const series = cumulativeProgressSeries([
      { entryDate: "2026-08-26", quantityDone: "5" },
      { entryDate: "2026-08-25", quantityDone: "10" },
      { entryDate: "2026-08-25", quantityDone: "2" },
    ]);
    expect(series.points).toEqual([
      { label: "25 Aug", value: 12 },
      { label: "26 Aug", value: 17 },
    ]);
    expect(series.distinctDays).toBe(2);
  });

  test("uses EVERY entry, not the last five rows", () => {
    const entries = Array.from({ length: 9 }, (_, i) => ({
      entryDate: `2026-08-${String(10 + i).padStart(2, "0")}`,
      quantityDone: 1,
    }));
    const series = cumulativeProgressSeries(entries);
    expect(series.distinctDays).toBe(9);
    expect(series.points[8].value).toBe(9);
    // The cumulative line starts from the project's real first day, not from
    // wherever a five-row window happened to begin.
    expect(series.points[0].value).toBe(1);
  });

  test("two entries on one day are ONE point, not two at the same x", () => {
    const series = cumulativeProgressSeries([
      { entryDate: "2026-08-25", quantityDone: 3 },
      { entryDate: "2026-08-25", quantityDone: 4 },
    ]);
    expect(series.points).toHaveLength(1);
    expect(series.points[0].value).toBe(7);
  });

  test("a single day reports itself, so the caller can say so instead of drawing an empty frame", () => {
    const series = cumulativeProgressSeries([{ entryDate: "2026-08-25", quantityDone: 3 }]);
    expect(series.distinctDays).toBe(1);
    expect(series.onlyDay).toBe("2026-08-25");
  });

  test("no entries gives no points and no 'only day' claim", () => {
    const series = cumulativeProgressSeries([]);
    expect(series.points).toEqual([]);
    expect(series.onlyDay).toBeNull();
  });

  test("an unusable date or quantity is skipped rather than poisoning the running total", () => {
    const series = cumulativeProgressSeries([
      { entryDate: null, quantityDone: 99 },
      { entryDate: "not a date", quantityDone: 99 },
      { entryDate: "2026-08-25", quantityDone: "abc" },
      { entryDate: "2026-08-26", quantityDone: 5 },
    ]);
    expect(series.points).toEqual([
      { label: "25 Aug", value: 0 },
      { label: "26 Aug", value: 5 },
    ]);
  });

  // R67 E-40 (R-272 / R-297) settles a sentence three items wrote differently
  // -- E-25's "Only one day logged (25 Aug)", E-29's "Progress will chart
  // after the second entry", and this one, which E-40 specifies explicitly as
  // the merge of the two source recommendations. This is the final wording.
  test("the one-day caption is E-40's exact sentence, with a dd-mm-yyyy date", () => {
    expect(oneDayCaption("2026-08-25")).toBe(
      "Only one day of progress logged (25-08-2026) — not enough to draw a trend"
    );
  });
});

// R67 E-38 (R-270): the two REAL budget destinations, passed in. /budgets is
// where a budget is read; /budgets/new is where one is set, and with no budget
// at all that is the only useful door.
const HREFS = { budgets: "/budgets?projectId=p1", setBudget: "/budgets/new?projectId=p1" };

describe("budgetCardModel", () => {
  // R67 E-39 (R-271) refines E-25 here. E-25 removed the false alarm and left
  // the words "no budget set" in the TREND row, which still rendered an arrow
  // beside them; E-39 removes the trend row entirely, because an arrow with
  // nothing to point away from is a claim about a comparison never made.
  test("NO budget anywhere: '<spend> spent', 'No budget set - Set budget', NO trend row and NO BAR", () => {
    const card = budgetCardModel(185_000, 0, null, HREFS, money);
    expect(card.target).toBeNull();
    // The word "spent" is load-bearing: without a budget beside it, a bare
    // money figure on a card called "Budget vs Actual" reads as the budget.
    expect(card.value).toBe("AED 185,000 spent");
    expect(card.trend).toBeNull();
    expect(card.baseline).toBe("No budget set \u2014 Set budget");
    expect(card.baseline).not.toContain("over budget");
    // R67 E-38: the door is where a budget is SET, never the read-only list.
    expect(card.href).toBe("/budgets/new?projectId=p1");
  });

  test("a null ERP budget is treated the same as a zero one -- both mean 'no target'", () => {
    expect(budgetCardModel(100, null, null, HREFS, money).target).toBeNull();
    expect(budgetCardModel(100, 0, 0, HREFS, money).target).toBeNull();
  });

  test("with a real budget the tile goes to the budget itself, not to the create form", () => {
    expect(budgetCardModel(50_000, 100_000, null, HREFS, money).href).toBe("/budgets?projectId=p1");
    expect(budgetCardModel(50_000, null, 80_000, HREFS, money).href).toBe("/budgets?projectId=p1");
  });

  test("a real ERP budget wins and the baseline says which budget it is", () => {
    const card = budgetCardModel(50_000, 100_000, 80_000, HREFS, money);
    expect(card.target).toBe(100_000);
    expect(card.source).toBe("erp");
    expect(card.baseline).toContain("cost centre");
    // With a real budget the verdict word IS earned, so the trend row returns.
    expect(card.trend?.word).toBe("within budget");
    expect(card.value).toBe("AED 50,000");
  });

  test("with no cost-centre budget, the BOQ-derived one is the target AND the baseline says so", () => {
    const card = budgetCardModel(90_000, null, 80_000, HREFS, money);
    expect(card.target).toBe(80_000);
    expect(card.source).toBe("boq");
    expect(card.baseline).toContain("BOQ x budget %");
    expect(card.baseline).toContain("no cost-centre budget set");
    expect(card.trend?.word).toBe("over budget");
    expect(card.trend?.tone).toBe("needs-you");
  });

  test("a real budget the spend has not passed is not an alarm", () => {
    const card = budgetCardModel(10, 100, null, HREFS, money);
    expect(card.trend?.direction).toBe("down");
    expect(card.trend?.tone).toBe("done");
  });
});

describe("primaryTrendLabel", () => {
  test("0% by value with real logged progress explains the gap and names the fix", () => {
    const trend = primaryTrendLabel(0, 60, "Earned AED 0");
    expect(trend.label).toBe("Activity log says 60% \u2014 no quantities booked against BOQ lines yet");
    expect(trend.tone).toBe("needs-you");
  });

  test("a real earned percentage keeps the ordinary earned-value label", () => {
    const trend = primaryTrendLabel(25, 60, "Earned AED 118,750");
    expect(trend.label).toBe("Earned AED 118,750");
    expect(trend.tone).toBe("context");
  });

  test("0% by value with NOTHING logged is not a contradiction, so it gets no special label", () => {
    expect(primaryTrendLabel(0, 0, "Earned AED 0").tone).toBe("context");
    expect(primaryTrendLabel(0, null, "Earned AED 0").tone).toBe("context");
  });

  test("an unknown BOQ percentage says nothing about linking", () => {
    expect(primaryTrendLabel(null, 60, "Import a BOQ to see this").label).toBe("Import a BOQ to see this");
  });
});
describe("oneDayAxis (R67 E-40: a single point on an axis that runs to today)", () => {
  test("the left end is the logged day and the right end is the WORD today", () => {
    const axis = oneDayAxis("2026-08-25", "2026-09-03");
    expect(axis.leftLabel).toBe("25-08-2026");
    expect(axis.rightLabel).toBe("today");
    // The point anchors the left end; the empty span to its right is the
    // thing worth seeing -- nine days with nothing logged.
    expect(axis.pointFraction).toBe(0);
  });

  test("when the only logged day IS today, the two ends still never read the same date", () => {
    const axis = oneDayAxis("2026-09-03", "2026-09-03");
    expect(axis.leftLabel).toBe("03-09-2026");
    expect(axis.rightLabel).toBe("today");
    expect(axis.leftLabel).not.toBe(axis.rightLabel);
    // No span to spread across, so the point sits under the word that names it.
    expect(axis.pointFraction).toBe(1);
  });

  test("an unparseable date does not produce NaN geometry", () => {
    const axis = oneDayAxis("not-a-date", "2026-09-03");
    expect(Number.isFinite(axis.pointFraction)).toBe(true);
  });
});
