"use client";

// LOCAL-FIRST shell, overview cluster: draws a server answer kept on this laptop (a report, an analysis) EXACTLY as the server sent it.
// It computes nothing: no sum, no ratio, no total. Scalars are a field/value list, a list of objects is a table (its columns are the
// union of the rows' own keys), a nested object is its own field/value list. Long tables are cut at MAX_ROWS with a plain note; the
// CSV export (report-run.ts reportResultToCsv) always carries every row.

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const MAX_ROWS = 200;

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v;
  return Array.isArray(v) ? `${v.length} items` : "…";
}

function Fields({ obj }: { obj: Record<string, unknown> }) {
  const scalars = Object.entries(obj).filter(([, v]) => !Array.isArray(v) && !isPlain(v));
  if (scalars.length === 0) return null;
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 text-sm" data-testid="overview-body-fields">
      {scalars.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-px-muted">{humanise(k)}</dt>
          <dd className="text-px-ink">{cell(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Rows({ rows }: { rows: unknown[] }) {
  if (rows.length === 0) return <p className="text-sm text-px-muted">No rows.</p>;
  const objects = rows.filter(isPlain);
  if (objects.length === 0) {
    return <ul className="list-disc pl-5 text-sm">{rows.slice(0, MAX_ROWS).map((r, i) => <li key={i}>{cell(r)}</li>)}</ul>;
  }
  const columns = [...new Set(objects.flatMap((r) => Object.keys(r)))].filter((c) => objects.some((r) => !Array.isArray(r[c]) && !isPlain(r[c])));
  return (
    <div className="overflow-x-auto rounded-lg border border-black/10 bg-white">
      <Table>
        <TableHeader>
          <TableRow>{columns.map((c) => <TableHead key={c}>{humanise(c)}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {objects.slice(0, MAX_ROWS).map((r, i) => (
            <TableRow key={i} data-testid="overview-body-row">
              {columns.map((c) => <TableCell key={c}>{cell(r[c])}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {objects.length > MAX_ROWS ? <p className="p-2 text-xs text-px-muted">Showing the first {MAX_ROWS} of {objects.length} rows. The export has all of them.</p> : null}
    </div>
  );
}

export function OverviewBody({ body }: { body: unknown }) {
  if (Array.isArray(body)) return <Rows rows={body} />;
  if (!isPlain(body)) return <p className="text-sm text-px-ink">{cell(body)}</p>;
  return (
    <div className="space-y-4" data-testid="overview-body">
      <Fields obj={body} />
      {Object.entries(body).map(([k, v]) =>
        Array.isArray(v) ? (
          <div key={k}>
            <h3 className="mb-1 text-sm font-semibold text-px-ink">{humanise(k)}</h3>
            <Rows rows={v} />
          </div>
        ) : isPlain(v) ? (
          <div key={k}>
            <h3 className="mb-1 text-sm font-semibold text-px-ink">{humanise(k)}</h3>
            <Fields obj={v} />
          </div>
        ) : null
      )}
    </div>
  );
}

/** Saves a text as a file in the browser (nothing leaves the laptop). */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
