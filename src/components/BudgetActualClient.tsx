"use client";

// R67 E-08 (R-115). "Revenue, Budget, Actual -- scope wise, category wise"
// (Sumeet item 9).
//
// Until this screen, those three words only ever met in the Project Status
// key-value card, with no breakdown and (until E-06) the wrong budget source.
// Here they are one table with a real toggle:
//
//   Item | Description | Revenue | Budget | Actual | Variance | % used
//
// Every figure comes from compliance-tracker's boqBudgetVarianceReport ->
// aggregateRevenueBudgetActual -- ONE fold, two views -- so the scope-wise
// rows and the category-wise rows can never add up to different totals. The
// toggle is persisted in the URL (?groupBy=), so a link opens on the view it
// was sent from.
//
// The chart above is sorted by variance descending, and every bar carries a
// glyph AND the word "over" or "under": the state never depends on colour
// alone. Clicking a bar filters the table to that category.
//
// It mounts as a tab on /scope beside BOQ and Cost Variance -- the item's own
// fallback until the project-scoped Budget screen (C03-16) ships.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { X } from "lucide-react";
import { toast } from "sonner";
import { ExportShareActions } from "@/components/ExportShareActions";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { useOrgMoney } from "@/lib/use-org-money";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import {
  readVarianceFilters,
  varianceApiQuery,
  varianceSearchParams,
  varianceBars,
  type VarianceFilters,
  type VarianceReport,
} from "@/lib/budget-variance-report";

const NUM = "text-right tabular-nums";
/** The en dash. "We do not have this figure" is not "this figure is zero". */
const EMPTY = "–";

export default function BudgetActualClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgMoney = useOrgMoney();

  const filters = useMemo<VarianceFilters>(() => readVarianceFilters(new URLSearchParams(searchParams.toString())), [searchParams]);
  const [report, setReport] = useState<VarianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const query = varianceApiQuery(projectId, filters);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await fetchJson<VarianceReport>(`/api/reports/budget-variance?${query}`));
      setLoadError(null);
    } catch (err) {
      setReport(null);
      setLoadError(errorMessage(err, "Could not load the budget report"));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  function apply(next: VarianceFilters) {
    router.replace(
      `?${varianceSearchParams(next, { projectId: searchParams.get("projectId"), tab: searchParams.get("tab") ?? "budget" }).toString()}`,
      { scroll: false }
    );
  }

  /**
   * R67 E-18: the link carries the GROUPING and the category filter as well as
   * the project, so what the recipient opens is the view that was sent -- not
   * the scope-wise default under a category-wise sentence.
   */
  async function shareUrlFactory(): Promise<string | null> {
    const qs = varianceSearchParams(filters, { projectId, tab: searchParams.get("tab") ?? "budget" });
    return `${window.location.origin}${window.location.pathname}?${qs.toString()}`;
  }

  const view = report?.revenueBudgetActual;
  const rows = view?.rows ?? [];
  const totals = view?.totals;
  // The chart is drawn from the CATEGORY fold whatever the table shows: "which
  // trade is over budget" is a category question, and a per-line chart of a
  // 300-line BOQ is not readable.
  const bars = varianceBars(report?.categorySubtotals ?? []);
  const widest = bars.reduce((m, b) => Math.max(m, Math.abs(b.value)), 0);

  const percent = (v: number | null) => (v === null ? EMPTY : `${v.toFixed(1)}%`);
  const money = (v: number | null) => (v === null ? EMPTY : orgMoney.money(v));

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Two options, both worth naming: a segmented control, not a dropdown
            that hides the alternative behind a click. */}
        <div className="inline-flex rounded-md border border-px-border" role="group" aria-label="Group by">
          {(["scope", "category"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => apply({ ...filters, groupBy: option })}
              aria-pressed={filters.groupBy === option}
              data-testid={`budget-groupby-${option}`}
              className={`cursor-pointer px-3 py-1.5 text-[12.5px] ${filters.groupBy === option ? "bg-px-ink text-white" : "text-px-ink"}`}
            >
              {option === "scope" ? "Scope-wise" : "Category-wise"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {filters.categories.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => apply({ ...filters, categories: [] })} data-testid="budget-clear-category">
              <X className="size-4" /> Clear {filters.categories.join(", ")}
            </Button>
          )}
          {/* R67 E-18 (R-178): the Budget screen's Export and Share, through the
              SAME control every other report screen now uses, against the same
              relay and the same filters -- one implementation, not two. The CSV
              is not offered here because this screen's grouping (scope-wise or
              category-wise) is a fold the browser does not hold the rows for;
              the relay renders the document VERIDIAN describes, and offering a
              CSV that quietly meant something else is the drift item E-12
              exists to prevent. */}
          <ExportShareActions
            canExport={rows.length > 0}
            exportReason={rows.length === 0 ? "No budget lines to export" : null}
            title={`Budget vs Actual — ${filters.groupBy === "scope" ? "Scope-wise" : "Category-wise"}`}
            pdfHref={`/api/reports/budget-variance/export?${query}&format=pdf`}
            xlsxHref={`/api/reports/budget-variance/export?${query}&format=xlsx`}
            shareUrlFactory={shareUrlFactory}
            onMessage={(message) => toast.success(message)}
          />
        </div>
      </div>

      {loadError && (
        <div className="rounded-md border border-px-error-border bg-px-error-light p-3 text-[12.5px] text-px-error" role="alert">
          {loadError} <button type="button" className="cursor-pointer underline" onClick={load}>Retry</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2" data-testid="budget-skeleton">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <Card className="shadow-card">
          <CardContent className="space-y-3 p-8 text-center">
            <p className="text-sm text-px-muted" data-testid="budget-empty">No BOQ approved for this project yet</p>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/scope?projectId=${encodeURIComponent(projectId)}`}>Open Scope</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {bars.length > 0 && (
            <Card className="shadow-card">
              <CardContent className="space-y-2 p-4">
                <p className="text-[12.5px] font-medium text-px-ink">Variance by category — worst first</p>
                {bars.map((bar) => (
                  <button
                    key={bar.key}
                    type="button"
                    onClick={() => apply({ ...filters, categories: [bar.key] })}
                    aria-label={bar.ariaLabel}
                    data-testid={`budget-bar-${bar.key}`}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-md px-1 py-1 text-left hover:bg-px-concrete"
                  >
                    <span className="w-40 shrink-0 truncate text-[12.5px] text-px-ink">{bar.label}</span>
                    <span className="h-3 rounded-sm" style={{
                      width: `${widest === 0 ? 0 : Math.round((Math.abs(bar.value) / widest) * 60)}%`,
                      background: bar.tone === "late" ? "var(--chart-4)" : "var(--chart-2)",
                    }} />
                    <span
                      className="shrink-0 text-[12px] tabular-nums"
                      style={{ color: bar.tone === "late" ? "var(--status-late-text)" : "var(--status-done-text)" }}
                    >
                      {bar.glyph} {orgMoney.money(Math.abs(bar.value))} {bar.word}
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className={NUM}>Revenue{orgMoney.unitSuffix}</TableHead>
                  <TableHead className={NUM}>Budget{orgMoney.unitSuffix}</TableHead>
                  <TableHead className={NUM}>Actual{orgMoney.unitSuffix}</TableHead>
                  <TableHead className={NUM}>Variance{orgMoney.unitSuffix}</TableHead>
                  <TableHead className={NUM}>% used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell>
                      {r.lineItemId && report?.boqId ? (
                        <Link href={`/scope/${encodeURIComponent(report.boqId)}#line-${r.lineItemId}`} className="underline underline-offset-2">{r.item}</Link>
                      ) : (
                        r.item
                      )}
                    </TableCell>
                    <TableCell>{r.description}</TableCell>
                    <TableCell className={NUM}>{money(r.revenue)}</TableCell>
                    <TableCell className={NUM}>{money(r.budget)}</TableCell>
                    <TableCell className={NUM}>{money(r.actual)}</TableCell>
                    <TableCell className={NUM} style={r.variance !== null && r.variance < 0 ? { color: "var(--status-late-text)" } : undefined}>
                      {r.variance === null ? EMPTY : `${r.variance < 0 ? "▲ over " : "▼ under "}${orgMoney.money(Math.abs(r.variance))}`}
                    </TableCell>
                    {/* budget 0 renders the en dash, never a divide-by-zero 0%. */}
                    <TableCell className={NUM} data-testid={`budget-percent-${r.key}`}>{percent(r.percentUsed)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell colSpan={2}>Grand Total</TableCell>
                  <TableCell className={NUM}>{money(totals?.revenue ?? null)}</TableCell>
                  <TableCell className={NUM} data-testid="budget-total">{money(totals?.budget ?? null)}</TableCell>
                  <TableCell className={NUM}>{money(totals?.actual ?? null)}</TableCell>
                  <TableCell className={NUM}>{money(totals?.variance ?? null)}</TableCell>
                  <TableCell className={NUM}>{percent(totals?.percentUsed ?? null)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="px-1 py-2 text-[11.5px] text-px-muted">
              Revenue is the BOQ line amount. Budget is its cost ceiling. Actual is the vendor quote plus the material and manpower split entered against it — an en dash means nothing has been costed yet, which is not the same as nothing being spent.
            </p>
          </div>
          <CurrencyNotSetNotice currencySet={orgMoney.currencySet} loaded={orgMoney.loaded} />
        </>
      )}
    </div>
  );
}
