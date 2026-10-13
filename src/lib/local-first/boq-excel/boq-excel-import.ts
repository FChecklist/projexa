// A BOQ workbook, read and mapped on the laptop with no network (Sumeet R-70..R-72, checklist 3.1): bytes -> the sheet's rows -> the server's own mapping
// rules (boq-excel-map.ts) -> the lines the New BOQ grid holds, with a per-row preview and the problems named by sheet row.
//
// Nothing here is sent anywhere and nothing is stored: the person looks at the preview, chooses to use the lines, and the New BOQ screen then keeps them as an
// ordinary create_boq (scope-writes.ts createBoqOffline) like any BOQ typed by hand, with all of its checks. The file itself is never kept.

import type { LineItemDraft } from "@/lib/boq-helpers";
import { mapBoqHeaders, mapRowsToLines, toDrafts, toPreviewRows, BoqMapError, type BoqColumnMapping, type BoqRowIssue, type PreviewRow } from "./boq-excel-map";
import { readFirstSheetRecords, XlsxReadError } from "./xlsx-lite";

export type BoqExcelImport = {
  fileName: string;
  sheetName: string;
  /** The file's name without its extension: the BOQ's suggested title. */
  title: string;
  headers: string[];
  mapping: BoqColumnMapping;
  /** Data rows of the sheet (the header excluded). */
  totalRows: number;
  drafts: LineItemDraft[];
  preview: PreviewRow[];
  warnings: string[];
  issues: BoqRowIssue[];
  /** The issues that stop the import: the person fixes the file and chooses it again. */
  blocking: BoqRowIssue[];
};

export type BoqExcelResult = { ok: true; value: BoqExcelImport } | { ok: false; message: string };

/** Plain words for every way reading a file can fail; never throws. */
export async function importBoqFromBytes(bytes: Uint8Array, fileName: string): Promise<BoqExcelResult> {
  try {
    if (/\.(xls|xlsb)$/i.test(fileName) && !/\.xlsx$/i.test(fileName)) return { ok: false, message: "Only .xlsx workbooks can be read on the laptop. Save the file as .xlsx and choose it again." };
    const sheet = await readFirstSheetRecords(bytes);
    const mapping = mapBoqHeaders(sheet.headers);
    const { lines, warnings, issues } = mapRowsToLines(sheet.records, mapping);
    if (lines.length === 0) return { ok: false, message: "No usable lines were found in this sheet. " + (warnings[0] ?? "") };
    return {
      ok: true,
      value: {
        fileName, sheetName: sheet.sheetName, title: fileName.replace(/\.[^.]+$/, "").trim(), headers: sheet.headers, mapping, totalRows: sheet.records.length,
        drafts: toDrafts(lines), preview: toPreviewRows(lines), warnings, issues, blocking: issues.filter((i) => i.blocking),
      },
    };
  } catch (error) {
    if (error instanceof XlsxReadError || error instanceof BoqMapError) return { ok: false, message: error.message };
    return { ok: false, message: "This file could not be read. Check that it is a normal Excel (.xlsx) BOQ sheet." };
  }
}
