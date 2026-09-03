"use client";

import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PivotTable } from "./PivotTable";
import { ReportChart } from "./ReportChart";
import { chartDefaults, filterRowsByCategory } from "./pivot-utils";

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
 *
 * R67 E-27 (R-213): a bar click in the Chart tab lifts its category here, so
 * the Table tab filters to it and a removable chip above the tabs says what is
 * being filtered. Without that, clicking a bar answered "which is biggest" and
 * then left the reader to find those rows by eye.
 */
export function ReportResultView({ result }: { result: TabularReportResult }) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // The field the chart is grouping by -- the same inference the chart itself
  // opens on, so the chip and the filter always name the column the bars are.
  const categoryField = useMemo(
    () => chartDefaults(result.rows, result.columns).categoryField,
    [result.rows, result.columns]
  );

  const visibleRows = useMemo(
    () => filterRowsByCategory(result.rows, categoryField, selectedCategory),
    [result.rows, categoryField, selectedCategory]
  );

  return (
    <div className="space-y-2">
      {result.narrative && (
        <p className="text-xs italic text-px-ink bg-white rounded p-2 border border-px-border">{result.narrative}</p>
      )}
      {result.rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-px-muted">No rows returned.</p>
      ) : (
        <Tabs defaultValue="table" className="space-y-2">
          {selectedCategory !== null && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-px-ink">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-px-border px-2 py-0.5">
                {categoryField}: {selectedCategory}
                <button
                  type="button"
                  aria-label={`Clear the ${categoryField} filter`}
                  onClick={() => setSelectedCategory(null)}
                  className="text-px-muted hover:text-px-ink"
                >
                  ×
                </button>
              </span>
              <span className="text-px-muted">
                {visibleRows.length} of {result.rows.length} row{result.rows.length === 1 ? "" : "s"}
              </span>
            </div>
          )}
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
                  {visibleRows.map((row, i) => (
                    <TableRow key={i}>
                      {result.columns.map((c) => <TableCell key={c}>{cellValue(row[c])}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
          <TabsContent value="pivot">
            {/* The pivot reads every row: it is a summary of the whole result,
                and silently pivoting a filtered subset under an unchanged
                heading is how a total comes to disagree with itself. */}
            <PivotTable columns={result.columns} rows={result.rows} />
          </TabsContent>
          <TabsContent value="chart">
            <ReportChart
              columns={result.columns}
              rows={result.rows}
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
            />
          </TabsContent>
        </Tabs>
      )}
      {result.note && <p className="text-[11px] text-px-muted">{result.note}</p>}
    </div>
  );
}
