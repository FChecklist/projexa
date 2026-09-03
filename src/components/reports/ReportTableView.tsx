"use client";

// R67 E-32 (R-265). ONE renderer for every report VERIDIAN serves.
//
// WHAT IT REPLACES. ReportOutput's generic object renderer, which printed a
// payload's own JSON key names against their raw values -- twelve of the
// seventeen reports in this module rendered that way. It is still the right
// component for the AI Copilot's arbitrary tool results, which genuinely have
// no declared shape; it is the wrong one for a report, which now has one.
//
// WHAT IT GUARANTEES, and each one is a defect the audit found:
//   * a FIXED header row, so scrolling a long report does not lose the columns;
//   * text left, numbers right, in tabular figures, so a money column lines up
//     on the decimal point instead of jittering per row;
//   * money through the ONE shared formatter (WS-G's formatMoney), so the same
//     amount cannot read "AED 1,200" here and "1200" on the dashboard;
//   * dates through the ONE shared date formatter, pinned to a locale and UTC;
//   * a missing value as an en-dash, never a zero;
//   * a bold grand-total row ONLY where the server said a total is a real
//     statement -- it omits `totals` for a row of percentages and for Project
//     Status's revenue/budget/expense, and this prints no total there rather
//     than inventing one.
//
// The Pivot and Chart tabs are fed from the SAME rows (toLabelledRows), so a
// figure cannot differ between the grid and the chart drawn beside it.

import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PivotTable } from "./PivotTable";
import { ReportChart } from "./ReportChart";
import { chartDefaults } from "./pivot-utils";
import { formatReportCell, hasTotals, toLabelledRows, type ReportTable } from "@/lib/report-table";
import type { OrgMoney } from "@/lib/use-org-money";

export function ReportTableView({ table, orgMoney }: { table: ReportTable; orgMoney: OrgMoney }) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // The money format the whole table uses. The server states the org's currency
  // once on the response; the client's own /api/currencies answer is the
  // fallback while it has one, so a table rendered before that request lands
  // still shows the code VERIDIAN already told us.
  const money = useMemo(
    () => ({ ...orgMoney.format, currency: table.currency ?? orgMoney.currency }),
    [orgMoney.format, orgMoney.currency, table.currency]
  );

  const labelled = useMemo(() => toLabelledRows(table), [table]);
  const categoryField = useMemo(
    () => chartDefaults(labelled.rows, labelled.columns).categoryField,
    [labelled.rows, labelled.columns]
  );
  const visibleRows = useMemo(() => {
    if (selectedCategory === null) return table.rows;
    // Filtering happens on the LABELLED projection (that is what the chart
    // clicked) but the grid renders the typed rows, so the two are zipped by
    // index rather than re-derived -- re-deriving is how a filtered table comes
    // to show a different row than the bar the reader clicked.
    const keep = new Set(
      labelled.rows.map((r, i) => (String(r[categoryField] ?? "") === selectedCategory ? i : -1)).filter((i) => i >= 0)
    );
    return table.rows.filter((_, i) => keep.has(i));
  }, [table.rows, labelled.rows, categoryField, selectedCategory]);

  if (table.rows.length === 0) {
    return (
      <div className="space-y-2">
        <p className="py-6 text-center text-sm text-px-muted">No rows returned.</p>
        {table.note && <p className="text-[11px] text-px-muted">{table.note}</p>}
      </div>
    );
  }

  const alignClass = (align: "left" | "right") => (align === "right" ? "text-right tabular-nums" : "text-left");
  // The first column with no total of its own is where the word "Total" goes.
  const firstFree = table.columns.findIndex((c) => table.totals?.[c.key] === undefined);
  const totalLabelIndex = firstFree === -1 ? 0 : firstFree;

  return (
    <div className="space-y-2">
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
              {visibleRows.length} of {table.rows.length} row{table.rows.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
        <TabsList>
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="pivot">Pivot</TabsTrigger>
          {/* A chart of a table with nothing to plot is an empty frame with a
              legend on it, so the tab is not offered at all. */}
          {table.columns.some((c) => c.unit !== "text" && c.unit !== "date") && (
            <TabsTrigger value="chart">Chart</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="table">
          <div className="overflow-x-auto rounded border border-px-border bg-white">
            <Table data-testid="report-table">
              <TableHeader className="sticky top-0 bg-white">
                <TableRow>
                  {table.columns.map((c) => (
                    <TableHead key={c.key} className={alignClass(c.align)}>
                      {/* The currency is named ONCE, in the header of the
                          column it applies to, rather than repeated on every
                          cell -- which is also why formatMoney's own code
                          prefix stays: a column read on its own still says
                          what it is. */}
                      {c.label}
                      {c.unit === "currency" ? orgMoney.unitSuffix : ""}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row, i) => (
                  <TableRow key={i}>
                    {table.columns.map((c) => (
                      <TableCell key={c.key} className={alignClass(c.align)}>
                        {formatReportCell(row[c.key], c.unit, money)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {hasTotals(table) && (
                  <TableRow className="border-t-2 border-px-border font-semibold" data-testid="report-total-row">
                    {table.columns.map((c, index) => {
                      const total = table.totals?.[c.key];
                      // The word goes in the first column that has no figure of
                      // its own, so the row reads as a total rather than as one
                      // more line of data -- and if EVERY column totals (a table
                      // of nothing but measures), it prefixes the first cell
                      // rather than being dropped, because an unlabelled bold
                      // row at the bottom of a report is exactly the kind of
                      // number a reader mistakes for another record.
                      const labelHere = index === totalLabelIndex;
                      if (labelHere && total === undefined) return <TableCell key={c.key}>Total</TableCell>;
                      return (
                        <TableCell key={c.key} className={alignClass(c.align)}>
                          {labelHere ? "Total " : ""}
                          {total === undefined ? "" : formatReportCell(total, c.unit, money)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="pivot">
          {/* The pivot reads EVERY row: it summarises the whole result, and
              silently pivoting a filtered subset under an unchanged heading is
              how a total comes to disagree with itself. */}
          <PivotTable columns={labelled.columns} rows={labelled.rows} />
        </TabsContent>

        <TabsContent value="chart">
          <ReportChart
            columns={labelled.columns}
            rows={labelled.rows}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />
        </TabsContent>
      </Tabs>
      {table.note && <p className="text-[11px] text-px-muted">{table.note}</p>}
      {orgMoney.showNotice && table.columns.some((c) => c.unit === "currency") && (
        <p className="text-[11px] text-px-muted">{orgMoney.notice}</p>
      )}
    </div>
  );
}
