import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PivotTable } from "@/components/reports/PivotTable";
import { ReportChart } from "@/components/reports/ReportChart";

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
 * report/tool.
 *
 * `fieldLabels` (optional): CONS-02 (R46 P4 consistency sweep) -- the
 * project-status report's own JSON legitimately carries two differently
 * -derived, intentionally-distinct percent-complete fields side by side
 * (percentByValue: value-weighted against the current BOQ; progressPercent:
 * a flat average of each activity's latest logged percentComplete, no BOQ
 * scoping -- see construction-dashboard-service.ts#getProjectDashboard()).
 * Rendered generically with their bare JSON key names, a real user reading
 * this screen sees two unexplained numbers disagreeing with no indication
 * they measure different things. Callers that know their report's field
 * semantics may supply a key -> human label override map here so this
 * still-generic renderer can show it without hand-building a bespoke view
 * for every report shape; reports that pass nothing keep today's exact
 * bare-key-name display.
 *
 * `fieldFormatters` (optional, R55): same opt-in per-key override shape as
 * `fieldLabels`, but for the rendered VALUE instead of the label -- e.g. a
 * currency field (project-status's contractValue) needs its org's live
 * currency code prefixed (see LabourClient.tsx / MaterialsClient.tsx's
 * currencyLabel()+useCurrencies() fix, same defect class: a bare number
 * with no currency token is not self-explanatory). Left undefined, a key
 * renders exactly as before via cellValue() -- no behavioural change for
 * the other 16 reports or the AI Copilot's 7 tool results that don't pass
 * one. */
export function ReportOutput({
  data,
  fieldLabels,
  fieldFormatters,
}: {
  data: unknown;
  fieldLabels?: Record<string, string>;
  fieldFormatters?: Record<string, (v: unknown) => string>;
}) {
  if (Array.isArray(data)) {
    if (data.length === 0) return <p className="py-6 text-center text-sm text-px-muted">No rows returned.</p>;
    const columns = isPlainObject(data[0]) ? Object.keys(data[0]) : ["value"];
    const rows: Record<string, unknown>[] = isPlainObject(data[0])
      ? (data as Record<string, unknown>[])
      : data.map((v) => ({ value: v }));
    return (
      <Tabs defaultValue="table" className="space-y-2">
        <TabsList>
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="pivot">Pivot</TabsTrigger>
          <TabsTrigger value="chart">Chart</TabsTrigger>
        </TabsList>
        <TabsContent value="table">
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
        </TabsContent>
        <TabsContent value="pivot">
          <PivotTable columns={columns} rows={rows} />
        </TabsContent>
        <TabsContent value="chart">
          <ReportChart columns={columns} rows={rows} />
        </TabsContent>
      </Tabs>
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
                <div className="text-xs text-px-muted">{fieldLabels?.[k] ?? k}</div>
                <div className="font-medium text-px-ink">{fieldFormatters?.[k] ? fieldFormatters[k](v) : cellValue(v)}</div>
              </div>
            ))}
          </div>
        )}
        {nestedEntries.map(([k, v]) => (
          <div key={k} className="space-y-2">
            <div className="text-sm font-semibold text-px-ink">{fieldLabels?.[k] ?? k}</div>
            <ReportOutput data={v} fieldLabels={fieldLabels} fieldFormatters={fieldFormatters} />
          </div>
        ))}
      </div>
    );
  }

  return <p className="text-sm text-px-ink">{cellValue(data)}</p>;
}
