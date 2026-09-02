// R67 (audit "Export writes a CSV of the filtered rows"). Every screen that
// exports today builds its CSV by hand with `[a, b, c].join(",")` and quotes
// only the fields the author remembered could contain a comma -- so a worker
// called "Ali Hassan, Jr" or a trade with a newline silently shifts every
// column after it, and a value beginning with "=" is a live formula the
// moment the file is opened in Excel.
//
// This is the one builder. It is server-safe (no "use client", no DOM) so it
// can be unit tested and reused from a route handler; downloadCsv() below is
// the only DOM-touching part and is called from the browser.
//
// The leading-character guard mirrors compliance-tracker's own
// src/lib/report-export-shared.ts csvEscape(): a cell whose first character is
// = + - @ (or a tab/CR, which Excel strips before parsing) is prefixed with a
// single quote so Excel treats it as text. That prefix is visible in the cell,
// which is the correct trade-off -- a visibly quoted string beats a formula
// that runs.

const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

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

/** Browser-only: hands the built CSV to the user as a download. */
export function downloadCsv(filename: string, csv: string): void {
  // The BOM keeps Excel from mangling non-ASCII names (a real problem on a
  // roster of Arabic and Hindi names) without affecting any other reader.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
