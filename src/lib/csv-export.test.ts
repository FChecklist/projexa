/// <reference types="bun-types" />
// R67 D-14. The escaping rules, held to the two things that actually break a
// client-side CSV: a value containing the delimiter, and a value a spreadsheet
// would execute.
import { describe, expect, test } from "bun:test";
import { csvEscape, rowsToCsv } from "./csv-export";

describe("csvEscape", () => {
  test("quotes a value containing a comma, a quote or a newline", () => {
    expect(csvEscape("Cedar Heights, Phase 1")).toBe('"Cedar Heights, Phase 1"');
    expect(csvEscape('He said "no"')).toBe('"He said ""no"""');
    expect(csvEscape("line one\nline two")).toBe('"line one\nline two"');
  });

  test("neutralises a formula so a spreadsheet reads it as text", () => {
    expect(csvEscape("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvEscape("+1 555 0100")).toBe("'+1 555 0100");
    expect(csvEscape("-25")).toBe("'-25");
    expect(csvEscape("@handle")).toBe("'@handle");
  });

  test("a formula that also needs quoting gets both treatments", () => {
    expect(csvEscape("=A1,B2")).toBe(`"'=A1,B2"`);
  });

  test("null and undefined are empty cells, never the words 'null'/'undefined'", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  test("an ordinary value is left exactly as it is", () => {
    expect(csvEscape("DEWA permit 2026.pdf")).toBe("DEWA permit 2026.pdf");
    expect(csvEscape(42)).toBe("42");
  });
});

describe("rowsToCsv", () => {
  test("header row first, then one line per row, in column order", () => {
    const csv = rowsToCsv(
      ["Name", "Category", "Relates to"],
      [
        ["DEWA permit 2026.pdf", "permit", "Permit — BP-2026-0142"],
        ["Site photo, north face", "site photo", "—"],
      ]
    );
    expect(csv.split("\n")).toEqual([
      "Name,Category,Relates to",
      "DEWA permit 2026.pdf,permit,Permit — BP-2026-0142",
      '"Site photo, north face",site photo,—',
    ]);
  });

  test("a header set with no rows is still a valid, openable file", () => {
    expect(rowsToCsv(["Name"], [])).toBe("Name");
  });
});
