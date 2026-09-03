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
import { Loader2, Play, Link2, Download, FileText, MessageCircle } from "lucide-react";
import { formatDate } from "@/lib/format-date";
import { formatDecimal } from "@/lib/format-number";
import { formatProgressCell } from "@/lib/work-progress-report";
import { useOrgMoney } from "@/lib/use-org-money";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import {
  isoDay,
  noProgressNotice,
  reportCaption,
  resolveReportParams,
  THIRD_COLUMN_NOTE,
  whatsappHref,
  whatsappMessage,
  type ReportView,
  type ThirdColumnMode,
} from "@/lib/work-progress-report-params";

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

/** Percentages get ONE decimal, down the whole column, so the column aligns on the point. */
function percentText(n: number) {
  return `${n.toFixed(1)}%`;
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

export function ScopeTable({
  rows,
  mode,
  projectId,
  money = formatDecimal,
}: {
  rows: LineItemRow[];
  mode: ThirdColumnMode;
  projectId: string;
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
                  {r.code ? <Link href={`/scope?projectId=${projectId}`} className="text-px-ink underline">{r.code}</Link> : "—"}
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

export default function WorkProgressReportClient({
  projectId,
  projectName = "this project",
  projectStartDate = null,
}: {
  projectId: string;
  projectName?: string;
  /** Optional: the third step of the From fallback chain. Absent today (the org dashboard payload carries no start date), so an entry-less project falls through to 1 January. */
  projectStartDate?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgMoney = useOrgMoney();
  const money = useCallback((n: number) => orgMoney.money(n), [orgMoney]);

  const today = isoDay(new Date());
  const initial = resolveReportParams(searchParams, { projectStartDate, today });

  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [view, setView] = useState<ReportView>(initial.view);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [sharing, setSharing] = useState(false);
  // Point 11: component state only -- never persisted, never sent to the API.
  const [thirdColumnMode, setThirdColumnMode] = useState<ThirdColumnMode>("total");
  // R36/P5: empty string means "let the server auto-pick the latest,
  // non-superseded BOQ"; a real id means the user chose one explicitly.
  const [selectedBoqId, setSelectedBoqId] = useState<string>(initial.boqVersion);
  // R67 I-05: the Category multi-select. Sent to the server and APPLIED THERE
  // -- never filtered client-side, or the Grand Total would keep describing
  // rows the table is no longer showing.
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  const tieError = report ? checkTies(report.rows, report.byCategory, thirdColumnMode, money) : null;

  const runReport = useCallback(
    async (overrides: { from?: string; to?: string; boqId?: string; categories?: string[] } = {}) => {
      const f = overrides.from ?? from;
      const t = overrides.to ?? to;
      const boqId = overrides.boqId ?? selectedBoqId;
      const categories = overrides.categories ?? selectedCategories;
      setLoading(true);
      try {
        const params = new URLSearchParams({ projectId, from: f, to: t });
        if (boqId) params.set("boqId", boqId);
        // Repeatable, not comma-joined: a real category name may contain a comma.
        for (const c of categories) params.append("category", c);
        const res = await fetch(`/api/work-progress/report?${params.toString()}`);
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
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : "Couldn't generate the report");
        setReport(null);
      } finally {
        setLoading(false);
      }
    },
    [projectId, from, to, selectedBoqId, selectedCategories]
  );

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
      writeParamsToUrl({ from: resolvedFrom, to, view, boqVersion: selectedBoqId });
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
  function writeParamsToUrl(next: { from: string; to: string; view: ReportView; boqVersion: string }, push = false) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "report");
    params.set("projectId", projectId);
    params.set("from", next.from);
    params.set("to", next.to);
    params.set("view", next.view);
    if (next.boqVersion) params.set("boqVersion", next.boqVersion); else params.delete("boqVersion");
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

  async function createShareLink(): Promise<{ url: string; expiresAt: string } | null> {
    const res = await fetch("/api/work-progress/report/share", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, from, to }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error);
    return data;
  }

  // Point 118: a plain, expiring, read-only link -- NOT the WhatsApp Business
  // API (explicitly ruled out).
  async function copyLink() {
    setSharing(true);
    try {
      const data = await createShareLink();
      if (!data) return;
      await navigator.clipboard.writeText(data.url);
      toast.success(`Link copied — paste it into WhatsApp or email. Expires ${formatDate(data.expiresAt)}.`);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create a share link");
    } finally {
      setSharing(false);
    }
  }

  async function sendOnWhatsApp() {
    setSharing(true);
    try {
      const data = await createShareLink();
      if (!data) return;
      const message = whatsappMessage({ projectName, from, to, url: data.url });
      // On a device that can share a FILE, send the real PDF -- a link that
      // expires is second best when the recipient can be handed the document
      // itself. Everywhere else, wa.me with the message and the link.
      const canShareFiles = typeof navigator !== "undefined" && typeof navigator.canShare === "function";
      if (canShareFiles) {
        try {
          const pdfRes = await fetch(pdfHref());
          if (pdfRes.ok) {
            const blob = await pdfRes.blob();
            const file = new File([blob], `work-progress-report-${from}-to-${to}.pdf`, { type: "application/pdf" });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], text: message, title: "Work Progress Report" });
              return;
            }
          }
        } catch {
          // Sharing the file is the nicer path, not the required one -- fall
          // through to the link rather than failing the whole action.
        }
      }
      window.open(whatsappHref(message), "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create a share link");
    } finally {
      setSharing(false);
    }
  }

  // Every header action carries its own reason when it cannot be used, beside
  // the button, in words -- never a disabled control with no explanation.
  const notRunYet = !report ? "Run the report first" : null;
  const exportReason = notRunYet ?? tieError;

  return (
    <div className="space-y-4">
      <Card className="shadow-card">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5"><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>

          {/* Header order, per the item: Run Report | Export PDF | Export CSV |
              Send on WhatsApp | Copy link. */}
          <Button
            onClick={() => { writeParamsToUrl({ from, to, view, boqVersion: selectedBoqId }, true); runReport(); }}
            disabled={loading}
            data-testid="work-progress-report-run"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run Report
          </Button>

          <Button
            variant="outline"
            disabled={Boolean(exportReason)}
            title={exportReason ?? undefined}
            data-testid="export-pdf"
            onClick={() => window.open(pdfHref(), "_blank", "noopener")}
          >
            <FileText className="size-4" /> Export PDF
          </Button>

          <Button variant="outline" disabled={Boolean(exportReason)} title={exportReason ?? undefined} data-testid="export-csv" onClick={exportCsv}>
            <Download className="size-4" /> Export CSV
          </Button>

          <Button variant="outline" disabled={Boolean(exportReason) || sharing} title={exportReason ?? undefined} data-testid="send-whatsapp" onClick={sendOnWhatsApp}>
            {sharing ? <Loader2 className="size-4 animate-spin" /> : <MessageCircle className="size-4" />} Send on WhatsApp
          </Button>

          <Button variant="outline" disabled={Boolean(exportReason) || sharing} title={exportReason ?? undefined} data-testid="copy-link" onClick={copyLink}>
            {sharing ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} Copy link
          </Button>

          {exportReason && <span className="text-xs text-px-muted" data-testid="export-disabled-reason">{exportReason}</span>}

          {report && report.availableBoqs.length > 1 && (
            <div className="space-y-1.5">
              <Label>BOQ</Label>
              <Select
                value={selectedBoqId || report.boqId || ""}
                onValueChange={(v) => { setSelectedBoqId(v); writeParamsToUrl({ from, to, view, boqVersion: v }); runReport({ boqId: v }); }}
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

          {emptyNotice && (
            <p className="text-sm" style={{ color: "var(--status-late-text)" }} data-testid="wpr-no-progress">
              {emptyNotice}
            </p>
          )}

          {loading ? (
            <ReportSkeleton />
          ) : !report ? (
            // Not an idle prompt -- the report runs on arrival, so the only way
            // to be here is a failed run, and the toast above said why.
            <p className="py-10 text-center text-sm text-px-muted">Couldn&apos;t generate this report. Press Run Report to try again.</p>
          ) : (
            <Tabs
              value={view}
              onValueChange={(v) => { const next = v as ReportView; setView(next); writeParamsToUrl({ from, to, view: next, boqVersion: selectedBoqId }); }}
              className="space-y-4"
            >
              <TabsList>
                <TabsTrigger value="scope">Scope-wise</TabsTrigger>
                <TabsTrigger value="category">Category-wise</TabsTrigger>
                <TabsTrigger value="manpower">Manpower-wise</TabsTrigger>
                <TabsTrigger value="vendor">Vendor-wise</TabsTrigger>
              </TabsList>
              <TabsContent value="scope"><ScopeTable rows={report.rows} mode={thirdColumnMode} projectId={projectId} money={money} /></TabsContent>
              <TabsContent value="category"><CategoryTable rows={report.byCategory} mode={thirdColumnMode} projectId={projectId} money={money} /></TabsContent>
              <TabsContent value="manpower"><ManpowerTable rows={report.byManpower} money={money} /></TabsContent>
              <TabsContent value="vendor"><VendorTable rows={report.byVendor} money={money} /></TabsContent>
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
