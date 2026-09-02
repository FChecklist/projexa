"use client";

// R67 lane D22 (item D-54, rec R-183) -- SCOPE OF WORK / BUDGET.
//
// WHAT WAS WRONG: this tab was called "Cost Variance" and printed six columns
// (Code, Description, Vendor, Budget, Vendor amount, Variance) with nothing
// editable on it. Sumeet's budget sheet is seventeen columns wide and is the
// screen a QS actually works in, so the tab is now called Budget and prints
// his order: S.No | Category | Code | Description | Qty | Unit | Rate |
// Amount | Budget % | Budget | Vendor | Vendor Amt | Material | Manpower |
// Actual | Revenue | Variance.
//
// ONE REPORT, NOT A SECOND SCREEN'S WORTH OF FETCHES: everything but the tie
// check comes from the already-registered "budget-variance" report
// (compliance-tracker's boqBudgetVarianceReport), widened by this item with
// `actual` (vendor + material + manpower) and `revenue` (what the interim/RA
// bills have billed against the line).
//
// THE TIE CHECK IS DELIBERATELY A SECOND OPINION: the Grand Total below is
// summed from this report's root lines in the browser, and compared against
// the "scope" report, which sums the same rows in SQL. Comparing a total to
// itself proves nothing -- the banner only means something because the two
// numbers travel by different routes.
//
// EDITING IS IN PLACE, through the same shared write path /budgets uses
// (BudgetLineCells + applyLineItemPatch), so Budget = Amount x % and Actual =
// vendor + material + manpower are computed in exactly one tested place.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AnalyticalScreen, BulletChart, KpiTag } from "@fchecklist/veridian-ui-kit/screens";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CellFeedback, useLineItemSaver, type BudgetFieldKey } from "@/components/BudgetLineCells";
import { useCurrencies } from "@/lib/currency";
import { errorMessage, fetchJson } from "@/lib/fetch-json";
import { withMoney } from "@/lib/money";
import {
  applyLineItemPatch,
  budgetCategoryOptions,
  budgetVariance,
  budgetVendorOptions,
  grandTotalTies,
  groupBudgetLinesByCategory,
  isOverBudget,
  type BudgetLine,
  type BudgetSubtotal,
} from "@/lib/budget-lines";
import type { Vendor } from "@/lib/boq-helpers";

type BudgetVarianceReport = {
  boqId: string | null;
  boqTitle: string | null;
  boqVersion: number | null;
  lines: BudgetLine[];
  totalBudget: number;
  totalActual: number;
  totalRevenue: number;
};

// The scope report's own answer to "what is this BOQ worth", computed in SQL
// over root lines only -- the second opinion the Grand Total is checked against.
type ScopeReport = { totalValue: number };

// The sentence a QS sees instead of an empty chart frame. It names the two
// things that would fill it, so "nothing here" is actionable rather than
// mysterious.
const NO_ACTUALS = "No actuals recorded yet - tag receipts and attendance to BOQ lines";

function MultiSelectFilter({
  label, options, selected, onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const summary = selected.length === 0 ? "All" : selected.length === 1
    ? (options.find((o) => o.id === selected[0])?.name ?? selected[0])
    : `${selected.length} selected`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1" disabled={options.length === 0}>
          {label}: {summary}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 space-y-2">
        {options.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <label key={option.id} className="flex cursor-pointer items-center gap-2 text-[13px]">
              <Checkbox
                checked={checked}
                onCheckedChange={() => onChange(checked ? selected.filter((s) => s !== option.id) : [...selected, option.id])}
              />
              <span>{option.name}</span>
            </label>
          );
        })}
        {selected.length > 0 && (
          <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange([])}>Clear</Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function CostVarianceAnalyticalClient({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<BudgetVarianceReport | null>(null);
  const [boqTotalValue, setBoqTotalValue] = useState<number | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupByCategory, setGroupByCategory] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [vendorFilter, setVendorFilter] = useState<string[]>([]);
  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The scope report and the vendor list are not worth failing the screen
      // over: without them the tie check and the vendor picker degrade, but
      // every number in the table is still correct.
      const [data, scope, vendorsData] = await Promise.all([
        fetchJson<BudgetVarianceReport>(`/api/reports/budget-variance?projectId=${encodeURIComponent(projectId)}`),
        fetchJson<ScopeReport>(`/api/reports/scope?projectId=${encodeURIComponent(projectId)}`).catch(() => null),
        fetchJson<{ vendors: Vendor[] }>("/api/vendors").catch(() => ({ vendors: [] })),
      ]);
      setReport(data);
      setBoqTotalValue(scope ? Number(scope.totalValue) : null);
      setVendors(vendorsData.vendors ?? []);
      setLoadError(null);
    } catch (err) {
      setReport(null);
      setLoadError(errorMessage(err, "Couldn't load this BOQ's budget"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const vendorNameById = useCallback(
    (vendorId: string | null) => (vendorId ? (vendors.find((v) => v.id === vendorId)?.vendorName ?? null) : null),
    [vendors]
  );
  const { cells, saveField } = useLineItemSaver(
    useCallback((lineItemId: string, patched: Record<string, unknown>) => {
      setReport((prev) => prev
        ? { ...prev, lines: prev.lines.map((l) => (l.lineItemId === lineItemId ? applyLineItemPatch(l, patched, vendorNameById) : l)) }
        : prev);
    }, [vendorNameById])
  );

  const lines = useMemo(() => report?.lines ?? [], [report]);
  const categoryOptions = useMemo(() => budgetCategoryOptions(lines).map((c) => ({ id: c, name: c })), [lines]);
  const vendorOptions = useMemo(() => budgetVendorOptions(lines), [lines]);
  // Filtered = what the table, the tiles and the chart show. Unfiltered = the
  // figure the BOQ total is checked against; a filter narrowing the view must
  // never make the BOQ look like it changed value.
  const { groups, grandTotal } = useMemo(
    () => groupBudgetLinesByCategory(lines, categoryFilter, vendorFilter),
    [lines, categoryFilter, vendorFilter]
  );
  const unfilteredTotal = useMemo(() => groupBudgetLinesByCategory(lines).grandTotal, [lines]);
  const visibleLines = useMemo(() => groups.flatMap((g) => g.lines), [groups]);
  const linesOverBudget = useMemo(() => visibleLines.filter(isOverBudget).length, [visibleLines]);
  // S.No is the row's position in the order the table prints, worked out ONCE.
  // Grouped and ungrouped render the SAME sequence, so a line keeps its number
  // when the "Group by category" toggle moves. A counter incremented inside the
  // row map would be a render-time mutation (react-hooks/immutability).
  const serialByLineItemId = useMemo(() => {
    const map = new Map<string, number>();
    visibleLines.forEach((line, index) => map.set(line.lineItemId, index + 1));
    return map;
  }, [visibleLines]);
  const hasActuals = grandTotal.actual > 0;
  const tiesToBoq = boqTotalValue === null || grandTotalTies(unfilteredTotal.amount, boqTotalValue);

  // Sorted worst-first, the kit's own category-comparison rule: a bullet per
  // category, actual against the budget it was given (lower is better).
  const categoryBars = useMemo(
    () => [...groups].sort((a, b) => b.subtotal.actual - a.subtotal.actual),
    [groups]
  );

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  const renderRow = (line: BudgetLine) => {
    const isChild = !!line.parentLineItemId;
    const cell = (field: BudgetFieldKey) => cells[`${line.lineItemId}:${field}`];
    const busy = (field: BudgetFieldKey) => cell(field)?.status === "saving";
    const variance = budgetVariance(line);
    return (
      <TableRow key={line.lineItemId} id={`line-${line.lineItemId}`}>
        <TableCell className="text-right text-px-muted">{serialByLineItemId.get(line.lineItemId)}</TableCell>
        <TableCell className="text-px-muted">{line.category ?? "—"}</TableCell>
        <TableCell className="font-mono text-[11px]">
          {report?.boqId ? (
            <a className="text-px-steel underline-offset-2 hover:underline" href={`/scope/${report.boqId}#line-${line.lineItemId}`}>
              {line.code ?? "—"}
            </a>
          ) : (line.code ?? "—")}
        </TableCell>
        <TableCell className={isChild ? "pl-6 text-px-muted" : "font-medium"}>{line.description}</TableCell>
        <TableCell className="text-right">{line.quantity}</TableCell>
        <TableCell className="text-px-muted">{line.unit}</TableCell>
        <TableCell className="text-right">{withMoney(currencyCode, line.rate)}</TableCell>
        <TableCell className="text-right font-medium">{withMoney(currencyCode, line.amount)}</TableCell>
        <TableCell className="text-right">
          <Input
            type="number" aria-label={`Budget % for ${line.code ?? line.description}`}
            title="default 25%" placeholder="default 25%"
            className="w-20 text-right" disabled={busy("budgetPercentage")}
            defaultValue={line.budgetPercentage}
            onBlur={(e) => {
              const pct = Number(e.target.value);
              if (!Number.isFinite(pct) || pct === line.budgetPercentage) return;
              void saveField(line.lineItemId, "budgetPercentage", pct);
            }}
          />
          <CellFeedback state={cell("budgetPercentage")} />
        </TableCell>
        <TableCell className="text-right">{withMoney(currencyCode, line.budget)}</TableCell>
        <TableCell>
          <Select
            disabled={busy("vendorId")} value={line.vendorId ?? undefined}
            onValueChange={(vendorId) => void saveField(line.lineItemId, "vendorId", vendorId)}
          >
            <SelectTrigger className="w-[150px]" aria-label={`Vendor for ${line.code ?? line.description}`}>
              <SelectValue placeholder="No vendor" />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}
            </SelectContent>
          </Select>
          <CellFeedback state={cell("vendorId")} />
        </TableCell>
        {(["vendorAmount", "materialAmount", "manpowerAmount"] as const).map((field) => (
          <TableCell key={field} className="text-right">
            <Input
              type="number" className="w-24 text-right" placeholder="—"
              aria-label={`${field === "vendorAmount" ? "Vendor Amt" : field === "materialAmount" ? "Material" : "Manpower"} for ${line.code ?? line.description}`}
              disabled={busy(field)} defaultValue={line[field] ?? ""}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const amt = raw === "" ? null : Number(raw);
                if (raw !== "" && !Number.isFinite(amt)) return;
                if (amt === (line[field] ?? null)) return;
                void saveField(line.lineItemId, field, amt);
              }}
            />
            <CellFeedback state={cell(field)} />
          </TableCell>
        ))}
        <TableCell className="text-right">
          {line.actual === null || line.actual === undefined ? <span className="text-px-muted">–</span> : withMoney(currencyCode, line.actual)}
        </TableCell>
        <TableCell className="text-right">
          {line.revenue === null || line.revenue === undefined ? <span className="text-px-muted">–</span> : withMoney(currencyCode, line.revenue)}
        </TableCell>
        <TableCell className="text-right">
          {variance === null ? (
            <span className="text-px-muted">–</span>
          ) : variance < 0 ? (
            // Over budget says so in words as well as colour: a glyph and the
            // word "over", never colour alone.
            <span className="flex items-center justify-end gap-1 text-px-error">
              <TriangleAlert className="size-3.5" aria-hidden="true" />
              {withMoney(currencyCode, Math.abs(variance))} over
            </span>
          ) : (
            withMoney(currencyCode, variance)
          )}
        </TableCell>
      </TableRow>
    );
  };

  const subtotalRow = (label: string, subtotal: BudgetSubtotal, emphasis: string) => (
    <TableRow className={emphasis}>
      <TableCell />
      <TableCell colSpan={6} className="text-[12px] font-medium">{label}</TableCell>
      <TableCell className="text-right font-medium">{withMoney(currencyCode, subtotal.amount)}</TableCell>
      <TableCell />
      <TableCell className="text-right font-medium">{withMoney(currencyCode, subtotal.budget)}</TableCell>
      <TableCell />
      <TableCell className="text-right font-medium">{withMoney(currencyCode, subtotal.vendorAmount)}</TableCell>
      <TableCell className="text-right font-medium">{withMoney(currencyCode, subtotal.materialAmount)}</TableCell>
      <TableCell className="text-right font-medium">{withMoney(currencyCode, subtotal.manpowerAmount)}</TableCell>
      <TableCell className="text-right font-medium">{withMoney(currencyCode, subtotal.actual)}</TableCell>
      <TableCell className="text-right font-medium">{withMoney(currencyCode, subtotal.revenue)}</TableCell>
      <TableCell className="text-right font-medium">
        {subtotal.budget - subtotal.actual < 0
          ? <span className="text-px-error">{withMoney(currencyCode, subtotal.actual - subtotal.budget)} over</span>
          : withMoney(currencyCode, subtotal.budget - subtotal.actual)}
      </TableCell>
    </TableRow>
  );

  return (
    <AnalyticalScreen
      breadcrumb="Scope of Work / Budget"
      kpiTags={
        <>
          <KpiTag label="Total budget" value={report ? withMoney(currencyCode, grandTotal.budget) : "—"} />
          <KpiTag label="Actual" value={report ? withMoney(currencyCode, grandTotal.actual) : "—"} />
          <KpiTag label="Lines over budget" value={report ? String(linesOverBudget) : "—"} />
        </>
      }
      chart={
        hasActuals ? (
          <div className="space-y-3">
            {categoryBars.map((group) => (
              <div key={group.category}>
                <div className="mb-0.5 flex justify-between text-[12px] text-px-slate">
                  <span>{group.category}</span>
                  <span className="tabular-nums">
                    {withMoney(currencyCode, group.subtotal.actual)} of {withMoney(currencyCode, group.subtotal.budget)}
                  </span>
                </div>
                <BulletChart value={group.subtotal.actual} target={group.subtotal.budget} lowerIsBetter />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-px-muted">{NO_ACTUALS}</p>
        )
      }
      table={
        <div className="space-y-3 p-4">
          {!tiesToBoq && (
            <p role="alert" className="rounded-sm border border-px-error-border bg-px-error-light px-3 py-2 text-[12.5px] text-px-error">
              Grand total {withMoney(currencyCode, unfilteredTotal.amount)} does not tie to this BOQ&apos;s own total{" "}
              {withMoney(currencyCode, boqTotalValue ?? 0)} — reload before trusting these figures.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="group-by-category" checked={groupByCategory} onCheckedChange={setGroupByCategory} />
              <Label htmlFor="group-by-category" className="text-[13px]">Group by category</Label>
            </div>
            <MultiSelectFilter label="Category" options={categoryOptions} selected={categoryFilter} onChange={setCategoryFilter} />
            <MultiSelectFilter label="Vendor" options={vendorOptions} selected={vendorFilter} onChange={setVendorFilter} />
            {(categoryFilter.length > 0 || vendorFilter.length > 0) && (
              <Button variant="ghost" size="sm" onClick={() => { setCategoryFilter([]); setVendorFilter([]); }}>Clear filters</Button>
            )}
          </div>
          {loading ? (
            <p className="px-4 py-6 text-[13px] text-px-muted">Loading…</p>
          ) : lines.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-px-muted">
              This project has no BOQ lines yet — create a BOQ to budget it.
            </p>
          ) : visibleLines.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-px-muted">
              No lines match these filters — clear them to see the whole BOQ.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">S.No</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Budget %</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Vendor Amt</TableHead>
                  <TableHead className="text-right">Material</TableHead>
                  <TableHead className="text-right">Manpower</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupByCategory
                  ? groups.map((group) => (
                      <Fragment key={group.category}>
                        {group.lines.map(renderRow)}
                        {subtotalRow(`${group.category} subtotal`, group.subtotal, "bg-px-cloud/50")}
                      </Fragment>
                    ))
                  : visibleLines.map(renderRow)}
                {subtotalRow("Grand total", grandTotal, "border-t-2 border-px-border2 bg-px-cloud font-semibold")}
              </TableBody>
            </Table>
          )}
        </div>
      }
      filterAction={{ label: "Filter", disabledReason: "Filter by Category or Vendor above the table" }}
      exportAction={{ label: "Export", disabledReason: "Export the Budget from Reports > Budget variance" }}
      newAction={undefined}
    />
  );
}
