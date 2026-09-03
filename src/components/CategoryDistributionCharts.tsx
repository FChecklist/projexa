"use client";

// R67 E-23 (R-206, correction C-07). THE PIE IS GONE.
//
// WHAT IT WAS. A pie of each category's share of the BOQ, capped at five
// slices with everything past slot five folded into a neutral "Other", plus
// a grouped total-vs-completed bar. Two problems, both real: the cap HID
// categories -- a project with nine trades showed four of them and a lump --
// and a pie forces the reader to compare angles when the question ("which
// trade is the biggest part of this BOQ, and how far through is it?") is a
// length comparison.
//
// WHAT IT IS NOW. One sorted horizontal bar per category, Completed drawn
// over Total, the share printed after the label as "Civil - 40% of BOQ", and
// a bar click opening the Work Progress analytics filtered to that category.
// EVERY category gets a bar -- nothing is hidden -- and the long tail is
// folded only in the label list beneath, where folding costs the reader
// nothing.
//
// Colours are WS-G's tokens, never a recharts default; the printed share and
// the printed amounts mean the chart is readable without hovering and without
// telling two muted fills apart.
//
// R67 MERGE (2026-09-03), reconciled against lane E1's own R67 E-02 (R-012)
// build of this same component: E-23 is a CORRECTION of E-02 on this exact
// chart (its own id says so), so the no-pie design below is what E-02's
// conditional-pie version was superseded by. What E-02's version got right
// and E-23's did not yet have is preserved: the split between a fetching
// wrapper and a presentational view, because DashboardProjectClient.tsx
// already fetches this project's category-progress once for its own KPI
// tiles and renders the presentational half directly (R67 E-02 x F-1) --
// a second read here would be a second request for a figure the screen
// already has. So the render logic below is exported as
// CategoryDistributionChartsView (categories/projectId/money as props, no
// fetch of its own), and CategoryDistributionCharts is the thin fetching
// wrapper every OTHER caller uses.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { isAllUncategorized } from "@/lib/category-distribution";
import { MONEY_CELL_CLASS } from "@/lib/format-money";
import { useOrgMoney } from "@/lib/use-org-money";
import { formatNumber } from "@/lib/format-number";

export type CategoryEntry = {
  categoryId: string;
  name: string;
  totalAmount: number;
  // R67 MERGE (2026-09-03): optional, not required -- compliance-tracker's
  // categoryProgressReport (what DashboardProjectClient.tsx's own already-
  // fetched data comes from) never carries this field, only the dedicated
  // category-distribution endpoints do. See the presentational view's own
  // sharePercent() fallback for how a missing value is handled.
  sharePercent?: number;
  percentComplete: number;
  completedAmount: number;
};

/** How many categories get a named row in the label list beneath the bars. Never how many get a BAR. */
const LABEL_LIST_LIMIT = 5;

/**
 * R67 E-33 (R-265): where a bar click goes. The dashboards send the reader to
 * this category's PROGRESS ENTRIES (the analytics drill they already had); the
 * Analytics tab, which is already that screen, sends them to the Work Progress
 * REPORT filtered to the category instead -- the same rule D-02 applies
 * everywhere else, that there is one Work Progress Report and it lives at
 * /work-progress?tab=report. A prop rather than a second component, because
 * everything else about the chart is identical and a fork would be two places
 * to fix the next time a bar is wrong.
 */
export type CategoryDrillTarget = "analytics" | "report";

function categoryHref(projectId: string, name: string, drillTo: CategoryDrillTarget) {
  const base = `/work-progress?projectId=${encodeURIComponent(projectId)}`;
  return drillTo === "report"
    ? `${base}&tab=report&view=category&category=${encodeURIComponent(name)}`
    : `${base}&tab=analytics&category=${encodeURIComponent(name)}`;
}

/**
 * Presentational half: takes real categories, draws them. Split out from the
 * fetching wrapper below so the chart's own rules -- every bar, the label
 * folding, the money labels, the drill target -- are testable without a
 * fetch stub, and so a caller that already has this project's category data
 * (DashboardProjectClient.tsx) can render it without a second request.
 */
export function CategoryDistributionChartsView({
  categories,
  projectId,
  money,
  drillTo = "analytics",
}: {
  categories: CategoryEntry[];
  projectId: string;
  /** The caller's own bound money formatter -- see the MERGE note above for why this is a prop and not a second useOrgMoney() read. */
  money: (value: number | string | null | undefined) => string;
  drillTo?: CategoryDrillTarget;
}) {
  if (categories.length === 0) {
    return (
      <div className="space-y-2 py-6 text-center">
        <p className="text-sm text-px-muted">No BOQ line items for this project yet</p>
        <Button size="sm" variant="outline" asChild>
          <Link href={`/scope?projectId=${encodeURIComponent(projectId)}`}>Import BOQ</Link>
        </Button>
      </div>
    );
  }

  const sorted = [...categories].sort((a, b) => b.totalAmount - a.totalAmount);
  const axisMax = sorted.reduce((max, c) => (c.totalAmount > max ? c.totalAmount : max), 0);
  const width = (value: number) => (axisMax <= 0 ? 0 : Math.max(0.5, (value / axisMax) * 100));
  // R67 MERGE (2026-09-03): DashboardProjectClient.tsx feeds this view rows
  // from compliance-tracker's categoryProgressReport (R67 F-14/F-27's own
  // reused fetch), which carries totalAmount/completedAmount/percentComplete
  // but never populated sharePercent -- that field only ever came from the
  // dedicated category-distribution endpoints the fetching wrapper below
  // calls. Both endpoints answer for the SAME project's WHOLE category
  // breakdown, so this project's own totalAmount sum is the correct
  // denominator whenever the caller didn't already do that division upstream.
  const totalAmount = sorted.reduce((sum, c) => sum + c.totalAmount, 0);
  const sharePercent = (c: CategoryEntry) => c.sharePercent ?? (totalAmount > 0 ? (c.totalAmount / totalAmount) * 100 : 0);

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-1 text-sm font-medium text-px-fg">Budget and completed value by category</h4>
        {/* R67 E-40 (R-272): one bar labelled "Uncategorized" is not a
            distribution. The bar still renders -- that money is real -- but the
            reader is told why there is only one and where the fix is, so
            "this project has one trade" and "nobody has assigned categories
            yet" stop looking identical. */}
        {isAllUncategorized(sorted) && (
          <p className="mb-2 text-[11.5px] text-px-muted" data-testid="all-uncategorised">
            All BOQ lines are uncategorised —{" "}
            <Link href={`/scope?projectId=${encodeURIComponent(projectId)}`} className="underline">
              Assign categories in Scope
            </Link>
          </p>
        )}
        <p className="mb-3 text-[11.5px] text-px-muted">
          The full bar is the category&apos;s BOQ amount; the darker bar over it is the value completed. Click a bar to
          {drillTo === "report" ? " open the Work Progress Report for that category." : " see its progress entries."}
        </p>
        <ul className="space-y-2.5">
          {sorted.map((category) => (
            <li key={category.categoryId}>
              <Link
                href={categoryHref(projectId, category.name, drillTo)}
                className="block rounded-md p-1.5 hover:bg-muted/40"
              >
                <div className="flex items-baseline justify-between gap-3">
                  {/* The share is printed after the label, in words -- "Civil - 40% of BOQ". */}
                  <span className="min-w-0 truncate text-[12.5px] text-px-ink">
                    {category.name} - {formatNumber(sharePercent(category), { fractionDigits: 0 })}% of BOQ
                  </span>
                  <span className={`${MONEY_CELL_CLASS} shrink-0 text-[11.5px] text-px-muted`}>
                    {money(category.completedAmount)} of {money(category.totalAmount)}
                  </span>
                </div>
                <span className="mt-1 block h-2.5 rounded-sm" style={{ width: `${width(category.totalAmount)}%`, backgroundColor: "var(--color-chart-5)" }}>
                  <span
                    className="block h-2.5 rounded-sm"
                    style={{
                      width: `${category.totalAmount > 0 ? Math.min(100, (category.completedAmount / category.totalAmount) * 100) : 0}%`,
                      backgroundColor: "var(--color-chart-2)",
                    }}
                    aria-hidden
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {sorted.length > LABEL_LIST_LIMIT && (
        // Only the LABEL LIST folds. Every category still has its own bar
        // above -- hiding a trade from the chart is what the capped pie did.
        <details className="text-[11.5px] text-px-muted">
          <summary className="cursor-pointer">
            {sorted.length} categories in this BOQ — show the smallest {sorted.length - LABEL_LIST_LIMIT} by name
          </summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {sorted.slice(LABEL_LIST_LIMIT).map((category) => (
              <li key={category.categoryId}>
                {category.name} - {formatNumber(sharePercent(category), { fractionDigits: 0 })}% of BOQ
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * R67 E-29 (R-255): `companyId` is OPTIONAL, because this chart is now mounted
 * on the project dashboard as well as on the company hierarchy, and the
 * project dashboard has a project and no company. Both endpoints answer the
 * same shape from the same pure function (src/lib/category-distribution.ts);
 * the only difference is which scope the server enforces before answering.
 */
export function CategoryDistributionCharts({
  companyId,
  projectId,
  drillTo = "analytics",
  ariaLabel,
}: {
  companyId?: string;
  projectId: string;
  drillTo?: CategoryDrillTarget;
  /** Names the whole chart for a screen reader, when it is mounted where its own heading is not adjacent. */
  ariaLabel?: string;
}) {
  const [categories, setCategories] = useState<CategoryEntry[] | null>(null);
  const [error, setError] = useState(false);
  const orgMoney = useOrgMoney();

  const load = useCallback(() => {
    setCategories(null);
    setError(false);
    const url = companyId
      ? `/api/dashboard-hierarchy/companies/${companyId}/projects/${projectId}/category-distribution`
      : `/api/projects/${encodeURIComponent(projectId)}/category-distribution`;
    return fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`category-distribution fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data) => setCategories(data?.categories ?? []))
      .catch(() => setError(true));
  }, [companyId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="space-y-2 py-6 text-center">
        <p role="alert" className="text-sm text-px-error">Couldn&apos;t load category data</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  if (categories === null) {
    return (
      <div className="space-y-2" aria-busy="true">
        <p className="text-xs text-px-muted">Loading budget and completion per category…</p>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-2.5 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div role={ariaLabel ? "group" : undefined} aria-label={ariaLabel}>
      <CategoryDistributionChartsView
        categories={categories}
        projectId={projectId}
        money={(v) => orgMoney.money(v, { fractionDigits: 0 })}
        drillTo={drillTo}
      />
    </div>
  );
}
