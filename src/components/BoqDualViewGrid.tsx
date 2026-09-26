"use client";

// R85 Addendum 3 v4 (R-50, "the dual-view money model"), PHASE 2 -- THE GRID.
// Work order: Google Drive WORK_ORDER_R85_ADDENDUM_3_v4_R50_FINAL.md, gates
// 2-01..2-10. Owner rulings D87 (claude_log 366) D88 (372) D89 (373) D90
// (374) D91 (375), owner's own words (D91): "When we submit proposal we
// usually show something else to customer and internally something else...
// R-50 helps in making it view to end user at every stage."
//
// WHAT THIS IS. The grid VERIDIAN's own BOQ GET route (/api/v1/construction/
// boq/[id], compliance-tracker) has carried dual-view data for since the
// Phase 3/7 merges, but that data had NO CONSUMER anywhere in either
// codebase until this file (confirmed directly: cost-visibility-service.ts's
// own header comment says so, and a `git grep` for "rateProject"/
// "qtyProject" outside service/route files found nothing before this pass).
// A BOQ line that cannot be EDITED here also had no write path at all before
// this phase -- see compliance-tracker's construction-boq-service.ts
// updateLineItemMoneyFields(), added alongside this file.
//
// THE FOUR COLUMNS (A3/D90). qtyProject/rateProject (PROJECT side -- the
// firm's own cost, freely editable, no evidence ever required, A8) and
// qtyContract/rateContract (CONTRACT side -- what the customer agreed;
// freely editable before confirmation, LOCKED after -- 2-02). NEVER four
// equivalent cells (X-05) -- the grouping below keeps that visually true, not
// just true in the data model.
//
// ★ THE DUAL-VIEW CONTRACT (E1), AND WHY THIS FILE FETCHES TWICE ★
// INTERNAL VIEW shows all four columns + variance + decomposition.
// CUSTOMER VIEW shows the contract side ONLY and must be INCAPABLE of
// rendering any project-side or variance figure -- not hidden with CSS, but
// genuinely absent from what is fetched and rendered (X-15: "Hiding a
// project-side field with CSS while it remains in the API response" is
// explicitly prohibited). rate_project is "the most sensitive field in the
// product" (E1) -- a client who sees it knows the firm's buying power.
// SO: switching to CUSTOMER makes a REAL, FRESH request with `?view=
// customer`, which compliance-tracker's GET route (see that file's own
// comment) redacts UNCONDITIONALLY server-side via the same
// redactProjectSideFields() applyCostVisibility() already uses for a real
// client_viewer/share-token read -- this is a genuine preview of the exact
// customer payload, not a client-side toggle over data already sitting in
// the browser in internal form. renderCustomerView() below is written so it
// physically cannot reach a project-side field even if one somehow arrived:
// it destructures ONLY contract-side keys off `customer.lineItems[]`.
//
// ★ ONE PRODUCER, MIRRORED FOR LIVE PREVIEW ONLY (Part D) ★
// compliance-tracker's boq-dual-view-service.ts is THE ONE PLACE this math
// is computed for anything that gets STORED, READ BACK OR TRUSTED. This
// file's own computeLineMoneyView()/sortValue() below are a DELIBERATE,
// NARROW exception, and only for one reason: 2-05 requires the PART C block
// to update LIVE as a cell changes, before the PATCH round-trip returns --
// a UI that only recomputes after a server response is not "live". The
// moment a save succeeds, this file discards its own local computation for
// that line and renders EXACTLY what the server returned (setLineFromServer
// below) -- so the server is always the last word for anything persisted,
// and the local math only ever governs the few hundred milliseconds between
// a keystroke and a save response.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOrgMoney } from "@/lib/use-org-money";
import { formatNumber } from "@/lib/format-number";
// PROJEXA-BUILD-001 U-33: the grid's two reads live in boq-read-source.ts, so this file names no /api/scope read (BR-419). They stay on
// the proxy on purpose: the project-side cost columns are what the Edge gateway never returns.
import { readBoqDualView } from "@/lib/boq-read-source";

// ─── A4's mathematics, mirrored client-side for live preview (see header). ─

export const NOT_SET = "NOT_SET" as const;
export type MoneyFigure = number | typeof NOT_SET;

function toFinite(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export type DualViewInput = {
  qtyProject?: string | number | null;
  rateProject?: string | number | null;
  qtyContract?: string | number | null;
  rateContract?: string | number | null;
};

export type DualViewMoney = {
  projectValue: MoneyFigure;
  contractValue: MoneyFigure;
  variance: MoneyFigure;
  variancePercent: MoneyFigure;
  quantityVariance: MoneyFigure;
  rateVariance: MoneyFigure;
};

/** A4, mirrored exactly (see this file's header for why a mirror exists at all). */
export function computeLineMoneyView(input: DualViewInput): DualViewMoney {
  const qtyProject = toFinite(input.qtyProject);
  const rateProject = toFinite(input.rateProject);
  const qtyContract = toFinite(input.qtyContract);
  const rateContract = toFinite(input.rateContract);

  const projectValue: MoneyFigure = qtyProject === null || rateProject === null ? NOT_SET : qtyProject * rateProject;
  const contractValue: MoneyFigure = qtyContract === null || rateContract === null ? NOT_SET : qtyContract * rateContract;
  const variance: MoneyFigure = projectValue === NOT_SET || contractValue === NOT_SET ? NOT_SET : contractValue - projectValue;
  const variancePercent: MoneyFigure =
    variance === NOT_SET || contractValue === NOT_SET || contractValue === 0 ? NOT_SET : (variance / contractValue) * 100;
  const quantityVariance: MoneyFigure =
    qtyContract === null || qtyProject === null || rateProject === null ? NOT_SET : (qtyContract - qtyProject) * rateProject;
  const rateVariance: MoneyFigure =
    rateContract === null || rateProject === null || qtyContract === null ? NOT_SET : (rateContract - rateProject) * qtyContract;

  return { projectValue, contractValue, variance, variancePercent, quantityVariance, rateVariance };
}

export type BoqCellValidation = { valid: true } | { valid: false; refused: boolean; reason: string };

/** 2-04, mirrored exactly from boq-dual-view-service.ts's validateBoqCellEdit. */
export function validateCellEdit(field: "qty" | "rate", raw: string): BoqCellValidation {
  const trimmed = raw.trim();
  if (trimmed === "") return { valid: true };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { valid: false, refused: true, reason: "Enter a number." };
  if (n < 0) {
    if (field === "qty") return { valid: false, refused: true, reason: "Quantity cannot be negative." };
    return { valid: false, refused: false, reason: "Negative rate — confirm this is intended (e.g. a credit line)." };
  }
  return { valid: true };
}

// R67 D-61: number/money formatting goes through formatNumber()/
// useOrgMoney()'s bound formatters, never a bare toFixed/toLocaleString --
// those pick the RUNTIME's own locale, which differs between the server's
// SSR pass and the browser and produces a hydration mismatch.
function formatFigure(value: MoneyFigure | undefined, money: (v: number) => string, decimals = false): string {
  if (value === undefined) return "–";
  if (value === NOT_SET) return NOT_SET;
  return decimals ? money(value) : `${formatNumber(value, { fractionDigits: 2 })}%`;
}

// ─── Server response shapes ────────────────────────────────────────────────

export type DualViewLine = {
  id: string;
  itemCode: string | null;
  parentLineItemId: string | null;
  breakdownPercentage?: string | null;
  description: string;
  unit: string;
  quantity: string;
  rate: string;
  qtyProject?: string | null;
  rateProject?: string | null;
  qtyContract?: string | null;
  rateContract?: string | null;
  projectValue?: MoneyFigure;
  contractValue?: MoneyFigure;
  variance?: MoneyFigure;
  variancePercent?: MoneyFigure;
  quantityVariance?: MoneyFigure;
  rateVariance?: MoneyFigure;
};

export type DualViewBoq = {
  id: string;
  status: string;
  hasConfirmedBaseline?: boolean;
  latestBaselineVersion?: number | null;
  lineItems: DualViewLine[];
  moneyView?: { projectValue: MoneyFigure; contractValue: MoneyFigure; variance: MoneyFigure; variancePercent: MoneyFigure; rootLineCount: number };
  costCoverage?: { coveredContractValue: number; totalContractValue: MoneyFigure; coverageRatio: MoneyFigure };
};

type SortKey = "variance" | "variancePercent" | "contractValue" | "quantityVariance";
const SORT_LABEL: Record<SortKey, string> = {
  variance: "Variance", variancePercent: "Variance %", contractValue: "Contract Value", quantityVariance: "Qty Variance",
};

/**
 * 1-02/D90: on a legacy line (created before this phase, or through the
 * existing single-value create form which still does not populate
 * qty_contract/rate_contract -- confirmed directly against
 * construction-boq-service.dual-view-write.test.ts, a real, disclosed gap
 * upstream of this file) the ORIGINAL quantity/rate columns "ALWAYS meant
 * the quoted (contract) figure" (drizzle/0593's own migration comment,
 * which backfilled every PRE-EXISTING row this exact way). This is a
 * DISPLAY-ONLY fallback for a line whose dual-view contract columns are
 * genuinely still null -- it changes nothing stored; the real qty_contract/
 * rate_contract columns are only ever written when a user actually edits a
 * cell here, through the real PATCH path.
 */
function effectiveContract(line: DualViewLine): { qty: string; rate: string } {
  return {
    qty: line.qtyContract ?? line.quantity,
    rate: line.rateContract ?? line.rate,
  };
}

function fetchBoq(boqId: string, view?: "customer"): Promise<DualViewBoq> {
  return readBoqDualView<DualViewBoq>(boqId, view);
}

export default function BoqDualViewGrid({ boqId }: { boqId: string }) {
  const [internal, setInternal] = useState<DualViewBoq | null>(null);
  const [customer, setCustomer] = useState<DualViewBoq | null>(null);
  const [view, setView] = useState<"internal" | "customer">("internal");
  const [loading, setLoading] = useState(true);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  // Provisional, in-progress edits -- keyed by lineId -- overlaying the last
  // server-known value so 2-05/2-06 can react on every keystroke, not just
  // after a save round-trip. Cleared for a line the moment its own save
  // response comes back (setLineFromServer), see header.
  const [drafts, setDrafts] = useState<Record<string, DualViewInput>>({});
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [cellWarning, setCellWarning] = useState<Record<string, string>>({});
  const [lockedReason, setLockedReason] = useState<string | null>(null);
  const orgMoney = useOrgMoney();

  const loadInternal = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchBoq(boqId);
      setInternal(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load this BOQ's money view");
    } finally {
      setLoading(false);
    }
  }, [boqId]);

  useEffect(() => { void loadInternal(); }, [loadInternal]);

  // 2-09: ONE-CLICK VIEW SWITCH. A REAL, FRESH server round trip every time
  // -- never cached/reused -- so this is a genuine preview of what the
  // customer receives right now, not a stale one from an earlier click.
  async function switchToCustomer() {
    setView("customer");
    setCustomerLoading(true);
    try {
      const data = await fetchBoq(boqId, "customer");
      setCustomer(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load the customer preview");
      setView("internal");
    } finally {
      setCustomerLoading(false);
    }
  }

  function draftFor(line: DualViewLine): DualViewInput {
    return {
      qtyProject: drafts[line.id]?.qtyProject ?? line.qtyProject ?? null,
      rateProject: drafts[line.id]?.rateProject ?? line.rateProject ?? null,
      qtyContract: drafts[line.id]?.qtyContract ?? effectiveContract(line).qty,
      rateContract: drafts[line.id]?.rateContract ?? effectiveContract(line).rate,
    };
  }

  const lines = internal?.lineItems ?? [];

  // 2-07: sort ROOT lines by the chosen key; each root's own children travel
  // immediately after it, in their original order (a sub-task is never
  // separated from its parent by a sort -- it has no contract/project value
  // of its own that is meaningful in isolation, A7).
  const sortedRootLines = useMemo(() => {
    const roots = lines.filter((l) => !l.parentLineItemId);
    if (!sort) return roots;
    const value = (l: DualViewLine): MoneyFigure => computeLineMoneyView(draftFor(l))[sort.key];
    return [...roots].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === NOT_SET && vb === NOT_SET) return 0;
      if (va === NOT_SET) return 1; // NOT_SET always last, 2-07/compareBoqLinesBySortKey parity
      if (vb === NOT_SET) return -1;
      return sort.dir === "asc" ? va - vb : vb - va;
    });
    // drafts is intentionally NOT a dependency here, even though draftFor()
    // closes over it: re-sorting on every keystroke would fight the user's
    // own typing mid-edit, so this only re-sorts on a data/sort-control
    // change, matching a spreadsheet's own "sort is a deliberate action"
    // convention -- the sort ORDER can lag an in-progress draft by design,
    // while the VALUES shown always reflect the live draft (draftFor is
    // still called fresh on every render, only the ORDER is memoized here).
  }, [lines, sort]);

  function childrenOf(rootId: string | null): DualViewLine[] {
    return lines.filter((l) => l.parentLineItemId === rootId);
  }

  function setLineFromServer(updated: DualViewLine) {
    setInternal((prev) => {
      if (!prev) return prev;
      return { ...prev, lineItems: prev.lineItems.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)) };
    });
    setDrafts((prev) => { const next = { ...prev }; delete next[updated.id]; return next; });
  }

  // 2-04 (client-side, immediate feedback) + server-side backstop
  // (construction-boq-service.ts's updateLineItemMoneyFields, the same
  // rules, mirrored per this file's header) -- refused edits never reach
  // the network at all; a warned-not-refused negative rate is sent through.
  async function commitCell(line: DualViewLine, field: keyof DualViewInput, raw: string) {
    const cellKey = `${line.id}:${field}`;
    const kind = field === "qtyProject" || field === "qtyContract" ? "qty" : "rate";
    const check = validateCellEdit(kind, raw);
    if (!check.valid && check.refused) {
      toast.error(check.reason);
      return;
    }
    setCellWarning((prev) => {
      const next = { ...prev };
      if (!check.valid && !check.refused) next[cellKey] = check.reason; else delete next[cellKey];
      return next;
    });

    const value = raw.trim() === "" ? null : Number(raw);
    setSavingCell(cellKey);
    try {
      const res = await fetch(`/api/scope/line-items/${line.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 2-02: the server's own refusal IS the "REFUSES the edit and
        // EXPLAINS WHY" — shown verbatim, and the field's own next render
        // pre-locks (lockedReason below) so a second attempt does not need
        // to round-trip to be told the same thing again.
        if (res.status === 409) setLockedReason(data.error ?? "The contract side is locked.");
        toast.error(data.error ?? "Couldn't save this cell");
        setDrafts((prev) => { const next = { ...prev }; delete next[line.id]; return next; }); // revert to last known-good
        return;
      }
      setLineFromServer(data as DualViewLine);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save this cell");
    } finally {
      setSavingCell(null);
    }
  }

  function onCellChange(lineId: string, field: keyof DualViewInput, raw: string) {
    // 2-05/2-06: updates the LIVE draft on every keystroke, which is what
    // makes the Part C block and the negative-variance highlight react as
    // the user types, not only after blur/save.
    setDrafts((prev) => ({ ...prev, [lineId]: { ...prev[lineId], [field]: raw === "" ? null : raw } }));
  }

  // 2-03: Excel column paste. A copy from Excel arrives as newline-separated
  // rows (each row possibly tab-separated if multiple columns were copied --
  // only the first token is used, since this handler is bound to one column
  // at a time). Applied starting at the pasted cell's own row, down through
  // the currently visible root-line order -- the same order the user is
  // looking at, sorted or not.
  function onPasteColumn(e: React.ClipboardEvent<HTMLInputElement>, startRootIndex: number, field: keyof DualViewInput) {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\n") && !text.includes("\r")) return; // a single value: let the native paste happen
    e.preventDefault();
    const values = text.split(/\r\n|\n|\r/).filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ""));
    values.forEach((raw, offset) => {
      const root = sortedRootLines[startRootIndex + offset];
      if (!root) return;
      const token = raw.split("\t")[0]!.trim();
      onCellChange(root.id, field, token);
      void commitCell(root, field, token);
    });
  }

  // 2-03: arrow-key navigation across the 4-column grid. Refs indexed
  // "lineId:field" so Up/Down move within a column and Left/Right move
  // within a row, skipping a field this line does not expose (a sub-task's
  // quantity/rate cells do not exist in this grid -- sub-tasks are excluded
  // from the money model per A7/R-32, same as the roll-up). Tab/Shift+Tab
  // need no handler at all: native DOM order already matches reading order.
  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const FIELD_ORDER: (keyof DualViewInput)[] = ["qtyProject", "rateProject", "qtyContract", "rateContract"];
  function onCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>, rootIndex: number, field: keyof DualViewInput) {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    let nextRow = rootIndex;
    let nextFieldIndex = FIELD_ORDER.indexOf(field);
    if (e.key === "ArrowUp") nextRow -= 1;
    if (e.key === "ArrowDown") nextRow += 1;
    if (e.key === "ArrowLeft") nextFieldIndex -= 1;
    if (e.key === "ArrowRight") nextFieldIndex += 1;
    const nextLine = sortedRootLines[nextRow];
    const nextField = FIELD_ORDER[nextFieldIndex];
    if (!nextLine || !nextField) return;
    cellRefs.current[`${nextLine.id}:${nextField}`]?.focus();
  }

  if (loading) return <div className="border-b border-ct-border px-4 py-6 text-sm text-ct-muted">Loading the money view…</div>;
  if (error || !internal) {
    return (
      <div className="space-y-2 border-b border-ct-border px-4 py-4">
        <p role="alert" className="text-[13px] text-px-error">{error ?? "Couldn't load this BOQ's money view"}</p>
        <Button variant="outline" size="sm" onClick={() => void loadInternal()}>Retry</Button>
      </div>
    );
  }

  const contractLocked = internal.hasConfirmedBaseline === true;

  return (
    <div className="border-b border-ct-border" data-testid="boq-dual-view-grid">
      {/* 2-09: the switch. A PREVIEW of what the customer receives, never a
          contract-vs-cost toggle (E1) -- see this file's header for why
          switching triggers a real fetch instead of hiding columns. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ct-border bg-px-cloud px-4 py-2">
        <h3 className="text-[13px] font-semibold text-ct-navy">Money model</h3>
        <div className="flex items-center gap-1" role="group" aria-label="View">
          <Button
            type="button" size="sm" variant={view === "internal" ? "default" : "outline"}
            onClick={() => setView("internal")}
            aria-pressed={view === "internal"}
          >
            Internal
          </Button>
          <Button
            type="button" size="sm" variant={view === "customer" ? "default" : "outline"}
            onClick={() => void switchToCustomer()}
            aria-pressed={view === "customer"}
            disabled={customerLoading}
          >
            {customerLoading ? "Loading customer preview…" : "Customer preview"}
          </Button>
        </div>
      </div>

      {view === "customer"
        ? <CustomerView boq={customer} loading={customerLoading} orgMoney={orgMoney} />
        : (
          <>
            <PartCBlock boq={internal} drafts={drafts} lines={lines} orgMoney={orgMoney} />
            {contractLocked && (
              <p className="border-b border-ct-border bg-px-cloud px-4 py-2 text-[12px] text-ct-muted">
                🔒 Contract side locked — confirmed as baseline v{internal.latestBaselineVersion}. Project-side (cost) cells stay editable.
              </p>
            )}
            {lockedReason && <p role="alert" className="border-b border-ct-border px-4 py-2 text-[12px] text-px-error">{lockedReason}</p>}

            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-ct-border text-left text-[11px] font-medium uppercase tracking-wide text-ct-muted">
                    <th className="px-3 py-2" rowSpan={2}>Description</th>
                    <th className="px-3 py-2" rowSpan={2}>Unit</th>
                    {/* 2-01: project and contract GROUPED, visually distinct, side by side -- never a tab/toggle/collapse (A9 S-1, C-8). */}
                    <th className="border-l border-ct-border px-3 py-1 text-center" colSpan={2}>Project (cost)</th>
                    <th className="border-l border-ct-border px-3 py-1 text-center" colSpan={2}>Contract (customer)</th>
                    <th className="border-l border-ct-border px-3 py-2 text-right" rowSpan={2}>Variance</th>
                    <th className="px-3 py-2 text-right" rowSpan={2}>Variance %</th>
                  </tr>
                  <tr className="border-b border-ct-border text-right text-[11px] font-medium uppercase tracking-wide text-ct-muted">
                    <th className="border-l border-ct-border px-3 py-1">Qty</th>
                    <th className="px-3 py-1">Rate</th>
                    <th className="border-l border-ct-border px-3 py-1">Qty</th>
                    <th className="px-3 py-1">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRootLines.map((root, rootIndex) => (
                    <GridRow
                      key={root.id}
                      line={root}
                      rootIndex={rootIndex}
                      subLines={childrenOf(root.id)}
                      draft={draftFor(root)}
                      lockedContract={contractLocked}
                      savingCell={savingCell}
                      cellWarning={cellWarning}
                      cellRefs={cellRefs}
                      onCellChange={onCellChange}
                      onCommitCell={commitCell}
                      onPasteColumn={onPasteColumn}
                      onCellKeyDown={onCellKeyDown}
                      orgMoney={orgMoney}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <SortControls sort={sort} onChange={setSort} />
          </>
        )}
    </div>
  );
}

function SortControls({ sort, onChange }: { sort: { key: SortKey; dir: "asc" | "desc" } | null; onChange: (s: { key: SortKey; dir: "asc" | "desc" } | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1 px-4 py-2 text-[11.5px]">
      <span className="text-ct-muted">Sort:</span>
      {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => {
        const active = sort?.key === key;
        return (
          <button
            key={key} type="button"
            className={`rounded border px-2 py-1 ${active ? "border-ct-navy bg-ct-navy text-white" : "border-ct-border text-ct-navy"}`}
            onClick={() => onChange(active ? (sort!.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" })}
          >
            {SORT_LABEL[key]}{active ? (sort!.dir === "asc" ? " ↑" : " ↓") : ""}
          </button>
        );
      })}
    </div>
  );
}

function GridRow({
  line, rootIndex, subLines, draft, lockedContract, savingCell, cellWarning, cellRefs,
  onCellChange, onCommitCell, onPasteColumn, onCellKeyDown, orgMoney,
}: {
  line: DualViewLine;
  rootIndex: number;
  subLines: DualViewLine[];
  draft: DualViewInput;
  lockedContract: boolean;
  savingCell: string | null;
  cellWarning: Record<string, string>;
  cellRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  onCellChange: (lineId: string, field: keyof DualViewInput, raw: string) => void;
  onCommitCell: (line: DualViewLine, field: keyof DualViewInput, raw: string) => void | Promise<void>;
  onPasteColumn: (e: React.ClipboardEvent<HTMLInputElement>, rootIndex: number, field: keyof DualViewInput) => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, rootIndex: number, field: keyof DualViewInput) => void;
  orgMoney: ReturnType<typeof useOrgMoney>;
}) {
  const money = computeLineMoneyView(draft);
  // 2-06: a NEGATIVE variance is visually distinct AS IT IS TYPED -- driven
  // by `money`, which is recomputed from the live `draft` on every render,
  // not from the last-saved server value.
  const isLoss = typeof money.variance === "number" && money.variance < 0;

  function cell(field: keyof DualViewInput, locked: boolean, lockReason?: string) {
    const cellKey = `${line.id}:${field}`;
    const warning = cellWarning[cellKey];
    return (
      <td className={field === "qtyProject" || field === "qtyContract" ? "border-l border-ct-border px-2 py-1" : "px-2 py-1"}>
        <Input
          ref={(el) => { cellRefs.current[cellKey] = el; }}
          aria-label={`${field} for ${line.description}`}
          type="number" inputMode="decimal"
          className="w-24 text-right tabular-nums"
          value={(draft[field] ?? "") as string | number}
          disabled={locked || savingCell === cellKey}
          title={locked ? lockReason : undefined}
          onChange={(e) => onCellChange(line.id, field, e.target.value)}
          onBlur={(e) => onCommitCell(line, field, e.target.value)}
          onPaste={(e) => onPasteColumn(e, rootIndex, field)}
          onKeyDown={(e) => onCellKeyDown(e, rootIndex, field)}
        />
        {warning && <p className="mt-0.5 text-[10px] text-px-error">{warning}</p>}
      </td>
    );
  }

  return (
    <>
      <tr className={`border-b border-ct-border ${isLoss ? "bg-px-error-light" : ""}`} data-testid={`boq-grid-row-${line.id}`} data-loss={isLoss ? "true" : "false"}>
        <td className="px-3 py-2 font-medium text-ct-navy">{line.description}</td>
        <td className="px-3 py-2 text-ct-muted">{line.unit}</td>
        {cell("qtyProject", false)}
        {cell("rateProject", false)}
        {cell("qtyContract", lockedContract, "The contract side is locked — this BOQ was confirmed. Post-confirmation contract changes need a cited evidence artefact and a new baseline version.")}
        {cell("rateContract", lockedContract, "The contract side is locked — this BOQ was confirmed. Post-confirmation contract changes need a cited evidence artefact and a new baseline version.")}
        <td className={`border-l border-ct-border px-3 py-2 text-right tabular-nums ${isLoss ? "font-semibold text-px-error" : ""}`}>
          {isLoss ? "LOSS " : typeof money.variance === "number" ? "PROFIT " : ""}
          {formatFigure(money.variance, orgMoney.money, true)}
        </td>
        <td className={`px-3 py-2 text-right tabular-nums ${isLoss ? "font-semibold text-px-error" : ""}`}>
          {formatFigure(money.variancePercent, orgMoney.money)}
        </td>
      </tr>
      {subLines.map((child) => (
        <tr key={child.id} className="border-b border-ct-border text-ct-muted">
          <td className="pl-8 pr-3 py-1.5">{child.description}{child.breakdownPercentage ? ` — ${child.breakdownPercentage}% of parent` : ""}</td>
          <td className="px-3 py-1.5">{child.unit}</td>
          <td className="border-l border-ct-border px-3 py-1.5 text-right text-[11px]" colSpan={4}>sub-task — excluded from the money model (A7/R-32, same rule as the roll-up)</td>
          <td className="border-l border-ct-border px-3 py-1.5" />
          <td className="px-3 py-1.5" />
        </tr>
      ))}
    </>
  );
}

/**
 * PART C (2-05: updates LIVE as any cell changes -- driven by `drafts`, not
 * a server round trip). Scoped to what Phase 2 actually owns: contract vs.
 * project value, profit/loss at both money's own PROFIT/LOSS wording (C-1),
 * visually distinct on a loss (C-2), NOT_SET rendered literally (C-5), and
 * the cost-coverage indicator (2-08). The gross/net VAT/retention stack and
 * committed/spent are Phase 4/5's own figures -- not built here, and not
 * reachable from any route yet either (checked directly: no committed/spent
 * or gross/net endpoint exists in compliance-tracker as of this pass) -- so
 * this block does not invent placeholder numbers for them.
 */
function PartCBlock({ boq, drafts, lines, orgMoney }: { boq: DualViewBoq; drafts: Record<string, DualViewInput>; lines: DualViewLine[]; orgMoney: ReturnType<typeof useOrgMoney> }) {
  const rootLines = lines.filter((l) => !l.parentLineItemId);
  let projectSum = 0, projectAny = false, contractSum = 0, contractAny = false;
  let coveredContractValue = 0, totalContractValue = 0, anyContract = false;

  for (const line of rootLines) {
    const draft: DualViewInput = {
      qtyProject: drafts[line.id]?.qtyProject ?? line.qtyProject ?? null,
      rateProject: drafts[line.id]?.rateProject ?? line.rateProject ?? null,
      qtyContract: drafts[line.id]?.qtyContract ?? effectiveContract(line).qty,
      rateContract: drafts[line.id]?.rateContract ?? effectiveContract(line).rate,
    };
    const m = computeLineMoneyView(draft);
    if (m.projectValue !== NOT_SET) { projectSum += m.projectValue; projectAny = true; }
    if (m.contractValue !== NOT_SET) {
      contractSum += m.contractValue; contractAny = true; totalContractValue += m.contractValue; anyContract = true;
      if (m.projectValue !== NOT_SET) coveredContractValue += m.contractValue;
    }
  }

  const projectValue: MoneyFigure = projectAny ? projectSum : NOT_SET;
  const contractValue: MoneyFigure = contractAny ? contractSum : NOT_SET;
  const variance: MoneyFigure = projectValue === NOT_SET || contractValue === NOT_SET ? NOT_SET : contractValue - projectValue;
  const variancePercent: MoneyFigure =
    variance === NOT_SET || contractValue === NOT_SET || contractValue === 0 ? NOT_SET : (variance / contractValue) * 100;
  const coverageRatio: MoneyFigure = !anyContract || totalContractValue === 0 ? NOT_SET : (coveredContractValue / totalContractValue) * 100;
  const isLoss = typeof variance === "number" && variance < 0;
  // 2-08: profit over a PARTIAL cost sheet is labelled PARTIAL, never complete.
  const partial = coverageRatio !== NOT_SET && coverageRatio < 100;

  return (
    <div className="space-y-1.5 border-b border-ct-border px-4 py-3" data-testid="boq-part-c-block">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <span className="text-[12.5px] text-ct-muted">Contract value (root lines)</span>
        <span className="font-medium tabular-nums">{formatFigure(contractValue, orgMoney.money, true)}</span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <span className="text-[12.5px] text-ct-muted">Project value (cost, root lines)</span>
        <span className="font-medium tabular-nums">{formatFigure(projectValue, orgMoney.money, true)}</span>
      </div>
      <div className={`flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-ct-border pt-1.5 ${isLoss ? "text-px-error" : "text-px-success"}`}>
        {/* C-1: the WORD changes on a loss, not just the sign. C-2: visually distinct without reading the number. */}
        <span className="font-semibold">{isLoss ? "LOSS" : typeof variance === "number" ? "PROFIT" : "Variance"}{partial ? " (PARTIAL)" : ""}</span>
        <span className="font-semibold tabular-nums">
          {formatFigure(variance, orgMoney.money, true)}
          {variancePercent !== NOT_SET ? ` (${formatFigure(variancePercent, orgMoney.money)})` : ""}
        </span>
      </div>
      {/* 2-08: cost coverage. */}
      <p className="text-[11.5px] text-ct-muted" data-testid="boq-cost-coverage">
        Cost coverage: {coverageRatio === NOT_SET ? NOT_SET : `${formatNumber(coverageRatio, { fractionDigits: 1 })}%`} of contract value has a project-side rate entered
        {partial ? " — profit shown above is PARTIAL, not complete." : ""}
      </p>
    </div>
  );
}

/**
 * ★ THE CUSTOMER VIEW ★ (E1, X-14, X-15). Deliberately receives ONLY
 * `boq`/`loading` -- never the internal `drafts`/`lines` the internal grid
 * uses -- and destructures ONLY contract-side keys off each line item below.
 * There is no code path in this function capable of reading qtyProject/
 * rateProject/projectValue/variance/variancePercent/quantityVariance/
 * rateVariance even if the server response somehow carried one (it does
 * not: compliance-tracker's `?view=customer` branch calls
 * redactProjectSideFields() unconditionally, independent of the caller's
 * own cost visibility -- see that route's own comment).
 */
function CustomerView({ boq, loading, orgMoney }: { boq: DualViewBoq | null; loading: boolean; orgMoney: ReturnType<typeof useOrgMoney> }) {
  if (loading || !boq) return <div className="px-4 py-6 text-sm text-ct-muted">Loading the customer preview…</div>;
  const rootLines = boq.lineItems.filter((l) => !l.parentLineItemId);
  let total = 0, any = false;
  for (const l of rootLines) {
    const qty = toFinite(l.qtyContract ?? l.quantity);
    const rate = toFinite(l.rateContract ?? l.rate);
    if (qty !== null && rate !== null) { total += qty * rate; any = true; }
  }
  return (
    <div data-testid="boq-customer-preview">
      <p className="border-b border-ct-border bg-px-cloud px-4 py-2 text-[11.5px] text-ct-muted">
        This is exactly what the customer will see — no project-side cost or variance figures.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-ct-border text-left text-[11px] font-medium uppercase tracking-wide text-ct-muted">
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rootLines.map((l) => {
              const qty = l.qtyContract ?? l.quantity;
              const rate = l.rateContract ?? l.rate;
              const qtyN = toFinite(qty), rateN = toFinite(rate);
              const amount = qtyN !== null && rateN !== null ? qtyN * rateN : null;
              return (
                <tr key={l.id} className="border-b border-ct-border">
                  <td className="px-3 py-2 font-medium text-ct-navy">{l.description}</td>
                  <td className="px-3 py-2 text-ct-muted">{l.unit}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{orgMoney.money(rate ?? null)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{amount === null ? "–" : orgMoney.money(amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end px-4 py-2 text-[13px] font-semibold text-ct-navy">
        Contract value: {any ? orgMoney.money(total) : "–"}
      </div>
    </div>
  );
}
