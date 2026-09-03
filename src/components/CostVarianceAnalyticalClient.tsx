"use client";

// R42 seq24 (M28 ANALYTICAL archetype) -- the real destination
// DASHBOARD.PROJECT's "Budget vs Actual" KPI links to. Data comes from the
// ALREADY-REGISTERED "budget-variance" report (REPORT_REGISTRY,
// boqBudgetVarianceReport, R39/R-C09).
//
// R67 E-07 (R-114). WHAT CHANGED, and why.
//
// This screen hard-coded BOTH header actions to "(Not yet available)" -- a
// deliberate stub, not a data condition -- while Sumeet 6.png II(iii) asks for
// S.No | Category | Code | Desc | Qty | Rate | Amt | Vendor | Vendor Amt with
// filters on Category and Vendor. So:
//
//  * Filter is a real drawer: category chips built from the categories this
//    BOQ actually uses, and a Vendor select from /api/vendors. Its state lives
//    in the URL (?category=&vendorId=), so Back restores it and a link carries
//    it -- the filters are re-applied SERVER-side, by the same report call, so
//    the totals under a filtered table are the totals OF that table.
//  * Export is real: CSV built in the browser from the rows on screen, PDF and
//    XLSX rendered by compliance-tracker and relayed. PROJEXA gains no PDF or
//    XLSX library.
//  * Every Code links to its own line on the Scope screen.
//  * The columns Sumeet asked for are all present, right-aligned and tabular,
//    with per-category subtotals and a Grand Total that ties.
//  * An empty filter result says which filter emptied it and offers a way out.
//
// This component is ALSO what Reports > "Budget Summary" opens (see
// src/lib/report-destinations.ts) -- one report, reached from two places, the
// same rule WS-E applies to the Work Progress Report.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Download, FileText, Filter, Link2, X } from "lucide-react";
import { AnalyticalScreen, KpiTag } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { useOrgMoney } from "@/lib/use-org-money";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import {
  buildVarianceCsv,
  checkVarianceTies,
  contractLines,
  emptyFilterMessage,
  readVarianceFilters,
  scopeLineHref,
  varianceApiQuery,
  varianceSearchParams,
  type VarianceFilters,
  type VarianceReport,
} from "@/lib/budget-variance-report";

type Vendor = { id: string; supplierName?: string; name?: string };

/** Right-aligned, tabular, same decimals down the column -- the money rule this app applies everywhere. */
const NUM = "text-right tabular-nums";
/** The en dash. "We do not have this figure" is not "this figure is zero". */
const EMPTY = "–";

export default function CostVarianceAnalyticalClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgMoney = useOrgMoney();

  const filters = useMemo<VarianceFilters>(() => readVarianceFilters(new URLSearchParams(searchParams.toString())), [searchParams]);

  const [report, setReport] = useState<VarianceReport | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const query = varianceApiQuery(projectId, filters);

  const load = useCallback(async () => {
    setLoading(true);
    const [rep, ven] = await Promise.allSettled([
      fetchJson<VarianceReport>(`/api/reports/budget-variance?${query}`),
      fetchJson<{ vendors?: Vendor[] }>("/api/vendors"),
    ]);
    if (rep.status === "fulfilled") {
      setReport(rep.value);
      setLoadError(null);
    } else {
      setReport(null);
      setLoadError(errorMessage(rep.reason, "Could not load the budget variance report"));
    }
    // A vendor list that fails to load costs the reader the Vendor FILTER, not
    // the report -- so it is not allowed to blank the screen.
    setVendors(ven.status === "fulfilled" ? (ven.value.vendors ?? []) : []);
    setLoading(false);
  }, [query]);

  useEffect(() => { load(); }, [load]);

  function applyFilters(next: VarianceFilters) {
    // The URL is the state. router.replace, not push: flipping a chip is not a
    // navigation a reader wants to press Back through six times.
    const qs = varianceSearchParams(next, {
      projectId: searchParams.get("projectId"),
      tab: searchParams.get("tab"),
    });
    router.replace(`?${qs.toString()}`, { scroll: false });
  }

  function toggleCategory(category: string) {
    const categories = filters.categories.includes(category)
      ? filters.categories.filter((c) => c !== category)
      : [...filters.categories, category];
    applyFilters({ ...filters, categories });
  }

  const vendorName = (id: string | null): string | null => {
    if (!id) return null;
    const fromReport = report?.availableVendors.find((v) => v.id === id)?.name;
    if (fromReport) return fromReport;
    const v = vendors.find((x) => x.id === id);
    return v?.supplierName ?? v?.name ?? id;
  };

  const rows = contractLines(report);
  const categoryRows = report?.categorySubtotals ?? [];
  const overBudget = rows.filter((l) => (l.variance ?? 0) > 0).length;
  const tieError = report ? checkVarianceTies(report, orgMoney.money) : null;
  // Disabled WITH a reason, in words, beside the button -- never a bare
  // "(Not yet available)", which is what this screen used to say about a
  // capability that was simply never wired.
  const exportReason = !report ? "Run the report first" : rows.length === 0 ? "No lines to export" : tieError;

  function exportCsv() {
    if (!report) return;
    const blob = new Blob([buildVarianceCsv(report, vendorName(filters.vendorId))], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-variance-${projectId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openServerExport(format: "pdf" | "xlsx") {
    // The relay is handed the SAME parameters this screen ran with, so the
    // file and the table can never disagree.
    window.open(`/api/reports/budget-variance/export?${query}&format=${format}`, "_blank", "noopener");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?${varianceSearchParams(filters, { projectId, tab: "variance" }).toString()}`);
      toast.success("Link copied — it opens this report with these filters.");
    } catch {
      toast.error("Couldn't copy the link");
    }
  }

  const filterSummary = filters.categories.length > 0 || filters.vendorId
    ? `${filters.categories.length > 0 ? filters.categories.join(", ") : "All categories"} · ${vendorName(filters.vendorId) ?? "All vendors"}`
    : null;

  return (
    <AnalyticalScreen
      breadcrumb="Scope of Work / Cost variance"
      filterAction={{ label: filterSummary ? `Filter (${filters.categories.length + (filters.vendorId ? 1 : 0)})` : "Filter", onClick: () => setDrawerOpen((v) => !v) }}
      exportAction={{ label: "Export", disabledReason: exportReason ?? undefined, onClick: exportCsv }}
      newAction={undefined}
      kpiTags={
        <>
          <KpiTag label="Total budget" value={report?.totalBudget === null || report === null ? EMPTY : orgMoney.money(report.totalBudget)} />
          <KpiTag label="Total vendor amount" value={report ? orgMoney.money(report.totalVendorAmount) : EMPTY} />
          <KpiTag label="Lines over budget" value={String(overBudget)} />
        </>
      }
      chart={
        <div className="space-y-3">
          {/* The header actions the archetype gives us are one button each, so
              the full Export set and Share live here, where their disabled
              reason can be READ rather than hovered for. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDrawerOpen((v) => !v)} data-testid="variance-filter-toggle">
              <Filter className="size-4" /> {drawerOpen ? "Hide filters" : "Filter"}
            </Button>
            <Button variant="outline" size="sm" disabled={Boolean(exportReason)} onClick={exportCsv} data-testid="variance-export-csv">
              <Download className="size-4" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" disabled={Boolean(exportReason)} onClick={() => openServerExport("pdf")} data-testid="variance-export-pdf">
              <FileText className="size-4" /> Export PDF
            </Button>
            <Button variant="outline" size="sm" disabled={Boolean(exportReason)} onClick={() => openServerExport("xlsx")} data-testid="variance-export-xlsx">
              <Download className="size-4" /> Export XLSX
            </Button>
            <Button variant="outline" size="sm" onClick={copyLink}>
              <Link2 className="size-4" /> Share link
            </Button>
            {exportReason && <span className="text-[12px] text-px-muted" data-testid="variance-export-reason">{exportReason}</span>}
          </div>

          {drawerOpen && (
            <Card className="shadow-card" data-testid="variance-filter-drawer">
              <CardContent className="space-y-3 p-4">
                <div className="space-y-1.5">
                  <p className="text-[12px] font-medium text-px-ink">Category</p>
                  <div className="flex flex-wrap gap-2">
                    {(report?.availableCategories ?? []).length === 0 ? (
                      <span className="text-[12px] text-px-muted">This BOQ has no categories on its lines yet.</span>
                    ) : (
                      (report?.availableCategories ?? []).map((category) => {
                        const on = filters.categories.includes(category);
                        return (
                          <button
                            key={category}
                            type="button"
                            onClick={() => toggleCategory(category)}
                            aria-pressed={on}
                            data-testid={`variance-category-${category}`}
                            className={`cursor-pointer rounded-full border px-3 py-1 text-[12px] ${on ? "border-px-ink bg-px-ink text-white" : "border-px-border text-px-ink"}`}
                          >
                            {category}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <p className="text-[12px] font-medium text-px-ink">Vendor</p>
                    <Select
                      value={filters.vendorId ?? "__all__"}
                      onValueChange={(v) => applyFilters({ ...filters, vendorId: v === "__all__" ? null : v })}
                    >
                      <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All vendors</SelectItem>
                        {(report?.availableVendors ?? []).map((v) => (
                          <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {filterSummary && (
                    <Button variant="ghost" size="sm" onClick={() => applyFilters({ ...filters, categories: [], vendorId: null })} data-testid="variance-clear-filters">
                      <X className="size-4" /> Clear filters
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {filterSummary && <p className="text-[12px] text-px-muted">Showing {filterSummary}</p>}
          {tieError && (
            <p role="alert" className="rounded-md border border-px-error-border bg-px-error-light p-3 text-[12.5px] text-px-error">{tieError}</p>
          )}
          {loadError && (
            <div className="rounded-md border border-px-error-border bg-px-error-light p-3 text-[12.5px] text-px-error" role="alert">
              {loadError}{" "}
              <button type="button" className="cursor-pointer underline" onClick={load}>Retry</button>
            </div>
          )}
        </div>
      }
      table={
        loading ? (
          // A skeleton with the band already visible, never a spinner over an
          // empty box -- the reader can see what is about to arrive.
          <div className="space-y-2 p-4" data-testid="variance-skeleton">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="space-y-3 p-8 text-center" data-testid="variance-empty">
            <p className="text-sm text-px-muted">
              {report && report.boqId === null
                ? "No BOQ approved for this project yet."
                : emptyFilterMessage(filters, vendorName(filters.vendorId))}
            </p>
            {filterSummary ? (
              <Button variant="outline" size="sm" onClick={() => applyFilters({ ...filters, categories: [], vendorId: null })}>Clear filters</Button>
            ) : (
              <Button variant="outline" size="sm" asChild><Link href={`/scope?projectId=${encodeURIComponent(projectId)}`}>Open Scope</Link></Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">S.No</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className={NUM}>Qty</TableHead>
                  <TableHead className={NUM}>Rate{orgMoney.unitSuffix}</TableHead>
                  <TableHead className={NUM}>Amt{orgMoney.unitSuffix}</TableHead>
                  <TableHead className={NUM}>Budget{orgMoney.unitSuffix}</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className={NUM}>Vendor Amt{orgMoney.unitSuffix}</TableHead>
                  <TableHead className={NUM}>Variance{orgMoney.unitSuffix}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.lineItemId}>
                    <TableCell className="tabular-nums">{l.sNo ?? EMPTY}</TableCell>
                    <TableCell>{l.category ?? EMPTY}</TableCell>
                    <TableCell>
                      {l.code ? (
                        <Link href={scopeLineHref(l)} className="underline underline-offset-2">{l.code}</Link>
                      ) : (
                        EMPTY
                      )}
                    </TableCell>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className={NUM}>{l.quantity.toLocaleString("en-US")} {l.unit}</TableCell>
                    <TableCell className={NUM}>{orgMoney.money(l.rate)}</TableCell>
                    <TableCell className={NUM}>{orgMoney.money(l.amount)}</TableCell>
                    <TableCell className={NUM}>{orgMoney.money(l.budget)}</TableCell>
                    <TableCell>{l.vendorName ?? EMPTY}</TableCell>
                    <TableCell className={NUM}>{l.vendorAmount === null ? EMPTY : orgMoney.money(l.vendorAmount)}</TableCell>
                    <TableCell className={NUM} style={l.variance !== null && l.variance > 0 ? { color: "var(--status-late-text)" } : undefined}>
                      {l.variance === null ? EMPTY : `${l.variance > 0 ? "▲ over " : "▼ under "}${orgMoney.money(Math.abs(l.variance))}`}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Per-category subtotals, from the fold the backend already
                    returned -- never re-added in the browser, so they cannot
                    drift from the rows above them. */}
                {categoryRows.map((c) => (
                  <TableRow key={`subtotal-${c.key}`} className="text-px-muted">
                    <TableCell colSpan={7}>Subtotal — {c.item} ({c.lineCount})</TableCell>
                    <TableCell className={NUM}>{orgMoney.money(c.budget)}</TableCell>
                    <TableCell />
                    <TableCell className={NUM}>{c.actual === null ? EMPTY : orgMoney.money(c.actual)}</TableCell>
                    <TableCell className={NUM}>{c.variance === null ? EMPTY : orgMoney.money(c.variance)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell colSpan={7}>Grand Total</TableCell>
                  <TableCell className={NUM} data-testid="variance-grand-total">{report?.totalBudget === null || !report ? EMPTY : orgMoney.money(report.totalBudget)}</TableCell>
                  <TableCell />
                  <TableCell className={NUM}>{report ? orgMoney.money(report.totalVendorAmount) : EMPTY}</TableCell>
                  <TableCell className={NUM}>{report ? orgMoney.money(report.totalVariance) : EMPTY}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {report && report.subTaskLineCount > 0 && (
              <p className="px-4 py-2 text-[11.5px] text-px-muted">
                {report.subTaskLineCount} weighted sub-task {report.subTaskLineCount === 1 ? "line is" : "lines are"} included in their parent line&apos;s figures — open Scope to see the breakdown.
              </p>
            )}
            <CurrencyNotSetNotice currencySet={orgMoney.currencySet} loaded={orgMoney.loaded} />
          </div>
        )
      }
    />
  );
}
