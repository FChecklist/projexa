// R67 D-14. A CSV a spreadsheet opens correctly and cannot be attacked with.
//
// PROJEXA must not gain an XLSX library (the drawings register's Export, D-10,
// relays a workbook built by VERIDIAN for exactly that reason). The Documents
// list's Export is small and client-side by design -- it serialises the rows
// already on screen -- but "client-side" is not a licence to build the file by
// joining strings with commas, which is what the one existing client-side
// export in this repo does (WorkProgressReportClient.exportCsv): a description
// containing a comma splits into two columns, a description containing a quote
// corrupts the row, and a cell beginning with "=" is executed as a formula by
// Excel and Sheets the moment the file is opened.
//
// The escaping rules here are the ones compliance-tracker's own
// src/lib/report-export-shared.ts applies server-side, so an export produced in
// the browser and one produced by VERIDIAN are the same file.

/**
 * RFC 4180 quoting plus the formula-injection guard: a value starting with
 * = + - @ (or a tab/CR, which some spreadsheets strip before parsing) is
 * prefixed with a single quote so it is read as text, never evaluated.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Header row plus one line per row, in the order the columns were given. */
export function rowsToCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvEscape).join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n");
}

/**
 * Hand the browser a file. Kept here so the two behaviours a download needs --
 * revoking the object URL, and removing the anchor -- are not re-remembered at
 * every call site.
 */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
