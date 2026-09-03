/// <reference types="bun-types" />
// R67 D-14 + the lane D3 export sweep: the shared CSV builder. Every assertion
// here is a defect the hand-rolled `[a, b].join(",")` exports in this repo
// actually have.
//
// R67 MERGE (D-11, lane D1 x lane D3, 2026-09-03). Both lanes wrote this file
// independently -- an add/add conflict. BOTH SUITES SURVIVE. The overlapping
// cases (comma, embedded quote, newline, formula prefix, null/undefined,
// untouched values) are kept once but with BOTH lanes' example data, because
// the examples are the point: "Ali Hassan, Jr" and "Cedar Heights, Phase 1"
// break in the same way but were found on different screens. D1's assertions
// against its own rowsToCsv() are RESTATED against the surviving toCsv(),
// including the CRLF line ending D1's version did not use -- see csv-export.ts's
// own merge note for why toCsv won.
import { describe, expect, test } from "bun:test";
import { csvEscape, csvFilename, toCsv } from "./csv-export";

describe("csvEscape", () => {
  test("a value containing a comma is quoted so the following columns do not shift", () => {
    expect(csvEscape("Ali Hassan, Jr")).toBe('"Ali Hassan, Jr"');
    expect(csvEscape("Cedar Heights, Phase 1")).toBe('"Cedar Heights, Phase 1"');
  });

  test("an embedded double quote is doubled, per RFC 4180", () => {
    expect(csvEscape('Steel 12" rebar')).toBe('"Steel 12"" rebar"');
    expect(csvEscape('He said "no"')).toBe('"He said ""no"""');
  });

  test("a newline inside a cell is quoted rather than ending the row", () => {
    expect(csvEscape("line one\nline two")).toBe('"line one\nline two"');
  });

  test("a value that Excel would run as a formula is prefixed so it stays text", () => {
    expect(csvEscape("=1+1")).toBe("'=1+1");
    expect(csvEscape("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvEscape("+44 7700 900000")).toBe("'+44 7700 900000");
    expect(csvEscape("+1 555 0100")).toBe("'+1 555 0100");
    expect(csvEscape("-5")).toBe("'-5");
    expect(csvEscape("-25")).toBe("'-25");
    expect(csvEscape("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvEscape("@handle")).toBe("'@handle");
  });

  // Lane D1's own case, and the one neither guard catches alone: the value is
  // BOTH executable and delimiter-bearing, so it needs the quote prefix INSIDE
  // the RFC 4180 quoting, in that order.
  test("a formula that also needs quoting gets both treatments", () => {
    expect(csvEscape("=A1,B2")).toBe(`"'=A1,B2"`);
  });

  test("null and undefined are empty cells, not the words 'null'/'undefined'", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  test("ordinary values are untouched", () => {
    expect(csvEscape("Ali Hassan")).toBe("Ali Hassan");
    expect(csvEscape("DEWA permit 2026.pdf")).toBe("DEWA permit 2026.pdf");
    expect(csvEscape(300)).toBe("300");
    expect(csvEscape(42)).toBe("42");
    expect(csvEscape(0)).toBe("0");
  });
});

describe("toCsv", () => {
  test("writes the header row then the data rows, CRLF separated", () => {
    const csv = toCsv(["S.No", "Name", "Daily Rate"], [[1, "Ali Hassan", 300], [2, "Bina, Rao", 250]]);
    expect(csv).toBe('S.No,Name,Daily Rate\r\n1,Ali Hassan,300\r\n2,"Bina, Rao",250');
  });

  // Lane D1's documents-export case, restated against toCsv and its CRLF.
  test("header row first, then one line per row, in column order", () => {
    const csv = toCsv(
      ["Name", "Category", "Relates to"],
      [
        ["DEWA permit 2026.pdf", "permit", "Permit — BP-2026-0142"],
        ["Site photo, north face", "site photo", "—"],
      ]
    );
    expect(csv.split("\r\n")).toEqual([
      "Name,Category,Relates to",
      "DEWA permit 2026.pdf,permit,Permit — BP-2026-0142",
      '"Site photo, north face",site photo,—',
    ]);
  });

  test("an empty row set still writes the header, so the file is never zero bytes", () => {
    expect(toCsv(["A", "B"], [])).toBe("A,B");
    expect(toCsv(["Name"], [])).toBe("Name");
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
