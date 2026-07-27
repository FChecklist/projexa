"use client";

import { useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AGGREGATION_LABELS, computePivot, formatPivotNumber, type AggregationFn } from "./pivot-utils";

const NONE_COLUMN = "__none__";

// Client-side pivot over an already-executed report_definitions result
// (bounded JSON array). Row/column/value field selection + sum/avg/count --
// no aggregation happens on a server anywhere in PROJEXA (STRICT_THIN_CLIENT_
// EXTENSION); this is the one place that math runs.
export function PivotTable({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  const [rowField, setRowField] = useState(columns[0] ?? "");
  const [colField, setColField] = useState<string>(NONE_COLUMN);
  const [valueField, setValueField] = useState<string>(columns[1] ?? columns[0] ?? "");
  const [agg, setAgg] = useState<AggregationFn>("sum");

  const pivot = useMemo(() => {
    if (!rowField) return null;
    return computePivot(rows, {
      rowField,
      colField: colField === NONE_COLUMN ? null : colField,
      valueField,
      agg,
    });
  }, [rows, rowField, colField, valueField, agg]);

  if (columns.length === 0) {
    return <p className="py-6 text-center text-sm text-px-muted">No fields available to pivot.</p>;
  }

  const showColTotals = (pivot?.colKeys.length ?? 0) > 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Rows</Label>
          <Select value={rowField} onValueChange={setRowField}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Columns</Label>
          <Select value={colField} onValueChange={setColField}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_COLUMN}>None</SelectItem>
              {columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Value</Label>
          <Select value={valueField} onValueChange={setValueField} disabled={agg === "count"}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Aggregate</Label>
          <Select value={agg} onValueChange={(v) => setAgg(v as AggregationFn)}>
            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(AGGREGATION_LABELS) as AggregationFn[]).map((a) => (
                <SelectItem key={a} value={a}>{AGGREGATION_LABELS[a]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!pivot || pivot.rowKeys.length === 0 ? (
        <p className="py-6 text-center text-sm text-px-muted">No data to pivot.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-px-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{rowField}</TableHead>
                {pivot.colKeys.map((ck) => <TableHead key={ck} className="text-right">{ck}</TableHead>)}
                {showColTotals && <TableHead className="text-right font-semibold">Total</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pivot.rowKeys.map((rk) => (
                <TableRow key={rk}>
                  <TableCell className="font-medium">{rk}</TableCell>
                  {pivot.colKeys.map((ck) => (
                    <TableCell key={ck} className="text-right">{formatPivotNumber(pivot.cells[rk][ck])}</TableCell>
                  ))}
                  {showColTotals && (
                    <TableCell className="text-right font-semibold">{formatPivotNumber(pivot.rowTotals[rk])}</TableCell>
                  )}
                </TableRow>
              ))}
              {showColTotals && (
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  {pivot.colKeys.map((ck) => (
                    <TableCell key={ck} className="text-right font-semibold">{formatPivotNumber(pivot.colTotals[ck])}</TableCell>
                  ))}
                  <TableCell className="text-right font-semibold">{formatPivotNumber(pivot.grandTotal)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
