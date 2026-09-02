"use client";

// R67 lane D22 (item D-68, rec R-258) -- ONE IMPORT SCREEN, THREE IMPORTS.
//
// A construction org has exactly three spreadsheets it needs to hand over: the
// BOQ, the programme, and the crew list. They were three separate problems in
// this codebase -- the BOQ importer shipped with no screen at all, the
// programme had a proxy pointing at a VERIDIAN path that never existed, and the
// roster was typed in one worker at a time. Items D-52 and D-48 built the first
// two screens; this is the component all three now share, so a person who has
// imported a BOQ already knows how to import a programme.
//
// NO XLSX LIBRARY IS ADDED TO THIS REPO, and none may be: the file is posted as
// FormData and parsed server-side, and everything shown below is VERIDIAN's
// real reading of it (dryRun=true) -- the same reading that gets committed, so
// the preview cannot disagree with the result. R-258's original suggestion of a
// client-side parse is dropped for exactly that reason.
//
// WHAT EVERY IMPORT GETS, whatever it is importing:
//   * a template link, so nobody has to guess the columns;
//   * a drop zone that also has a real Choose file control (a drop zone alone
//     is unusable on a tablet, which is what half of a site office runs);
//   * the columns the server DETECTED, correctable, because a real export names
//     things its own way and the fix should not be "go and edit the file";
//   * per-row messages that say what to fix and where -- "Row 3: Rate is
//     blank", not "invalid input";
//   * one summary sentence, "38 rows ready, 3 with errors";
//   * a "Skip rows with errors" toggle, because 3 bad rows out of 38 should not
//     block the other 35;
//   * one primary button whose label counts what will actually be written, and
//     which is disabled WITH THE REASON rather than failing after the click.
import type { ReactNode } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** The sentinel the mapping selects use for "this field has no column in the file". */
export const UNMAPPED = "__unmapped__";

export type ImportField = { key: string; label: string; required?: boolean };

export type ImportPreviewRow = {
  key: string | number;
  /** Row number as the person sees it in Excel. */
  rowNumber: number;
  cells: ReactNode[];
  errors: string[];
  warnings: string[];
};

export type ImportPreview = {
  fileName: string;
  /** The headers actually present in the uploaded file. */
  headers: string[];
  /** field key -> the header currently feeding it. */
  mapping: Record<string, string | undefined>;
  rows: ImportPreviewRow[];
  /** Sheet-level messages: rose stops the import, clay does not. */
  blockingErrors: string[];
  notices: string[];
};

export type ImportScreenProps = {
  /** "Import BOQ from Excel" / "Import programme" / "Import roster". */
  title: string;
  helpText: string;
  /** Static file in public/templates. */
  templateHref: string;
  templateColumns: string;
  /** The fields this import understands, in the order the template lists them. */
  fields: ImportField[];
  /** Column headings for the preview grid. */
  previewColumns: string[];
  preview: ImportPreview | null;
  busy: boolean;
  error: string | null;
  skipRowsWithErrors: boolean;
  onSkipChange: (next: boolean) => void;
  /**
   * Non-null disables the "Skip rows with errors" toggle and says why. Some
   * imports genuinely cannot skip: a programme with a missing predecessor
   * imports a broken dependency chain, which is worse than not importing.
   */
  skipDisabledReason?: string | null;
  onFileChosen: (file: File | null) => void;
  onMappingChange: (field: string, header: string) => void;
  onImport: () => void;
  onRetry: () => void;
  /** e.g. the BOQ's "Create as Rev0 / new revision of ..." radio. */
  extraControls?: ReactNode;
  /** A second true sentence this particular import can add under the summary. */
  extraSummary?: ReactNode;
  /** What one row is called, for the button and the summary. */
  rowNoun?: { one: string; many: string };
};

/** Pure: "38 rows ready, 3 with errors" -- the item's own sentence. */
export function importSummaryLine(readyRows: number, errorRows: number, noun = { one: "row", many: "rows" }): string {
  const rows = `${readyRows} ${readyRows === 1 ? noun.one : noun.many} ready`;
  return `${rows}, ${errorRows} with ${errorRows === 1 ? "error" : "errors"}`;
}

/** Pure: why the primary button cannot be pressed, or null when it can. */
export function importDisabledReason(args: {
  hasFile: boolean;
  busy: boolean;
  errorRows: number;
  skipRowsWithErrors: boolean;
  blockingErrors: number;
  unmappedRequired: string[];
  importableRows: number;
}): string | null {
  if (!args.hasFile) return "Choose a file";
  if (args.busy) return "Importing…";
  if (args.blockingErrors > 0) return "This file cannot be read";
  if (args.unmappedRequired.length > 0) {
    return `${args.unmappedRequired.length} required ${args.unmappedRequired.length === 1 ? "field" : "fields"} unmapped - ${args.unmappedRequired.join(", ")}`;
  }
  // "Fix 3 rows" is the item's own wording. Skipping them is the other way out,
  // which is why the toggle sits right beside this button.
  if (args.errorRows > 0 && !args.skipRowsWithErrors) {
    return `Fix ${args.errorRows} ${args.errorRows === 1 ? "row" : "rows"}`;
  }
  if (args.importableRows === 0) return "Nothing left to import";
  return null;
}

export default function ImportScreen({
  title, helpText, templateHref, templateColumns, fields, previewColumns,
  preview, busy, error, skipRowsWithErrors, onSkipChange, skipDisabledReason = null,
  onFileChosen, onMappingChange, onImport, onRetry,
  extraControls, extraSummary, rowNoun = { one: "row", many: "rows" },
}: ImportScreenProps) {
  const errorRows = preview ? preview.rows.filter((r) => r.errors.length > 0).length : 0;
  const readyRows = preview ? preview.rows.length - errorRows : 0;
  const importableRows = skipRowsWithErrors && !skipDisabledReason ? readyRows : readyRows + errorRows;
  const unmappedRequired = preview
    ? fields.filter((f) => f.required && (!preview.mapping[f.key] || preview.mapping[f.key] === UNMAPPED)).map((f) => f.label)
    : [];
  const canSkip = !skipDisabledReason;
  const disabledReason = importDisabledReason({
    hasFile: !!preview, busy, errorRows, skipRowsWithErrors: skipRowsWithErrors && canSkip,
    blockingErrors: preview?.blockingErrors.length ?? 0, unmappedRequired, importableRows,
  });

  return (
    <div className="space-y-4">
      <h2 className="text-[15px] font-medium">{title}</h2>

      {error && (
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <p role="alert" className="text-sm text-px-error">{error}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 p-6">
          <p className="text-sm text-px-muted">{helpText}</p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-px-border2 p-8 text-center">
            <Upload className="size-6 text-px-muted" aria-hidden="true" />
            <span className="text-sm font-medium">Choose a .xlsx or .csv file</span>
            <span className="text-[12px] text-px-muted">{busy ? "Reading…" : preview ? preview.fileName : "or drop it here"}</span>
            <input
              type="file" accept=".xlsx,.xls,.csv" className="sr-only"
              aria-label={title}
              onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-[12.5px]">
            <a className="text-px-steel underline underline-offset-2" href={templateHref} download>
              Download the PROJEXA template (.xlsx)
            </a>
            <span className="text-px-muted"> — {templateColumns}</span>
          </p>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-sm font-medium" role="status">{importSummaryLine(readyRows, errorRows, rowNoun)}</p>
            {extraSummary && <p className="text-[12.5px] text-px-muted">{extraSummary}</p>}

            {preview.blockingErrors.length > 0 && (
              <ul className="space-y-1 text-[12.5px] text-px-error" role="alert">
                {preview.blockingErrors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
            {preview.notices.length > 0 && (
              <ul className="space-y-1 text-[12.5px] text-px-warning">
                {preview.notices.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}

            {/* The correctable mapping row. A real export names its columns its
                own way; the fix is a dropdown here, not "go and edit the file". */}
            {preview.headers.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-3">
                {fields.map((f) => {
                  const value = preview.mapping[f.key] ?? UNMAPPED;
                  const missing = !!f.required && value === UNMAPPED;
                  return (
                    <label key={f.key} className="space-y-1 text-[12.5px]">
                      <span className={missing ? "text-px-error" : "text-px-muted"}>
                        {f.label}{f.required && <span aria-hidden="true"> *</span>}
                        {f.required && <span className="sr-only"> (required)</span>}
                      </span>
                      <Select value={value} onValueChange={(v) => onMappingChange(f.key, v)}>
                        <SelectTrigger aria-label={`${f.label} column`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNMAPPED}>Not in this file</SelectItem>
                          {preview.headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </label>
                  );
                })}
              </div>
            )}

            {extraControls}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-right">Row</TableHead>
                    {previewColumns.map((c) => <TableHead key={c}>{c}</TableHead>)}
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="text-right text-px-muted">{row.rowNumber}</TableCell>
                      {row.cells.map((cell, i) => <TableCell key={i}>{cell}</TableCell>)}
                      <TableCell className="min-w-[220px]">
                        {row.errors.length > 0 ? (
                          <ul className="space-y-0.5 text-[12px] text-px-error">
                            {row.errors.map((e) => <li key={e}>{e}</li>)}
                          </ul>
                        ) : row.warnings.length > 0 ? (
                          <ul className="space-y-0.5 text-[12px] text-px-warning">
                            {row.warnings.map((w) => <li key={w}>{w}</li>)}
                          </ul>
                        ) : (
                          <span className="text-[12px] text-px-success">OK</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <label className="flex items-center gap-2 text-[12.5px]">
              <input
                type="checkbox"
                checked={skipRowsWithErrors && canSkip}
                disabled={errorRows === 0 || !canSkip}
                title={skipDisabledReason ?? undefined}
                onChange={(e) => onSkipChange(e.target.checked)}
              />
              Skip rows with errors
              {!canSkip
                ? <span className="text-px-muted">({skipDisabledReason})</span>
                : errorRows === 0 && <span className="text-px-muted">(no rows have errors)</span>}
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={onImport} disabled={!!disabledReason} title={disabledReason ?? undefined}>
                Import ({importableRows} {importableRows === 1 ? rowNoun.one : rowNoun.many})
              </Button>
              {disabledReason && <p className="text-[12.5px] text-px-muted">{disabledReason}</p>}
              <Button variant="ghost" onClick={() => onFileChosen(null)}>Choose a different file</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
