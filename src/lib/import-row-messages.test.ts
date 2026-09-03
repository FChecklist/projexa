/// <reference types="bun-types" />
// R67 lane D22 (item D-68). The messages the three import screens put on
// individual rows, taken from the flat lists VERIDIAN's importers report.
import { describe, expect, test } from "bun:test";
import { attributeRowMessages, reportedRowNumbers } from "./import-row-messages";

describe("attributeRowMessages", () => {
  test("puts each 'Row N:' message on its own row, keeping the message verbatim", () => {
    const { byRow, sheetLevel } = attributeRowMessages([
      "Row 14: Finish before Start",
      "Row 3: Rate is blank",
    ]);
    expect(byRow.get(14)).toEqual(["Row 14: Finish before Start"]);
    expect(byRow.get(3)).toEqual(["Row 3: Rate is blank"]);
    expect(sheetLevel).toEqual([]);
  });

  test("collects several messages about the same row, in the order reported", () => {
    const { byRow } = attributeRowMessages([
      "Row 22: predecessor 'A-07' not found",
      "Row 22: Finish before Start",
    ]);
    expect(byRow.get(22)).toEqual([
      "Row 22: predecessor 'A-07' not found",
      "Row 22: Finish before Start",
    ]);
  });

  test("a message that names no row stays sheet-level rather than being attached to a guess", () => {
    const { byRow, sheetLevel } = attributeRowMessages([
      "Reading dates as dd/mm/yyyy",
      "Row 5: Qty is blank",
    ]);
    expect(sheetLevel).toEqual(["Reading dates as dd/mm/yyyy"]);
    expect([...byRow.keys()]).toEqual([5]);
  });

  test("a row number mentioned mid-sentence is not a prefix and does not steal the message", () => {
    const { byRow, sheetLevel } = attributeRowMessages(["Two headers found before Row 9"]);
    expect(byRow.size).toBe(0);
    expect(sheetLevel).toHaveLength(1);
  });

  test("an empty list is an empty attribution, not a crash", () => {
    const { byRow, sheetLevel } = attributeRowMessages([]);
    expect(byRow.size).toBe(0);
    expect(sheetLevel).toEqual([]);
  });
});

describe("reportedRowNumbers", () => {
  test("is ascending and de-duplicated, so a synthesised error row is created once", () => {
    expect(reportedRowNumbers([
      "Row 14: Finish before Start",
      "Row 3: Rate is blank",
      "Row 14: predecessor 'A-07' not found",
    ])).toEqual([3, 14]);
  });
});
