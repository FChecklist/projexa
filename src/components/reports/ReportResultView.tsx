"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PivotTable } from "./PivotTable";
import { ReportChart } from "./ReportChart";

export type TabularReportResult = {
  columns: string[];
  rows: Record<string, string | number>[];
  narrative?: string;
  note?: string;
};

function cellValue(v: string | number | undefined): string {
  if (v === undefined || v === null || v === "") return "—";
  return String(v);
}

/**
 * View-mode switcher (Table / Pivot / Chart) over one report_definitions
 * execution result. All three views read the same {columns, rows} shape --
 * Table is the raw grid, Pivot and Chart aggregate it client-side
 * (pivot-utils.ts). Kept separate from ReportOutput.tsx, which handles
 * report shapes that are NOT flat tabular JSON (nested objects, key/value
 * summaries) -- this component is for the tabular case specifically.
 */
export function ReportResultView({ result }: { result: TabularReportResult }) {
  return (
    <div className="space-y-2">
      {result.narrative && (
        <p className="text-xs italic text-px-ink bg-white rounded p-2 border border-px-border">{result.narrative}</p>
      )}
      {result.rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-px-muted">No rows returned.</p>
      ) : (
        <Tabs defaultValue="table" className="space-y-2">
          <TabsList>
            <TabsTrigger value="table">Table</TabsTrigger>
            <TabsTrigger value="pivot">Pivot</TabsTrigger>
            <TabsTrigger value="chart">Chart</TabsTrigger>
          </TabsList>
          <TabsContent value="table">
            <div className="overflow-x-auto rounded border border-px-border bg-white">
              <Table>
                <TableHeader>
                  <TableRow>{result.columns.map((c) => <TableHead key={c}>{c}</TableHead>)}</TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row, i) => (
                    <TableRow key={i}>
                      {result.columns.map((c) => <TableCell key={c}>{cellValue(row[c])}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
          <TabsContent value="pivot">
            <PivotTable columns={result.columns} rows={result.rows} />
          </TabsContent>
          <TabsContent value="chart">
            <ReportChart columns={result.columns} rows={result.rows} />
          </TabsContent>
        </Tabs>
      )}
      {result.note && <p className="text-[11px] text-px-muted">{result.note}</p>}
    </div>
  );
}
