"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCompactNumber } from "@/lib/format-number";

// Same validated 5-slot categorical order as ReportChart.tsx (dataviz
// skill, see ai-os/PIVOT_CHART_TECH_DECISION_2026-07-27.md) -- fixed order,
// never cycled, anything past slot 5 folds into a neutral "Other" bucket.
// R67 WS-G re-valued those five slots to the muted CVD-checked set in
// globals.css; the references here are unchanged because they were already
// token references and not hexes.
const PIE_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];
const PIE_OTHER_COLOR = "var(--status-neutral-text)";
const PIE_MAX_SLICES = 5;

const barConfig = {
  totalAmount: { label: "Total", color: "var(--color-chart-1)" },
  completedAmount: { label: "Completed", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

type CategoryEntry = { categoryId: string; name: string; totalAmount: number; sharePercent: number; percentComplete: number; completedAmount: number };

export function CategoryDistributionCharts({ companyId, projectId }: { companyId: string; projectId: string }) {
  const [categories, setCategories] = useState<CategoryEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setCategories(null);
    setError(false);
    fetch(`/api/dashboard-hierarchy/companies/${companyId}/projects/${projectId}/category-distribution`)
      .then((res) => {
        if (!res.ok) throw new Error(`category-distribution fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data) => setCategories(data?.categories ?? []))
      .catch(() => setError(true));
  }, [companyId, projectId]);

  if (error) return <p className="py-6 text-center text-sm text-destructive">Unable to load category data. Please try again later.</p>;
  if (categories === null) return <p className="py-6 text-center text-sm text-px-muted">Loading category distribution...</p>;
  if (categories.length === 0) return <p className="py-6 text-center text-sm text-px-muted">No BOQ line items found for this project yet.</p>;

  const pieData = [...categories]
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, PIE_MAX_SLICES)
    .map((c) => ({ name: c.name, value: c.sharePercent }));
  if (categories.length > PIE_MAX_SLICES) {
    const otherShare = [...categories].sort((a, b) => b.totalAmount - a.totalAmount).slice(PIE_MAX_SLICES).reduce((s, c) => s + c.sharePercent, 0);
    pieData.push({ name: "Other", value: otherShare });
  }

  const barData = categories.map((c) => ({ name: c.name, totalAmount: c.totalAmount, completedAmount: Math.round(c.completedAmount) }));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <h4 className="mb-2 text-sm font-medium text-px-fg">Category share of total BOQ</h4>
        <ChartContainer config={barConfig} className="aspect-auto h-72 w-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="name" formatter={(value) => `${Number(value).toFixed(1)}%`} />} />
            <Pie data={pieData} dataKey="value" nameKey="name" label={(entry) => `${entry.name} ${Number(entry.value).toFixed(0)}%`}>
              {pieData.map((entry, i) => (
                <Cell key={entry.name} fill={entry.name === "Other" ? PIE_OTHER_COLOR : PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <ChartLegend content={<ChartLegendContent nameKey="name" />} />
          </PieChart>
        </ChartContainer>
      </div>
      <div>
        <h4 className="mb-2 text-sm font-medium text-px-fg">Completed vs total amount per category</h4>
        <ChartContainer config={barConfig} className="aspect-auto h-72 w-full">
          <BarChart data={barData} margin={{ left: 8, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} width={56} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {/* R67 WS-G (R-227): radius 0 and the value printed at the bar
                end, on both series -- the grouped pair is exactly the case
                where two muted fills are hardest to tell apart, and the
                printed figure removes the need to. */}
            <Bar dataKey="totalAmount" fill="var(--color-chart-1)" radius={0}>
              <LabelList dataKey="totalAmount" position="top" offset={6} className="fill-ct-navy" fontSize={11} formatter={(v: number) => formatCompactNumber(v)} />
            </Bar>
            <Bar dataKey="completedAmount" fill="var(--color-chart-2)" radius={0}>
              <LabelList dataKey="completedAmount" position="top" offset={6} className="fill-ct-navy" fontSize={11} formatter={(v: number) => formatCompactNumber(v)} />
            </Bar>
            <ChartLegend content={<ChartLegendContent />} />
          </BarChart>
        </ChartContainer>
      </div>
    </div>
  );
}
