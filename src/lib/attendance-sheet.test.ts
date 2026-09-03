/// <reference types="bun-types" />
// R67 D-30: the arithmetic the foot of the Daily Attendance Sheet shows, and
// the closed vocabulary a failure prints. Both are things a screenshot cannot
// prove, so they are asserted here.
import { describe, expect, test } from "bun:test";
import { ApiError } from "./fetch-json";
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_GLYPH,
  ATTENDANCE_STATUS_KEY,
  ATTENDANCE_STATUS_LABEL,
  UNSPECIFIED_TRADE,
  loadFailureSentence,
  rowCost,
  saveFailureSentence,
  shiftIsoDate,
  summariseByTrade,
} from "./attendance-sheet";

describe("rowCost", () => {
  test("present is the full rate, half_day is half, absent is zero", () => {
    expect(rowCost("300", "present")).toBe(300);
    expect(rowCost("300", "half_day")).toBe(150);
    expect(rowCost("300", "absent")).toBe(0);
  });

  test("an UNMARKED row is null, not zero -- the sheet renders it as an en-dash so it cannot be mistaken for Absent", () => {
    expect(rowCost("300", null)).toBeNull();
  });

  test("an odd rate halves to two decimals rather than a floating-point tail", () => {
    expect(rowCost("275", "half_day")).toBe(137.5);
    expect(rowCost("0.01", "half_day")).toBe(0.01);
  });

  test("a missing or unparseable rate costs 0 rather than producing NaN in the day total", () => {
    expect(rowCost(null, "present")).toBe(0);
    expect(rowCost("", "present")).toBe(0);
    expect(rowCost("n/a", "present")).toBe(0);
  });
});

describe("summariseByTrade", () => {
  const rows = [
    { trade: "Civil", dailyRate: "300", status: "present" as const },
    { trade: "Civil", dailyRate: "250", status: "half_day" as const },
    { trade: "Painter", dailyRate: "200", status: "absent" as const },
    { trade: "  ", dailyRate: "400", status: "present" as const },
    { trade: "Painter", dailyRate: "200", status: null },
  ];

  test("subtotals one row per trade, with the day total equal to their sum", () => {
    const totals = summariseByTrade(rows);
    expect(totals.trades.map((t) => t.trade)).toEqual(["Civil", "Painter", UNSPECIFIED_TRADE]);
    expect(totals.trades.find((t) => t.trade === "Civil")!.cost).toBe(300 + 125);
    expect(totals.trades.find((t) => t.trade === "Painter")!.cost).toBe(0);
    expect(totals.trades.find((t) => t.trade === UNSPECIFIED_TRADE)!.cost).toBe(400);
    expect(totals.totalCost).toBe(totals.trades.reduce((s, t) => s + t.cost, 0));
    expect(totals.totalCost).toBe(825);
  });

  test("a blank trade groups under 'Unspecified' and is always listed last", () => {
    expect(summariseByTrade([{ trade: null, dailyRate: "100", status: "present" }]).trades[0].trade)
      .toBe(UNSPECIFIED_TRADE);
    expect(summariseByTrade(rows).trades.at(-1)!.trade).toBe(UNSPECIFIED_TRADE);
  });

  test("unmarked rows are counted nowhere -- not in markedCount, not in a trade's headcount, not in the cost", () => {
    const totals = summariseByTrade(rows);
    expect(totals.markedCount).toBe(4);
    const painter = totals.trades.find((t) => t.trade === "Painter")!;
    expect(painter.marked).toBe(1);
    expect(painter.absent).toBe(1);
  });

  test("an empty sheet totals to zero rather than throwing", () => {
    expect(summariseByTrade([])).toEqual({ trades: [], markedCount: 0, totalCost: 0 });
  });

  test("trades are alphabetical so the foot does not reshuffle as rows are marked", () => {
    const totals = summariseByTrade([
      { trade: "Tiles", dailyRate: "1", status: "present" },
      { trade: "Civil", dailyRate: "1", status: "present" },
      { trade: "Gypsum", dailyRate: "1", status: "present" },
    ]);
    expect(totals.trades.map((t) => t.trade)).toEqual(["Civil", "Gypsum", "Tiles"]);
  });
});

describe("the closed failure vocabulary (D-03)", () => {
  test("an upstream timeout says the service didn't answer AND that nothing was saved", () => {
    const sentence = saveFailureSentence(new ApiError("VERIDIAN request timed out", 504, null));
    expect(sentence).toBe("The construction data service didn't answer — nothing was saved.");
  });

  test("a 404 tells the user what to do next rather than repeating the backend's row id", () => {
    const sentence = saveFailureSentence(new ApiError("Roster entry not found on this project: roster-abc123", 404, null));
    expect(sentence).toBe("One of these workers is no longer on this project's roster — reload the sheet. Nothing was saved.");
    expect(sentence).not.toContain("roster-abc123");
  });

  test("every save-failure sentence states that nothing was saved", () => {
    for (const status of [400, 403, 404, 409, 500, 502, 504, 0]) {
      expect(saveFailureSentence(new ApiError("raw backend text", status, null))).toContain("othing was saved");
    }
  });

  test("a non-ApiError (a dropped connection, a parse failure) still produces a sentence, never '[object Object]'", () => {
    expect(saveFailureSentence(new Error("fetch failed"))).toBe("The construction data service didn't answer — nothing was saved.");
    // R67 D-65 merge: a READ failure now speaks the product's ONE shared
    // vocabulary (src/lib/task-errors.ts's describeReadError) rather than this
    // module's own three sentences, so "supabaseKey is required" reads the same
    // here as on every other screen. D-03's actual requirement is unchanged and
    // is what is asserted: never a raw backend string, and always the subject
    // the user asked for.
    const sentence = loadFailureSentence(undefined, "roster");
    expect(sentence).toContain("roster");
    expect(sentence).not.toContain("[object Object]");
    expect(sentence.length).toBeGreaterThan(20);
  });

  test("load failures name the subject the user asked for", () => {
    expect(loadFailureSentence(new ApiError("x", 502, null), "attendance for this date"))
      .toContain("attendance for this date");
    // The raw upstream text never reaches the user.
    expect(loadFailureSentence(new ApiError("supabaseKey is required", 500, null), "roster")).not.toContain("supabaseKey");
  });
});

describe("status vocabulary", () => {
  test("the three on-screen labels are fixed", () => {
    expect(ATTENDANCE_STATUS_LABEL).toEqual({ present: "Present", half_day: "Half day", absent: "Absent" });
  });

  test("P / H / A are the keyboard marks", () => {
    expect(ATTENDANCE_STATUS_KEY.p).toBe("present");
    expect(ATTENDANCE_STATUS_KEY.h).toBe("half_day");
    expect(ATTENDANCE_STATUS_KEY.a).toBe("absent");
  });
});

describe("shiftIsoDate (D-53 day navigation)", () => {
  test("moves exactly one day in each direction", () => {
    expect(shiftIsoDate("2026-09-02", -1)).toBe("2026-09-01");
    expect(shiftIsoDate("2026-09-02", 1)).toBe("2026-09-03");
  });

  test("crosses month and year boundaries", () => {
    expect(shiftIsoDate("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftIsoDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
    // A leap year: 2028-02-29 must exist, and 2027 must not have one.
    expect(shiftIsoDate("2028-03-01", -1)).toBe("2028-02-29");
  });

  test("is UTC-pinned, so it cannot land on the previous day for a western visitor", () => {
    // Same assertion twice with a day-long span: 365 single steps forward from
    // 2026-01-01 must be 2027-01-01 exactly, with no DST drift anywhere.
    let iso = "2026-01-01";
    for (let i = 0; i < 365; i++) iso = shiftIsoDate(iso, 1);
    expect(iso).toBe("2027-01-01");
  });

  test("an unparseable date is returned unchanged rather than becoming NaN in the URL", () => {
    expect(shiftIsoDate("not-a-date", 1)).toBe("not-a-date");
  });
});

describe("ATTENDANCE_STATUS_GLYPH (D-53)", () => {
  test("every status has a distinct glyph, so the word is never the only signal", () => {
    const glyphs = ATTENDANCE_STATUSES.map((s) => ATTENDANCE_STATUS_GLYPH[s]);
    expect(new Set(glyphs).size).toBe(ATTENDANCE_STATUSES.length);
  });
});
