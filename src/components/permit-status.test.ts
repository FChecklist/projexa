import { describe, expect, test } from "bun:test";
import {
  EXPIRING_WITHIN_DAYS,
  permitHeaderParts,
  permitHeaderSentence,
  permitStatus,
  permitStatusCounts,
  permitStatusLabel,
  sortByExpiryAscending,
} from "./permit-status";

// R67 G-01 acceptance (R-017), verbatim: the four branches return exactly
// "-", "expired 3 days ago", "expires in 12 days" and "valid, 214 days left"
// for null, -3, 12 and 214, and each returns a non-empty glyph key distinct
// from the others.

describe("G-01 acceptance: the four branches", () => {
  test("null renders '-'", () => {
    expect(permitStatusLabel(null)).toBe("-");
  });

  test("-3 renders 'expired 3 days ago'", () => {
    expect(permitStatusLabel(-3)).toBe("expired 3 days ago");
  });

  test("12 renders 'expires in 12 days'", () => {
    expect(permitStatusLabel(12)).toBe("expires in 12 days");
  });

  test("214 renders 'valid, 214 days left'", () => {
    expect(permitStatusLabel(214)).toBe("valid, 214 days left");
  });

  test("each of the four returns a non-empty glyph key, distinct from the others", () => {
    const keys = [null, -3, 12, 214].map((d) => permitStatus(d).glyphKey);
    for (const key of keys) expect(key.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(4);
  });

  test("not one of the four is a bare number or a bare sign", () => {
    for (const d of [null, -3, 0, 12, 214]) {
      const label = permitStatusLabel(d);
      expect(label).not.toMatch(/^-?\d+$/);
    }
  });
});

describe("the boundaries between the branches", () => {
  test("0 is its own sentence -- 'expires today', not 'expires in 0 days'", () => {
    expect(permitStatusLabel(0)).toBe("expires today");
    expect(permitStatus(0).tone).toBe("needs-you");
  });

  test("30 is still expiring, 31 is already valid", () => {
    expect(EXPIRING_WITHIN_DAYS).toBe(30);
    expect(permitStatus(30).kind).toBe("expiring");
    expect(permitStatusLabel(30)).toBe("expires in 30 days");
    expect(permitStatus(31).kind).toBe("valid");
    expect(permitStatusLabel(31)).toBe("valid, 31 days left");
  });

  test("-1 and 1 read as singular", () => {
    expect(permitStatusLabel(-1)).toBe("expired 1 day ago");
    expect(permitStatusLabel(1)).toBe("expires in 1 day");
  });

  test("rose is used for expired and for nothing else", () => {
    expect(permitStatus(-1).tone).toBe("late");
    for (const d of [null, 0, 1, 30, 31, 214]) {
      expect(permitStatus(d).tone).not.toBe("late");
    }
  });
});

describe("header-level status (R-017: at header level as well as item level)", () => {
  const rows = [
    { daysToExpiry: -3 },
    { daysToExpiry: -40 },
    { daysToExpiry: 12 },
    { daysToExpiry: 90 },
    { daysToExpiry: 120 },
    { daysToExpiry: 200 },
    { daysToExpiry: 214 },
    { daysToExpiry: 300 },
  ];

  test("counts come out of the loaded rows", () => {
    expect(permitStatusCounts(rows)).toEqual({ expired: 2, expiring: 1, valid: 5, unknown: 0 });
  });

  test("renders R-017's own example sentence", () => {
    expect(permitHeaderSentence(permitStatusCounts(rows))).toBe("2 expired - 1 expiring within 30 days - 5 valid");
  });

  test("'expires today' counts as expiring, not as valid", () => {
    expect(permitStatusCounts([{ daysToExpiry: 0 }])).toEqual({ expired: 0, expiring: 1, valid: 0, unknown: 0 });
  });

  test("a permit with no end date is counted separately, never as valid", () => {
    const counts = permitStatusCounts([{ daysToExpiry: null }, { daysToExpiry: 200 }]);
    expect(counts).toEqual({ expired: 0, expiring: 0, valid: 1, unknown: 1 });
    expect(permitHeaderSentence(counts)).toBe("1 valid - 1 with no expiry date");
  });

  test("a zero clause is dropped, not shown as '0 expired'", () => {
    expect(permitHeaderSentence({ expired: 0, expiring: 0, valid: 3, unknown: 0 })).toBe("3 valid");
    expect(permitHeaderSentence({ expired: 0, expiring: 0, valid: 0, unknown: 0 })).toBe("");
  });

  test("each header clause carries the same glyph its rows carry", () => {
    const parts = permitHeaderParts(permitStatusCounts(rows));
    expect(parts.map((p) => p.glyphKey)).toEqual(["late", "needs-you", "done"]);
    expect(parts.map((p) => p.glyphKey)).toEqual([
      permitStatus(-3).glyphKey,
      permitStatus(12).glyphKey,
      permitStatus(214).glyphKey,
    ]);
  });
});

describe("default order: most urgent first", () => {
  const unsorted = [
    { daysToExpiry: 214, endDate: "2027-04-01", name: "Hoarding licence" },
    { daysToExpiry: null, endDate: null, name: "Zoning letter" },
    { daysToExpiry: -3, endDate: "2026-08-30", name: "Crane permit" },
    { daysToExpiry: 12, endDate: "2026-09-14", name: "Excavation NOC" },
  ];

  test("expired first, then soonest, with no-end-date last", () => {
    expect(sortByExpiryAscending(unsorted).map((r) => r.name)).toEqual([
      "Crane permit",
      "Excavation NOC",
      "Hoarding licence",
      "Zoning letter",
    ]);
  });

  test("does not mutate the caller's array", () => {
    const copy = [...unsorted];
    sortByExpiryAscending(unsorted);
    expect(unsorted).toEqual(copy);
  });

  test("ties are broken by name, so the order is stable across reloads", () => {
    const tied = [
      { daysToExpiry: 5, endDate: "2026-09-07", name: "Beta" },
      { daysToExpiry: 5, endDate: "2026-09-07", name: "Alpha" },
    ];
    expect(sortByExpiryAscending(tied).map((r) => r.name)).toEqual(["Alpha", "Beta"]);
  });
});
