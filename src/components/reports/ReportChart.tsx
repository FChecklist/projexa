"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AGGREGATION_LABELS, computeChartData, type AggregationFn } from "./pivot-utils";

type ChartType = "bar" | "line" | "pie";

// Validated 5-slot categorical order (dataviz skill, see
// ai-os/PIVOT_CHART_TECH_DECISION_2026-07-27.md) -- fixed order, never
// cycled per-series; bar/line use one series (slot 1 only), pie assigns
// slots in this order and folds anything past slot 5 into a neutral
// "Other" bucket rather than generating a 6th hue.
const SERIES_COLOR = "var(--color-chart-1)";
const PIE_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];
const PIE_OTHER_COLOR = "var(--color-px-muted)";
const PIE_MAX_SLICES = 5;

const chartConfig = { value: { label: "Value", color: SERIES_COLOR } } satisfies ChartConfig;

// Chart view over an already-executed report_definitions result (bounded
// JSON array) -- bar/line/pie, all grouped client-side via
// computeChartData() (STRICT_THIN_CLIENT_EXTENSION: no server aggregation).
export function ReportChart({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [categoryField, setCategoryField] = useState(columns[0] ?? "");
  const [valueField, setValueField] = useState(columns[1] ?? columns[0] ?? "");
  const [agg, setAgg] = useState<AggregationFn>("sum");

  const data = useMemo(() => {
    if (!categoryField) return [];
    return computeChartData(rows, { categoryField, valueField, agg });
  }, [rows, categoryField, valueField, agg]);

  const pieData = useMemo(() => {
    if (chartType !== "pie" || data.length <= PIE_MAX_SLICES) return data;
    const sorted = [...data].sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, PIE_MAX_SLICES);
    const otherTotal = sorted.slice(PIE_MAX_SLICES).reduce((sum, d) => sum + d.value, 0);
    return [...top, { category: "Other", value: otherTotal }];
  }, [chartType, data]);

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
              <SelectItem value="line">Line</SelectItem>
              <SelectItem value="pie">Pie</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Category</Label>
          <Select value={categoryField} onValueChange={setCategoryField}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
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

      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-px-muted">No data to chart.</p>
      ) : (
        <ChartContainer config={chartConfig} className="aspect-auto h-80 w-full">
          {chartType === "bar" ? (
            <BarChart data={data} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="category" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} width={48} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="value" fill={SERIES_COLOR} radius={4} />
            </BarChart>
          ) : chartType === "line" ? (
            <LineChart data={data} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="category" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} width={48} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line dataKey="value" type="monotone" stroke={SERIES_COLOR} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          ) : (
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="category" />} />
              <Pie data={pieData} dataKey="value" nameKey="category" label={(entry) => entry.category}>
                {pieData.map((entry, i) => (
                  <Cell key={entry.category} fill={entry.category === "Other" ? PIE_OTHER_COLOR : PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <ChartLegend content={<ChartLegendContent nameKey="category" />} />
            </PieChart>
          )}
        </ChartContainer>
      )}
    </div>
  );
}
