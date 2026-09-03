"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Play } from "lucide-react";
import { formatDate, formatTime } from "@/lib/format-date";
import { formatDecimal } from "@/lib/format-number";
import { timeoutSentence, useTimedRun } from "@/lib/use-timed-run";
import { ProjexaReportScreen } from "@/components/screens/ProjexaReportScreen";
import { formatProgressCell } from "@/lib/work-progress-report";

// Point 11 (Rajat, 21 Aug: "SHOW BOTH TOTAL AND BALANCE, USER CHOOSES"):
// the third column of every band can read either total (previous +
// current) or balance (original - total) -- both legitimate, neither
// persisted, chosen here in component state only.
export type ThirdColumnMode = "total" | "balance";

export type LineItemRow = {
  lineItemId: string; code: string; description: string; categoryName: string; unit: string; rate: number;
  qtyTotal: number; amtTotal: number;
  // Point 108: which line this is a hierarchical BOQ child of, if any --
  // WPR-06 says percentages are PARENT-only, so this decides whether the
  // percent band renders blank for this row (a child) or real numbers
  // (a parent -- including a childless standalone line, which is a parent
  // of nothing but still not anyone's own child).
  parentLineItemId: string | null;
  qty: { prev: number; current: number; total: number; balance: number };
  amt: { prev: number; current: number; total: number; balance: number };
  percentage: { prev: number; current: number; total: number; balance: number };
  // T-WPR-14-1 / Point 111 (WPR-14): whether ANY progress entry contributed
  // to each bucket -- see work-progress-report.ts's own LineItemProgress
  // comment, which is where this is actually computed. money() alone can't
  // tell a real computed zero (dash) from a bucket nothing has ever touched
  // (blank) -- both are the JS number 0. Always present on the real API
  // response (buildWorkProgressReport -> computeLineItemProgress populates
  // it unconditionally); required here, not optional, so a test fixture
  // that omits it is a type error, not a silent blank/zero mismatch.
  touched: { prev: boolean; current: boolean; total: boolean };
};
type CategoryRow = { name: string; amtTotal: number; amt: { prev: number; current: number; total: number; balance: number }; percentage: { prev: number; current: number; total: number; balance: number } };
type ManpowerRow = { trade: string; workerDays: number; totalCost: number };
type VendorRow = { vendorId: string; vendorName: string; totalCost: number };

// R36/P5 (B5 decision): additive fields so an existing consumer that
// doesn't know about them still works exactly as before.
type BoqOption = { id: string; title: string; status: string; version: number };
// R67 I-05: availableCategories/categoryFilter are additive -- an older
// response without them still renders, the multi-select just has nothing to
// offer until the first run comes back.
// R67 E-28: `from`/`to` are the range the SERVER really ran -- `from` may have
// been defaulted there from the project's earliest progress entry, so the
// screen shows what happened rather than what it asked for.
type ReportResponse = {
  boqTitle: string | null; boqId: string | null; availableBoqs: BoqOption[];
  rows: LineItemRow[]; byCategory: CategoryRow[]; byManpower: ManpowerRow[]; byVendor: VendorRow[];
  availableCategories?: string[]; categoryFilter?: string[];
  from?: string; to?: string; earliestEntryDate?: string | null; fromWasDefaulted?: boolean;
};

// R67 G-05 (R-260). This passed `undefined` as the locale, which is the
// hydration bug src/lib/format-date.ts exists to prevent: with no locale
// argument the runtime picks its OWN default, so the SSR pass formats in the
// server's locale and the first client pass in the visitor's, and for any
// non-en-US visitor (this app ships a real "hi" locale, whose digit grouping
// is the Indian numbering system) the two strings differ and React reports a
// mismatch. formatDecimal() pins it.
//
// Deliberately formatDecimal and NOT formatMoney: this one helper renders
// both the Quantity band and the Amount band of the same grid, so a quantity
// of 50 must stay "50" rather than becoming "50.00", and no cell may carry a
// currency prefix. The currency belongs in the band header -- see the note on
// ScopeTable, which takes no currency prop today.
function money(n: number) {
  return formatDecimal(n);
}

// T-WPR-14-1 (WPR-14, point 111): money() alone renders every Qty/Amt cell
// as a plain formatted number, so a real computed zero (e.g. a line that is
// fully complete, balance = 0) and a bucket with NO progress entry in this
// window at all (both the JS number 0 today) were visually identical --
// exactly the bug this test caught. formatProgressCell (work-progress-
// report.ts) is the canonical (value, touched) -> "" / "-" / real-number
// rule; this just layers this table's own money() thousands-formatting on
// top of its real-number case, so a genuine value still reads "20,833.20"
// rather than an unformatted raw number. NOT used for the Percent band --
// WPR-06 already gives percent cells their own, deliberately different,
// parent-only blanking rule (isChild below / formatParentOnlyPercent on the
// share page), unrelated to whether a bucket was ever touched.
function moneyCell(value: number, touched: boolean): string {
  const cell = formatProgressCell(value, touched);
  return typeof cell === "number" ? money(cell) : cell;
}

// Point 108 (Rajat, 21 Aug: "FOLLOW THE XLSX ORDER, not the handwritten
// page" -- the xlsx is the EXECUTED artefact, what his team actually fills
// in): S.No | Category | Code | Description | Unit | Rate | Amt (identifying
// columns, unchanged), then THREE bands in XLSX order -- Percent, then
// Quantity, then Amount -- each Previous | Current | Total-or-Balance
// (point 11's toggle), visually separated so a reader sees three groups,
// not nine undifferentiated columns. WPR-06: percentages are PARENT rows
// only -- a row with a parentLineItemId (a hierarchical BOQ child) renders
// blank percent cells, not 0.00 and not a number.
const bandBorder = "border-l-2 border-px-border";

// R42 seq24 (REPORT.GLOBAL): the arithmetic identity this report must hold
// -- GROUP SUBTOTALS (here, byCategory) and a GRAND TOTAL that ties. Parent
// rows carry the real BoQ contract value (D-3: parent-lines-only); child
// rows' own amtTotal is a separate, informational figure (see
// applyWeightedParentRollup's own comment -- it is NOT a portion carved out
// of the parent's amtTotal), so the "Amt" grand total sums PARENT rows
// only, matching earnedValueReport()'s own contractValue convention
// exactly (never a second summation rule). The Amount-band totals
// (Previous/Current/Total-or-Balance = progress-to-date, in AED) are safe
// to sum over every row by that same comment's own construction.
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

// Tie check: byCategory groups the SAME rows this table renders (rollupBy
// in work-progress-report.ts) -- its own amt-band sums must equal this
// table's own sums of the identical rows. A mismatch means a row silently
// fell outside every category group (a real, on-paper B-3-shaped defect),
// not a rounding artefact -- REPORT.GLOBAL: "the report is wrong and MUST
// SAY SO LOUDLY, not render anyway."
function checkTies(rows: LineItemRow[], byCategory: CategoryRow[], mode: ThirdColumnMode): string | null {
  const grand = computeGrandTotal(rows, mode);
  const categorySum = byCategory.reduce((s, c) => s + c.amt[mode], 0);
  const diff = Math.abs(grand.amt.third - categorySum);
  if (diff > 0.01) {
    return `Category subtotals (${money(categorySum)}) do not sum to the grand total (${money(grand.amt.third)}) -- a row is missing from a category group. Export is disabled until this is fixed.`;
  }
  return null;
}

// R67 I-05 (R-177): the Category multi-select on the parameter bar.
//
// Checkboxes, not a shadcn Select -- Select is single-value, and a fake "multi"
// built on it would silently drop every choice but the last. Nothing is
// filtered until Apply: re-running on every checkbox click would fire a report
// request per keystroke-equivalent. "All categories" is what the EMPTY
// selection is called, stated in words, so an empty control never reads as
// "nothing matches" -- that wording is load-bearing and is pinned by a test.
//
// Exported and purely presentational (props in, callbacks out, no state and no
// fetching of its own) for the same reason ScopeTable above is: it is the only
// way this file's markup gets a real test in this repo, where the DOM-backed
// test runner is unavailable and components are asserted through
// renderToStaticMarkup. Renders nothing at all when the report has surfaced no
// categories, so a project whose BOQ has none never shows an empty filter box.
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

// R67 E-28 (R-244): the first three identifying columns stay put while the
// nine-column amount group scrolls, so a QS reading the Amount band at 1440 px
// can still see which line they are on. `sticky` needs an opaque background or
// the scrolled cells show through it.
const stickyCol = "sticky bg-white";

export function ScopeTable({ rows, mode, projectId, boqId }: { rows: LineItemRow[]; mode: ThirdColumnMode; projectId: string; boqId?: string | null }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">No BoQ line items for this project yet.</p>;
  const thirdLabel = mode === "balance" ? "Balance" : "Total";
  const grand = computeGrandTotal(rows, mode);
  // R67 E-28: the code links to the BOQ REVISION it belongs to, when the
  // report knows which one it ran against -- /scope/[id] is the real page for
  // that revision. Falls back to the project's BOQ list when it does not.
  const codeHref = boqId ? `/scope/${boqId}` : `/scope?projectId=${projectId}`;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead rowSpan={2} className={`${stickyCol} left-0`}>S.No</TableHead><TableHead rowSpan={2} className={`${stickyCol} left-12`}>Category</TableHead>
          <TableHead rowSpan={2} className={`${stickyCol} left-40`}>Code</TableHead><TableHead rowSpan={2}>Description</TableHead>
          <TableHead rowSpan={2}>Unit</TableHead><TableHead rowSpan={2}>BOQ Qty</TableHead><TableHead rowSpan={2}>Rate</TableHead><TableHead rowSpan={2}>Amt</TableHead>
          <TableHead colSpan={3} className={`text-center ${bandBorder}`}>Percent</TableHead>
          <TableHead colSpan={3} className={`text-center ${bandBorder}`}>Quantity</TableHead>
          <TableHead colSpan={3} className={`text-center ${bandBorder}`}>Amount</TableHead>
        </TableRow>
        <TableRow>
          <TableHead className={bandBorder}>Previous</TableHead><TableHead>Current</TableHead><TableHead>{thirdLabel}</TableHead>
          <TableHead className={bandBorder}>Previous</TableHead><TableHead>Current</TableHead><TableHead>{thirdLabel}</TableHead>
          <TableHead className={bandBorder}>Previous</TableHead><TableHead>Current</TableHead><TableHead>{thirdLabel}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => {
          const isChild = !!r.parentLineItemId; // WPR-06: percentages are parent-only
          return (
            <TableRow key={r.lineItemId}>
              <TableCell className={`${stickyCol} left-0`}>{i + 1}</TableCell><TableCell className={`${stickyCol} left-12`}>{r.categoryName}</TableCell>
              {/* R42 seq24: every item code is a hyperlink to its BOQ (REPORT.GLOBAL) -- ScopeClient is the real, live screen for that line (no BOQ-line OBJECT screen exists; see this seq's own screen_spec finding). */}
              <TableCell className={`${stickyCol} left-40 font-mono text-xs`}>
                {r.code ? <Link href={codeHref} className="text-px-ink underline">{r.code}</Link> : "—"}
              </TableCell>
              <TableCell>{r.description}</TableCell>
              <TableCell>{r.unit}</TableCell><TableCell>{money(r.qtyTotal)}</TableCell><TableCell>{money(r.rate)}</TableCell><TableCell>{money(r.amtTotal)}</TableCell>

              <TableCell className={bandBorder} data-testid="pct-prev">{isChild ? "" : `${r.percentage.prev}%`}</TableCell>
              <TableCell data-testid="pct-current">{isChild ? "" : `${r.percentage.current}%`}</TableCell>
              <TableCell data-testid="pct-third">{isChild ? "" : `${r.percentage[mode]}%`}</TableCell>

              {/* T-WPR-14-1: third-column mode toggles between "total" and
                  "balance", but touched only tracks prev/current/total (see
                  the type's own comment) -- balance is algebraically total's
                  own complement (qtyTotal/amtTotal - total), so it is a real
                  computed figure exactly when total is, and touched.total is
                  the correct signal for it in either mode. */}
              <TableCell className={bandBorder} data-testid="qty-prev">{moneyCell(r.qty.prev, r.touched.prev)}</TableCell>
              <TableCell data-testid="qty-current">{moneyCell(r.qty.current, r.touched.current)}</TableCell>
              <TableCell data-testid="qty-third">{moneyCell(r.qty[mode], r.touched.total)}</TableCell>

              <TableCell className={bandBorder} data-testid="amt-prev">{moneyCell(r.amt.prev, r.touched.prev)}</TableCell>
              <TableCell data-testid="amt-current">{moneyCell(r.amt.current, r.touched.current)}</TableCell>
              <TableCell data-testid="amt-third">{moneyCell(r.amt[mode], r.touched.total)}</TableCell>
            </TableRow>
          );
        })}
        {/* R42 seq24: GRAND TOTAL, always visible, never requiring a scroll (REPORT.GLOBAL). */}
        <TableRow className="font-semibold border-t-2 border-px-border" data-testid="grand-total-row">
          <TableCell colSpan={7}>Grand Total</TableCell>
          <TableCell>{money(grand.amtTotal)}</TableCell>
          <TableCell className={bandBorder} />
          <TableCell /><TableCell />
          <TableCell className={bandBorder} />
          <TableCell /><TableCell />
          <TableCell className={bandBorder}>{money(grand.amt.prev)}</TableCell>
          <TableCell>{money(grand.amt.current)}</TableCell>
          <TableCell data-testid="grand-total-amount">{money(grand.amt.third)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function CategoryTable({ rows, mode, projectId }: { rows: CategoryRow[]; mode: ThirdColumnMode; projectId: string }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">Nothing to break down by category yet.</p>;
  const thirdLabel = mode === "balance" ? "Balance" : "Total";
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead><TableHead>Amt Total</TableHead>
          <TableHead>Amt Prev</TableHead><TableHead>Amt Current</TableHead><TableHead>Amt {thirdLabel} (to date)</TableHead>
          <TableHead>% Prev</TableHead><TableHead>% Current</TableHead><TableHead>% {thirdLabel}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.name}>
            {/* R42 seq24: every group subtotal links to the ANALYTICAL page filtered to that group (REPORT.GLOBAL) -- the real destination this seq built (WorkProgressAnalyticalClient), not a dead end. */}
            <TableCell>
              <Link href={`/work-progress?projectId=${projectId}&tab=analytics&category=${encodeURIComponent(r.name)}`} className="text-px-ink underline">{r.name}</Link>
            </TableCell>
            <TableCell>{money(r.amtTotal)}</TableCell>
            <TableCell>{money(r.amt.prev)}</TableCell><TableCell>{money(r.amt.current)}</TableCell><TableCell>{money(r.amt[mode])}</TableCell>
            <TableCell>{r.percentage.prev}%</TableCell><TableCell>{r.percentage.current}%</TableCell><TableCell>{r.percentage[mode]}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ManpowerTable({ rows }: { rows: ManpowerRow[] }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">No attendance recorded in this date range.</p>;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Trade</TableHead><TableHead>Worker-Days</TableHead><TableHead>Cost</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.trade}><TableCell>{r.trade}</TableCell><TableCell>{r.workerDays}</TableCell><TableCell>{money(r.totalCost)}</TableCell></TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function VendorTable({ rows }: { rows: VendorRow[] }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">No vendor-linked labour cost in this date range.</p>;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Vendor</TableHead><TableHead>Cost</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.vendorId}><TableCell>{r.vendorName}</TableCell><TableCell>{money(r.totalCost)}</TableCell></TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Today, in the ISO form every date input and every query param here uses. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

export type WorkProgressReportView = "scope" | "category" | "manpower" | "vendor";
const VIEWS: WorkProgressReportView[] = ["scope", "category", "manpower", "vendor"];
const VIEW_LABEL: Record<WorkProgressReportView, string> = {
  scope: "Scope-wise",
  category: "Category-wise",
  manpower: "Manpower-wise",
  vendor: "Vendor-wise",
};
function normaliseView(value: string | null | undefined): WorkProgressReportView {
  return VIEWS.includes(value as WorkProgressReportView) ? (value as WorkProgressReportView) : "scope";
}

/**
 * R67 E-28 (R-244 / R-254, D-02). THERE IS ONE WORK PROGRESS REPORT.
 *
 * WHAT WAS WRONG, and what this component now does about each of it.
 *
 * 1. NOTHING RAN UNTIL YOU PRESSED A BUTTON, over a range that was already
 *    filled in, under the instruction "Pick a date range and click Run Report"
 *    (C-04). It runs on arrival now, from the URL's own parameters, and that
 *    sentence is gone.
 *
 * 2. THE DEFAULT RANGE WAS THE CURRENT MONTH. On a project whose work started
 *    in June, a month-to-date default reports it as having done nothing. The
 *    default start now comes from the DATA -- the project's earliest progress
 *    entry, computed server-side from entries the route already fetches -- and
 *    the range that really ran comes back on the response and is shown.
 *
 * 3. A RUN HAD NO STATE. No elapsed counter, no Cancel, no bound. The button
 *    reads "Running... {n} s" with a Cancel beside it, the panel shows a
 *    skeleton of the report's own columns rather than a blank card, completion
 *    prints how long it took and when, and a failure prints the backend's own
 *    words with a Retry -- in the panel AND in the footer, because the
 *    footer's Export buttons are the other thing the reader was about to press.
 *    src/lib/use-timed-run.ts owns the machine; the route's own 30 s deadline
 *    backs it up for work the browser abandoned.
 *
 * 4. EXPORT PDF EXISTED AND NOTHING CALLED IT. The relay has shipped since
 *    point 117 with no button on it. Export now offers PDF and XLSX, both
 *    server-rendered and streamed through the projexa relays (projexa gains no
 *    document library), beside the CSV that was already here -- still honestly
 *    labelled CSV, because that is what it is.
 *
 * 5. SHARE WAS COPY-A-LINK ONLY. "Send on WhatsApp" opens wa.me with the
 *    report named, the period spelled out and the same expiring link.
 *
 * The parameters live in the URL (projectId, from, to, view, boqId) so a run is
 * linkable, and the Reports module and the Full Catalog can both point here
 * (D-02) instead of running a second, slower copy of the same report.
 */
export default function WorkProgressReportClient({
  projectId,
  projectName,
  initialFrom,
  initialTo,
  initialView,
  initialBoqId,
}: {
  projectId: string;
  projectName?: string | null;
  /** From the page's own searchParams -- read on the server, never through useSearchParams (which forces a Suspense bailout at build time). */
  initialFrom?: string | null;
  initialTo?: string | null;
  initialView?: string | null;
  initialBoqId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // "" means "let the server pick the start date from the data" -- see the header.
  const [from, setFrom] = useState(initialFrom ?? "");
  const [to, setTo] = useState(initialTo ?? today());
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [sharing, setSharing] = useState(false);
  const [view, setView] = useState<WorkProgressReportView>(normaliseView(initialView));
  // Point 11: component state only -- never persisted, never sent to the API.
  const [thirdColumnMode, setThirdColumnMode] = useState<ThirdColumnMode>("total");
  // R36/P5 (B5 decision, cc_spec point 177): a project can have more than one
  // independent BOQ at once -- empty string means "let the server auto-pick
  // the latest, non-superseded one" (the exact previous behaviour); a real
  // id means the user explicitly chose a specific BOQ to report on.
  const [selectedBoqId, setSelectedBoqId] = useState<string>(initialBoqId ?? "");
  // R67 lane I (WS-I item I-05, R-177): the Category multi-select. Held here,
  // sent to the server, and APPLIED THERE -- never filtered client-side, or the
  // Grand Total would keep describing rows the table is no longer showing.
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  // The option list comes from the last run (every category present BEFORE the
  // filter), so selecting one never removes the others from the control.
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const run = useTimedRun<ReportResponse>();
  // `run` is a fresh object every render, but `run.run` is a stable
  // useCallback -- so the runner can be a dependency directly. It used to be
  // held in a ref that was WRITTEN during render, which React's own lint rule
  // forbids for a real reason: a ref written in render is not tracked, so a
  // concurrent re-render can read a value from a render that was thrown away.
  const startRun = run.run;

  // R42 seq24: recomputed every render (cheap, no memo needed) so it always
  // reflects the current thirdColumnMode toggle -- see checkTies()'s own comment.
  const tieError = report ? checkTies(report.rows, report.byCategory, thirdColumnMode) : null;

  const runReport = useCallback(
    async (overrides: { boqId?: string; categories?: string[]; from?: string; to?: string } = {}) => {
      const boqId = overrides.boqId ?? selectedBoqId;
      const categories = overrides.categories ?? selectedCategories;
      const rangeFrom = overrides.from ?? from;
      const rangeTo = overrides.to ?? to;

      const data = await startRun(async (signal) => {
        const params = new URLSearchParams({ projectId, to: rangeTo });
        // Omitted on purpose when empty: that is what asks the server for the
        // data-derived default rather than guessing one here.
        if (rangeFrom) params.set("from", rangeFrom);
        if (boqId) params.set("boqId", boqId);
        // Repeatable, not comma-joined: a real category name may contain a comma.
        for (const c of categories) params.append("category", c);
        const res = await fetch(`/api/work-progress/report?${params.toString()}`, { signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `The report service answered ${res.status}`);
        return body as ReportResponse;
      });

      if (!data) return; // cancelled, timed out or failed -- the hook holds which
      setReport(data);
      // Reflect what the server really ran: its effective range and its BOQ pick.
      if (data.from && data.from !== rangeFrom) setFrom(data.from);
      if (!boqId && data.boqId) setSelectedBoqId(data.boqId);
      // R67 I-05: only ever GROWS the option list. A filtered run legitimately
      // reports fewer categories present, and shrinking the control to match
      // would make it impossible to widen the filter again.
      if (Array.isArray(data.availableCategories)) {
        setAvailableCategories((prev) => [...new Set([...prev, ...data.availableCategories!])].sort());
      }
    },
    [projectId, selectedBoqId, selectedCategories, from, to, startRun]
  );

  // RUN ON ARRIVAL (C-04). Once, for the parameters the URL brought, and again
  // whenever the project changes -- deliberately NOT on every keystroke in a
  // date field, which is why from/to are not dependencies here; the date
  // inputs re-run explicitly on change instead.
  useEffect(() => {
    void runReport();
    // runReport is deliberately not a dependency: it changes on every date
    // keystroke, and this effect is "run on arrival", not "run on every edit".
  }, [projectId]);

  // The URL carries the parameters, so a run is linkable and the Reports
  // module can point at exactly this one (D-02). replace(), not push(): a date
  // change is not a new page in the reader's history.
  useEffect(() => {
    const params = new URLSearchParams({ tab: "report", projectId, view });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (selectedBoqId) params.set("boqId", selectedBoqId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [router, pathname, projectId, from, to, view, selectedBoqId]);

  const effectiveFrom = report?.from ?? from;
  const period = effectiveFrom ? `${formatDate(effectiveFrom)} to ${formatDate(to)}` : `up to ${formatDate(to)}`;
  const exportQuery = `projectId=${encodeURIComponent(projectId)}&from=${encodeURIComponent(effectiveFrom || to)}&to=${encodeURIComponent(to)}&mode=${thirdColumnMode}`;

  /**
   * R42 seq24 (REPORT.GLOBAL "EXPORT XLSX -- raw rows so a QS can check the
   * arithmetic himself... a TRUST FEATURE"). The CSV is still built here and
   * still honestly labelled "Export CSV"; PDF and XLSX are SERVER-rendered and
   * streamed through the relays, because projexa must gain no document library
   * (C06-13 / D-09).
   */
  function exportCsv() {
    if (!report) return;
    const thirdLabel = thirdColumnMode === "balance" ? "Balance" : "Total";
    const lines = [
      ["S.No", "Category", "Code", "Description", "Unit", "BOQ Qty", "Rate", "Amt", "% Prev", "% Current", `% ${thirdLabel}`, "Qty Prev", "Qty Current", `Qty ${thirdLabel}`, "Amt Prev", "Amt Current", `Amt ${thirdLabel}`].join(","),
      ...report.rows.map((r, i) => [
        i + 1, `"${r.categoryName}"`, r.code ?? "", `"${r.description}"`, r.unit, r.qtyTotal, r.rate,
        r.amtTotal, r.parentLineItemId ? "" : r.percentage.prev, r.parentLineItemId ? "" : r.percentage.current, r.parentLineItemId ? "" : r.percentage[thirdColumnMode],
        r.qty.prev, r.qty.current, r.qty[thirdColumnMode], r.amt.prev, r.amt.current, r.amt[thirdColumnMode],
      ].join(",")),
      ["", "", "", "Grand Total", "", "", "", tieError ? "" : String(computeGrandTotal(report.rows, thirdColumnMode).amtTotal)].join(","),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wpr-${projectId}-${effectiveFrom || to}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Creates the expiring, read-only link both Share actions hand out. */
  async function createShareLink(): Promise<string> {
    const res = await fetch("/api/work-progress/report/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, from: effectiveFrom || to, to }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error);
    return data.url as string;
  }

  // Point 118: a plain, expiring, read-only link -- NOT the WhatsApp Business
  // API (explicitly ruled out).
  async function shareReport() {
    setSharing(true);
    try {
      const url = await createShareLink();
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied.");
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create a share link");
    } finally {
      setSharing(false);
    }
  }

  // R67 E-28 (R-254): the same expiring link, handed to WhatsApp with the
  // report named and the period spelled out -- a bare URL in a site foreman's
  // chat says nothing about what it is.
  async function shareOnWhatsApp() {
    setSharing(true);
    try {
      const url = await createShareLink();
      const text = `Work Progress Report — ${projectName || "this project"}, ${period}: ${url}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create a share link");
    } finally {
      setSharing(false);
    }
  }

  const running = run.state === "running";
  const failureMessage =
    run.state === "timeout"
      ? `${timeoutSentence()} Narrow the date range, or pick a single BOQ, and run it again.`
      : run.state === "failed"
        ? `Could not run Work Progress: ${run.error ?? "the service did not answer"}`
        : null;

  const parameterBar = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="wpr-from">From</Label>
        <Input id="wpr-from" type="date" value={effectiveFrom} onChange={(e) => { setFrom(e.target.value); void runReport({ from: e.target.value }); }} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wpr-to">To</Label>
        <Input id="wpr-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); void runReport({ to: e.target.value }); }} />
      </div>
      {running ? (
        <div className="flex items-end gap-2">
          <Button disabled data-testid="work-progress-report-run">
            <Loader2 className="size-4 animate-spin" /> Running… {run.elapsedSeconds} s
          </Button>
          <Button variant="outline" onClick={() => run.cancel()}>Cancel</Button>
        </div>
      ) : (
        <Button onClick={() => void runReport()} data-testid="work-progress-report-run">
          <Play className="size-4" /> Run again
        </Button>
      )}
      {report && report.availableBoqs.length > 1 && (
        <div className="space-y-1.5">
          <Label>BOQ</Label>
          <Select
            value={selectedBoqId || report.boqId || ""}
            onValueChange={(v) => { setSelectedBoqId(v); void runReport({ boqId: v }); }}
          >
            <SelectTrigger className="w-56" data-testid="boq-selector"><SelectValue /></SelectTrigger>
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
        disabled={running}
        onToggle={(name, checked) =>
          setSelectedCategories((prev) => (checked ? [...prev, name] : prev.filter((x) => x !== name)))
        }
        onApply={() => void runReport({ categories: selectedCategories })}
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
        </div>
      )}
    </div>
  );

  const body = (() => {
    if (running) {
      // A skeleton of the report's OWN columns, so the reader can already see
      // the shape of what is coming instead of a blank card.
      return (
        <div className="space-y-2" aria-busy="true" data-testid="wpr-skeleton">
          <p className="text-sm text-px-muted">Running Work Progress Report… {run.elapsedSeconds} s</p>
          <div className="flex gap-2">
            {["S.No", "Category", "Code", "Description", "Percent", "Quantity", "Amount"].map((c) => (
              <Skeleton key={c} className="h-4 flex-1" />
            ))}
          </div>
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
        </div>
      );
    }
    if (failureMessage) {
      return (
        <div className="space-y-3 py-10 text-center">
          <p role="alert" className="text-sm text-px-error">{failureMessage}</p>
          <Button size="sm" variant="outline" onClick={() => void runReport()}>Retry</Button>
        </div>
      );
    }
    if (run.state === "cancelled" && !report) {
      return <p className="py-10 text-center text-sm text-px-muted">Cancelled. Nothing was run.</p>;
    }
    if (!report) return <p className="py-10 text-center text-sm text-px-muted">Loading this project&apos;s Work Progress Report…</p>;
    return (
      <div className="space-y-3">
        {/* Four real views over rows already in state -- switching one never
            re-fetches. The horizontal scroll lives INSIDE this container, so
            the page itself never scrolls sideways. */}
        <div role="tablist" aria-label="Work Progress Report view" className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-md border px-3 py-1.5 text-[13px] ${view === v ? "border-px-ink bg-muted/60 text-px-ink" : "border-px-border text-px-muted"}`}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          {view === "scope" && <ScopeTable rows={report.rows} mode={thirdColumnMode} projectId={projectId} boqId={report.boqId} />}
          {view === "category" && <CategoryTable rows={report.byCategory} mode={thirdColumnMode} projectId={projectId} />}
          {view === "manpower" && <ManpowerTable rows={report.byManpower} />}
          {view === "vendor" && <VendorTable rows={report.byVendor} />}
        </div>
      </div>
    );
  })();

  return (
    <ProjexaReportScreen
      breadcrumb="Work Progress / Report"
      headerBlock={{
        project: (
          <Link href={`/dashboard/project?projectId=${encodeURIComponent(projectId)}`} className="hover:underline">
            {projectName || "This project"}
          </Link>
        ),
        revision: report?.boqTitle ? `BOQ ${report.boqTitle}` : undefined,
        period,
        // How long it took AND when it ran: "as of" without "how long" is what
        // made a slow report feel broken rather than slow.
        generatedAt: run.ranAt ? formatTime(run.ranAt) : "—",
        generatedBy: "this workspace",
        generatedIn: run.durationMs !== null ? `${(run.durationMs / 1000).toFixed(1)} s` : undefined,
      }}
      parameterBar={parameterBar}
      // REPORT.GLOBAL: subtotals that do not tie say so LOUDLY, and export is
      // blocked -- an export of a report that does not add up is worse than no
      // export. A failed run is mirrored here for the same reason: the footer's
      // Export buttons are the next thing the reader was going to press.
      tieError={tieError ?? failureMessage}
      shareAction={{
        label: "Share",
        onClick: () => void shareReport(),
        disabledReason: sharing ? "Share (creating a link…)" : report ? undefined : "Share (run the report first)",
      }}
      shareWhatsAppAction={{
        label: "Send on WhatsApp",
        onClick: () => void shareOnWhatsApp(),
        disabledReason: sharing ? "Send on WhatsApp (creating a link…)" : report ? undefined : "Send on WhatsApp (run the report first)",
      }}
      exportCsvAction={{
        label: "Export CSV",
        onClick: exportCsv,
        disabledReason: !report ? "Export CSV (run the report first)" : (tieError ?? undefined),
      }}
      exportXlsxAction={{
        label: "Export XLSX",
        href: report && !tieError ? `/api/work-progress/report/xlsx?${exportQuery}` : undefined,
        downloadName: `work-progress-${effectiveFrom || to}-to-${to}.xlsx`,
        disabledReason: !report ? "Export XLSX (run the report first)" : (tieError ?? undefined),
      }}
      exportPdfAction={{
        label: "Export PDF",
        href: report && !tieError ? `/api/work-progress/report/pdf?${exportQuery}` : undefined,
        downloadName: `work-progress-${effectiveFrom || to}-to-${to}.pdf`,
        disabledReason: !report ? "Export PDF (run the report first)" : (tieError ?? undefined),
      }}
    >
      {body}
    </ProjexaReportScreen>
  );
}
