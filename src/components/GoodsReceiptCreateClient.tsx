"use client";

// Real-screen conversion (2026-08-30): replaces ProcurementClient.tsx's old
// "New Goods Receipt" Dialog popup with a real create screen. Accepts an
// optional poId prop (resolved server-side from ?poId= by the route's
// page.tsx, same pattern as every other project/id prefill this session --
// client-side useSearchParams() needs its own Suspense boundary, which this
// avoids) to prefill from PurchaseOrderObjectClient.tsx's "Receive Goods"
// action.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type PurchaseOrder = { id: string; poNumber: number; supplierId: string };
type Vendor = { id: string; vendorName: string };
type ItemRow = { id: string; itemCode: string; itemName: string };
type WarehouseRow = { id: string; warehouseName: string };

export default function GoodsReceiptCreateClient({ poId: prefillPoIdProp }: { poId?: string }) {
  const router = useRouter();
  const prefillPoId = prefillPoIdProp ?? "none";
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [poId, setPoId] = useState(prefillPoId);
  const [supplierId, setSupplierId] = useState("");
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [submitting, setSubmitting] = useState(false);

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
      if (prefillPoId !== "none") {
        const po = (poData.purchaseOrders ?? []).find((p) => p.id === prefillPoId);
        if (po) setSupplierId(po.supplierId);
      }
    }).catch(() => {});
    // prefillPoId is a server-resolved prop, stable for this page's lifetime
    // -- fetches run once on mount.
  }, []);

  const missing = [...(supplierId ? [] : ["Vendor"]), ...(warehouseId ? [] : ["Warehouse"]), ...(quantity ? [] : ["Quantity"])];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      const receipt = await fetchJson<{ id: string }>("/api/procurement/goods-receipts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId, purchaseOrderId: poId !== "none" ? poId : undefined,
          postingDate: new Date().toISOString().slice(0, 10),
          items: [{ itemId: itemId || undefined, quantity: Number(quantity) || 1, warehouseId }],
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
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Recording…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Purchase Order (optional)</Label>
          <Select value={poId} onValueChange={(v) => {
            setPoId(v);
            const po = purchaseOrders.find((p) => p.id === v);
            if (po) setSupplierId(po.supplierId);
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {purchaseOrders.map((po) => <SelectItem key={po.id} value={po.id}>PO-{po.poNumber}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Vendor</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
            <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Item (optional — a stock item to post FIFO receipt for)</Label>
          <Select value={itemId} onValueChange={setItemId}>
            <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
            <SelectContent>{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.itemName} ({i.itemCode})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Receiving Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
              <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
        </div>
      </div>
    </ObjectScreen>
  );
}
