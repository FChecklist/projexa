"use client";

// Real-screen conversion (2026-08-30): purchase orders never had a detail
// view -- getPurchaseOrder() already existed in erp-buying-service.ts with
// no plain GET route until this conversion. Real Object Page on the kit's
// ObjectScreen.
//
// R80 GAP-6 (2026-09-08): Edit and Delete now exist. The comment that stood
// on this line said "No generic Edit/Delete -- no updatePurchaseOrder()
// exists", and it was true of every layer: the service had no update and no
// cancel, and /api/procurement/purchase-orders/[id] exported GET only. Both
// halves were built for this fix -- updatePurchaseOrder()/
// cancelPurchaseOrder() in erp-buying-service.ts, PATCH/DELETE on that route.
//
// BOTH ARE DRAFT-ONLY, and the screen only offers them on a draft. That is a
// UX affordance, not the boundary: the real refusal is the service's 409,
// which also covers the case the status alone cannot -- a PO with a goods
// receipt already pointing at it. Delete is a real CANCEL (status ->
// 'cancelled'), the same "real Delete = real Cancel" convention
// InvoiceObjectClient and BudgetObjectClient use, because
// erp_purchase_receipts.purchaseOrderId is bare text with no FK and a row
// delete would strand it.
//
// EDIT IS THE HEADER ONLY -- vendor, order date, expected delivery. Line
// items are R80 GAP-7's subject: grandTotal is derived from them, so a line
// editor means recomputing the total and re-checking the goods-receipt guard,
// which is its own piece of work rather than a side effect of this one. (An
// earlier draft of this comment said no document in this repo can edit its
// lines after create. That was FALSE and is corrected here --
// BudgetObjectClient's edit mode edits draftLines and PATCHes lineItems to
// /api/project-budgets/[id]. The header-only scope stands on the reason
// above, which does not need that claim.)
//
// CREATED TWO WAYS, both real and both unchanged by this fix:
// /purchase-orders/new (PurchaseOrderCreateClient -> POST /api/purchase-orders
// -> redirects to this page), and "Convert to PO" from a Quotation
// (ProcurementClient.convertToPo). An earlier draft of this comment claimed
// there was no Create screen; there is.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDeleteConfirmation } from "@/components/DeleteConfirmation";
import { Send, PackageCheck } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type PurchaseOrder = {
  id: string; poNumber: number; status: string; orderDate: string; expectedDeliveryDate: string | null; supplierId: string; grandTotal: string;
  items: { id: string; description: string; quantity: string; rate: string; amount: string }[];
};
type Vendor = { id: string; vendorName: string };

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", submitted: "waiting", partially_received: "waiting", completed: "done", cancelled: "late" };

export default function PurchaseOrderObjectClient({ poId }: { poId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const label = currencyLabel(undefined, currencies);
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ supplierId: "", orderDate: "", expectedDeliveryDate: "" });
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  async function load() {
    try {
      const [data, vendorData] = await Promise.all([
        fetchJson<PurchaseOrder>(`/api/procurement/purchase-orders/${poId}`),
        fetchJson<{ vendors?: Vendor[] }>("/api/vendors").catch(() => ({ vendors: [] })),
      ]);
      setPo(data);
      setVendors(vendorData.vendors ?? []);
      setLoadError(null);
    } catch (err) {
      setPo(null);
      setLoadError(errorMessage(err, "Couldn't load this purchase order"));
    }
  }
  useEffect(() => { load(); }, [poId]);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/procurement/purchase-orders/${poId}/submit`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to submit purchase order");
      toast.success("Purchase order submitted");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit purchase order");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit() {
    if (!po) return;
    setDraft({
      supplierId: po.supplierId,
      orderDate: po.orderDate?.slice(0, 10) ?? "",
      expectedDeliveryDate: po.expectedDeliveryDate?.slice(0, 10) ?? "",
    });
    setMode("edit");
  }

  async function saveEdit() {
    if (!draft.supplierId || !draft.orderDate) { toast.error("Vendor and order date are required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/procurement/purchase-orders/${poId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: draft.supplierId,
          orderDate: draft.orderDate,
          // Cleared in the form means cleared on the record -- null, not "".
          expectedDeliveryDate: draft.expectedDeliveryDate || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to save purchase order");
      toast.success("Purchase order saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save purchase order");
    } finally {
      setSaving(false);
    }
  }

  async function cancelPo() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/procurement/purchase-orders/${poId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to cancel purchase order");
      toast.success("Purchase order cancelled");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel purchase order");
    } finally {
      setCancelling(false);
    }
  }

  // R67 D-67: the kit's ObjectScreen calls onDelete() straight from onClick, so
  // the confirm has to be armed by it rather than live inside it. Cancelling is
  // irreversible from this screen -- there is no un-cancel control anywhere and
  // the service refuses to edit or submit anything that is not a draft -- so
  // "This cannot be undone" is literally true here. The verb reads "Cancel
  // this purchase order" so the destructive button cannot be confused with the
  // card's own bare "Cancel" that backs out of it.
  //
  // The `verb` option renames the BUTTON only -- deleteConfirmation() in
  // create-screen.ts hard-codes the sentence as "Delete <subject><extra>?
  // This cannot be undone.", and that helper is shared by every screen that
  // really does destroy a row. So the correction rides in `extra`, which is
  // the one part of the sentence this screen controls: the user reads
  // "Delete purchase order PO-7 -- a cancellation, not a row delete: ..."
  // rather than a promise of a destruction that does not happen.
  // Declared before the early returns below, because a hook must be.
  const removal = useDeleteConfirmation({
    objectLabel: "Purchase Order",
    identifier: po ? `PO-${po.poNumber}` : null,
    extra: "-- a cancellation, not a row delete: it stays on file as 'cancelled', closed to Submit and Receive Goods",
    verb: "Cancel this",
    run: cancelPo,
  });

  const vendorName = vendors.find((v) => v.id === po?.supplierId)?.vendorName ?? po?.supplierId ?? "—";

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!po) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const isDraft = po.status === "draft";
  const missingRequired = !draft.supplierId || !draft.orderDate;

  return (
    <ObjectScreen
      breadcrumb="Procurement / Purchase Order"
      title={mode === "edit" ? `Edit PO-${po.poNumber}` : `PO-${po.poNumber}`}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[po.status] ?? "neutral", label: po.status.replace(/_/g, " ") }}
      facets={[
        { label: "Vendor", value: vendorName },
        { label: "Order Date", value: formatDate(po.orderDate) },
        { label: "Expected Delivery", value: po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : "—" },
        { label: "Grand Total", value: `${label}${Number(po.grandTotal).toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
      ]}
      // Offered on a draft only. The service refuses the rest with a 409 that
      // also catches what this cannot see -- a goods receipt already pointing
      // at the order -- and that sentence is what the toast shows.
      onEdit={isDraft && mode === "display" ? startEdit : undefined}
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      saveDisabled={saving || missingRequired}
      saveDisabledReason={saving ? "Saving…" : missingRequired ? "Vendor and order date are required" : undefined}
      onDelete={isDraft && mode === "display" ? removal.request : undefined}
      deleteDisabledReason={cancelling ? "Cancelling…" : undefined}
      // BACK GOES TO THE PROCUREMENT HUB. Untouched by this fix -- an earlier
      // draft of this comment claimed it was restoring a target some edit had
      // silently changed to "/purchase-orders", and git says otherwise: the
      // file's only commit (56d5671) introduced this exact line. It is
      // documented rather than changed because the choice is not obvious.
      // Two lists open this page -- /purchase-orders (its own sidebar pill,
      // AppSidebar.tsx:132)
      // and /procurement's tab 4 -- so Back cannot be right for both, and the
      // tie is broken by what is on this screen: the breadcrumb above reads
      // "Procurement / Purchase Order", and Back that disagrees with the
      // breadcrumb is the confusing one. It is also the idiom every sibling
      // procurement Object Page follows -- RfqObjectClient, RequisitionObject-
      // Client and GoodsReceiptObjectClient all go back to /procurement?tab=.
      onBack={() => router.push("/procurement?tab=purchase-orders")}
      messages={[]}
    >
      {removal.card}
      {mode === "edit" && (
        <div className="space-y-3 px-4 py-3">
          <div className="space-y-1.5">
            <Label htmlFor="po-vendor">Vendor</Label>
            <Select value={draft.supplierId} onValueChange={(v) => setDraft((d) => ({ ...d, supplierId: v }))}>
              <SelectTrigger id="po-vendor" className="w-full"><SelectValue placeholder={vendors.length ? "Pick a vendor" : "Loading…"} /></SelectTrigger>
              <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="po-order-date">Order Date</Label>
            <Input id="po-order-date" type="date" value={draft.orderDate} onChange={(e) => setDraft((d) => ({ ...d, orderDate: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="po-expected-delivery">Expected Delivery (optional)</Label>
            <Input id="po-expected-delivery" type="date" value={draft.expectedDeliveryDate} onChange={(e) => setDraft((d) => ({ ...d, expectedDeliveryDate: e.target.value }))} />
            <p className="text-[12px] text-px-muted">Line items are not editable here — a purchase order&apos;s lines are fixed at create.</p>
          </div>
        </div>
      )}
      {mode === "display" && (
        <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
          {isDraft && (
            <Button size="sm" disabled={submitting} onClick={submit}><Send className="size-4" /> {submitting ? "Submitting…" : "Submit"}</Button>
          )}
          {/* A cancelled PO is a dead end: it can no longer be submitted, and
              receiving against it would post stock for an order that was
              withdrawn. */}
          {!isDraft && po.status !== "cancelled" && (
            <Button size="sm" variant="outline" onClick={() => router.push(`/procurement/goods-receipts/new?poId=${po.id}`)}>
              <PackageCheck className="size-4" /> Receive Goods
            </Button>
          )}
        </div>
      )}
      <Table>
        <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
        <TableBody>
          {po.items.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-medium">{i.description}</TableCell>
              <TableCell className="text-right">{i.quantity}</TableCell>
              <TableCell className="text-right">{label}{Number(i.rate).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
              <TableCell className="text-right">{label}{Number(i.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ObjectScreen>
  );
}
