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
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { useDeleteConfirmation } from "@/components/DeleteConfirmation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useCurrencies } from "@/lib/currency";
import { formatMoney } from "@/lib/format";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import {
  type Boq, type BoqLineItemRow, type Vendor,
  boqTotal, withCurrency, childPercentSum, derivedSubQtyRate,
} from "@/lib/boq-helpers";

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
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
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

  async function saveLineItemBudget(rowId: string, patch: { budgetPercentage?: number; vendorId?: string | null; vendorAmount?: number | null }) {
    setSavingRowId(rowId);
    try {
      const res = await fetch(`/api/scope/line-items/${rowId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...data } : r)));
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save budget/vendor");
    } finally {
      setSavingRowId(null);
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

  // R67 D-67: deleting a BOQ takes its line items with it, and a QS may
  // have spent an afternoon building them. The kit fired this from a single
  // click. Declared before the early returns below, because a hook must be.
  const removal = useDeleteConfirmation({
    objectLabel: "BOQ",
    identifier: boq ? `${boq.title} (v${boq.version})` : null,
    extra: rows.length > 0 ? `and its ${rows.length} line item${rows.length === 1 ? "" : "s"}` : null,
    run: () => runAction("delete"),
  });

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
      onDelete={isDraft ? removal.request : undefined}
      deleteDisabledReason={isDraft ? undefined : "Only a draft BOQ can be deleted"}
      // Real Back, preserving ?projectId= — derived from the loaded BOQ
      // itself (same pattern as PermitObjectClient's permit.projectId), not
      // a page-level query param, so Back is correct even from a bookmarked
      // /scope/{id} URL with no ?projectId= at all. router.back() alone has
      // no history entry to return to after a full reload.
      onBack={() => router.push(`/scope?projectId=${boq.projectId}`)}
      messages={[]}
    >
      {/* Real, object-specific workflow toolbar — BOQ's own actions, since
          ObjectScreen's fixed footer has no slot for anything beyond
          Edit/Delete/Save/Cancel. Every button here maps to a real endpoint
          this same pass either confirmed or (submit/approve) built for the
          first time — see api/scope/[id]/submit and .../approve. */}
      {removal.card}
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
              <TableHead>Description</TableHead><TableHead>Unit</TableHead>
              <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Budget %</TableHead><TableHead className="text-right">Budget</TableHead>
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
              const saving = savingRowId === r.id;
              const budget = r.computedBudget ?? (Number(r.amount) * (Number(r.budgetPercentage ?? 0) / 100));
              return (
                <TableRow key={r.id}>
                  <TableCell className={isSub ? "pl-8 text-ct-muted" : "font-medium text-ct-navy"}>
                    {r.description}
                    {r.itemCode && <span className="ml-2 font-mono text-[10px] text-ct-muted">{r.itemCode}</span>}
                    {isSub && r.breakdownPercentage && <span className="ml-2 text-[10px] text-ct-muted">{r.breakdownPercentage}% of parent</span>}
                    {!isSub && childSum !== null && <span className="ml-2 text-[10px] text-ct-muted">(children: {childSum}%)</span>}
                  </TableCell>
                  <TableCell className="text-ct-muted">{r.unit}</TableCell>
                  <TableCell className="text-right">{isSub ? (derived?.qty ?? "—") : r.quantity}</TableCell>
                  <TableCell className="text-right">{isSub ? (derived ? formatMoney(derived.rate) : "—") : formatMoney(r.rate)}</TableCell>
                  <TableCell className="text-right font-medium">{withCurrency(currencyCode, r.amount)}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number" disabled={saving} className="w-20 text-right" defaultValue={r.budgetPercentage ?? "25"}
                      onBlur={(e) => {
                        const pct = Number(e.target.value);
                        if (!Number.isFinite(pct)) return;
                        saveLineItemBudget(r.id, { budgetPercentage: pct });
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right text-ct-muted">{withCurrency(currencyCode, budget)}</TableCell>
                  <TableCell>
                    <Select disabled={saving} value={r.vendorId ?? undefined} onValueChange={(vendorId) => saveLineItemBudget(r.id, { vendorId })}>
                      <SelectTrigger className="w-[150px]"><SelectValue placeholder="No vendor" /></SelectTrigger>
                      <SelectContent>
                        {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number" disabled={saving} className="w-24 text-right" defaultValue={r.vendorAmount ?? ""} placeholder="—"
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const amt = raw === "" ? null : Number(raw);
                        if (raw !== "" && !Number.isFinite(amt)) return;
                        saveLineItemBudget(r.id, { vendorAmount: amt });
                      }}
                    />
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
