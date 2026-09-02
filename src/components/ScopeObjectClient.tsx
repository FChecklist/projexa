"use client";

// Real-screen conversion (2026-08-30, owner directive: "real screens with
// real built the SAP way — real Object Page routes, real Back/Edit/Delete").
// This is the Scope (BOQ) Object Page — the real replacement for
// ScopeClient.tsx's old "View" Dialog popup. Built on the SAME ObjectScreen
// archetype PermitObjectClient.tsx already proves works (real display mode,
// real Back preserving ?projectId=, real Delete gated on the backend's own
// rule). ObjectScreen's footer is fixed to Edit/Delete/Save/Cancel only (no
// generic custom-action slot) — BOQ's own workflow actions (Submit for
// Approval / Approve / Create Revision / Compare) render as a real toolbar
// in the body instead, immediately below the header, matching a real SAP
// Object Page's own object-specific action bar.
//
// ─── R67 lane D22 (item D-76, rec R-288): THE CELLS SAY WHAT HAPPENED ──────
// Every inline editor on this page used to report through a corner toast --
// "Saved" and "Couldn't save budget/vendor" both, three columns away from the
// cell they were about. Worse, on failure the typed value stayed in the box:
// the screen showed a number the server had refused, as though it had been
// accepted, and the next person to read the BOQ had no way to tell. The cells
// now say "Saving…", then "Saved" for three seconds, or the backend's own
// message in rose beside the cell WITH THE PREVIOUS VALUE PUT BACK -- through
// the same useLineItemSaver both budget screens already use, so the three
// screens that edit these fields cannot drift apart.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { takeFooterMessage, type FooterMessage } from "@/lib/footer-message";
import {
  type Boq, type BoqLineItemRow, type Vendor,
  boqTotal, withCurrency, childPercentSum, derivedSubQtyRate, NO_CATEGORY_CHIP_LABEL,
} from "@/lib/boq-helpers";
import BoqCategorySelect, { useBoqCategories } from "@/components/BoqCategorySelect";
import { CellFeedback, useLineItemSaver, type BudgetFieldKey } from "@/components/BudgetLineCells";

// Real StatusTone values only ("needs-you" | "running" | "waiting" | "done" |
// "late" | "neutral" -- veridian-ui-kit/screens/types.ts). "submitted"
// genuinely needs a manager's action, so "needs-you"; "superseded" is just a
// historical, no-longer-current revision, not a failure, so plain "neutral".
const STATUS_TONE: Record<string, "needs-you" | "running" | "waiting" | "done" | "late" | "neutral"> = {
  draft: "neutral", submitted: "needs-you", approved: "done", superseded: "neutral",
};

export default function ScopeObjectClient({ boqId }: { boqId: string }) {
  const router = useRouter();
  const [boq, setBoq] = useState<Boq | null>(null);
  const [rows, setRows] = useState<BoqLineItemRow[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  // R67 D-76: one counter per cell, bumped when a save fails. It is the React
  // `key` of that cell's uncontrolled <input>, so a failure remounts the input
  // and it reads the STORED value again -- the rejected keystrokes are gone
  // from the screen, which is the only honest thing for the cell to show.
  const [revertToken, setRevertToken] = useState<Record<string, number>>({});
  // R67 lane D22 (item D-52): the import receipt, written on /scope/import
  // just before it navigated here. Taken ONCE on mount and then held in state,
  // so it persists on screen (the kit's MessageArea, never a toast -- see that
  // component's own header) without re-announcing itself on every reload.
  const [receipt, setReceipt] = useState<FooterMessage | null>(null);
  // R67 lane I (WS-I item I-05, R-177): the org's category list, so the
  // Category column is a real pick-list here too and not free text that would
  // invent a new category on every typo.
  const { categories, failed: categoriesFailed, addLocal } = useBoqCategories();
  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";

  async function load() {
    setLoading(true);
    try {
      // The real backend response for GET /api/scope/{id} is the BOQ's own
      // fields PLUS lineItems -- one real call, matching how the old View
      // dialog loaded it. Vendors fetched alongside for the inline vendor
      // Select (real, already-working PATCH per line item).
      const [data, vendorsData] = await Promise.all([
        fetchJson<Boq & { lineItems: BoqLineItemRow[] }>(`/api/scope/${boqId}`),
        fetchJson<{ vendors: Vendor[] }>(`/api/vendors`).catch(() => ({ vendors: [] })),
      ]);
      setBoq({ id: data.id, projectId: data.projectId, version: data.version, title: data.title, status: data.status, parentBoqId: data.parentBoqId, createdAt: data.createdAt });
      setRows(data.lineItems ?? []);
      setVendors(vendorsData.vendors ?? []);
      setLoadError(null);
    } catch (err) {
      setBoq(null);
      setLoadError(errorMessage(err, "Couldn't load this BOQ"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [boqId]);
  useEffect(() => { setReceipt(takeFooterMessage(`/scope/${boqId}`)); }, [boqId]);

  // R67 lane I (I-03/I-05) + D-76: one write path for every per-line budget
  // field, shared with /budgets and Scope > Budget through useLineItemSaver --
  // the server's own response body is what the row then shows, so the cell and
  // the totals beneath it move together or not at all.
  const applyPatched = useCallback((lineItemId: string, patched: Record<string, unknown>) => {
    setRows((prev) => prev.map((r) => (r.id === lineItemId ? { ...r, ...(patched as Partial<BoqLineItemRow>) } : r)));
  }, []);
  const revertCell = useCallback((lineItemId: string, field: BudgetFieldKey) => {
    setRevertToken((prev) => ({ ...prev, [`${lineItemId}:${field}`]: (prev[`${lineItemId}:${field}`] ?? 0) + 1 }));
  }, []);
  const { cells, saveField } = useLineItemSaver(applyPatched, revertCell);

  /** The cell's own state and its remount key, so every column below reads the same two lines. */
  function cellKey(rowId: string, field: BudgetFieldKey) {
    return `${rowId}:${field}`;
  }

  // R67 lane I (I-05): "Add new" from the Category column registers the
  // category org-wide. A registration failure is surfaced, never swallowed --
  // but the name is still applied to the line, so nothing the user did is lost.
  async function registerCategory(name: string) {
    addLocal(name);
    try {
      const res = await fetch("/api/scope/categories", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok && res.status !== 409) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? `"${name}" was applied to this line but could not be added to the category list.`);
      }
    } catch {
      toast.error(`"${name}" was applied to this line but could not be added to the category list.`);
    }
  }

  async function runAction(action: "submit" | "approve" | "delete") {
    setActionBusy(action);
    try {
      const method = action === "delete" ? "DELETE" : "POST";
      const path = action === "delete" ? `/api/scope/${boqId}` : `/api/scope/${boqId}/${action}`;
      const res = await fetch(path, { method });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't ${action} this BOQ`);
      if (action === "delete") {
        toast.success("BOQ deleted");
        router.push(`/scope?projectId=${boq!.projectId}`);
        return;
      }
      toast.success(action === "submit" ? "Submitted for approval" : "Approved");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't ${action} this BOQ`);
    } finally {
      setActionBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (loading || !boq) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const total = boqTotal(rows);
  const isDraft = boq.status === "draft";

  return (
    <ObjectScreen
      breadcrumb="Scope / Bill of Quantities"
      title={boq.title}
      subtitle={`Version ${boq.version}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[boq.status] ?? "neutral", label: boq.status }}
      facets={[
        { label: "Total (root lines only)", value: withCurrency(currencyCode, total) },
        { label: "Line items", value: String(rows.length) },
      ]}
      // Real Delete, gated exactly on the backend's own rule (draft-only) —
      // never a fake-enabled button that fails after the click.
      onDelete={isDraft ? () => runAction("delete") : undefined}
      deleteDisabledReason={isDraft ? undefined : "Only a draft BOQ can be deleted"}
      // Real Back, preserving ?projectId= — derived from the loaded BOQ
      // itself (same pattern as PermitObjectClient's permit.projectId), not
      // a page-level query param, so Back is correct even from a bookmarked
      // /scope/{id} URL with no ?projectId= at all. router.back() alone has
      // no history entry to return to after a full reload.
      onBack={() => router.push(`/scope?projectId=${boq.projectId}`)}
      messages={receipt ? [{ level: receipt.level, text: receipt.text }] : []}
    >
      {/* Real, object-specific workflow toolbar — BOQ's own actions, since
          ObjectScreen's fixed footer has no slot for anything beyond
          Edit/Delete/Save/Cancel. Every button here maps to a real endpoint
          this same pass either confirmed or (submit/approve) built for the
          first time — see api/scope/[id]/submit and .../approve. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ct-border px-4 py-3">
        {isDraft && (
          <Button size="sm" disabled={actionBusy !== null} onClick={() => runAction("submit")}>
            {actionBusy === "submit" ? "Submitting…" : "Submit for Approval"}
          </Button>
        )}
        {boq.status === "submitted" && (
          <Button size="sm" disabled={actionBusy !== null} onClick={() => runAction("approve")}>
            {actionBusy === "approve" ? "Approving…" : "Approve"}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => router.push(`/scope/${boqId}/revise`)}>
          Create Revision
        </Button>
        {boq.parentBoqId && (
          <Button size="sm" variant="outline" onClick={() => router.push(`/scope/${boqId}/compare`)}>
            Compare to Previous
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-ct-muted">This BOQ has no line items.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              {/* R67 I-05 (R-177): the line's real category, editable in place
                  and saved through the same PATCH as Budget %/Vendor. */}
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Budget %</TableHead><TableHead className="text-right">Budget</TableHead>
              {/* R67 I-03: the material/manpower split of this line's budget. */}
              <TableHead className="text-right">Material</TableHead><TableHead className="text-right">Manpower</TableHead>
              <TableHead>Vendor</TableHead><TableHead className="text-right">Vendor Amt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const isSub = !!r.parentLineItemId;
              const derived = isSub ? derivedSubQtyRate(r, rows) : null;
              const childSum = !isSub ? childPercentSum(rows.map((row) => ({
                description: row.description, unit: row.unit, quantity: row.quantity, rate: row.rate,
                itemCode: row.itemCode ?? undefined, parentItemCode: rows.find((p) => p.id === row.parentLineItemId)?.itemCode ?? undefined,
                breakdownPercentage: row.breakdownPercentage ?? undefined,
              })), r.itemCode ?? undefined) : null;
              const budget = r.computedBudget ?? (Number(r.amount) * (Number(r.budgetPercentage ?? 0) / 100));
              return (
                // The anchor D-41's budget rows and D-64's work-progress cells
                // both link to (/scope/{boqId}#line-{id}). It never existed, so
                // those links landed at the top of the page; it does now.
                <TableRow key={r.id} id={`line-${r.id}`}>
                  <TableCell className={isSub ? "pl-8 text-ct-muted" : "font-medium text-ct-navy"}>
                    {r.description}
                    {r.itemCode && <span className="ml-2 font-mono text-[10px] text-ct-muted">{r.itemCode}</span>}
                    {isSub && r.breakdownPercentage && <span className="ml-2 text-[10px] text-ct-muted">{r.breakdownPercentage}% of parent</span>}
                    {!isSub && childSum !== null && <span className="ml-2 text-[10px] text-ct-muted">(children: {childSum}%)</span>}
                  </TableCell>
                  <TableCell>
                    <BoqCategorySelect
                      value={r.category ?? ""}
                      categories={categories}
                      failed={categoriesFailed}
                      onChange={(next) => saveField(r.id, "category", next.trim() === "" ? null : next)}
                      onAddNew={registerCategory}
                    />
                    {!r.category && (
                      <span className="ml-1 text-[10px] text-ct-muted">{NO_CATEGORY_CHIP_LABEL}</span>
                    )}
                    <CellFeedback state={cells[cellKey(r.id, "category")]} />
                  </TableCell>
                  <TableCell className="text-ct-muted">{r.unit}</TableCell>
                  <TableCell className="text-right">{isSub ? (derived?.qty ?? "—") : r.quantity}</TableCell>
                  <TableCell className="text-right">{isSub ? (derived ? derived.rate.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—") : r.rate}</TableCell>
                  <TableCell className="text-right font-medium">{withCurrency(currencyCode, r.amount)}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      aria-label="Budget percentage"
                      key={`${cellKey(r.id, "budgetPercentage")}:${revertToken[cellKey(r.id, "budgetPercentage")] ?? 0}`}
                      type="number" className="w-20 text-right" defaultValue={r.budgetPercentage ?? "25"}
                      onBlur={(e) => {
                        const pct = Number(e.target.value);
                        if (!Number.isFinite(pct)) return;
                        if (String(pct) === String(r.budgetPercentage ?? "25")) return;
                        saveField(r.id, "budgetPercentage", pct);
                      }}
                    />
                    <CellFeedback state={cells[cellKey(r.id, "budgetPercentage")]} />
                  </TableCell>
                  <TableCell className="text-right text-ct-muted">{withCurrency(currencyCode, budget)}</TableCell>
                  {/* R67 I-03: material/manpower split. Blank means NOT SPLIT
                      (the placeholder is a dash, never a 0) -- "unsplit" and
                      "split as zero" are different facts and the report keeps
                      them apart, so this editor must too. */}
                  {(["materialAmount", "manpowerAmount"] as const).map((field) => (
                    <TableCell key={field} className="text-right">
                      <Input
                        aria-label={field === "materialAmount" ? "Material amount" : "Manpower amount"}
                        key={`${cellKey(r.id, field)}:${revertToken[cellKey(r.id, field)] ?? 0}`}
                        type="number" className="w-24 text-right" defaultValue={r[field] ?? ""} placeholder="—"
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const amt = raw === "" ? null : Number(raw);
                          if (raw !== "" && !Number.isFinite(amt)) return;
                          if (raw === String(r[field] ?? "")) return;
                          saveField(r.id, field, amt);
                        }}
                      />
                      <CellFeedback state={cells[cellKey(r.id, field)]} />
                    </TableCell>
                  ))}
                  <TableCell>
                    {/* A controlled Select, so a rejected change never needs a
                        remount: the row is only updated from the server's own
                        response, and on failure it still shows the stored vendor. */}
                    <Select value={r.vendorId ?? undefined} onValueChange={(vendorId) => saveField(r.id, "vendorId", vendorId)}>
                      <SelectTrigger className="w-[150px]"><SelectValue placeholder="No vendor" /></SelectTrigger>
                      <SelectContent>
                        {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <CellFeedback state={cells[cellKey(r.id, "vendorId")]} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      aria-label="Vendor amount"
                      key={`${cellKey(r.id, "vendorAmount")}:${revertToken[cellKey(r.id, "vendorAmount")] ?? 0}`}
                      type="number" className="w-24 text-right" defaultValue={r.vendorAmount ?? ""} placeholder="—"
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const amt = raw === "" ? null : Number(raw);
                        if (raw !== "" && !Number.isFinite(amt)) return;
                        if (raw === String(r.vendorAmount ?? "")) return;
                        saveField(r.id, "vendorAmount", amt);
                      }}
                    />
                    <CellFeedback state={cells[cellKey(r.id, "vendorAmount")]} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </ObjectScreen>
  );
}
