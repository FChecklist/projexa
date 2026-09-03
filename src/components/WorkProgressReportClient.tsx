"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Play, Share2, Download } from "lucide-react";
import { formatDate } from "@/lib/format-date";
import { formatDecimal } from "@/lib/format-number";
import { formatProgressCell, unlinkedEntriesNote } from "@/lib/work-progress-report";

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
// offer until the first run comes back. R67 B-09's unlinkedEntryCount is
// additive for the same reason.
type ReportResponse = {
  boqTitle: string | null; boqId: string | null; availableBoqs: BoqOption[];
  rows: LineItemRow[]; byCategory: CategoryRow[]; byManpower: ManpowerRow[]; byVendor: VendorRow[];
  availableCategories?: string[]; categoryFilter?: string[];
  unlinkedEntryCount?: number;
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

export function ScopeTable({ rows, mode, projectId }: { rows: LineItemRow[]; mode: ThirdColumnMode; projectId: string }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-px-muted">No BoQ line items for this project yet.</p>;
  const thirdLabel = mode === "balance" ? "Balance" : "Total";
  const grand = computeGrandTotal(rows, mode);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead rowSpan={2}>S.No</TableHead><TableHead rowSpan={2}>Category</TableHead>
          <TableHead rowSpan={2}>Code</TableHead><TableHead rowSpan={2}>Description</TableHead>
          <TableHead rowSpan={2}>Unit</TableHead><TableHead rowSpan={2}>Rate</TableHead><TableHead rowSpan={2}>Amt</TableHead>
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
              <TableCell>{i + 1}</TableCell><TableCell>{r.categoryName}</TableCell>
              {/* R42 seq24: every item code is a hyperlink to its BOQ (REPORT.GLOBAL) -- ScopeClient is the real, live screen for that line (no BOQ-line OBJECT screen exists; see this seq's own screen_spec finding). */}
              <TableCell className="font-mono text-xs">
                {r.code ? <Link href={`/scope?projectId=${projectId}`} className="text-px-ink underline">{r.code}</Link> : "—"}
              </TableCell>
              <TableCell>{r.description}</TableCell>
              <TableCell>{r.unit}</TableCell><TableCell>{money(r.rate)}</TableCell><TableCell>{money(r.amtTotal)}</TableCell>

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
          <TableCell colSpan={6}>Grand Total</TableCell>
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

function defaultFrom() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default function WorkProgressReportClient({ projectId }: { projectId: string }) {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReportResponse | null>(null);
  // R67 B-09: the sentence itself is a pure function beside the report's own
  // maths, so the number the note quotes and the number the tables exclude
  // can never come from two different definitions of "linked".
  const unlinkedNote = unlinkedEntriesNote(report?.unlinkedEntryCount ?? 0);
  const [sharing, setSharing] = useState(false);
  // Point 11: component state only -- never persisted, never sent to the API.
  const [thirdColumnMode, setThirdColumnMode] = useState<ThirdColumnMode>("total");
  // R36/P5 (B5 decision, cc_spec point 177): a project can have more than one
  // independent BOQ at once -- empty string means "let the server auto-pick
  // the latest, non-superseded one" (the exact previous behaviour); a real
  // id means the user explicitly chose a specific BOQ to report on.
  const [selectedBoqId, setSelectedBoqId] = useState<string>("");
  // R67 lane I (WS-I item I-05, R-177): the Category multi-select. Held here,
  // sent to the server, and APPLIED THERE -- never filtered client-side, or the
  // Grand Total would keep describing rows the table is no longer showing.
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  // The option list comes from the last run (every category present BEFORE the
  // filter), so selecting one never removes the others from the control.
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  // R42 seq24: recomputed every render (cheap, no memo needed) so it always
  // reflects the current thirdColumnMode toggle -- see checkTies()'s own comment.
  const tieError = report ? checkTies(report.rows, report.byCategory, thirdColumnMode) : null;

  // REBASE NOTE (r67 lane A onto lane I): both lanes changed this function.
  // Lane I (I-05) gave it the category filter and the grow-only option list;
  // lane A (A-04) made it a useCallback so the auto-run effect below can
  // depend on it honestly rather than reaching past the dependency array.
  // Both are kept -- I's body, A's wrapper -- and selectedCategories joins the
  // dependency list, because the default parameter reads it.
  const runReport = useCallback(
    async (boqId = selectedBoqId, categories = selectedCategories) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ projectId, from, to });
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

  // R67 A-04. The composer's "Run WPR" card is a verb: it must run the report,
  // not land the user on a form with the dates already filled in and a Run
  // Report button still to press. It navigates here with ?run=1 and the report
  // runs on arrival, over the default range this component already computes
  // (1st of the month to today).
  //
  // ONCE. The ref, not the report state, is the guard: a run that FAILS must
  // not retry itself on every re-render, and the user must be able to press
  // Run Report again afterwards without the effect fighting them. The ref also
  // makes the effect safe now that runReport's identity changes with lane I's
  // selectedCategories: picking a category cannot silently re-fire the run.
  const searchParams = useSearchParams();
  const autoRunRequested = searchParams.get("run") === "1";
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (!autoRunRequested || autoRanRef.current) return;
    autoRanRef.current = true;
    void runReport();
  }, [autoRunRequested, runReport]);

  // R42 seq24 (REPORT.GLOBAL "EXPORT XLSX -- raw rows so a QS can check the
  // arithmetic himself... a TRUST FEATURE"): a real CSV rather than a
  // binary .xlsx -- Excel opens CSV natively and every value is checkable,
  // without adding an xlsx-writing dependency to this bundle for one
  // export button (compliance-tracker's own xlsx package is read-only,
  // used for BOQ import, not export). Honestly labelled "Export CSV", not
  // claimed as XLSX. Disabled when the tie check fails -- an export of a
  // report that doesn't add up is worse than no export.
  const exportCsv = useCallback(() => {
    if (!report) return;
    const lines = [
      ["S.No", "Category", "Code", "Description", "Unit", "Rate", "Amt", "% Prev", "% Current", `% ${thirdColumnMode === "balance" ? "Balance" : "Total"}`, "Qty Prev", "Qty Current", "Qty Third", "Amt Prev", "Amt Current", "Amt Third"].join(","),
      ...report.rows.map((r, i) => [
        i + 1, `"${r.categoryName}"`, r.code ?? "", `"${r.description}"`, r.unit, r.rate,
        r.amtTotal, r.parentLineItemId ? "" : r.percentage.prev, r.parentLineItemId ? "" : r.percentage.current, r.parentLineItemId ? "" : r.percentage[thirdColumnMode],
        r.qty.prev, r.qty.current, r.qty[thirdColumnMode], r.amt.prev, r.amt.current, r.amt[thirdColumnMode],
      ].join(",")),
      ["", "", "", "Grand Total", "", "", tieError ? "" : String(computeGrandTotal(report.rows, thirdColumnMode).amtTotal)].join(","),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `wpr-${projectId}-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report, thirdColumnMode, tieError, projectId, from, to]);

  // R67 A-20. The composer's "Export CSV" card is a verb and the FILE is the
  // whole point of it, so the card navigates here with ?tab=report&run=1&
  // export=csv and the export happens once the report the effect above ran has
  // actually arrived. Landing the user on an empty report with an export button
  // that can do nothing until they press Run would be the same "card that is
  // really a place" this programme is removing.
  //
  // ONCE, and never over a report that does not add up: the tie check is the
  // same one that disables the button, and "an export of a report that doesn't
  // add up is worse than no export" (see exportCsv's own comment above). When
  // the check fails the tie-error card is already on screen saying why.
  const autoExportRequested = searchParams.get("export") === "csv";
  const autoExportedRef = useRef(false);
  useEffect(() => {
    if (!autoExportRequested || autoExportedRef.current) return;
    if (!report || tieError) return;
    autoExportedRef.current = true;
    exportCsv();
  }, [autoExportRequested, report, tieError, exportCsv]);

  // Point 118: a plain, expiring, read-only link -- NOT the WhatsApp
  // Business API (explicitly ruled out). Copies the URL so the user can
  // paste it into WhatsApp themselves.
  async function shareReport() {
    setSharing(true);
    try {
      const res = await fetch("/api/work-progress/report/share", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, from, to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      await navigator.clipboard.writeText(data.url);
      toast.success(`Share link copied — expires ${formatDate(data.expiresAt)}`);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create a share link");
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-card">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5"><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button onClick={() => runReport()} disabled={loading} data-testid="work-progress-report-run">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run Report
          </Button>
          {report && (
            <Button onClick={shareReport} disabled={sharing} variant="outline">
              {sharing ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />} Share
            </Button>
          )}
          {report && (
            <Button onClick={exportCsv} disabled={!!tieError} title={tieError ?? undefined} variant="outline" data-testid="export-csv">
              <Download className="size-4" /> Export CSV
            </Button>
          )}
          {report && report.availableBoqs.length > 1 && (
            <div className="space-y-1.5">
              <Label>BOQ</Label>
              <Select
                value={selectedBoqId || report.boqId || ""}
                onValueChange={(v) => { setSelectedBoqId(v); runReport(v); }}
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
            disabled={loading}
            onToggle={(name, checked) =>
              setSelectedCategories((prev) => (checked ? [...prev, name] : prev.filter((x) => x !== name)))
            }
            onApply={() => runReport(selectedBoqId, selectedCategories)}
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
        </CardContent>
      </Card>

      {/* R42 seq24 (REPORT.GLOBAL): "IF THE SUBTOTALS DO NOT SUM TO THE GRAND
          TOTAL THE REPORT IS WRONG AND MUST SAY SO LOUDLY, not render
          anyway." Shown, not hidden -- the tables below still render (a QS
          still needs to see the numbers to find the bug), only export is blocked. */}
      {tieError && (
        <Card className="border-px-error-border bg-px-error-light">
          <CardContent className="p-4 text-sm text-px-error" data-testid="tie-error">{tieError}</CardContent>
        </Card>
      )}

      <Card className="shadow-card">
        <CardContent className="p-4">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : !report ? (
            <p className="py-10 text-center text-sm text-px-muted">Pick a date range and click Run Report.</p>
          ) : (
            <Tabs defaultValue="scope" className="space-y-4">
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
              <TabsList>
                <TabsTrigger value="scope">Scope-wise</TabsTrigger>
                <TabsTrigger value="category">Category-wise</TabsTrigger>
                <TabsTrigger value="manpower">Manpower-wise</TabsTrigger>
                <TabsTrigger value="vendor">Vendor-wise</TabsTrigger>
              </TabsList>
              <TabsContent value="scope"><ScopeTable rows={report.rows} mode={thirdColumnMode} projectId={projectId} /></TabsContent>
              <TabsContent value="category"><CategoryTable rows={report.byCategory} mode={thirdColumnMode} projectId={projectId} /></TabsContent>
              <TabsContent value="manpower"><ManpowerTable rows={report.byManpower} /></TabsContent>
              <TabsContent value="vendor"><VendorTable rows={report.byVendor} /></TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
