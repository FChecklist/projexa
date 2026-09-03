"use client";

// R67 E-12 (R-136). The ONE report document, rendered from its schema.
//
// This replaces ReportOutput's generic branches for every report that has a
// schema: instead of a table whose headers are raw JSON keys and whose cells
// are all String(v), the columns, their order, their labels, their alignment,
// their decimals, the bands, the subtotals, the grand total and the links are
// all read off src/lib/report-schema.ts -- the same description
// compliance-tracker builds the exported PDF/XLSX/CSV from.
//
// Reports with no schema keep the generic grid, deliberately (see
// report-schema.ts's header): inventing a document for a payload nobody
// described would be a worse lie than the raw keys. Their unmapped keys are
// logged rather than dropped.

import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Fragment, useEffect, useMemo, useState } from "react";
import { MONEY_CELL_CLASS, type MoneyFormat } from "@/lib/format-money";
import {
  chartBars,
  columnTotals,
  formatCell,
  groupRows,
  lineHref,
  schemaRows,
  totalsTieMessage,
  unmappedKeys,
  type ReportSchema,
} from "@/lib/report-schema";

/** The banner's exact words live with the rule that produces them, in report-schema.ts. */
export function ReportTotalsBanner({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800"
      data-testid="report-totals-banner"
    >
      {message} — Export is disabled until the report and its rows agree.
    </p>
  );
}

function cellClass(align: "left" | "right"): string {
  // Right-aligned figures get tabular numerals so a column of money aligns on
  // the decimal point rather than drifting with the glyph widths.
  return align === "right" ? MONEY_CELL_CLASS : "text-left";
}

/**
 * A sorted horizontal bar, offered only where the schema allows a chart at all.
 * Never a pie: a pie cannot be read for rank or for difference, which is the
 * only question anyone asks of these figures.
 */
function SortedBars({ bars, format }: { bars: { label: string; value: number }[]; format: MoneyFormat }) {
  const max = Math.max(...bars.map((b) => b.value), 0);
  return (
    <ul className="space-y-1.5" data-testid="report-chart">
      {bars.map((bar) => (
        <li key={bar.label} className="flex items-center gap-3">
          <span className="w-40 shrink-0 truncate text-[12px] text-px-ink" title={bar.label}>{bar.label}</span>
          <span className="h-3 flex-1 rounded-sm bg-px-teal/15">
            <span
              className="block h-3 rounded-sm bg-px-teal"
              style={{ width: max > 0 ? `${Math.max((bar.value / max) * 100, 1)}%` : "1%" }}
              aria-hidden
            />
          </span>
          <span className={`w-36 shrink-0 text-[12px] ${MONEY_CELL_CLASS}`}>{formatCell(bar.value, "money", format)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ReportDocument({
  schema,
  payload,
  format,
  /** Printed when the report ran and returned no rows -- see noRowsMessage(). */
  emptyMessage,
  /** Reported to the caller so the header can disable Export with this exact reason. */
  onTieMessage,
}: {
  schema: ReportSchema;
  payload: unknown;
  format: MoneyFormat;
  emptyMessage: string;
  onTieMessage?: (message: string | null) => void;
}) {
  const [showChart, setShowChart] = useState(false);
  const rows = useMemo(() => schemaRows(schema, payload), [schema, payload]);
  const tieMessage = useMemo(() => totalsTieMessage(schema, rows, payload, format), [schema, rows, payload, format]);
  const groups = useMemo(() => groupRows(rows, schema.groupBy), [rows, schema.groupBy]);
  const grand = useMemo(() => columnTotals(rows, schema.totals ?? []), [rows, schema.totals]);
  const bars = useMemo(() => (showChart ? chartBars(schema, rows) : []), [showChart, schema, rows]);

  // R-136: an unmapped key is LOGGED, never silently dropped -- a report that
  // quietly grew a column is exactly how a document and its data drift apart.
  useEffect(() => {
    const extra = unmappedKeys(schema, rows);
    if (extra.length > 0) {
      console.warn(`[report-document] ${schema.slug}: rows carry keys no column claims: ${extra.join(", ")}`);
    }
  }, [schema, rows]);

  // Reported up whenever the answer changes, so the header's Export can carry
  // this exact reason rather than the reader discovering it in a broken file.
  useEffect(() => {
    onTieMessage?.(tieMessage);
  }, [tieMessage, onTieMessage]);

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-px-muted" data-testid="report-empty">{emptyMessage}</p>;
  }

  const totalKeys = new Set(schema.totals ?? []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-px-ink" data-testid="report-document-title">{schema.title}</h3>
        {schema.chart && (
          <Button variant="outline" size="sm" onClick={() => setShowChart((v) => !v)} data-testid="report-chart-toggle">
            {showChart ? "Hide chart" : `Chart: ${schema.chart.title}`}
          </Button>
        )}
      </div>

      {tieMessage && <ReportTotalsBanner message={tieMessage} />}

      {showChart && bars.length > 0 && <SortedBars bars={bars} format={format} />}

      {/* Wide documents scroll inside their own container; the page body never
          scrolls sideways. */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {schema.columns.map((c) => (
                <TableHead key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                  {/* R-260: the unit lives in the header, once, not on every row. */}
                  {c.type === "money" && format.currency ? `${c.label} (${format.currency})` : c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <Fragment key={group.name || schema.slug}>
                {schema.groupBy && group.name && (
                  <TableRow className="bg-px-cloud2">
                    <TableCell colSpan={schema.columns.length} className="text-[12px] font-medium text-px-ink">
                      {group.name}
                    </TableCell>
                  </TableRow>
                )}
                {group.rows.map((row, i) => {
                  const href = lineHref(schema, row);
                  return (
                    <TableRow key={`${group.name}-${i}`}>
                      {schema.columns.map((c) => {
                        const text = formatCell(row[c.key], c.type, format);
                        return (
                          <TableCell key={c.key} className={cellClass(c.align)}>
                            {c.type === "code" && href && text !== "–" ? (
                              <Link href={href} className="text-px-teal underline underline-offset-2">{text}</Link>
                            ) : (
                              text
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
                {/* A subtotal per band, so a reader can check the grand total
                    against the parts it is made of rather than trusting it. */}
                {schema.groupBy && group.name && (schema.totals ?? []).length > 0 && (
                  <TableRow className="font-medium">
                    {schema.columns.map((c, i) => {
                      if (i === 0) return <TableCell key={c.key}>{group.name} subtotal</TableCell>;
                      if (!totalKeys.has(c.key)) return <TableCell key={c.key} />;
                      return (
                        <TableCell key={c.key} className={cellClass(c.align)}>
                          {formatCell(columnTotals(group.rows, [c.key])[c.key], c.type, format)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                )}
              </Fragment>
            ))}
            {(schema.totals ?? []).length > 0 && (
              <TableRow className="border-t-2 border-px-border font-semibold" data-testid="report-grand-total">
                {schema.columns.map((c, i) => {
                  if (c.key === schema.totalLabelColumn || (!schema.totalLabelColumn && i === 0)) {
                    return <TableCell key={c.key}>Grand Total</TableCell>;
                  }
                  if (!totalKeys.has(c.key)) return <TableCell key={c.key} />;
                  return (
                    <TableCell key={c.key} className={cellClass(c.align)}>
                      {formatCell(grand[c.key], c.type, format)}
                    </TableCell>
                  );
                })}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
