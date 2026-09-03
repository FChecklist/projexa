// R67 (audit "Export writes a CSV of the filtered rows", D-14 + the lane D3
// export sweep). A CSV a spreadsheet opens correctly and cannot be attacked with.
//
// PROJEXA must not gain an XLSX library (the drawings register's Export, D-10,
// relays a workbook built by VERIDIAN for exactly that reason). The client-side
// exports are small and by design -- they serialise the rows already on screen --
// but "client-side" is not a licence to build the file by joining strings with
// commas, which is what every hand-rolled export in this repo used to do: a
// description containing a comma splits into two columns, a description
// containing a quote corrupts the row, and a cell beginning with "=" is executed
// as a formula by Excel and Sheets the moment the file is opened.
//
// This is the one builder. It is server-safe (no "use client", no DOM) so it can
// be unit tested and reused from a route handler; downloadCsv() below is the only
// DOM-touching part and is called from the browser.
//
// The escaping rules here are the ones compliance-tracker's own
// src/lib/report-export-shared.ts applies server-side, so an export produced in
// the browser and one produced by VERIDIAN are the same file.
//
// R67 MERGE (D-11, lane D1 x lane D3, 2026-09-03). Both lanes wrote this module
// independently -- an add/add conflict on every line. It is now ONE
// implementation, resolved per function on merit rather than by picking a side:
//
//   - csvEscape: identical behaviour in both; kept D3's explicit
//     FORMULA_TRIGGERS list over D1's equivalent regex, because the list names
//     what it is guarding against.
//   - toCsv: D3's name and its CRLF line ending WIN over D1's rowsToCsv/"\n".
//     CRLF is what Excel expects, and one exported builder under two names is
//     the duplication this merge exists to prevent. D1's three call sites
//     (BudgetAnalyticalClient, DocumentsClient, ProjectsListClient) and its
//     assertions moved across; rowsToCsv is GONE, not aliased.
//   - downloadCsv: a genuine union. D3's UTF-8 BOM (Excel mangles Arabic and
//     Hindi names without it) plus D1's appendChild/remove around the click,
//     which is what makes the download fire in Firefox -- an anchor that was
//     never in the document does nothing there.
//   - csvFilename: D3's only; D1 had no equivalent and its call sites built
//     names inline.

const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * RFC 4180 quoting plus the formula-injection guard: a value starting with
 * = + - @ (or a tab/CR, which some spreadsheets strip before parsing) is
 * prefixed with a single quote so it is read as text, never evaluated. That
 * prefix is visible in the cell, which is the correct trade-off -- a visibly
 * quoted string beats a formula that runs.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (text.length > 0 && FORMULA_TRIGGERS.includes(text[0])) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Header row + data rows, CRLF-separated (the line ending Excel expects). */
export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

/**
 * Builds a filename like `roster-cedar-heights-villa-phase-1-2026-09-03.csv`.
 * The label is slugged because a real project name carries spaces, slashes and
 * dashes that a browser's download attribute (and Windows) will not keep.
 */
export function csvFilename(prefix: string, label: string, isoDate: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "export";
  return `${prefix}-${slug}-${isoDate}.csv`;
}

/**
 * Browser-only: hands the built CSV to the user as a download. Kept here so the
 * three things a download needs -- the BOM, being in the document when clicked,
 * and revoking the object URL -- are not re-remembered at every call site.
 */
export function downloadCsv(filename: string, csv: string): void {
  // The BOM keeps Excel from mangling non-ASCII names (a real problem on a
  // roster of Arabic and Hindi names) without affecting any other reader.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  // In the document before the click, removed straight after: Firefox ignores
  // a click on an anchor that was never attached.
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
