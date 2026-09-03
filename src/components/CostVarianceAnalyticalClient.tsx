"use client";

// R42 seq24 (M28 ANALYTICAL archetype) -- the real destination
// DASHBOARD.PROJECT's "Budget vs Actual" KPI links to. Data comes from the
// ALREADY-REGISTERED "budget-variance" report (REPORT_REGISTRY,
// boqBudgetVarianceReport, R39/R-C09).
//
// R67 D-26 (R-066) rewrote what this screen is allowed to claim:
//
//  - COMMITTED COST IS VENDOR + MATERIAL + MANPOWER, not vendor alone. Sumeet's
//    budget model has three components and only one existed, so the tile that
//    read "Total vendor amount 0" was reporting a sum of nothing as if it were
//    a measurement.
//  - NO DATA IS AN EN DASH, A REAL ZERO IS "AED 0". A line nobody has costed
//    has no variance; rendering that as 0 reads as "on budget".
//  - VARIANCE NOW MEANS BUDGET LEFT. Positive is under budget, negative is
//    over -- the backend's own new sign (computeBudgetVarianceLine).
//  - FILTER AND EXPORT ARE REAL. They used to render disabled with "Not yet
//    available"; Category and Vendor now filter the rows on screen and Export
//    CSV writes exactly those rows, using the same honest label Work Progress
//    uses (CSV, not "Excel").
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnalyticalScreen, BarChart, KpiTag, ListScreen, MoneyCell, type BarChartDatum, type ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { useCurrencies } from "@/lib/currency";
import DataLoadError from "@/components/DataLoadError";

export type VarianceLine = {
  serialNumber: number;
  lineItemId: string;
  code: string | null;
  category: string | null;
  description: string;
  unit: string;
  quantity: number;
  rate: number;
  amount: number;
  budget: number;
  vendorId: string | null;
  vendorName: string | null;
  vendorAmount: number | null;
  materialAmount: number | null;
  manpowerAmount: number | null;
  committed: number | null;
  variance: number | null;
};

type VarianceReport = {
  boqId: string | null;
  lines: VarianceLine[];
  totalBudget: number;
  totalCommitted: number | null;
  totalVariance: number | null;
  linesOverBudget: number;
  lineCount: number;
};

const UNCATEGORIZED = "Uncategorized";
const NO_VENDOR = "No vendor";
const ALL = "__all__";

// Sumeet's Budget Report shape: S.No | Category | Code | Description | Qty |
// Rate | Amount | Budget % | Budget | Vendor | Vendor Amt | Material |
// Manpower | Variance.
const COLUMNS: ScreenColumn[] = [
  { label: "S.No", field: "serialNumber", type: "number", importance: "High" },
  { label: "Category", field: "category", type: "text", importance: "High" },
  { label: "Code", field: "code", type: "text", importance: "High" },
  { label: "Description", field: "description", type: "text", importance: "High" },
  { label: "Qty", field: "quantity", type: "number", importance: "High" },
  { label: "Rate", field: "rate", type: "number", importance: "High" },
  { label: "Amount", field: "amount", type: "number", importance: "High" },
  { label: "Budget", field: "budget", type: "number", importance: "High" },
  { label: "Vendor", field: "vendorName", type: "text", importance: "High" },
  { label: "Vendor Amt", field: "vendorAmount", type: "number", importance: "High" },
  { label: "Material", field: "materialAmount", type: "number", importance: "High" },
  { label: "Manpower", field: "manpowerAmount", type: "number", importance: "High" },
  { label: "Variance", field: "variance", type: "number", importance: "High" },
];

const CSV_HEADERS = [
  "S.No", "Category", "Code", "Description", "Unit", "Qty", "Rate", "Amount",
  "Budget", "Vendor", "Vendor Amt", "Material", "Manpower", "Variance",
] as const;

/** A CSV field: quoted when it needs to be, and an empty cell for a genuinely absent figure rather than a 0. */
function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(lines: VarianceLine[]): string {
  return [
    CSV_HEADERS.join(","),
    ...lines.map((l) => [
      l.serialNumber, l.category, l.code, l.description, l.unit, l.quantity, l.rate, l.amount,
      l.budget, l.vendorName, l.vendorAmount, l.materialAmount, l.manpowerAmount, l.variance,
    ].map(csvCell).join(",")),
  ].join("\n");
}

/** "AED 1,200" for a real figure, an en dash for one nobody has entered. Zero is a real figure. */
export function money(value: number | null, currencyCode: string): string {
  if (value === null) return "–";
  const n = value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return currencyCode ? `${currencyCode} ${n}` : n;
}

export function applyFilters(lines: VarianceLine[], category: string, vendor: string): VarianceLine[] {
  return lines.filter((l) => {
    if (category !== ALL && (l.category ?? UNCATEGORIZED) !== category) return false;
    if (vendor !== ALL && (l.vendorName ?? NO_VENDOR) !== vendor) return false;
    return true;
  });
}

export default function CostVarianceAnalyticalClient({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<VarianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>(ALL);
  const [vendor, setVendor] = useState<string>(ALL);
  // The header's Filter action shows and hides the two selects. They start
  // VISIBLE -- a filter you have to find is a filter nobody uses -- so the
  // button is a way to reclaim the space, not a gate in front of the feature.
  const [filtersOpen, setFiltersOpen] = useState(true);
  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson<VarianceReport>(`/api/reports/budget-variance?projectId=${encodeURIComponent(projectId)}`);
      setReport(data);
    } catch (err) {
      setReport(null);
      setLoadError(errorMessage(err, "Couldn't load cost variance"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  const allLines = useMemo(() => report?.lines ?? [], [report]);
  const lines = useMemo(() => applyFilters(allLines, category, vendor), [allLines, category, vendor]);

  // The Category and Vendor option lists are the values actually present in
  // this project's own rows -- never a hardcoded list that can offer a filter
  // matching nothing.
  const categories = useMemo(
    () => [...new Set(allLines.map((l) => l.category ?? UNCATEGORIZED))].sort((a, b) => a.localeCompare(b)),
    [allLines]
  );
  const vendorNames = useMemo(
    () => [...new Set(allLines.map((l) => l.vendorName ?? NO_VENDOR))].sort((a, b) => a.localeCompare(b)),
    [allLines]
  );

  const costedLines = lines.filter((l) => l.committed !== null);
  const visibleBudget = lines.reduce((s, l) => s + l.budget, 0);
  const visibleCommitted = costedLines.length === 0 ? null : costedLines.reduce((s, l) => s + (l.committed ?? 0), 0);
  const overBudget = lines.filter((l) => l.variance !== null && l.variance < 0).length;

  const bars: BarChartDatum[] = lines
    .filter((l) => l.variance !== null)
    .map((l) => ({ label: l.code ?? l.description, value: l.variance!, tone: l.variance! < 0 ? "late" : "done" }));

  function exportCsv() {
    const blob = new Blob([toCsv(lines)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cost-variance-${projectId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AnalyticalScreen
      breadcrumb="Scope of Work / Cost variance"
      // R67 integration: main disabled these two with "not built yet"; D-26
      // builds them, so the live handlers replace the disclaimers rather than
      // the other way round. A working control beats an honest dead one.
      filterAction={{ label: "Filter", onClick: () => setFiltersOpen((open) => !open) }}
      exportAction={{ label: "Export CSV", onClick: exportCsv }}
      newAction={undefined}
      kpiTags={
        <>
          <KpiTag label="Total budget" value={report ? money(visibleBudget, currencyCode) : "–"} />
          <KpiTag label="Committed (vendor + material + manpower)" value={money(visibleCommitted, currencyCode)} />
          <KpiTag label="Lines over budget" value={`${overBudget} of ${lines.length}`} />
        </>
      }
      chart={
        bars.length > 0 ? (
          <BarChart data={bars} />
        ) : (
          <p className="text-[12.5px] text-ct-muted">
            No committed cost yet - enter vendor, material or manpower amounts on a BOQ line to see variance.
            {report?.boqId && (
              <>
                {" "}
                <Link href={`/scope/${report.boqId}`} className="underline">Open the current BOQ</Link>
              </>
            )}
          </p>
        )
      }
      table={
        loading ? (
          <p className="px-4 py-6 text-[13px] text-ct-muted">Loading…</p>
        ) : loadError ? (
          <DataLoadError messages={[loadError]} onRetry={load} />
        ) : (
          <div className="space-y-2">
            {/* The real Filter that replaced "Not yet available". Applied to the
                rows already on screen -- no second round trip, and the tiles,
                the chart and the CSV all read the SAME filtered set. */}
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3" hidden={!filtersOpen}>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger aria-label="Filter by category" className="w-[180px]"><SelectValue placeholder="All categories" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All categories</SelectItem>
                  {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={vendor} onValueChange={setVendor}>
                <SelectTrigger aria-label="Filter by vendor" className="w-[180px]"><SelectValue placeholder="All vendors" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All vendors</SelectItem>
                  {vendorNames.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              {(category !== ALL || vendor !== ALL) && (
                <Button variant="ghost" size="sm" onClick={() => { setCategory(ALL); setVendor(ALL); }}>Clear filters</Button>
              )}
            </div>
            <ListScreen
              functionId="scope.cost-variance"
              columns={COLUMNS}
              rows={lines as unknown as Record<string, unknown>[]}
              getRowId={(row) => row.lineItemId as string}
              emptyStateLabel="No BOQ line items yet."
              renderCell={{
                category: (row) => {
                  const value = (row as unknown as VarianceLine).category;
                  return value ? <>{value}</> : <span className="text-ct-muted">{UNCATEGORIZED}</span>;
                },
                budget: (row) => <MoneyCell value={(row as unknown as VarianceLine).budget} />,
                vendorAmount: (row) => <NullableMoney value={(row as unknown as VarianceLine).vendorAmount} />,
                materialAmount: (row) => <NullableMoney value={(row as unknown as VarianceLine).materialAmount} />,
                manpowerAmount: (row) => <NullableMoney value={(row as unknown as VarianceLine).manpowerAmount} />,
                variance: (row) => {
                  const v = (row as unknown as VarianceLine).variance;
                  if (v === null) return <span className="text-ct-muted">–</span>;
                  // Negative = committed cost exceeds budget = the row to worry about.
                  return <MoneyCell value={v} tone={v < 0 ? "late" : "done"} />;
                },
              }}
            />
          </div>
        )
      }
    />
  );
}

/** An en dash for "nobody has entered this", a real money cell for everything else -- including a real 0. */
function NullableMoney({ value }: { value: number | null }) {
  return value === null ? <span className="text-ct-muted">–</span> : <MoneyCell value={value} />;
}
