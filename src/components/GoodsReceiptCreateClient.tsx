"use client";

// Real-screen conversion (2026-08-30): replaces ProcurementClient.tsx's old
// "New Goods Receipt" Dialog popup with a real create screen. Accepts an
// optional poId prop (resolved server-side from ?poId= by the route's
// page.tsx, same pattern as every other project/id prefill this session --
// client-side useSearchParams() needs its own Suspense boundary, which this
// avoids) to prefill from PurchaseOrderObjectClient.tsx's "Receive Goods"
// action.
//
// R80 GAP-7 (2026-09-08), part 1 -- REPEATABLE LINES. The screen held ONE
// item/warehouse/quantity triple in three scalar useStates and posted
// `items: [{ … }]` -- a literal one-element array -- so receiving a delivery
// against a five-line purchase order took five separate goods receipts. The
// API has always taken an array of any length (VERIDIAN
// erp-goods-receipt-service.ts createPurchaseReceipt:
// `if (!input.items?.length) throw new ServiceError("At least one line item
// is required", 400)` -- a MINIMUM of one -- then `input.items.map(…)` into
// a bulk insert, and submitPurchaseReceipt already walks `receipt.items` in
// a for-loop opening one FIFO layer per line). Converted to the same
// repeatable line editor PurchaseOrderCreateClient.tsx uses.
//
// The warehouse moved from a single header field ONTO each row, because
// that is what the service actually validates:
// `if (input.items.some((i) => !i.warehouseId)) throw new
// ServiceError("Every line item requires a receiving warehouse", 400)`.
// A new row inherits the row above's warehouse, so the common
// one-truck-one-store case still takes one choice.
//
// R80 GAP-7 (2026-09-08), part 2 -- PREFILL FROM THE PO. This is the one
// create screen in the group that reads a backend record, and it used to
// read exactly one field off it: the PO's supplierId, copied out of the
// LIST response. The PO's own lines -- the entire content of the delivery
// being received -- were ignored, so "Receive Goods" on a purchase order
// opened a blank form the storekeeper had to retype from the paper docket.
// It now reads the single-PO route (GET /api/procurement/purchase-orders/
// [id], whose getPurchaseOrder() returns `with: { items: true }`) and seeds
// one editable row per PO line: the ordered quantity, the ordered item where
// the line names one, and the PO line's description as a read-only caption.
// That caption is not a nicety for the odd free-text line -- it is normally
// the ONLY thing identifying a seeded row. erp_purchase_order_items.itemId
// is nullable, so a seeded row may arrive with no stock item and the
// caption is then the only thing identifying it. Both PROJEXA paths that
// raise a purchase order now DO send an itemId when the buyer picks one
// (PurchaseOrderCreateClient.tsx posts `itemId: l.itemId || undefined`, and
// ProcurementClient.tsx's convertToPo() carries the quotation line's own
// itemId through) -- it is optional on both, because this product
// legitimately buys things that are not stock items. Every row stays editable and removable -- a
// delivery legitimately differs from its order (short
// shipment, damaged units, a split delivery), and a receipt that could not
// say so would be worse than the blank form it replaced.
//
// R80 GAP-7 (2026-09-08), part 3 -- THE PO LINE ID IS POSTED. Parts 1-2
// read every PO line and threw its id away, so each seeded row reached the
// API as an UNLINKED line. That was not cosmetic: `purchaseOrderItemId` is
// the only thing tying a received line back to what was ordered, and
// submitPurchaseReceipt uses it for two independent jobs.
//
// CREDITING THE ORDER. `if (item.purchaseOrderItemId && !parentPoCancelled)`
// adds the line's quantity to erp_purchase_order_items.receivedQuantity, and
// the header rollup reads that column straight back (`partiallyReceived =
// po.items.some((i) => Number(i.receivedQuantity) > 0)`). An unlinked line
// credits nothing, so a purchase order could never reach partially_received
// or completed however much was received against it.
//
// VALUING THE STOCK. A line that names a stock item opens its FIFO layer at
// `item.rate != null ? Number(item.rate) : undefined`, falling back under
// `if (rate === undefined && item.purchaseOrderItemId)` to the ORDERED rate.
// With no link and no rate on this payload, every layer opened at
// `rate ?? 0` -- zero-valued stock.
//
// THOSE TWO JOBS DO NOT SHARE A GUARD, and that is what makes the link
// enough on its own here. The crediting update runs FIRST, above
// submitPurchaseReceipt's `if (!item.itemId) continue`; the `continue` now
// gates only the stock posting. It used to sit above both, which was the
// binding gate, so for any PO line with no stock item -- which a PO may
// legitimately have, the column being nullable -- posting the id alone
// would still have left the order stuck. Each seeded row now carries its PO line's id and posts it as
// `purchaseOrderItemId`.
//
// NO RUNNING TOTAL HERE, deliberately: this payload's lines carry
// itemId/quantity/warehouseId and no rate, so there is no money on the
// document to total. (erp_purchase_receipt_items has a nullable rate
// column; submitPurchaseReceipt falls back to the linked PO item's rate,
// which is exactly what the purchaseOrderItemId above now makes reachable.
// A hand-entered row with no PO line behind it has no rate to fall back to,
// so if it names a stock item its layer still opens at 0 -- unchanged
// behaviour, and not this screen's to fix.)
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

/** listPurchaseOrders() returns the whole row, `status` included -- see the picker below. */
type PurchaseOrder = { id: string; poNumber: number; supplierId: string; status?: string };
/** getPurchaseOrder() returns the row `with: { items: true }`; drizzle numerics arrive as strings. */
type PurchaseOrderDetail = { id: string; supplierId: string; items?: { id: string; itemId: string | null; description: string; quantity: string }[] };
type Vendor = { id: string; vendorName: string };
type ItemRow = { id: string; itemCode: string; itemName: string };
type WarehouseRow = { id: string; warehouseName: string };
/**
 * `poItemId` is the erp_purchase_order_items row this line was seeded from,
 * posted as `purchaseOrderItemId` -- it is what credits the order's
 * receivedQuantity, and what gives the line its rate at submit time on the
 * rows that also name a stock item (see part 3 above). Empty on a
 * hand-entered row, which has no ordered line behind it.
 * `poDescription` is the PO line's own text, shown but never posted --
 * erp_purchase_receipt_items has no description column.
 */
type Line = { itemId: string; poItemId: string; quantity: string; warehouseId: string; poDescription: string };

function blankLine(warehouseId = ""): Line {
  return { itemId: "", poItemId: "", quantity: "1", warehouseId, poDescription: "" };
}

/**
 * True only while the rows are still the single untouched row the form opens
 * with. Seeding from a purchase order replaces every row, so it may happen
 * without asking only while there is nothing to lose. A warehouse already
 * picked on that row is not line work -- seeding carries it forward.
 */
function isPristine(lines: Line[]): boolean {
  return lines.length === 1 && !lines[0].itemId && !lines[0].poItemId && lines[0].quantity === "1";
}

/**
 * One editable row per PO line. `warehouseId` is carried in from whatever the
 * form already had rather than guessed -- the PO does not name a receiving
 * store, so inventing one would be a fact the document never stated.
 */
function linesFromPurchaseOrder(po: PurchaseOrderDetail, warehouseId: string): Line[] {
  const items = po.items ?? [];
  if (!items.length) return [blankLine(warehouseId)];
  return items.map((i) => ({
    itemId: i.itemId ?? "",
    poItemId: i.id,
    quantity: String(Number(i.quantity) || 1),
    warehouseId,
    poDescription: i.description ?? "",
  }));
}

export default function GoodsReceiptCreateClient({ poId: prefillPoIdProp }: { poId?: string }) {
  const router = useRouter();
  const prefillPoId = prefillPoIdProp ?? "none";
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [poId, setPoId] = useState(prefillPoId);
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [seedingFromPo, setSeedingFromPo] = useState(prefillPoId !== "none");
  const [submitting, setSubmitting] = useState(false);

  /**
   * Reads the chosen PO and seeds the rows from its lines. A failure here is
   * stated, not swallowed: the form stays usable by hand, and the storekeeper
   * is told the prefill did not happen rather than being shown a blank form
   * that looks like the PO had no lines.
   */
  async function seedFromPurchaseOrder(id: string) {
    setSeedingFromPo(true);
    try {
      const po = await fetchJson<PurchaseOrderDetail>(`/api/procurement/purchase-orders/${encodeURIComponent(id)}`);
      setSupplierId(po.supplierId);
      setLines((prev) => linesFromPurchaseOrder(po, prev[0]?.warehouseId ?? ""));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't read that purchase order's lines — enter them by hand"));
    } finally {
      setSeedingFromPo(false);
    }
  }

  useEffect(() => {
    Promise.all([
      fetchJson<{ purchaseOrders?: PurchaseOrder[] }>("/api/procurement/purchase-orders"),
      fetchJson<{ vendors?: Vendor[] }>("/api/vendors"),
      fetchJson<{ items?: ItemRow[] }>("/api/inventory/items"),
      fetchJson<{ warehouses?: WarehouseRow[] }>("/api/inventory/warehouses"),
    ]).then(([poData, vendorData, itemData, whData]) => {
      setPurchaseOrders(poData.purchaseOrders ?? []);
      setVendors(vendorData.vendors ?? []);
      setItems(itemData.items ?? []);
      setWarehouses(whData.warehouses ?? []);
    }).catch(() => {});
    if (prefillPoId !== "none") void seedFromPurchaseOrder(prefillPoId);
    // prefillPoId is a server-resolved prop, stable for this page's lifetime
    // -- fetches run once on mount.
  }, []);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const missing = [
    ...(supplierId ? [] : ["Vendor"]),
    ...(lines.every((l) => l.warehouseId) ? [] : ["A receiving warehouse on every line"]),
    ...(lines.every((l) => l.quantity) ? [] : ["A quantity on every line"]),
  ];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      const receipt = await fetchJson<{ id: string }>("/api/procurement/goods-receipts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId, purchaseOrderId: poId !== "none" ? poId : undefined,
          postingDate: new Date().toISOString().slice(0, 10),
          items: lines.map((l) => ({ purchaseOrderItemId: l.poItemId || undefined, itemId: l.itemId || undefined, quantity: Number(l.quantity) || 1, warehouseId: l.warehouseId })),
        }),
      });
      toast.success("Goods receipt recorded (draft)");
      router.push(`/procurement/goods-receipts/${receipt.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't record goods receipt"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Procurement / New Goods Receipt"
      title="Record Goods Receipt"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/procurement?tab=goods-receipts")}
      onBack={() => router.push("/procurement?tab=goods-receipts")}
      saveDisabled={submitting || seedingFromPo || missing.length > 0}
      saveDisabledReason={submitting ? "Recording…" : seedingFromPo ? "Reading the purchase order…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Purchase Order (optional)</Label>
          <Select value={poId} onValueChange={(v) => {
            setPoId(v);
            if (v === "none") return;
            // Seeding REPLACES every row. Silent only while the form is still
            // untouched; once anything has been typed the storekeeper decides,
            // because the alternative is losing a counted delivery to a click.
            if (!isPristine(lines) && !window.confirm("Replace the lines you've entered with this purchase order's lines?")) return;
            void seedFromPurchaseOrder(v);
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {/* A cancelled order is a withdrawn one -- nothing may be received against it. The
                  service refuses it outright (erp-goods-receipt-service.ts createPurchaseReceipt);
                  this only keeps it out of the list. An already-selected one stays listed so the
                  trigger can still name what is selected. */}
              {purchaseOrders.filter((po) => po.status !== "cancelled" || po.id === poId).map((po) => <SelectItem key={po.id} value={po.id}>PO-{po.poNumber}</SelectItem>)}
            </SelectContent>
          </Select>
          {poId !== "none" && (
            <p className="text-xs text-px-muted">
              {seedingFromPo
                ? "Reading the order's lines…"
                : lines.some((l) => l.poItemId)
                  ? "Lines below are the order's — edit the quantities to what actually arrived, or remove a line that did not."
                  : "Your own lines are kept, not the order's. They carry no ordered rate and won't count against the order's received quantities."}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Vendor</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
            <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Received Lines</Label>
          {lines.map((l, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2">
                <Select value={l.itemId} onValueChange={(v) => updateLine(i, { itemId: v })}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Stock item (optional)" /></SelectTrigger>
                  <SelectContent>{items.map((it) => <SelectItem key={it.id} value={it.id}>{it.itemName} ({it.itemCode})</SelectItem>)}</SelectContent>
                </Select>
                <Select value={l.warehouseId} onValueChange={(v) => updateLine(i, { warehouseId: v })}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="Warehouse" /></SelectTrigger>
                  <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-20" />
                <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></Button>
              </div>
              {l.poDescription && <p className="text-xs text-px-muted">From the order: {l.poDescription}</p>}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, blankLine(prev[prev.length - 1]?.warehouseId ?? "")])}>
            <Plus className="size-3.5" /> Add Line
          </Button>
          <p className="text-xs text-px-muted">A line with no stock item posts no FIFO stock layer on submit — it is still recorded, and if it came from the purchase order it still counts towards that order line&apos;s received quantity.</p>
        </div>
      </div>
    </ObjectScreen>
  );
}
