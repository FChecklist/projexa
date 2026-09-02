/// <reference types="bun-types" />
// R67 D-31 (R-090). The trade-wise attendance summary is rendered in three
// places -- the Manpower panel, its CSV export, and the public share page --
// and these pin the rules all three share: what an empty cell means, what "this
// week" covers, and what the headline sentence says.
import { describe, expect, test } from "bun:test";
import {
  countCell,
  moneyCell,
  headlineSentence,
  presetRange,
  summaryToCsv,
  tradeLabel,
  UNSPECIFIED_TRADE_LABEL,
  type AttendanceSummaryRow,
} from "./attendance-summary";

const ROWS: AttendanceSummaryRow[] = [
  { trade: "Electrician", present: 4, halfDay: 2, absent: 0, workerDays: 5, cost: 750 },
  { trade: "Mason", present: 12, halfDay: 0, absent: 1, workerDays: 12, cost: 1440 },
];

describe("tradeLabel", () => {
  test("a real trade is used as-is", () => {
    expect(tradeLabel("Mason")).toBe("Mason");
  });

  test("a blank or missing trade is NAMED, never rendered as an empty cell", () => {
    expect(tradeLabel(null)).toBe(UNSPECIFIED_TRADE_LABEL);
    expect(tradeLabel("")).toBe(UNSPECIFIED_TRADE_LABEL);
    expect(tradeLabel("   ")).toBe(UNSPECIFIED_TRADE_LABEL);
  });
});

describe("countCell -- zero and unknown are different facts", () => {
  test("a real zero renders as 0", () => {
    expect(countCell(0)).toBe("0");
  });

  test("no figure at all renders as an en-dash, never as 0", () => {
    expect(countCell(null)).toBe("–");
    expect(countCell(undefined)).toBe("–");
    expect(countCell(Number.NaN)).toBe("–");
  });

  test("a half worker-day survives as a half", () => {
    expect(countCell(5.5)).toBe("5.5");
  });
});

describe("moneyCell", () => {
  test("a zero cost is a real currency zero, not a dash", () => {
    expect(moneyCell(0, "AED ")).toBe("AED 0.00");
  });

  test("an absent cost is a dash, with no currency glyph implying a figure", () => {
    expect(moneyCell(null, "AED ")).toBe("–");
  });

  test("thousands are grouped", () => {
    expect(moneyCell(1440, "AED ")).toBe("AED 1,440.00");
  });
});

describe("headlineSentence", () => {
  test("reads as the sentence the item asks for", () => {
    expect(headlineSentence(18, ROWS)).toBe("18 people on site — Electrician 6 · Mason 12");
  });

  test("one person is not 'people'", () => {
    expect(headlineSentence(1, [{ trade: "Mason", present: 1, halfDay: 0, absent: 0, workerDays: 1, cost: 120 }]))
      .toBe("1 person on site — Mason 1");
  });

  test("an empty window says so in words rather than showing a bare 0", () => {
    expect(headlineSentence(0, [])).toBe("Nobody on site in this window");
  });

  test("a trade with only absences is left out of the headline", () => {
    const withAbsentees = [...ROWS, { trade: "Helper", present: 0, halfDay: 0, absent: 3, workerDays: 0, cost: 0 }];
    expect(headlineSentence(18, withAbsentees)).toBe("18 people on site — Electrician 6 · Mason 12");
  });
});

describe("presetRange", () => {
  test("Today is a single day", () => {
    expect(presetRange("today", "2026-09-03")).toEqual({ from: "2026-09-03", to: "2026-09-03" });
  });

  test("This week runs Monday to Sunday around the anchor", () => {
    // 2026-09-03 is a Thursday.
    expect(presetRange("week", "2026-09-03")).toEqual({ from: "2026-08-31", to: "2026-09-06" });
  });

  test("a Sunday anchor belongs to the week that STARTED on the previous Monday, not the next one", () => {
    expect(presetRange("week", "2026-09-06")).toEqual({ from: "2026-08-31", to: "2026-09-06" });
  });

  test("a Monday anchor is the first day of its own week", () => {
    expect(presetRange("week", "2026-08-31")).toEqual({ from: "2026-08-31", to: "2026-09-06" });
  });

  test("This month runs first to last, including a 30-day month's real last day", () => {
    expect(presetRange("month", "2026-09-03")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  test("February in a leap year ends on the 29th", () => {
    expect(presetRange("month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("summaryToCsv", () => {
  test("exports exactly the rows on screen plus the grand total", () => {
    const csv = summaryToCsv(ROWS, { present: 16, halfDay: 2, absent: 1, workerDays: 17, cost: 2190 });
    expect(csv.split("\n")).toEqual([
      "Trade,Present,Half day,Absent,Worker-days,Cost",
      "Electrician,4,2,0,5,750",
      "Mason,12,0,1,12,1440",
      "Total,16,2,1,17,2190",
    ]);
  });

  test("a trade name containing a comma is quoted rather than splitting the row", () => {
    const csv = summaryToCsv(
      [{ trade: "Mason, senior", present: 1, halfDay: 0, absent: 0, workerDays: 1, cost: 120 }],
      { present: 1, halfDay: 0, absent: 0, workerDays: 1, cost: 120 }
    );
    expect(csv.split("\n")[1]).toBe('"Mason, senior",1,0,0,1,120');
  });
});
