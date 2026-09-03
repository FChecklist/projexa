"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Play } from "lucide-react";
import { formatDate } from "@/lib/format-date";
import { formatDecimal, formatNumber } from "@/lib/format-number";
import { formatProgressCell, unlinkedEntriesNote } from "@/lib/work-progress-report";
import { useOrgMoney } from "@/lib/use-org-money";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import {
  CUSTOM_PERIOD_LABEL,
  isoDay,
  matchPeriodPreset,
  noProgressNotice,
  periodLine,
  periodPresetRange,
  PERIOD_PRESETS,
  PERIOD_PRESET_LABELS,
  reportCaption,
  resolveWprParams,
  THIRD_COLUMN_NOTE,
  whatsappMessage,
  wprRunningLine,
  WPR_STILL_RUNNING_MS,
  WPR_STILL_RUNNING_NOTE,
  type PeriodPreset,
  type WprView,
  type ThirdColumnMode,
  type WprParams,
} from "@/lib/work-progress-report-params";
import { ExportShareActions } from "@/components/ExportShareActions";
import { SortedBarList, type SortedBar } from "@/components/reports/SortedBarList";

export type { ThirdColumnMode };

export type LineItemRow = {
  lineItemId: string; code: string; description: string; categoryName: string; unit: string; rate: number;
  qtyTotal: number; amtTotal: number;
  // Point 108: which line this is a hierarchical BOQ child of, if any --
  // WPR-06 says percentages are PARENT-only, so this decides whether the
  // percent band renders blank for this row (a child) or real numbers.
  parentLineItemId: string | null;
  qty: { prev: number; current: number; total: number; balance: number };
  amt: { prev: number; current: number; total: number; balance: number };
  percentage: { prev: number; current: number; total: number; balance: number };
  // T-WPR-14-1 / Point 111 (WPR-14): whether ANY progress entry contributed
  // to each bucket -- see work-progress-report.ts's own LineItemProgress
  // comment. money() alone can't tell a real computed zero (dash) from a
  // bucket nothing has ever touched (blank) -- both are the JS number 0.
  touched: { prev: boolean; current: boolean; total: boolean };
};
type CategoryRow = { name: string; amtTotal: number; amt: { prev: number; current: number; total: number; balance: number }; percentage: { prev: number; current: number; total: number; balance: number } };
type ManpowerRow = { trade: string; workerDays: number; totalCost: number };
type VendorRow = { vendorId: string; vendorName: string; totalCost: number };

// R36/P5 (B5 decision): additive fields so an existing consumer that
// doesn't know about them still works exactly as before.
type BoqOption = { id: string; title: string; status: string; version: number };
// R67 I-05: availableCategories/categoryFilter are additive.
type ReportResponse = {
  boqTitle: string | null; boqId: string | null; availableBoqs: BoqOption[];
  rows: LineItemRow[]; byCategory: CategoryRow[]; byManpower: ManpowerRow[]; byVendor: VendorRow[];
  availableCategories?: string[]; categoryFilter?: string[];
  // R67 B-09: additive, so a server that has not shipped it yet renders the
  // report rather than a broken note.
  unlinkedEntryCount?: number;
};

/**
 * QUANTITIES are not money. A quantity of 50 must stay "50", not "50.00", and
 * carries no currency; the Amount band and the Rate/Amt columns go through the
 * org money formatter instead (R67 E-03). formatDecimal pins the locale, which
 * is the hydration bug src/lib/format-date.ts exists to prevent.
 */
function qtyText(n: number) {
  return formatDecimal(n);
}

/**
 * Percentages get ONE decimal, down the whole column, so the column aligns on
 * the point. R67 D-61 (second-merge fix): formatNumber(), not a direct
 * toFixed() -- a bare toFixed() picks the runtime's own locale for the digit
 * grouping (none, here, since there's no group separator below 1000 -- but
 * money-format-rule.test.ts bans the METHOD everywhere under src/components,
 * not just where the mismatch is visible, so the sweep cannot regress one
 * call at a time).
 */
function percentText(n: number) {
  return `${formatNumber(n, { fractionDigits: 1 })}%`;
}

// T-WPR-14-1 (WPR-14, point 111): a real computed zero (a line that is fully
// complete, balance = 0) and a bucket with NO progress entry in this window
// are both the JS number 0 and were visually identical. formatProgressCell is
// the canonical (value, touched) -> "" / "-" / real-number rule; this layers
// the caller's own formatter on top of its real-number case.
function progressCell(value: number, touched: boolean, format: (n: number) => string): string {
  const cell = formatProgressCell(value, touched);
  return typeof cell === "number" ? format(cell) : cell;
}

// Point 108: S.No | Category | Code | Description | PO Qty | Unit | Rate | Amt
// (identifying columns), then THREE bands in XLSX order -- Percent, then
// Quantity, then Amount -- each Previous | Current | Total-or-Balance.
const bandBorder = "border-l-2 border-px-border";

// R67 E-03 (R-076): the Amount band was unreachable at 1440 px -- the table
// simply ran off the right edge. The table now scrolls inside its own
// container, and the columns that tell a reader WHICH LINE they are looking at
// stay pinned while the numeric bands scroll under them. Three columns, not
// all eight: pinning eight would consume most of a 1440 px viewport and leave
// the bands no room, which is the problem restated rather than solved. (Item
// E-15, the same lane, words this requirement as "position-sticky S.No and
// Code columns" -- this is that, plus Category, and the widths below are
// fixed precisely so the cumulative left offsets are exact.)
const STICKY_SNO = "sticky left-0 z-20 bg-card w-12";
const STICKY_CATEGORY = "sticky left-12 z-20 bg-card w-32";
const STICKY_CODE = "sticky left-44 z-20 bg-card w-24 border-r-2 border-px-border";

/** Money cells and quantity cells alike align right on tabular figures, so a column reads as a column. */
const NUM_CELL = "text-right tabular-nums whitespace-nowrap";

// R42 seq24 (REPORT.GLOBAL): the arithmetic identity this report must hold --
// GROUP SUBTOTALS (here, byCategory) and a GRAND TOTAL that ties. Parent rows
// carry the real BoQ contract value (D-3: parent-lines-only); child rows'
// own amtTotal is a separate, informational figure, so the "Amt" grand total
// sums PARENT rows only, matching earnedValueReport()'s contractValue
// convention exactly.
function computeGrandTotal(rows: LineItemRow[], mode: ThirdColumnMode) {
  const parents = rows.filter((r) => !r.parentLineItemId);
  return {
    amtTotal: parents.reduce((s, r) => s + r.amtTotal, 0),
    amt: {
      prev: rows.reduce((s, r) => s + r.amt.prev, 0),
      current: rows.reduce((s, r) => s + r.amt.current, 0),
      third: rows.reduce((s, r) => s + r.amt[mode], 0),
    },
  };
}

// Tie check: byCategory groups the SAME rows this table renders -- its own
// amt-band sums must equal this table's own sums of the identical rows. A
// mismatch means a row silently fell outside every category group, not a
// rounding artefact -- REPORT.GLOBAL: "the report is wrong and MUST SAY SO
// LOUDLY, not render anyway."
export function checkTies(
  rows: LineItemRow[],
  byCategory: CategoryRow[],
  mode: ThirdColumnMode,
  format: (n: number) => string = formatDecimal
): string | null {
  const grand = computeGrandTotal(rows, mode);
  const categorySum = byCategory.reduce((s, c) => s + c.amt[mode], 0);
  const diff = Math.abs(grand.amt.third - categorySum);
  if (diff > 0.01) {
    return `Category subtotals (${format(categorySum)}) do not sum to the grand total (${format(grand.amt.third)}) -- a row is missing from a category group. Export is disabled until this is fixed.`;
  }
  return null;
}

// R67 I-05 (R-177): the Category multi-select on the parameter bar.
//
// Checkboxes, not a shadcn Select -- Select is single-value, and a fake "multi"
// built on it would silently drop every choice but the last. Nothing is
// filtered until Apply. "All categories" is what the EMPTY selection is called,
// stated in words, so an empty control never reads as "nothing matches".
export function CategoryFilterGroup({
  available,
  selected,
  disabled,
  onToggle,
  onApply,
}: {
  available: string[];
  selected: string[];
  disabled: boolean;
  onToggle: (name: string, checked: boolean) => void;
  onApply: () => void;
}) {
  if (available.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <Label id="wpr-category-filter-label">Category</Label>
      <div
        role="group"
        aria-labelledby="wpr-category-filter-label"
        data-testid="wpr-category-filter"
        className="flex max-w-[420px] flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-px-border px-2 py-1.5"
      >
        {available.map((c) => (
          <label key={c} className="flex items-center gap-1 text-xs text-px-ink">
            <input
              type="checkbox"
              checked={selected.includes(c)}
              onChange={(e) => onToggle(c, e.target.checked)}
            />
            {c}
          </label>
        ))}
        <span className="text-xs text-px-muted">
          {selected.length === 0 ? "All categories" : `${selected.length} selected`}
        </span>
        <Button size="sm" variant="outline" disabled={disabled} data-testid="wpr-category-apply" onClick={onApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

/**
 * R67 E-20 (R-209): every item code links to the LINE, not just to the screen.
 * `/scope?boqId=...#line-<id>` -- the boqId names the revision the number came
 * from, and the fragment names the row, so a QS checking a figure lands on it
 * rather than on a BOQ they then have to search.
 */
export function boqLineHref(projectId: string, boqId: string | null, lineItemId: string): string {
  const qs = new URLSearchParams({ projectId });
  if (boqId) qs.set("boqId", boqId);
  return `/scope?${qs.toString()}#line-${encodeURIComponent(lineItemId)}`;
}

/**
 * R67 E-20 (R-209): the legend, under the table, in words. Three bands of
 * near-identical columns is exactly the table where a reader needs telling what
 * "Previous" is previous TO, and a header cell has no room to say it.
 */
export function scopeTableLegend(mode: ThirdColumnMode, from: string, to: string): string {
  const third = mode === "balance"
    ? "Balance = the contract less everything done to date"
    : "Total = everything done to date, including before this period";
  return `Previous = done before ${from}. Current = done between ${from} and ${to}. ${third}. Percentages are of the BOQ line and are shown on parent lines only; a sub-task's own quantity and amount are its own.`;
}

export function ScopeTable({
  rows,
  mode,
  projectId,
  boqId = null,
  from,
  to,
  money = formatDecimal,
}: {
  rows: LineItemRow[];
  mode: ThirdColumnMode;
  projectId: string;
  /** The BOQ revision these rows came from, so a Code link names the revision as well as the line. */
  boqId?: string | null;
  from: string;
  to: string;
  /** The org money formatter. Defaults to a bare number so a caller with no currency in hand still renders. */
  money?: (n: number) => string;
}) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">No BoQ line items for this project yet.</p>;
  const thirdLabel = mode === "balance" ? "Balance" : "Total";
  const grand = computeGrandTotal(rows, mode);
  return (
    // R67 E-03 (R-076): its OWN horizontal scroller. The page body must never
    // scroll sideways, and the Amount band must always be reachable.
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead rowSpan={2} className={STICKY_SNO}>S.No</TableHead>
            <TableHead rowSpan={2} className={STICKY_CATEGORY}>Category</TableHead>
            <TableHead rowSpan={2} className={STICKY_CODE}>Code</TableHead>
            <TableHead rowSpan={2}>Description</TableHead>
            {/* R67 E-03 / E-15: the BOQ quantity itself -- the column a QS
                reads every progress figure against, and the one this table
                never had. */}
            <TableHead rowSpan={2} className={NUM_CELL}>PO Qty</TableHead>
            <TableHead rowSpan={2}>Unit</TableHead>
            <TableHead rowSpan={2} className={NUM_CELL}>Rate</TableHead>
            <TableHead rowSpan={2} className={NUM_CELL}>Amt</TableHead>
            <TableHead colSpan={3} className={`text-center ${bandBorder}`}>Percent</TableHead>
            <TableHead colSpan={3} className={`text-center ${bandBorder}`}>Quantity</TableHead>
            <TableHead colSpan={3} className={`text-center ${bandBorder}`}>Amount</TableHead>
          </TableRow>
          <TableRow>
            <TableHead className={`${bandBorder} ${NUM_CELL}`}>Previous</TableHead><TableHead className={NUM_CELL}>Current</TableHead><TableHead className={NUM_CELL}>{thirdLabel}</TableHead>
            <TableHead className={`${bandBorder} ${NUM_CELL}`}>Previous</TableHead><TableHead className={NUM_CELL}>Current</TableHead><TableHead className={NUM_CELL}>{thirdLabel}</TableHead>
            <TableHead className={`${bandBorder} ${NUM_CELL}`}>Previous</TableHead><TableHead className={NUM_CELL}>Current</TableHead><TableHead className={NUM_CELL}>{thirdLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => {
            const isChild = !!r.parentLineItemId; // WPR-06: percentages are parent-only
            return (
              <TableRow key={r.lineItemId}>
                <TableCell className={STICKY_SNO}>{i + 1}</TableCell>
                <TableCell className={STICKY_CATEGORY}>{r.categoryName}</TableCell>
                {/* R42 seq24: every item code is a hyperlink to its BOQ (REPORT.GLOBAL). */}
                <TableCell className={`font-mono text-xs ${STICKY_CODE}`}>
                  {r.code ? (
                    <Link href={boqLineHref(projectId, boqId, r.lineItemId)} className="text-px-ink underline" data-testid="scope-code-link">
                      {r.code}
                    </Link>
                  ) : "—"}
                </TableCell>
                <TableCell>{r.description}</TableCell>
                <TableCell className={NUM_CELL} data-testid="po-qty">{qtyText(r.qtyTotal)}</TableCell>
                <TableCell>{r.unit}</TableCell>
                <TableCell className={NUM_CELL} data-testid="rate">{money(r.rate)}</TableCell>
                <TableCell className={NUM_CELL} data-testid="amt-total">{money(r.amtTotal)}</TableCell>

                <TableCell className={`${bandBorder} ${NUM_CELL}`} data-testid="pct-prev">{isChild ? "" : percentText(r.percentage.prev)}</TableCell>
                <TableCell className={NUM_CELL} data-testid="pct-current">{isChild ? "" : percentText(r.percentage.current)}</TableCell>
                <TableCell className={NUM_CELL} data-testid="pct-third">{isChild ? "" : percentText(r.percentage[mode])}</TableCell>

                {/* T-WPR-14-1: balance is algebraically total's own complement,
                    so touched.total is the correct signal for it in either mode. */}
                <TableCell className={`${bandBorder} ${NUM_CELL}`} data-testid="qty-prev">{progressCell(r.qty.prev, r.touched.prev, qtyText)}</TableCell>
                <TableCell className={NUM_CELL} data-testid="qty-current">{progressCell(r.qty.current, r.touched.current, qtyText)}</TableCell>
                <TableCell className={NUM_CELL} data-testid="qty-third">{progressCell(r.qty[mode], r.touched.total, qtyText)}</TableCell>

                <TableCell className={`${bandBorder} ${NUM_CELL}`} data-testid="amt-prev">{progressCell(r.amt.prev, r.touched.prev, money)}</TableCell>
                <TableCell className={NUM_CELL} data-testid="amt-current">{progressCell(r.amt.current, r.touched.current, money)}</TableCell>
                <TableCell className={NUM_CELL} data-testid="amt-third">{progressCell(r.amt[mode], r.touched.total, money)}</TableCell>
              </TableRow>
            );
          })}
          {/* R42 seq24: GRAND TOTAL, always visible, never requiring a scroll (REPORT.GLOBAL). */}
          <TableRow className="font-semibold border-t-2 border-px-border" data-testid="grand-total-row">
            <TableCell colSpan={7} className="sticky left-0 z-20 bg-card">Grand Total</TableCell>
            <TableCell className={NUM_CELL}>{money(grand.amtTotal)}</TableCell>
            <TableCell className={bandBorder} />
            <TableCell /><TableCell />
            <TableCell className={bandBorder} />
            <TableCell /><TableCell />
            <TableCell className={`${bandBorder} ${NUM_CELL}`}>{money(grand.amt.prev)}</TableCell>
            <TableCell className={NUM_CELL}>{money(grand.amt.current)}</TableCell>
            <TableCell className={NUM_CELL} data-testid="grand-total-amount">{money(grand.amt.third)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {/* R67 E-20 (R-209): the legend, under the table. Three bands of
          near-identical column names need one sentence saying what each is
          relative to -- and a sentence survives a printout, which a tooltip
          does not. */}
      <p className="pt-2 text-[12px] text-px-muted" data-testid="scope-table-legend">{scopeTableLegend(mode, from, to)}</p>
    </div>
  );
}

function CategoryTable({ rows, mode, projectId, money }: { rows: CategoryRow[]; mode: ThirdColumnMode; projectId: string; money: (n: number) => string }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">Nothing to break down by category yet.</p>;
  const thirdLabel = mode === "balance" ? "Balance" : "Total";
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Category</TableHead><TableHead className={NUM_CELL}>Amt Total</TableHead>
            <TableHead className={NUM_CELL}>Amt Prev</TableHead><TableHead className={NUM_CELL}>Amt Current</TableHead><TableHead className={NUM_CELL}>Amt {thirdLabel} (to date)</TableHead>
            <TableHead className={NUM_CELL}>% Prev</TableHead><TableHead className={NUM_CELL}>% Current</TableHead><TableHead className={NUM_CELL}>% {thirdLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.name}>
              {/* R42 seq24: every group subtotal links to the ANALYTICAL page filtered to that group (REPORT.GLOBAL). */}
              <TableCell>
                <Link href={`/work-progress?projectId=${projectId}&tab=analytics&category=${encodeURIComponent(r.name)}`} className="text-px-ink underline">{r.name}</Link>
              </TableCell>
              <TableCell className={NUM_CELL}>{money(r.amtTotal)}</TableCell>
              <TableCell className={NUM_CELL}>{money(r.amt.prev)}</TableCell><TableCell className={NUM_CELL}>{money(r.amt.current)}</TableCell><TableCell className={NUM_CELL}>{money(r.amt[mode])}</TableCell>
              <TableCell className={NUM_CELL}>{percentText(r.percentage.prev)}</TableCell><TableCell className={NUM_CELL}>{percentText(r.percentage.current)}</TableCell><TableCell className={NUM_CELL}>{percentText(r.percentage[mode])}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ManpowerTable({ rows, money }: { rows: ManpowerRow[]; money: (n: number) => string }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">No attendance recorded in this date range.</p>;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Trade</TableHead><TableHead className={NUM_CELL}>Worker-Days</TableHead><TableHead className={NUM_CELL}>Cost</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.trade}><TableCell>{r.trade}</TableCell><TableCell className={NUM_CELL}>{qtyText(r.workerDays)}</TableCell><TableCell className={NUM_CELL}>{money(r.totalCost)}</TableCell></TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function VendorTable({ rows, money }: { rows: VendorRow[]; money: (n: number) => string }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">No vendor-linked labour cost in this date range.</p>;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Vendor</TableHead><TableHead className={NUM_CELL}>Cost</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.vendorId}><TableCell>{r.vendorName}</TableCell><TableCell className={NUM_CELL}>{money(r.totalCost)}</TableCell></TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The loading state during the automatic run. A skeleton with the band headers
 * already visible, not a lone spinner: the reader learns the shape of what is
 * coming while it comes, and the screen does not jump when it arrives.
 */
function ReportSkeleton() {
  return (
    <div className="space-y-3" data-testid="wpr-skeleton">
      <div className="flex gap-6 text-[12px] font-medium text-px-muted">
        <span>Percent</span><span>Quantity</span><span>Amount</span>
      </div>
      {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
    </div>
  );
}

/**
 * R67 D-29 (audit R-080), lane D1, folded onto lane D-02's URL-state rewrite.
 * "Every band untouched" -- the report ran, and nothing happened on this
 * project between those two dates. Four empty tables under four tabs is a
 * puzzle; one sentence is an answer.
 *
 * `touched.current` is the flag the report already computes for exactly this
 * distinction (see LineItemRow's own comment): money() cannot tell a real
 * computed zero from a bucket no progress entry has ever reached, because both
 * are the number 0.
 *
 * This is reached only AFTER the `reportError` branch below, so it can never
 * be the sentence shown over a failed run -- the empty answer and the failed
 * answer stay distinct, which is the same rule read-outcome.ts enforces for
 * every list in the product.
 */
export function reportIsEmpty(report: Pick<ReportResponse, "rows" | "byManpower" | "byVendor">): boolean {
  return (
    report.rows.every((r) => !r.touched.current) &&
    report.byManpower.length === 0 &&
    report.byVendor.length === 0
  );
}

/** The sentence itself, so its wording is asserted rather than trusted. */
export function noProgressText(from: string, to: string): string {
  return `No progress recorded between ${from} and ${to}`;
}

// R67 MERGE (lane D1 x lane D-02/C-04). Both lanes rewrote this screen's run
// path. Under decision D-11 the version on main is canonical -- D-02 holds the
// report's whole state in the URL, runs on arrival, and already replaced
// D-29's four-second failure TOAST with a `reportError` state rendered beside
// a Retry (it keeps the toast as well, which is the one part of D-29's
// complaint that is a matter of taste rather than of truth). So lane D1's own
// `runError` is dropped as a duplicate of `reportError`, NOT as a rejected
// idea -- the behaviour D-29 asked for is what ships.
//
// What lane D1 had that main did not is above: reportIsEmpty()/noProgressText().
// A report that ran successfully over a quiet fortnight used to render four
// empty tables under four tabs and leave the reader to work out which of
// "nothing happened", "the filter is too narrow" and "it broke" they were
// looking at.
//
// R67 D-02: the report opens with its parameters ALREADY in the URL (the page
// resolves them through parseWprParams) and runs on arrival. Correction C-04:
// before this, the range was pre-filled and the screen still said "Pick a date
// range and click Run Report" -- three clicks to see the current month it could
// have shown immediately. defaultFrom()/defaultTo() moved into
// src/lib/work-progress-report-params.ts, where they are shared with the
// Reports module's link and are actually tested.
export default function WorkProgressReportClient({
  projectId,
  projectName = "this project",
  projectStartDate = null,
  initialParams,
}: {
  projectId: string;
  projectName?: string;
  /** Optional: the third step of the From fallback chain. Absent today (the org dashboard payload carries no start date), so an entry-less project falls through to 1 January. */
  projectStartDate?: string | null;
  /**
   * R67 D-02: the parameters the SERVER already resolved off the URL. Seeded
   * from here rather than re-parsed on the client, because the client's own
   * `today` is the visitor's clock -- resolving the default range twice, once
   * per side, is exactly the hydration mismatch format-date.ts exists to stop.
   */
  initialParams?: WprParams;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgMoney = useOrgMoney();
  const money = useCallback((n: number) => orgMoney.money(n), [orgMoney]);

  const today = isoDay(new Date());
  // R67 D-02 + E-03, merged. D-02 owns the URL's shape (from/to/view/
  // boqVersion, with boqVersion a stable, readable VERSION NUMBER rather than
  // a cuid); E-03 owns what a MISSING from means -- the project's own earliest
  // entry rather than the first of this month, because a job whose last
  // progress was logged in July must not open on an empty September.
  const initial =
    initialParams ??
    resolveWprParams(
      {
        from: searchParams.get("from") ?? undefined,
        to: searchParams.get("to") ?? undefined,
        view: searchParams.get("view") ?? undefined,
        boqVersion: searchParams.get("boqVersion") ?? undefined,
      },
      { projectStartDate, today }
    );

  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [view, setView] = useState<WprView>(initial.view);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ReportResponse | null>(null);
  // R67 B-09: the sentence itself is a pure function beside the report's own
  // maths, so the number the note quotes and the number the tables exclude can
  // never come from two different definitions of "linked".
  const unlinkedNote = unlinkedEntriesNote(report?.unlinkedEntryCount ?? 0);
  const [sharing, setSharing] = useState(false);
  // Point 11: component state only -- never persisted, never sent to the API.
  const [thirdColumnMode, setThirdColumnMode] = useState<ThirdColumnMode>("total");
  // R36/P5: empty string means "let the server auto-pick the latest,
  // non-superseded BOQ"; a real id means the user chose one explicitly.
  const [selectedBoqId, setSelectedBoqId] = useState<string>("");
  // R67 D-02: the URL carries the BOQ as a VERSION (stable and readable across
  // revisions, and meaningful to a person reading a pasted link) while the API
  // takes an id. Held separately from selectedBoqId so changing the dates
  // afterwards cannot silently drop the chosen BOQ out of a shareable URL.
  const [selectedBoqVersion, setSelectedBoqVersion] = useState<number | null>(initial.boqVersion);
  // The first response is what maps one to the other, so a link that names a
  // version is honoured exactly once, on arrival.
  const wantedBoqVersion = useRef<number | null>(initial.boqVersion);
  // R67 I-05: the Category multi-select. Sent to the server and APPLIED THERE
  // -- never filtered client-side, or the Grand Total would keep describing
  // rows the table is no longer showing.
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  // R67 E-17 (R-175): the run's own state. A spinner cannot tell a slow report
  // from a hung one; a second count can, and after twenty seconds the screen
  // says what it thinks is happening. It does NOT abort -- unlike the Reports
  // panel, which has a faster alternative to send the reader to, this screen IS
  // the fast path, so the choice to keep waiting is the reader's.
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  // R67 E-17: the period is a row of named chips, and "Custom..." is the
  // absence of one. `earliestFrom` is the From the auto-run resolved, so
  // "Since first entry" is that same date rather than a second opinion.
  const [earliestFrom, setEarliestFrom] = useState(initial.from);
  const [customPeriod, setCustomPeriod] = useState(false);
  // R67 E-17: Table | Chart. The chart is a sorted horizontal bar per group
  // with click-to-filter -- never a pie.
  const [output, setOutput] = useState<"table" | "chart">("table");
  /** Set once a share link has been minted, so the expiry can be said in words. */
  const [shareExpiry, setShareExpiry] = useState<string | null>(null);

  const tieError = report ? checkTies(report.rows, report.byCategory, thirdColumnMode, money) : null;

  const runReport = useCallback(
    async (overrides: { from?: string; to?: string; boqId?: string; categories?: string[] } = {}) => {
      const f = overrides.from ?? from;
      const t = overrides.to ?? to;
      const boqId = overrides.boqId ?? selectedBoqId;
      const categories = overrides.categories ?? selectedCategories;
      // A second run supersedes the first rather than racing it.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const params = new URLSearchParams({ projectId, from: f, to: t });
        if (boqId) params.set("boqId", boqId);
        // Repeatable, not comma-joined: a real category name may contain a comma.
        for (const c of categories) params.append("category", c);
        const res = await fetch(`/api/work-progress/report?${params.toString()}`, { signal: controller.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error);
        setReport(data);
        if (!boqId && data.boqId) setSelectedBoqId(data.boqId); // reflect the server's auto-pick back into the dropdown
        // R67 I-05: only ever GROWS the option list. A filtered run legitimately
        // reports fewer categories present, and shrinking the control to match
        // would make it impossible to widen the filter again.
        if (Array.isArray(data.availableCategories)) {
          setAvailableCategories((prev) => [...new Set([...prev, ...data.availableCategories!])].sort());
        }
        // R67 D-02: honour a ?boqVersion= from the URL ONCE, now that the
        // version -> id mapping is known. Cleared before it is used, so a
        // shared link can never loop the screen through repeated runs.
        const wanted = wantedBoqVersion.current;
        wantedBoqVersion.current = null;
        if (wanted !== null) {
          const match = (data.availableBoqs as BoqOption[] | undefined)?.find((b) => b.version === wanted);
          if (match && match.id !== data.boqId) {
            setSelectedBoqId(match.id);
            void runReport({ boqId: match.id });
          }
        } else if (!boqId && data.boqId) {
          // Reflect the server's auto-pick back into the URL as a version, so
          // the link a reader copies names the BOQ they are actually looking at.
          const picked = (data.availableBoqs as BoqOption[] | undefined)?.find((b) => b.id === data.boqId);
          if (picked && selectedBoqVersion === null) setSelectedBoqVersion(picked.version);
        }
      } catch (err) {
        // An abort is the reader's own decision (Cancel, or a second run
        // superseding this one), not a failure to report back at them.
        if (err instanceof DOMException && err.name === "AbortError") return;
        toast.error(err instanceof Error && err.message ? err.message : "Couldn't generate the report");
        setReport(null);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setLoading(false);
        }
      }
    },
    [projectId, from, to, selectedBoqId, selectedCategories]
  );

  /** R67 E-17: Cancel. The request really stops; the last good result stays on screen. */
  function cancelRun() {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }

  // The elapsed-seconds counter, restarted with every run.
  useEffect(() => {
    if (!loading) return;
    const started = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
  }, [loading]);

  // R67 E-03, implementing D-02: THE REPORT RUNS ON ARRIVAL.
  //
  // Correction C-04 recorded that the screen showed "Pick a date range and
  // click Run Report." over a range that was ALREADY FILLED -- three clicks to
  // reach a report the screen already had every parameter for. That prompt no
  // longer exists in this file.
  //
  // Before the first run, when the URL carried no From, the earliest recorded
  // entry date for this project is read and used (see resolveDefaultFrom's own
  // fallback chain) -- so the report opens on the work that exists rather than
  // on a two-day window. The resolved parameters are then written back into the
  // URL, which is what makes the state shareable and Back-able.
  const didAutoRun = useRef(false);
  useEffect(() => {
    if (didAutoRun.current) return;
    didAutoRun.current = true;

    let cancelled = false;
    (async () => {
      let resolvedFrom = from;
      if (!searchParams.get("from")) {
        try {
          const res = await fetch(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`);
          if (res.ok) {
            const data = await res.json();
            const dates: string[] = (data.entries ?? []).map((e: { entryDate: string }) => e.entryDate).filter(Boolean);
            if (dates.length > 0) {
              const earliest = dates.reduce((min, d) => (d < min ? d : min));
              resolvedFrom = resolveEarliest(earliest, projectStartDate, today);
            }
          }
        } catch {
          // A failed lookup is not a failed report: fall through to the
          // already-resolved default rather than refusing to run.
        }
      }
      if (cancelled) return;
      if (resolvedFrom !== from) setFrom(resolvedFrom);
      // R67 E-17: the same date the "Since first entry" chip means, so the chip
      // row and the auto-run can never describe different windows.
      setEarliestFrom(resolvedFrom);
      writeParamsToUrl({ from: resolvedFrom, to, view, boqVersion: selectedBoqVersion });
      await runReport({ from: resolvedFrom });
    })();
    return () => { cancelled = true; };
    // Mount only -- didAutoRun guards a second pass, and every later run goes
    // through the Run Report button or a control that calls runReport itself.
  }, []);

  function resolveEarliest(earliest: string, startDate: string | null, fallbackToday: string): string {
    return earliest || startDate || `${fallbackToday.slice(0, 4)}-01-01`;
  }

  /**
   * The URL is the state. router.replace, not push, on the automatic run: the
   * reader did not navigate, so Back must still leave this screen rather than
   * undoing a parameter they never chose.
   */
  function writeParamsToUrl(next: { from: string; to: string; view: WprView; boqVersion: number | null }, push = false) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "report");
    params.set("projectId", projectId);
    params.set("from", next.from);
    params.set("to", next.to);
    params.set("view", next.view);
    if (next.boqVersion !== null) params.set("boqVersion", String(next.boqVersion)); else params.delete("boqVersion");
    const url = `/work-progress?${params.toString()}`;
    if (push) router.push(url); else router.replace(url);
  }

  const caption = reportCaption({
    from,
    to,
    boqTitle: report?.boqTitle ?? null,
    boqVersionLabel: (() => {
      const chosen = report?.availableBoqs.find((b) => b.id === (selectedBoqId || report?.boqId));
      return chosen ? `v${chosen.version}` : null;
    })(),
    mode: thirdColumnMode,
  });

  const emptyNotice = report ? noProgressNotice(report.rows, from, to) : null;

  /** Which period chip is lit. null means the window matches no preset -- a real state, not a bug. */
  const activePreset: PeriodPreset | null = matchPeriodPreset({ from, to }, { today, earliestFrom });

  /**
   * R67 E-17: the Chart view's bars, one per group of the view on screen, and
   * always the SAME figure the table's third Amount column shows -- a chart
   * that measured something the table beside it does not would be a second
   * report, not a picture of this one.
   */
  const chartTitle =
    view === "manpower" ? "Labour cost by trade"
    : view === "vendor" ? "Labour cost by vendor"
    : `Amount ${thirdColumnMode === "balance" ? "remaining" : "done to date"} by category`;

  const chartBars: SortedBar[] = !report
    ? []
    : view === "manpower"
      ? report.byManpower.map((r) => ({ key: r.trade, label: r.trade, value: r.totalCost, display: money(r.totalCost) }))
      : view === "vendor"
        ? report.byVendor.map((r) => ({ key: r.vendorId, label: r.vendorName, value: r.totalCost, display: money(r.totalCost) }))
        : report.byCategory.map((r) => ({
            key: r.name,
            label: r.name,
            value: r.amt[thirdColumnMode],
            display: money(r.amt[thirdColumnMode]),
          }));

  // R42 seq24 (REPORT.GLOBAL "EXPORT XLSX -- raw rows so a QS can check the
  // arithmetic himself... a TRUST FEATURE"): a real CSV rather than a binary
  // .xlsx -- Excel opens CSV natively and every value is checkable. R67 E-03
  // adds the caption as the FIRST LINE, so an exported file can never be
  // mistaken for a different range or a different BOQ revision.
  function exportCsv() {
    if (!report) return;
    const lines = [
      caption,
      ["S.No", "Category", "Code", "Description", "PO Qty", "Unit", "Rate", "Amt", "% Prev", "% Current", `% ${thirdColumnMode === "balance" ? "Balance" : "Total"}`, "Qty Prev", "Qty Current", "Qty Third", "Amt Prev", "Amt Current", "Amt Third"].join(","),
      ...report.rows.map((r, i) => [
        i + 1, `"${r.categoryName}"`, r.code ?? "", `"${r.description}"`, r.qtyTotal, r.unit, r.rate,
        r.amtTotal, r.parentLineItemId ? "" : r.percentage.prev, r.parentLineItemId ? "" : r.percentage.current, r.parentLineItemId ? "" : r.percentage[thirdColumnMode],
        r.qty.prev, r.qty.current, r.qty[thirdColumnMode], r.amt.prev, r.amt.current, r.amt[thirdColumnMode],
      ].join(",")),
      ["", "", "", "Grand Total", "", "", "", tieError ? "" : String(computeGrandTotal(report.rows, thirdColumnMode).amtTotal)].join(","),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `wpr-${projectId}-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * R67 E-03 (R-077): the PDF has existed end to end since #1314 --
   * compliance-tracker generateWorkProgressReportPdf, its own route, and the
   * projexa relay -- and no button called it. This is that button. PROJEXA has
   * no PDF library and must not gain one; the relay streams the bytes.
   */
  function pdfHref() {
    return `/api/work-progress/report/pdf?projectId=${encodeURIComponent(projectId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&mode=${thirdColumnMode}`;
  }

  /**
   * R67 E-18 (R-178) / E-20 (R-208): the XLSX, over VERIDIAN's own
   * rowsToXLSXBuffer and its formula-injection guard, built from the SAME
   * ReportExportSchema the PDF is drawn from. PROJEXA gains no XLSX library.
   */
  function xlsxHref() {
    return `/api/work-progress/report/xlsx?projectId=${encodeURIComponent(projectId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&mode=${thirdColumnMode}`;
  }

  async function createShareLink(): Promise<{ url: string; expiresAt: string } | null> {
    const res = await fetch("/api/work-progress/report/share", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, from, to }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error);
    return data;
  }

  // R67 A-20. The composer's "Export CSV" card is a verb and the FILE is the
  // whole point of it, so the card navigates here with ?tab=report&export=csv
  // and the export happens once the report has actually arrived. Landing the
  // reader on an empty report with an export button that can do nothing until
  // they press Run would be the same "card that is really a place" this
  // programme is removing.
  //
  // ONCE, and never over a report that does not add up: the tie check is the
  // same one that disables the button, and an export of a report that does not
  // add up is worse than no export. When the check fails the tie-error card is
  // already on screen saying why.
  const autoExportRequested = searchParams.get("export") === "csv";
  const autoExportedRef = useRef(false);
  useEffect(() => {
    if (!autoExportRequested || autoExportedRef.current) return;
    if (!report || tieError) return;
    autoExportedRef.current = true;
    exportCsv();
  }, [autoExportRequested, report, tieError]);

  // Point 118: a plain, expiring, read-only link -- NOT the WhatsApp Business
  // API (explicitly ruled out). One factory, handed to the shared control, so
  // Copy link and Send via WhatsApp mint the SAME link rather than two.
  async function shareUrlFactory(): Promise<string | null> {
    setSharing(true);
    try {
      const data = await createShareLink();
      if (!data) return null;
      // The expiry is part of what the reader is handing over, so it is said
      // rather than left to be discovered when the link stops working.
      setShareExpiry(formatDate(data.expiresAt));
      return data.url;
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create a share link");
      return null;
    } finally {
      setSharing(false);
    }
  }

  // Every header action carries its own reason when it cannot be used, beside
  // the button, in words -- never a disabled control with no explanation.
  const notRunYet = !report ? "Run the report first" : null;
  const exportReason = notRunYet ?? (tieError ? "Totals do not tie – export disabled" : null);

  return (
    <div className="space-y-4">
      <Card className="shadow-card">
        <CardContent className="space-y-3 p-4">
          {/* R67 E-17 (R-175): the period, as NAMED CHIPS with one preselected.
              Two bare date inputs made a reader do the arithmetic to work out
              which window they were looking at; a lit chip says it. "Custom..."
              is the absence of a preset, not a fifth one, so a shared link with
              a hand-typed window lights nothing and reveals the two fields. */}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period" data-testid="wpr-period-chips">
            <span className="text-[12.5px] text-px-muted">Period</span>
            {PERIOD_PRESETS.map((preset) => {
              const active = !customPeriod && activePreset === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={active}
                  data-testid={`wpr-period-${preset}`}
                  onClick={() => {
                    const range = periodPresetRange(preset, { today, earliestFrom });
                    setCustomPeriod(false);
                    setFrom(range.from);
                    setTo(range.to);
                    writeParamsToUrl({ from: range.from, to: range.to, view, boqVersion: selectedBoqVersion });
                    runReport({ from: range.from, to: range.to });
                  }}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-[12px] transition-colors ${
                    active ? "border-px-teal bg-px-teal/10 text-px-ink" : "border-px-border text-px-muted hover:bg-px-cloud/50"
                  }`}
                >
                  {PERIOD_PRESET_LABELS[preset]}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={customPeriod || activePreset === null}
              data-testid="wpr-period-custom"
              onClick={() => setCustomPeriod(true)}
              className={`cursor-pointer rounded-full border px-3 py-1 text-[12px] transition-colors ${
                customPeriod || activePreset === null
                  ? "border-px-teal bg-px-teal/10 text-px-ink"
                  : "border-px-border text-px-muted hover:bg-px-cloud/50"
              }`}
            >
              {CUSTOM_PERIOD_LABEL}
            </button>
          </div>

          {/* The two date fields, revealed by Custom... (or by a URL whose
              window matches no preset), never sitting there by default. */}
          {(customPeriod || activePreset === null) && (
            <div className="flex flex-wrap items-end gap-3" data-testid="wpr-custom-dates">
              <div className="space-y-1.5"><Label htmlFor="wpr-from">From</Label><Input id="wpr-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="wpr-to">To</Label><Input id="wpr-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
          <Button
            onClick={() => { writeParamsToUrl({ from, to, view, boqVersion: selectedBoqVersion }, true); runReport(); }}
            disabled={loading}
            data-testid="work-progress-report-run"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run Report
          </Button>

          {/* R67 E-18 (R-178): ONE Export / Share control, the same one the
              Materials Cost Report, the Cost Variance screen and the Design
              Studio use. Five separate header buttons became two word-buttons
              with menus; PDF and XLSX are relay hrefs (PROJEXA has no PDF or
              XLSX library), and the CSV is still built here from the rows on
              screen, which is the trust feature it always was. */}
          <ExportShareActions
            canExport={!exportReason}
            exportReason={exportReason}
            title={`Work Progress Report – ${projectName}, ${from} to ${to}`}
            pdfHref={pdfHref()}
            xlsxHref={xlsxHref()}
            onCsv={exportCsv}
            shareUrlFactory={shareUrlFactory}
            shareReason={sharing ? "Creating the link..." : null}
            onMessage={(m) => toast.success(m)}
          />

          {shareExpiry && (
            <span className="text-xs text-px-muted" data-testid="wpr-share-expiry">Link expires {shareExpiry}</span>
          )}

          {report && report.availableBoqs.length > 1 && (
            <div className="space-y-1.5">
              <Label>BOQ</Label>
              <Select
                value={selectedBoqId || report.boqId || ""}
                onValueChange={(v) => {
                  setSelectedBoqId(v);
                  // The control is keyed by id (what the API takes); the URL
                  // carries that BOQ's version (what a person can read).
                  const chosen = report?.availableBoqs.find((b) => b.id === v)?.version ?? null;
                  setSelectedBoqVersion(chosen);
                  writeParamsToUrl({ from, to, view, boqVersion: chosen });
                  runReport({ boqId: v });
                }}
              >
                {/* R67 E-03: w-80, not w-56 -- a real BOQ title plus its
                    revision did not fit and was silently truncated with no way
                    to read the rest. The title attribute carries the full text
                    for the case where even this is not wide enough. */}
                <SelectTrigger
                  className="w-80"
                  data-testid="boq-selector"
                  title={report.availableBoqs.find((b) => b.id === (selectedBoqId || report.boqId))?.title ?? undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {report.availableBoqs.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.title} (v{b.version}{b.status === "superseded" ? ", superseded" : ""})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <CategoryFilterGroup
            available={availableCategories}
            selected={selectedCategories}
            disabled={loading}
            onToggle={(name, checked) =>
              setSelectedCategories((prev) => (checked ? [...prev, name] : prev.filter((x) => x !== name)))
            }
            onApply={() => runReport({ categories: selectedCategories })}
          />
          {report && (
            <div className="space-y-1.5">
              <Label>Third column</Label>
              <Select value={thirdColumnMode} onValueChange={(v) => setThirdColumnMode(v as ThirdColumnMode)}>
                <SelectTrigger className="w-36" data-testid="third-column-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="total">Total</SelectItem>
                  <SelectItem value="balance">Balance</SelectItem>
                </SelectContent>
              </Select>
              {/* A SENTENCE, not a tooltip: a tooltip cannot be read on a
                  printout, on a phone, or by someone who does not know to
                  hover. */}
              <p className="text-[12px] text-px-muted" data-testid="third-column-note">{THIRD_COLUMN_NOTE}</p>
            </div>
          )}
          </div>
        </CardContent>
      </Card>

      {/* R42 seq24 (REPORT.GLOBAL): "IF THE SUBTOTALS DO NOT SUM TO THE GRAND
          TOTAL THE REPORT IS WRONG AND MUST SAY SO LOUDLY, not render anyway."
          Shown, not hidden -- the tables below still render (a QS still needs
          to see the numbers to find the bug), only export is blocked. */}
      {tieError && (
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-4 text-sm text-px-error" data-testid="tie-error">{tieError}</CardContent>
        </Card>
      )}

      <Card className="shadow-card">
        <CardContent className="space-y-3 p-4">
          {/* The caption sits above the table and is the first line of the CSV
              and the PDF -- one sentence, three facts, so no exported file can
              be mistaken for a different range or revision. */}
          <p className="text-[12.5px] text-px-muted" data-testid="wpr-caption">{caption}</p>
          {/* R67 E-20 (R-194): the grey period line that replaced the idle
              prompt -- the window in words, with the preset it corresponds to
              named, and a way to change it that is not a hunt. */}
          <p className="text-[12px] text-px-muted" data-testid="wpr-period-line">
            {periodLine({ from, to }, { today, earliestFrom })}
            {" — "}
            <button
              type="button"
              className="cursor-pointer underline"
              data-testid="wpr-change-dates"
              onClick={() => setCustomPeriod(true)}
            >
              Change dates
            </button>
          </p>

          {emptyNotice && (
            <p className="text-sm" style={{ color: "var(--status-late-text)" }} data-testid="wpr-no-progress">
              {emptyNotice}
            </p>
          )}

          {loading ? (
            <div className="space-y-3">
              {/* R67 E-17 (R-175): the run's own state, said in words and
                  counted in seconds, with a Cancel that really aborts. */}
              <div className="space-y-1 text-center" data-testid="wpr-running">
                <p className="text-sm text-px-ink">{wprRunningLine(elapsed)}</p>
                {elapsed * 1000 >= WPR_STILL_RUNNING_MS && (
                  <p className="text-[12px] text-px-muted" data-testid="wpr-still-running">{WPR_STILL_RUNNING_NOTE}</p>
                )}
                <Button variant="ghost" size="sm" onClick={cancelRun} data-testid="wpr-cancel">Cancel</Button>
              </div>
              <ReportSkeleton />
            </div>
          ) : !report ? (
            // Not an idle prompt -- the report runs on arrival, so the only way
            // to be here is a failed run, and the toast above said why.
            <p className="py-10 text-center text-sm text-px-muted">Couldn&apos;t generate this report. Press Run Report to try again.</p>
          ) : (
            <Tabs
              value={view}
              onValueChange={(v) => { const next = v as WprView; setView(next); writeParamsToUrl({ from, to, view: next, boqVersion: selectedBoqVersion }); }}
              className="space-y-4"
            >
              {/* R67 B-09: this report has always silently DROPPED an entry
                  that no BOQ line can claim. On a project without a BOQ that
                  is the whole day's work, and the site engineer sees a total
                  they know is short with nothing to explain it. Now it says
                  so, above the table, before anyone reads a number. */}
              {unlinkedNote && (
                <p
                  className="rounded-md border border-px-warning-border bg-px-warning-light px-3 py-2 text-[12.5px] text-px-warning"
                  data-testid="work-progress-report-unlinked-note"
                >
                  {unlinkedNote}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TabsList>
                  <TabsTrigger value="scope">Scope-wise</TabsTrigger>
                  <TabsTrigger value="category">Category-wise</TabsTrigger>
                  <TabsTrigger value="manpower">Manpower-wise</TabsTrigger>
                  <TabsTrigger value="vendor">Vendor-wise</TabsTrigger>
                </TabsList>
                {/* R67 E-17 (R-175): Table | Chart. The chart is a sorted
                    horizontal bar per group with click-to-filter -- never a
                    pie; see reports/SortedBarList.tsx for why. */}
                <div className="flex gap-1" role="group" aria-label="Output" data-testid="wpr-output-toggle">
                  {(["table", "chart"] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      aria-pressed={output === o}
                      data-testid={`wpr-output-${o}`}
                      onClick={() => setOutput(o)}
                      className={`cursor-pointer rounded-md border px-3 py-1 text-[12px] transition-colors ${
                        output === o ? "border-px-teal bg-px-teal/10 text-px-ink" : "border-px-border text-px-muted hover:bg-px-cloud/50"
                      }`}
                    >
                      {o === "table" ? "Table" : "Chart"}
                    </button>
                  ))}
                </div>
              </div>
              {output === "chart" ? (
                <SortedBarList
                  bars={chartBars}
                  title={chartTitle}
                  emptyMessage="Nothing to chart for this view and period."
                  // Click-to-filter only where there is a filter to apply: the
                  // Category multi-select is the report's only real one, so a
                  // bar in any other view would be a dead click.
                  onSelect={
                    view === "category" || view === "scope"
                      ? (key) => { setSelectedCategories([key]); runReport({ categories: [key] }); }
                      : undefined
                  }
                  selectedKey={selectedCategories.length === 1 ? selectedCategories[0] : null}
                />
              ) : (
                <>
                  <TabsContent value="scope"><ScopeTable rows={report.rows} mode={thirdColumnMode} projectId={projectId} boqId={selectedBoqId || report.boqId} from={from} to={to} money={money} /></TabsContent>
                  <TabsContent value="category"><CategoryTable rows={report.byCategory} mode={thirdColumnMode} projectId={projectId} money={money} /></TabsContent>
                  <TabsContent value="manpower"><ManpowerTable rows={report.byManpower} money={money} /></TabsContent>
                  <TabsContent value="vendor"><VendorTable rows={report.byVendor} money={money} /></TabsContent>
                </>
              )}
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* R67 G-05: said once, at the foot -- explains the warning glyph on
          every unlabelled figure above, and renders nothing when a currency
          is set. */}
      <CurrencyNotSetNotice currencySet={orgMoney.currencySet} loaded={orgMoney.loaded} />
    </div>
  );
}