"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCompactNumber } from "@/lib/format-number";
import { useOrgMoney } from "@/lib/use-org-money";

// R67 E-02 (R-012), chart 2. WHAT CHANGED AND WHY:
//
// 1. THE DATA SOURCE. This used to read
//    /api/dashboard-hierarchy/companies/{companyId}/projects/{projectId}/category-distribution
//    -- an endpoint that only existed for the Company drill-down screen, which
//    this workstream retires. It now reads the PROJECT-SCOPED
//    GET /api/reports/category-progress, which DashboardProjectClient already
//    calls, extended (compliance-tracker categoryProgressReport) with the
//    total and completed amount per category. One project, one report, one
//    round trip -- and the percentage and the money now come from the same
//    call, so they cannot describe two different BOQ revisions.
//
// 2. THE BARS SAY WHAT THEY MEAN. "Civil 40%" does not tell a reader whether
//    Civil is a tenth of the job or nine tenths. Each bar is now labelled
//    "Completed AED n / Total AED n".
//
// 3. THE PIE IS CONDITIONAL. Kept only at five categories or fewer, dropped
//    entirely above that -- the dashboard rule this product follows is "never
//    a pie with more than 5 segments; prefer a sorted horizontal bar always",
//    and a sixth "Other" slice answers nothing.
//
// 4. EVERY BAR IS A DESTINATION. A category the reader can see and cannot open
//    is a dead end; each one links to Work Progress > Analytics filtered to it.

// Same validated 5-slot categorical order as ReportChart.tsx (dataviz
// skill, see ai-os/PIVOT_CHART_TECH_DECISION_2026-07-27.md) -- fixed order,
// never cycled. R67 WS-G re-valued those five slots to the muted CVD-checked
// set in globals.css; the references here are unchanged because they were
// already token references and not hexes.
const PIE_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];
export const PIE_MAX_SLICES = 5;

const barConfig = {
  totalAmount: { label: "Total", color: "var(--color-chart-1)" },
  completedAmount: { label: "Completed", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

export type CategoryEntry = {
  categoryId: string;
  name: string;
  totalAmount: number;
  sharePercent: number;
  percentComplete: number;
  completedAmount: number;
};

/**
 * The empty state, in the words the item specifies -- an empty chart panel
 * tells a reader nothing about what to do next, and "Import a BOQ" is what
 * they need to do next.
 */
export const NO_BOQ_LINES_MESSAGE = "No BOQ line items yet";

export function analyticsHref(projectId: string, category: string): string {
  return `/work-progress?projectId=${encodeURIComponent(projectId)}&tab=analytics&category=${encodeURIComponent(category)}`;
}

/**
 * Presentational half: takes real categories, draws them. Split out from the
 * fetching wrapper below so the chart's own rules -- the pie cap, the money
 * labels, the links -- are testable without a fetch stub.
 */
export function CategoryDistributionChartsView({
  categories,
  projectId,
  money,
}: {
  categories: CategoryEntry[];
  projectId: string;
  money: (value: number | string | null | undefined) => string;
}) {
  if (categories.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-px-muted">
        {NO_BOQ_LINES_MESSAGE} —{" "}
        <Link href={`/scope?projectId=${encodeURIComponent(projectId)}`} className="text-px-teal underline">
          Import a BOQ
        </Link>
      </p>
    );
  }

  const byValue = [...categories].sort((a, b) => b.totalAmount - a.totalAmount);
  const showPie = categories.length <= PIE_MAX_SLICES;
  const pieData = byValue.map((c) => ({ name: c.name, value: c.sharePercent }));
  const barData = byValue.map((c) => ({
    name: c.name,
    totalAmount: Math.round(c.totalAmount),
    completedAmount: Math.round(c.completedAmount),
  }));

  return (
    <div className={showPie ? "grid grid-cols-1 gap-6 lg:grid-cols-2" : "space-y-4"}>
      {showPie && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-px-fg">Category share of total BOQ</h4>
          <ChartContainer config={barConfig} className="aspect-auto h-72 w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="name" formatter={(value) => `${Number(value).toFixed(1)}%`} />} />
              <Pie data={pieData} dataKey="value" nameKey="name" label={(entry) => `${entry.name} ${Number(entry.value).toFixed(0)}%`}>
                {pieData.map((entry, i) => (
                  <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <ChartLegend content={<ChartLegendContent nameKey="name" />} />
            </PieChart>
          </ChartContainer>
        </div>
      )}

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

      {/* The figures in full, and the destination. A chart a reader cannot open
          is a dead end, and a compact axis label ("2.1M") is not a figure a QS
          can check. */}
      <ul className="space-y-1 lg:col-span-2">
        {byValue.map((c) => (
          <li key={c.categoryId} className="text-[12.5px]">
            <Link href={analyticsHref(projectId, c.name)} className="text-px-ink hover:underline">
              <span className="font-medium">{c.name}</span>{" "}
              <span className="tabular-nums text-px-muted">
                Completed {money(c.completedAmount)} / Total {money(c.totalAmount)} ({c.percentComplete}%)
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CategoryDistributionCharts({ projectId }: { projectId: string }) {
  const [categories, setCategories] = useState<CategoryEntry[] | null>(null);
  const [error, setError] = useState(false);
  const orgMoney = useOrgMoney();

  useEffect(() => {
    setCategories(null);
    setError(false);
    fetch(`/api/reports/category-progress?projectId=${encodeURIComponent(projectId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`category-progress fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data) => setCategories(data?.categories ?? []))
      .catch(() => setError(true));
  }, [projectId]);

  // A failed read and a genuinely empty BOQ are DIFFERENT answers and must
  // never render the same way -- the whole reason this component has had a
  // test since it shipped.
  if (error) return <p className="py-6 text-center text-sm text-destructive">Unable to load category data. Please try again later.</p>;
  if (categories === null) return <p className="py-6 text-center text-sm text-px-muted">Loading category distribution...</p>;

  return <CategoryDistributionChartsView categories={categories} projectId={projectId} money={orgMoney.money} />;
}
