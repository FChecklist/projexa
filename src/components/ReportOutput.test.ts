/// <reference types="bun-types" />
// R67 D-61 (audit R-198 / R-226). ReportOutput is the generic renderer behind
// all 17 named reports and the AI Copilot's 7 tool results, so whatever it does
// with a raw JSON value is what a customer reads on every one of them. It did
// `String(v)`.
//
// That is why the audit could measure four number formats and four date formats
// in one visit: a report's key/value grid printed "1250000.5" and
// "2026-08-25T00:00:00.000Z" one tab away from a table printing "1,250,000.50"
// and "8/25/2026" for the same two fields.
//
// Which key is MONEY still cannot be known here -- that stays opt-in through
// fieldFormatters (ReportsClient's buildProjectStatusFormatters). What a number
// and a date look like is knowable, and is now the product's one answer.
import { describe, expect, test } from "bun:test";
import { cellValue } from "./ReportOutput";
// EMPTY_VALUE is asserted through the shared module rather than as a literal,
// so a change to the product's "no value" glyph updates this test with it
// instead of failing it.
import { EMPTY_VALUE } from "@/lib/format-number";

describe("cellValue (R67 D-61)", () => {
  test("a number gets the product's thousands separators, not String(v)", () => {
    expect(cellValue(1250000.5)).toBe("1,250,000.5");
    expect(cellValue(0)).toBe("0");
    expect(cellValue(-42)).toBe("-42");
  });

  test("the grouping is the pinned one, so a report reads the same on every device", () => {
    // The defect: String(v) had no grouping at all, and any fix reaching for
    // toLocaleString() with no locale would group as 12,00,000 for a visitor
    // on this app's "hi" locale.
    expect(cellValue(1200000)).toBe("1,200,000");
  });

  test("a date-only ISO string renders through the product's date formatter", () => {
    expect(cellValue("2026-08-25")).toBe("8/25/2026");
  });

  test("an ISO timestamp renders as a date and time, in UTC, not as raw JSON", () => {
    expect(cellValue("2026-08-25T14:30:00.000Z")).toBe("8/25/2026, 2:30:00 PM");
  });

  test("a string that merely starts with digits is left alone", () => {
    // Guards the date regex against eating a BOQ code, an invoice number or a
    // part number -- all of which are strings that must render verbatim.
    expect(cellValue("1.01.4")).toBe("1.01.4");
    expect(cellValue("2026-08")).toBe("2026-08");
    expect(cellValue("BP-2026-0142")).toBe("BP-2026-0142");
    expect(cellValue("2026-08-25 and later")).toBe("2026-08-25 and later");
  });

  test("null and undefined stay the one empty dash, not the word null", () => {
    expect(cellValue(null)).toBe(EMPTY_VALUE);
    expect(cellValue(undefined)).toBe(EMPTY_VALUE);
    expect(cellValue(null)).not.toBe("null");
  });

  test("booleans and objects are unchanged", () => {
    expect(cellValue(true)).toBe("true");
    expect(cellValue({ a: 1 })).toBe('{"a":1}');
  });
});
