"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AGGREGATION_LABELS, chartDefaults, computeChartData, inferColumnTypes, type AggregationFn } from "./pivot-utils";
import { formatCompactNumber, formatNumber } from "@/lib/format-number";

type ChartType = "bar" | "line";

// R67 E-27 (R-213). FOUR THINGS THE CHART TAB DID WRONG.
//
// 1. IT OPENED UNREADABLE. Initial state was columns[0] against columns[1] --
//    on every report this app runs, that is an id on the axis and a name as
//    the height, so the first thing a reader saw was a frame of zero-height
//    bars with cuids along the bottom. It now infers what each column IS
//    (pivot-utils.ts's inferColumnTypes) and opens on the first text column
//    against the first numeric one, summed -- or averaged, when the value is a
//    percentage, because a summed percentage is not a figure.
//
// 2. VERTICAL BARS WITH LONG LABELS. Category names in this product are
//    "Blockwork to external walls", not "Q1". Horizontal bars give the label
//    the width it needs, and sorting by value descending puts the answer at
//    the top instead of leaving the reader to scan for it.
//
// 3. A LINE OPTION WITH NOTHING TO PUT ON THE X AXIS. Offered only when the
//    result actually has a date column now.
//
// 4. A PIE. Removed. Sumeet's own question of a category split is "how big is
//    this share", which a printed percentage answers exactly and an angle
//    answers approximately -- so the pie is replaced by a "Show as share of
//    total" toggle over the SAME bars, and it is only enabled at five
//    categories or fewer, where a share of the whole is a sentence a reader
//    can hold in their head.
//
// A bar click lifts its category to the caller, which is what makes the Table
// tab filter to it (ReportResultView).

const SERIES_COLOR = "var(--color-chart-1)";
const SELECTED_COLOR = "var(--color-chart-2)";

/** A "share of total" reading is only offered while the whole fits in one glance. */
export const SHARE_MAX_CATEGORIES = 5;
export const SHARE_TOGGLE_LABEL = "Show as share of total";

const chartConfig = { value: { label: "Value", color: SERIES_COLOR } } satisfies ChartConfig;

export function ReportChart({
  columns,
  rows,
  selectedCategory,
  onSelectCategory,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  /** Lifted by the caller so the Table tab can filter to the clicked bar. */
  selectedCategory?: string | null;
  onSelectCategory?: (category: string | null) => void;
}) {
  const defaults = useMemo(() => chartDefaults(rows, columns), [rows, columns]);
  const columnTypes = useMemo(() => inferColumnTypes(rows, columns), [rows, columns]);

  const [chartType, setChartType] = useState<ChartType>("bar");
  const [categoryField, setCategoryField] = useState(defaults.categoryField);
  const [valueField, setValueField] = useState(defaults.valueField);
  const [agg, setAgg] = useState<AggregationFn>(defaults.agg);
  const [asShare, setAsShare] = useState(false);

  // A new result is a new report: re-derive the defaults rather than leaving
  // the previous report's column names selected against rows that do not have
  // them (which is another way to draw an empty chart).
  useEffect(() => {
    setCategoryField(defaults.categoryField);
    setValueField(defaults.valueField);
    setAgg(defaults.agg);
    setAsShare(false);
    if (!defaults.hasDateColumn) setChartType("bar");
  }, [defaults]);

  const data = useMemo(() => {
    if (!categoryField) return [];
    // Sorted by value descending -- the answer first.
    return [...computeChartData(rows, { categoryField, valueField, agg })].sort((a, b) => b.value - a.value);
  }, [rows, categoryField, valueField, agg]);

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const shareAvailable = data.length > 0 && data.length <= SHARE_MAX_CATEGORIES && total > 0;
  const showingShare = asShare && shareAvailable;

  const plotted = showingShare
    ? data.map((d) => ({ ...d, value: Math.round((d.value / total) * 1000) / 10 }))
    : data;

  const printValue = (v: number) => (showingShare ? `${formatNumber(v, { fractionDigits: 1 })}%` : formatCompactNumber(v));

  if (columns.length === 0) {
    return <p className="py-6 text-center text-sm text-px-muted">No fields available to chart.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Chart type</Label>
          <Select value={chartType} onValueChange={(v) => setChartType(v as ChartType)}>
            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bar">Bar</SelectItem>
              {/* No date column, no line: an x axis of category names pretending to be time is a lie. */}
              {defaults.hasDateColumn && <SelectItem value="line">Line</SelectItem>}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Category</Label>
          <Select value={categoryField} onValueChange={setCategoryField}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {columnTypes.map((c) => (
                <SelectItem key={c.name} value={c.name}>{c.name}{c.kind === "id" ? " (id)" : ""}</SelectItem>
              ))}
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
        {/* Disabled-with-reason rather than hidden: a control that vanishes
            teaches nothing about when it comes back. */}
        <label
          className={`flex items-center gap-1.5 pb-1.5 text-xs ${shareAvailable ? "text-px-ink" : "text-px-muted"}`}
          title={shareAvailable ? undefined : `${SHARE_TOGGLE_LABEL} (available at ${SHARE_MAX_CATEGORIES} categories or fewer)`}
        >
          <input
            type="checkbox"
            checked={showingShare}
            disabled={!shareAvailable}
            onChange={(e) => setAsShare(e.target.checked)}
          />
          {SHARE_TOGGLE_LABEL}
        </label>
      </div>

      {plotted.length === 0 ? (
        <p className="py-6 text-center text-sm text-px-muted">No data to chart.</p>
      ) : (
        <ChartContainer config={chartConfig} className="aspect-auto h-80 w-full">
          {chartType === "bar" ? (
            // layout="vertical" is recharts' name for horizontal bars: the
            // VALUE runs along x and the categories stack down y.
            <BarChart data={plotted} layout="vertical" margin={{ left: 8, right: 56 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="category" tickLine={false} axisLine={false} width={150} tickMargin={6} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {/* R67 WS-G (R-227): radius 0, and the value printed at the bar
                  end, so the chart is readable without hovering and the muted
                  fill is not the only carrier of meaning. */}
              <Bar dataKey="value" fill={SERIES_COLOR} radius={0} onClick={(d: { category?: string }) => {
                if (!onSelectCategory || !d?.category) return;
                onSelectCategory(d.category === selectedCategory ? null : d.category);
              }}>
                {plotted.map((entry) => (
                  <Cell
                    key={entry.category}
                    fill={entry.category === selectedCategory ? SELECTED_COLOR : SERIES_COLOR}
                    cursor={onSelectCategory ? "pointer" : undefined}
                  />
                ))}
                <LabelList
                  dataKey="value"
                  position="right"
                  offset={6}
                  className="fill-ct-navy"
                  fontSize={11}
                  formatter={(v: number) => printValue(v)}
                />
              </Bar>
            </BarChart>
          ) : (
            <LineChart data={plotted} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="category" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} width={48} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line dataKey="value" type="monotone" stroke={SERIES_COLOR} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          )}
        </ChartContainer>
      )}

      {onSelectCategory && plotted.length > 0 && (
        <p className="text-[11px] text-px-muted">Click a bar to filter the Table tab to that {categoryField}.</p>
      )}
    </div>
  );
}
