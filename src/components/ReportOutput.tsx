import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PivotTable } from "@/components/reports/PivotTable";
import { ReportChart } from "@/components/reports/ReportChart";
// R67 D-61: one number and date format for the whole product. The number
// helpers come from lane G-05's src/lib/format-number.ts -- D-61 briefly
// shipped a second module of its own and it has been dropped in favour of
// G-05's, which is a superset.
import { EMPTY_VALUE, formatDecimal } from "@/lib/format-number";
import { formatDate, formatDateTime } from "@/lib/format-date";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * R67 D-61 (audit R-198/R-226). This renderer is generic over 17 named reports
 * and 7 Copilot tool results, so it cannot know which key is money -- that
 * stays opt-in through `fieldFormatters` (see ReportsClient's
 * buildProjectStatusFormatters). What it CAN do, and did not, is render a
 * NUMBER as a number: `String(v)` produced "1250000.5" in a key/value grid
 * sitting one tab away from a table showing "1,250,000.50" for the same figure.
 *
 * Two rules, both from the shared helpers:
 *   - a finite number renders with the pinned locale's thousands separators;
 *   - an ISO date/timestamp renders through format-date.ts, the same as every
 *     other date in the product, instead of leaking "2026-08-25T00:00:00.000Z"
 *     into a report a customer reads.
 * Everything else (booleans, ids, codes, free text) is unchanged.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function cellValue(v: unknown): string {
  if (v === null || v === undefined) return EMPTY_VALUE;
  if (typeof v === "object") return JSON.stringify(v);
  // formatDecimal, not formatNumber: this renderer sees quantities, counts and
  // amounts through the same branch and cannot tell them apart, so it groups
  // the thousands and keeps up to two decimals without inventing ".00" on a
  // count. A key that really is money opts in through fieldFormatters.
  if (typeof v === "number") return formatDecimal(v);
  if (typeof v === "string" && ISO_DATE.test(v)) {
    return v.length === 10 ? formatDate(v) : formatDateTime(v);
  }
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
                {/* R67 D-61: tabular figures, so two stacked values in this
                    grid have digits of the same width and can be compared. */}
                <div className="font-medium text-px-ink tabular-nums">{fieldFormatters?.[k] ? fieldFormatters[k](v) : cellValue(v)}</div>
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
