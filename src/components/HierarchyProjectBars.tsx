"use client";

// R67 E-23 (R-206, correction C-07). Sumeet's company chart: a sorted
// horizontal small-multiples block, one row per project ordered by revenue
// descending, three thin bars per row -- Revenue in dusty blue, Budget in
// grey, Progress as earned value in sage -- on ONE shared AED axis, with the
// value printed right-aligned and tabular at the end of each bar. The whole
// row is a door to that project's dashboard.
//
// C-07: this belongs to /dashboard/hierarchy. Pass 1 never saw the screen
// rendered because the route 504'd, so this is built against the pass-2
// capture, not the pass-1 assumption.
//
// NO CHARTING LIBRARY, deliberately. recharts gives a per-row axis or a
// grouped bar with a hover tooltip; what this needs is one shared scale, a
// printed value on every bar (R-227: never rely on the mark alone), and a row
// that is a link. Divs do all three and nothing here needs an axis renderer.

import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MONEY_CELL_CLASS } from "@/lib/format-money";
import type { OrgMoney } from "@/lib/use-org-money";
import {
  BUDGET_NOT_DATE_FILTERED_NOTE,
  buildProjectBarRows,
  type ProjectBarSource,
} from "@/lib/project-bar-rows";

export function HierarchyProjectBars({
  projects,
  orgMoney,
  loading,
  error,
  onRetry,
  dateRangeApplied,
}: {
  projects: ProjectBarSource[] | null;
  orgMoney: OrgMoney;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  dateRangeApplied: boolean;
}) {
  if (loading) {
    // A labelled skeleton, not a bare grey block: the reader can already see
    // what is coming and how many rows of it.
    return (
      <div className="space-y-3" aria-busy="true">
        <p className="text-xs text-px-muted">Loading revenue, budget and earned value per project…</p>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-4/5" />
            <Skeleton className="h-2 w-2/5" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2 py-6 text-center">
        <p role="alert" className="text-sm text-px-error">Couldn&apos;t load project data — {error}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
      </div>
    );
  }

  const { rows } = buildProjectBarRows(projects ?? []);
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-px-muted">No projects in this scope yet.</p>;
  }

  const usesErpBudget = rows.some((r) => r.budgetSource === "erp");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-px-muted">
        {/* Words beside every swatch: the series is never carried by colour alone. */}
        {rows[0].bars.map((bar) => (
          <span key={bar.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: bar.colorVar }} aria-hidden />
            {bar.label}
          </span>
        ))}
        <span>All bars share one {orgMoney.currency ?? "amount"} axis.</span>
        {dateRangeApplied && <span>{BUDGET_NOT_DATE_FILTERED_NOTE}.</span>}
        {usesErpBudget && <span>Where the BOQ carries no budget %, the cost-centre budget is shown instead.</span>}
      </div>

      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={row.href} className="block rounded-md p-2 hover:bg-muted/40">
              <p className="mb-1 text-[13px] font-medium text-px-ink">{row.name}</p>
              <div className="space-y-1">
                {row.bars.map((bar) => (
                  <div key={bar.key} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 text-[11px] text-px-muted">{bar.label}</span>
                    <span className="h-2 min-w-0 flex-1 rounded-sm bg-px-border/50">
                      <span
                        className="block h-2 rounded-sm"
                        style={{ width: `${bar.widthPercent}%`, backgroundColor: bar.colorVar }}
                        aria-hidden
                      />
                    </span>
                    {/* R-227: the figure is printed at the bar end, so the
                        chart is readable without hovering and without
                        distinguishing two muted fills. */}
                    <span className={`${MONEY_CELL_CLASS} w-32 shrink-0 text-[11.5px] text-px-ink`}>
                      {bar.value === null ? "Not set" : orgMoney.money(bar.value, { fractionDigits: 0 })}
                    </span>
                  </div>
                ))}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
