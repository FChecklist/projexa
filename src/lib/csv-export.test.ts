/// <reference types="bun-types" />
// R67: the shared CSV builder. Every assertion here is a defect the
// hand-rolled `[a, b].join(",")` exports in this repo actually have.
import { describe, expect, test } from "bun:test";
import { csvEscape, csvFilename, toCsv } from "./csv-export";

describe("csvEscape", () => {
  test("a value containing a comma is quoted so the following columns do not shift", () => {
    expect(csvEscape("Ali Hassan, Jr")).toBe('"Ali Hassan, Jr"');
  });

  test("an embedded double quote is doubled, per RFC 4180", () => {
    expect(csvEscape('Steel 12" rebar')).toBe('"Steel 12"" rebar"');
  });

  test("a newline inside a cell is quoted rather than ending the row", () => {
    expect(csvEscape("line one\nline two")).toBe('"line one\nline two"');
  });

  test("a value that Excel would run as a formula is prefixed so it stays text", () => {
    expect(csvEscape("=1+1")).toBe("'=1+1");
    expect(csvEscape("+44 7700 900000")).toBe("'+44 7700 900000");
    expect(csvEscape("-5")).toBe("'-5");
    expect(csvEscape("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  test("null and undefined are empty cells, not the words 'null'/'undefined'", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  test("ordinary values are untouched", () => {
    expect(csvEscape("Ali Hassan")).toBe("Ali Hassan");
    expect(csvEscape(300)).toBe("300");
    expect(csvEscape(0)).toBe("0");
  });
});

describe("toCsv", () => {
  test("writes the header row then the data rows, CRLF separated", () => {
    const csv = toCsv(["S.No", "Name", "Daily Rate"], [[1, "Ali Hassan", 300], [2, "Bina, Rao", 250]]);
    expect(csv).toBe('S.No,Name,Daily Rate\r\n1,Ali Hassan,300\r\n2,"Bina, Rao",250');
  });

  test("an empty row set still writes the header, so the file is never zero bytes", () => {
    expect(toCsv(["A", "B"], [])).toBe("A,B");
  });
});

describe("csvFilename", () => {
  test("slugs a real project name into something a browser and Windows will keep", () => {
    expect(csvFilename("roster", "Cedar Heights Villa - Phase 1", "2026-09-03"))
      .toBe("roster-cedar-heights-villa-phase-1-2026-09-03.csv");
  });

  test("a name made entirely of punctuation still yields a usable filename", () => {
    expect(csvFilename("roster", "///", "2026-09-03")).toBe("roster-export-2026-09-03.csv");
  });
});
