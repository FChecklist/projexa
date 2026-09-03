"use client";

// R67 D-62 (audit R-202). REPLACES CostVarianceAnalyticalClient.tsx.
//
// WHAT WAS WRONG. The tab was called "Cost Variance" and it was read-only: it
// showed a budget figure, a vendor and a variance, and offered no way to set any
// of them. Its Filter and Export both read "Not yet available". So the one
// screen in PROJEXA that answers "what am I allowed to spend on this line, who
// is doing it, and for how much" could only be read, never used -- and the
// figures it read were already being written by a real API nothing called
// (PATCH /api/scope/line-items/[id], shipped R39/R-C09).
//
// WHAT THIS IS. Sumeet's budget sheet: every BOQ line carries a budget percent
// (the column's own NOT NULL DEFAULT 25 -- the "25% default with a per-line
// override" is the database's default, not a constant invented here), a vendor
// and a vendor amount, all editable in place; Material and Manpower alongside
// them; and a Budget Report view with Category and Vendor filters and an Export.
//
// NO MIGRATION WAS NEEDED, and D-62 says to check before inventing one:
// budgetPercentage, vendorId, vendorAmount, materialAmount and manpowerAmount are all
// real, long-standing columns on construction_boq_line_items. They had a write
// path and a report; what they did not have was a screen.
//
// R67 MERGE (D-11, lane D1 x lane D21, 2026-09-03) -- WHAT WAS FOLDED IN HERE.
// D21 landed on main first and rewrote the screen this one replaces
// (CostVarianceAnalyticalClient) rather than deleting it, adding D-26's cost
// tiles and variance chart. Both lanes were right about different halves, so:
//
//   - THIS screen survives, because it is the genuine superset: D21's version
//     was still read-only, and the whole point of D-62 is that these figures
//     must be editable in place.
//   - D21's D-26 work FOLDED IN rather than being lost: the "Committed
//     (vendor + material + manpower)" tile, the "Lines over budget: n of m"
//     count, and the no-committed-cost empty state that links to the current
//     BOQ. Its five assertions were RESTATED against this screen in
//     BudgetAnalyticalClient.test.tsx; none was dropped.
//   - CostVarianceAnalyticalClient.tsx and its test are deleted, since their
//     subject is gone. Two doors onto one set of figures, one of them
//     read-only, is the confusion D-62 exists to remove.
//   - A REAL DEFECT the auto-merge hid: D-26 flipped `variance` from overspend
//     to budget REMAINING in compliance-tracker, and git merged this file
//     without a conflict because D21 never touched it. The row colouring and
//     the tile label here both read the old sign, so every under-budget line
//     rendered red. Fixed at the cell, and budget-lines.ts's type now states
//     the new meaning. See the note on BudgetLine.committed.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnalyticalScreen, KpiTag } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import DataLoadError from "@/components/DataLoadError";
// R67 D-61/D-62: the money helpers are lane G-05's shared modules. D-61
// briefly shipped its own format-money.ts plus a useCurrencyCode() hook in
// @/lib/currency; G-05's format-money.ts + useOrgMoney() landed on main first
// and are a superset (three-state currency: not-asked / none / a code), so the
// D-61 copies were dropped at the merge and these call sites moved across.
import { MONEY_CELL_CLASS } from "@/lib/format-money";
import { formatNumber } from "@/lib/format-number";
import { useOrgMoney } from "@/lib/use-org-money";
import { downloadCsv, toCsv } from "@/lib/csv-export";
import {
  BUDGET_EXPORT_HEADERS,
  budgetExportRows,
  budgetPercentError,
  budgetTotals,
  categoryLabel,
  categoryOptions,
  filterBudgetLines,
  showingCount,
  vendorAmountError,
  vendorLabel,
  vendorOptions,
  type BudgetFilters,
  type BudgetLine,
  type BudgetReport,
} from "@/lib/budget-lines";

type Vendor = { id: string; vendorName: string };

/** The two things this tab is for, named as questions rather than as archetypes. */
const VIEWS = [
  { id: "budget", label: "Budget" },
  { id: "report", label: "Budget Report" },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

export default function BudgetAnalyticalClient({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<BudgetReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [view, setView] = useState<ViewId>("budget");
  const [filters, setFilters] = useState<BudgetFilters>({ category: "", vendor: "" });
  // Per-line edit state, keyed by line id. Only lines the user has actually
  // touched appear here, so an untouched grid holds no draft at all.
  const [drafts, setDrafts] = useState<Record<string, { budgetPercentage?: string; vendorAmount?: string }>>({});
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { money } = useOrgMoney();
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/budget-variance?projectId=${encodeURIComponent(projectId)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The old screen had no catch at all: a failed read left it on
        // "Loading…" for ever, with three KPI tags reading "—" above it.
        setReport(null);
        setLoadError(body.error ?? `Couldn't load the budget (HTTP ${res.status})`);
        return;
      }
      setReport(body as BudgetReport);
      setLoadError(null);
    } catch (err) {
      setReport(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load the budget");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // The vendor picker is a convenience: its failure must not stop the budget
    // being read or its percents being edited.
    fetch("/api/vendors")
      .then((r) => (r.ok ? r.json() : { vendors: [] }))
      .then((d) => setVendors(d.vendors ?? []))
      .catch(() => setVendors([]));
  }, []);

  const lines = useMemo(() => report?.lines ?? [], [report]);
  const shown = useMemo(() => filterBudgetLines(lines, filters), [lines, filters]);
  const totals = useMemo(() => budgetTotals(shown), [shown]);
  const filtered = filters.category !== "" || filters.vendor !== "";

  async function saveLine(lineItemId: string, patch: { budgetPercentage?: number; vendorId?: string | null; vendorAmount?: number | null }) {
    setSavingLineId(lineItemId);
    setSaveError(null);
    try {
      const res = await fetch(`/api/scope/line-items/${encodeURIComponent(lineItemId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(body.error ?? `Couldn't save this line (HTTP ${res.status})`);
        return;
      }
      // Re-read rather than patching state by hand: budget and variance are
      // both derived from the percent, and re-deriving them here would be a
      // second copy of the backend's arithmetic.
      setDrafts((d) => {
        const next = { ...d };
        delete next[lineItemId];
        return next;
      });
      await load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save this line");
    } finally {
      setSavingLineId(null);
    }
  }

  function exportVisible() {
    downloadCsv(`budget-${projectId}.csv`, toCsv(BUDGET_EXPORT_HEADERS, budgetExportRows(shown)));
  }

  const editable = view === "budget";

  return (
    <AnalyticalScreen
      breadcrumb="Scope of Work / Budget"
      filterAction={{
        label: "Filter",
        // The filter bar is always visible on the Report view (it is what the
        // view is for), so the header control is only meaningful on the grid.
        onClick: () => setView("report"),
        disabledReason: view === "report" ? "The Budget Report's filters are below" : undefined,
      }}
      exportAction={{
        label: "Export",
        onClick: exportVisible,
        disabledReason: shown.length === 0 ? "No rows to export" : undefined,
      }}
      newAction={undefined}
      kpiTags={
        <>
          <KpiTag label="Total budget" value={money(totals.budget)} />
          <KpiTag label="Material" value={totals.material === null ? "Not set" : money(totals.material)} />
          <KpiTag label="Manpower" value={totals.labour === null ? "Not set" : money(totals.labour)} />
          <KpiTag label="Vendor amount" value={totals.vendorAmount === null ? "Not quoted yet" : money(totals.vendorAmount)} />
          {/* R67 merge (D-11, D1 x D21): D-26's two tiles, folded in from the
              deleted CostVarianceAnalyticalClient. "Committed" is the figure
              that made D-26 worth doing -- a budget compared only against the
              subcontract understated every line costed through material and
              manpower. The en dash (never "AED 0") is load-bearing: nothing
              costed is not the same as costed at zero. */}
          <KpiTag label="Committed (vendor + material + manpower)" value={totals.committed === null ? "–" : money(totals.committed)} />
          <KpiTag label="Lines over budget" value={`${totals.overBudgetLines} of ${shown.length}`} />
          {/* Named "Budget remaining", not "Variance": D-26 flipped the sign so
              the number means what is LEFT, and the old one-word label would
              have kept reading as overspend. */}
          <KpiTag label="Budget remaining" value={totals.variance === null ? "Not quoted yet" : money(totals.variance)} />
        </>
      }
      chart={
        <div className="space-y-2 px-4 py-3">
          <div className="flex items-center gap-2" role="tablist" aria-label="Budget views">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={view === v.id}
                onClick={() => setView(v.id)}
                className={
                  view === v.id
                    ? "rounded-md bg-ct-navy px-3 py-1.5 text-[13px] font-medium text-white"
                    : "rounded-md border border-ct-border2 px-3 py-1.5 text-[13px] text-ct-navy"
                }
              >
                {v.label}
              </button>
            ))}
            <p className="text-[12.5px] text-ct-muted">
              {editable
                ? "Every BOQ line starts at a 25% budget. Change a line's percent, vendor or vendor amount in place."
                : "Filter the same lines by Category and Vendor, then Export what you see."}
            </p>
          </div>
          {view === "report" && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-[12.5px] text-ct-navy">
                Category
                <select
                  value={filters.category}
                  onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
                  className="rounded-md border border-ct-border2 px-2 py-1 text-[12.5px]"
                >
                  <option value="">All</option>
                  {categoryOptions(lines).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[12.5px] text-ct-navy">
                Vendor
                <select
                  value={filters.vendor}
                  onChange={(e) => setFilters((f) => ({ ...f, vendor: e.target.value }))}
                  className="rounded-md border border-ct-border2 px-2 py-1 text-[12.5px]"
                >
                  <option value="">All</option>
                  {vendorOptions(lines).map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>
              <span className="text-[12.5px] text-ct-muted">{showingCount(shown.length, lines.length)}</span>
              {filtered && (
                <button
                  type="button"
                  onClick={() => setFilters({ category: "", vendor: "" })}
                  className="text-[12.5px] text-ct-navy underline"
                >
                  Clear all
                </button>
              )}
            </div>
          )}
          {/* R67 merge (D-11, D1 x D21): D-26's empty state, folded in from the
              deleted CostVarianceAnalyticalClient. Without it the three cost
              tiles read as an en dash with nothing saying why, or what to do
              about it. The link is the shortest route to the only screen where
              the missing figures can actually be entered. */}
          {!loading && !loadError && totals.committed === null && lines.length > 0 && (
            <p className="text-[12.5px] text-ct-muted">
              No committed cost yet - enter vendor, material or manpower amounts on a BOQ line to see variance.
              {report?.boqId && (
                <>
                  {" "}
                  <Link href={`/scope/${report.boqId}`} className="underline">Open the current BOQ</Link>
                </>
              )}
            </p>
          )}
          {saveError && (
            <p role="alert" className="text-[12.5px] text-[color:var(--color-veri-status-late)]">{saveError}</p>
          )}
        </div>
      }
      table={
        loadError ? (
          <div className="px-4 py-3">
            <DataLoadError messages={[`Couldn't load the budget: ${loadError}`]} onRetry={() => void load()} />
          </div>
        ) : loading ? (
          <p className="px-4 py-6 text-[13px] text-ct-muted" aria-busy="true">Loading the budget…</p>
        ) : shown.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-ct-muted">
            {lines.length === 0 ? "No BOQ line items yet." : "No lines match these filters."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Budget %</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Manpower</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Vendor amount</TableHead>
                  <TableHead>Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((l) => (
                  <BudgetRow
                    key={l.lineItemId}
                    line={l}
                    editable={editable}
                    vendors={vendors}
                    saving={savingLineId === l.lineItemId}
                    draft={drafts[l.lineItemId] ?? {}}
                    onDraft={(patch) => setDrafts((d) => ({ ...d, [l.lineItemId]: { ...d[l.lineItemId], ...patch } }))}
                    onSave={(patch) => void saveLine(l.lineItemId, patch)}
                    money={money}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )
      }
    />
  );
}

function BudgetRow({
  line,
  editable,
  vendors,
  saving,
  draft,
  onDraft,
  onSave,
  money,
}: {
  line: BudgetLine;
  editable: boolean;
  vendors: Vendor[];
  saving: boolean;
  draft: { budgetPercentage?: string; vendorAmount?: string };
  onDraft: (patch: { budgetPercentage?: string; vendorAmount?: string }) => void;
  onSave: (patch: { budgetPercentage?: number; vendorId?: string | null; vendorAmount?: number | null }) => void;
  money: (n: number | null) => string;
}) {
  const percentValue = draft.budgetPercentage ?? String(line.budgetPercentage);
  const amountValue = draft.vendorAmount ?? (line.vendorAmount === null ? "" : String(line.vendorAmount));
  const percentError = editable ? budgetPercentError(percentValue) : undefined;
  const amountError = editable ? vendorAmountError(amountValue) : undefined;

  return (
    <TableRow>
      <TableCell>{line.code ?? "—"}</TableCell>
      <TableCell>{line.description}</TableCell>
      <TableCell>{categoryLabel(line)}</TableCell>
      <TableCell className={MONEY_CELL_CLASS}>
        {editable ? (
          <>
            <Input
              aria-label={`Budget percent for ${line.code ?? line.description}`}
              value={percentValue}
              disabled={saving}
              onChange={(e) => onDraft({ budgetPercentage: e.target.value })}
              // Committed on blur, not on every keystroke: a percent is typed
              // two characters at a time and "2" is not a save-worthy value.
              onBlur={() => {
                if (percentError || Number(percentValue) === line.budgetPercentage) return;
                onSave({ budgetPercentage: Number(percentValue) });
              }}
              className="h-7 w-16 text-right"
            />
            {percentError && (
              <p role="alert" className="text-[12px] text-[color:var(--color-veri-status-late)]">{percentError}</p>
            )}
          </>
        ) : (
          formatNumber(line.budgetPercentage)
        )}
      </TableCell>
      <TableCell className={MONEY_CELL_CLASS}>{money(line.budget)}</TableCell>
      <TableCell className={MONEY_CELL_CLASS}>
        {line.materialAmount === null ? <span className="text-ct-muted">Not set</span> : money(line.materialAmount)}
      </TableCell>
      <TableCell className={MONEY_CELL_CLASS}>
        {line.manpowerAmount === null ? <span className="text-ct-muted">Not set</span> : money(line.manpowerAmount)}
      </TableCell>
      <TableCell>
        {editable ? (
          <select
            aria-label={`Vendor for ${line.code ?? line.description}`}
            value={line.vendorId ?? ""}
            disabled={saving}
            onChange={(e) => onSave({ vendorId: e.target.value || null })}
            className="rounded-md border border-ct-border2 px-2 py-1 text-[12.5px]"
          >
            <option value="">No vendor</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.vendorName}</option>
            ))}
          </select>
        ) : (
          vendorLabel(line)
        )}
      </TableCell>
      <TableCell className={MONEY_CELL_CLASS}>
        {editable ? (
          <>
            <Input
              aria-label={`Vendor amount for ${line.code ?? line.description}`}
              value={amountValue}
              disabled={saving}
              placeholder="Not quoted"
              onChange={(e) => onDraft({ vendorAmount: e.target.value })}
              onBlur={() => {
                if (amountError) return;
                const next = amountValue.trim() === "" ? null : Number(amountValue);
                if (next === line.vendorAmount) return;
                onSave({ vendorAmount: next });
              }}
              className="h-7 w-24 text-right"
            />
            {amountError && (
              <p role="alert" className="text-[12px] text-[color:var(--color-veri-status-late)]">{amountError}</p>
            )}
          </>
        ) : line.vendorAmount === null ? (
          <span className="text-ct-muted">Not quoted</span>
        ) : (
          money(line.vendorAmount)
        )}
      </TableCell>
      <TableCell className={MONEY_CELL_CLASS}>
        {line.variance === null ? (
          <span className="text-ct-muted">Not quoted</span>
        ) : (
          // R67 MERGE DEFECT FIX (D-11, lane D1 x lane D21, 2026-09-03). This
          // test read `variance > 0` as OVERSPENT, which was right while
          // variance meant vendorAmount - budget. D-26 flipped the backend to
          // budget REMAINING without touching this file, and git auto-merged it
          // with no conflict -- leaving every under-budget line red and every
          // overrun green. Negative remaining is the overrun now, and
          // budgetTotals().overBudgetLines counts it the same way.
          <span className={line.variance < 0 ? "text-[color:var(--color-veri-status-late)]" : "text-[color:var(--color-veri-status-done)]"}>
            {money(line.variance)}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
