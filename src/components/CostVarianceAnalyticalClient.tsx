"use client";

// R42 seq24 (M28 ANALYTICAL archetype) -- the real destination
// DASHBOARD.PROJECT's "Budget vs Actual" KPI links to. Data comes from the
// ALREADY-REGISTERED "budget-variance" report (REPORT_REGISTRY,
// boqBudgetVarianceReport, R39/R-C09).
//
// R67 E-26 (R-212). FOUR THINGS THIS SCREEN GOT WRONG, all fixed here.
//
// 1. THE MONEY HAD NO CURRENCY. Every KPI tag rendered
//    `report.totalBudget.toLocaleString()` -- a bare number, on a screen whose
//    only subject is money. They go through the one org-currency formatter now
//    (src/lib/use-org-money.ts), and the screen says once, in its footer, when
//    the org has no currency set.
//
// 2. SUB-TASKS LOOKED LIKE SEPARATE MONEY. They were listed flat, beside their
//    own parents, with no indent and nothing saying their budget is derived.
//    Combined with the backend's own double-counted totals (fixed in
//    computeBoqBudgetVariance) that is how one BOQ came to show a QS two
//    budgets 35% apart. Child rows now indent under their root, print their
//    "% of parent" in the Code cell, and render their derived budget in
//    italics, and the note under the table says why they are not in the total.
//
// 3. THE CHART WAS BLANK ON THE NORMAL CASE. It plotted variance, and variance
//    is null until a vendor amount is entered, so a budgeted-but-not-yet-quoted
//    BOQ -- every new project -- got "No vendor-linked BOQ lines yet." There is
//    a real chart for that project and it is now drawn: budget per root line,
//    sorted, with the caption saying what the bars are. Clicking a bar filters
//    the table to that line and its sub-tasks.
//
// 4. TWO CONTROLS SAID "Not yet available". Export is real now (CSV, built by
//    the same pure writer the tests cover); Filter says what is actually
//    coming and why it is not here yet.
import { useEffect, useMemo, useState } from "react";
import { AnalyticalScreen, KpiTag, ListScreen, type ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import { MONEY_CELL_CLASS } from "@/lib/format-money";
import { EMPTY_VALUE } from "@/lib/format-number";
import { useOrgMoney } from "@/lib/use-org-money";
import {
  DERIVED_BUDGET_NOTE,
  FILTER_DISABLED_REASON,
  NO_VARIANCE_CAPTION,
  budgetBars,
  buildCostVarianceRows,
  costVarianceCsv,
  filterToLine,
  hasAnyVariance,
  overBudgetRootCount,
  quotedLineCount,
  varianceBars,
  type CostVarianceBar,
  type CostVarianceLine,
  type CostVarianceRow,
} from "@/lib/cost-variance-rows";

type VarianceReport = {
  lines: CostVarianceLine[];
  totalBudget: number;
  totalVendorAmount: number;
  totalVariance: number;
};

const COLUMNS: ScreenColumn[] = [
  { label: "Code", field: "code", type: "text", importance: "High" },
  { label: "Description", field: "description", type: "text", importance: "High" },
  { label: "Vendor", field: "vendorName", type: "text", importance: "High" },
  { label: "Budget", field: "budget", type: "number", importance: "High" },
  { label: "Vendor amount", field: "vendorAmount", type: "number", importance: "High" },
  { label: "Variance", field: "variance", type: "number", importance: "High" },
];

/**
 * The bars. No charting library: what this needs is one shared scale, the
 * figure printed at each bar end (R-227 -- never rely on the mark alone) and a
 * click that filters the table. Divs do all three, and the same approach is
 * already used by HierarchyProjectBars for the same reasons.
 *
 * Exported and purely presentational so it can be rendered in a test without
 * the screen's fetch.
 */
export function CostVarianceBars({
  bars,
  measure,
  selectedLineItemId,
  onSelect,
  formatValue,
}: {
  bars: CostVarianceBar[];
  measure: "variance" | "budget";
  selectedLineItemId: string | null;
  onSelect: (lineItemId: string | null) => void;
  formatValue: (value: number) => string;
}) {
  if (bars.length === 0) return <p className="text-[12.5px] text-ct-muted">No BOQ line items with a budget yet.</p>;
  const axisMax = bars.reduce((max, b) => (Math.abs(b.value) > max ? Math.abs(b.value) : max), 0);

  return (
    <div className="space-y-2">
      <p className="text-[11.5px] text-ct-muted">
        {measure === "budget" ? NO_VARIANCE_CAPTION : "Variance per line — a positive figure is spend above the budgeted amount."}
      </p>
      <ul className="space-y-1.5">
        {bars.map((bar) => {
          const selected = bar.lineItemId === selectedLineItemId;
          return (
            <li key={bar.lineItemId}>
              <button
                type="button"
                onClick={() => onSelect(selected ? null : bar.lineItemId)}
                aria-pressed={selected}
                className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted/40 ${selected ? "bg-muted/60" : ""}`}
              >
                <span className="w-28 shrink-0 truncate text-[11.5px] text-ct-muted">{bar.label}</span>
                <span className="h-2 min-w-0 flex-1 rounded-sm bg-px-border/50">
                  <span
                    className="block h-2 rounded-sm"
                    style={{
                      width: `${axisMax <= 0 ? 0 : Math.max(0.5, (Math.abs(bar.value) / axisMax) * 100)}%`,
                      backgroundColor:
                        measure === "budget"
                          ? "var(--color-chart-1)"
                          : bar.value > 0
                            ? "var(--color-veri-status-late)"
                            : "var(--color-chart-2)",
                    }}
                    aria-hidden
                  />
                </span>
                <span className={`${MONEY_CELL_CLASS} w-32 shrink-0 text-[11.5px] text-ct-navy`}>{formatValue(bar.value)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function CostVarianceAnalyticalClient({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<VarianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLineItemId, setSelectedLineItemId] = useState<string | null>(null);
  const orgMoney = useOrgMoney();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // format=legacy, and it MUST stay legacy rather than migrate to E-32's
    // table: this screen draws E-26's indented child rows, which need
    // lineItemId, parentLineItemId, budgetIsDerived and percentOfParent --
    // none of which the flat table carries, by design (a table row is a row,
    // and hierarchy is not a column).
    fetch(`/api/reports/budget-variance?format=legacy&projectId=${encodeURIComponent(projectId)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `The report service answered ${res.status}`);
        return data as VarianceReport;
      })
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error && err.message ? err.message : "the service did not answer");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const rows = useMemo(() => buildCostVarianceRows(report?.lines ?? []), [report]);
  const quoted = hasAnyVariance(report?.lines ?? []);
  const bars = quoted ? varianceBars(rows) : budgetBars(rows);
  const visibleRows = filterToLine(rows, selectedLineItemId);
  const selectedRow = selectedLineItemId ? rows.find((r) => r.lineItemId === selectedLineItemId) : undefined;

  function exportCsv() {
    const csv = costVarianceCsv(visibleRows, orgMoney.currency);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cost-variance-${projectId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <AnalyticalScreen
        breadcrumb="Scope of Work / Cost variance"
        // R67 E-26: the real reason, not "Not yet available".
        filterAction={{ label: "Filter", disabledReason: FILTER_DISABLED_REASON }}
        exportAction={{
          label: "Export CSV",
          onClick: exportCsv,
          disabledReason: rows.length > 0 ? undefined : "Export CSV (no BOQ lines to export yet)",
        }}
        newAction={undefined}
        // Three tags, the kit's own stated limit. The quoted-line count and
        // the total variance are one sentence under the chart instead --
        // they are context for the bars, not headline figures.
        kpiTags={
          <>
            <KpiTag label="Total budget" value={report ? orgMoney.money(report.totalBudget) : EMPTY_VALUE} />
            <KpiTag label="Total vendor amount" value={report ? orgMoney.money(report.totalVendorAmount) : EMPTY_VALUE} />
            <KpiTag label="Lines over budget" value={report ? String(overBudgetRootCount(rows)) : EMPTY_VALUE} />
          </>
        }
        chart={
          error ? (
            <p role="alert" className="text-[12.5px] text-px-error">Couldn&apos;t load cost variance — {error}</p>
          ) : loading ? (
            <p className="text-[12.5px] text-ct-muted">Loading budget and vendor amounts per line…</p>
          ) : (
            <div className="space-y-2">
              <CostVarianceBars
                bars={bars}
                measure={quoted ? "variance" : "budget"}
                selectedLineItemId={selectedLineItemId}
                onSelect={setSelectedLineItemId}
                formatValue={(v) => orgMoney.money(v, { fractionDigits: 0 })}
              />
              {report && (
                <p className="text-[11.5px] text-ct-muted">
                  {quotedLineCount(rows)} of {rows.length} line{rows.length === 1 ? "" : "s"} quoted
                  {quoted ? ` · total variance ${orgMoney.money(report.totalVariance)}` : ""}
                </p>
              )}
            </div>
          )
        }
        table={
          loading ? (
            <p className="px-4 py-6 text-[13px] text-ct-muted">Loading…</p>
          ) : (
            <div className="space-y-2">
              {selectedRow && (
                <div className="flex items-center gap-2 px-4 pt-3 text-[12.5px] text-ct-navy">
                  <span>
                    Showing {selectedRow.code ?? selectedRow.description} and its sub-tasks
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setSelectedLineItemId(null)}>
                    Show all lines
                  </Button>
                </div>
              )}
              <ListScreen
                functionId="scope.cost-variance"
                columns={COLUMNS}
                rows={visibleRows as unknown as Record<string, unknown>[]}
                getRowId={(row) => row.lineItemId as string}
                emptyStateLabel="No BOQ line items yet."
                renderCell={{
                  // The indent, and the "% of parent" that explains the number
                  // in the Budget cell beside it.
                  code: (row) => {
                    const r = row as unknown as CostVarianceRow;
                    return (
                      <span className={r.depth === 1 ? "block pl-4" : "block"}>
                        <span className="font-mono text-xs">{r.code ?? EMPTY_VALUE}</span>
                        {r.parentShareLabel && (
                          <span className="block text-[11px] text-ct-muted">{r.parentShareLabel}</span>
                        )}
                      </span>
                    );
                  },
                  budget: (row) => {
                    const r = row as unknown as CostVarianceRow;
                    return (
                      <span className={`${MONEY_CELL_CLASS} block ${r.isDerived ? "italic text-ct-muted" : ""}`}>
                        {orgMoney.money(r.budget)}
                      </span>
                    );
                  },
                  vendorAmount: (row) => {
                    const v = (row as unknown as CostVarianceRow).vendorAmount;
                    return (
                      <span className={`${MONEY_CELL_CLASS} block`}>
                        {v === null ? EMPTY_VALUE : orgMoney.money(v)}
                      </span>
                    );
                  },
                  // An en dash until a vendor amount exists: "not yet quoted"
                  // is a real state, and printing 0 would claim this line came
                  // in exactly on budget.
                  variance: (row) => {
                    const v = (row as unknown as CostVarianceRow).variance;
                    if (v === null) return <span className={`${MONEY_CELL_CLASS} block text-ct-muted`}>{EMPTY_VALUE}</span>;
                    return (
                      <span
                        className={`${MONEY_CELL_CLASS} block`}
                        style={{ color: v > 0 ? "var(--color-veri-status-late)" : undefined }}
                      >
                        {v > 0 ? "▲ " : v < 0 ? "▼ " : ""}
                        {orgMoney.money(v)}
                      </span>
                    );
                  },
                }}
              />
              <p className="px-4 pb-3 text-[11.5px] text-ct-muted">{DERIVED_BUDGET_NOTE}</p>
            </div>
          )
        }
      />
      <CurrencyNotSetNotice currencySet={orgMoney.currencySet} loaded={orgMoney.loaded} />
    </div>
  );
}
