import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Adaptive renderer for arbitrary read-only JSON results (VERIDIAN's 17
 * named reports and the AI Copilot's 7 whitelisted tool results) -- each
 * returns a different shape, so this renders arrays-of-objects as tables
 * and scalar object fields as a key/value summary grid, recursing into
 * nested arrays/objects, rather than hand-building a bespoke view per
 * report/tool. */
export function ReportOutput({ data }: { data: unknown }) {
  if (Array.isArray(data)) {
    if (data.length === 0) return <p className="py-6 text-center text-sm text-px-muted">No rows returned.</p>;
    const columns = isPlainObject(data[0]) ? Object.keys(data[0]) : ["value"];
    return (
      <Table>
        <TableHeader><TableRow>{columns.map((c) => <TableHead key={c}>{c}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {data.map((row, i) => (
            <TableRow key={i}>
              {columns.map((c) => <TableCell key={c}>{cellValue(isPlainObject(row) ? row[c] : row)}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  if (isPlainObject(data)) {
    const scalarEntries = Object.entries(data).filter(([, v]) => !Array.isArray(v) && !isPlainObject(v));
    const nestedEntries = Object.entries(data).filter(([, v]) => Array.isArray(v) || isPlainObject(v));
    return (
      <div className="space-y-4">
        {scalarEntries.length > 0 && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {scalarEntries.map(([k, v]) => (
              <div key={k}>
                <div className="text-xs text-px-muted">{k}</div>
                <div className="font-medium text-px-ink">{cellValue(v)}</div>
              </div>
            ))}
          </div>
        )}
        {nestedEntries.map(([k, v]) => (
          <div key={k} className="space-y-2">
            <div className="text-sm font-semibold text-px-ink">{k}</div>
            <ReportOutput data={v} />
          </div>
        ))}
      </div>
    );
  }

  return <p className="text-sm text-px-ink">{cellValue(data)}</p>;
}
