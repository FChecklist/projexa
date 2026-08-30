"use client";

// Real-screen conversion (2026-08-30) -- replaces InventoryClient.tsx's old
// "Record Stock Movement" Dialog popup with a real create screen. No
// Object Page: a stock ledger entry is a write-once transaction record, not
// an editable object.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";

type ItemRow = { id: string; itemCode: string; itemName: string };
type WarehouseRow = { id: string; warehouseName: string };

export default function StockEntryCreateClient() {
  const router = useRouter();
  const [items, setItems] = useState<ItemRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [entryType, setEntryType] = useState<"receipt" | "issue">("receipt");
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [rate, setRate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ items?: ItemRow[] }>("/api/inventory/items").then((d) => setItems(d.items ?? [])).catch(() => {});
    fetchJson<{ warehouses?: WarehouseRow[] }>("/api/inventory/warehouses").then((d) => setWarehouses(d.warehouses ?? [])).catch(() => {});
  }, []);

  async function recordEntry() {
    if (!itemId || !warehouseId || !quantity) {
      toast.error("Item, warehouse, and quantity are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/inventory/stock-entries", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: entryType, itemId, warehouseId, quantity: Number(quantity),
          rate: rate ? Number(rate) : undefined, postingDate: new Date().toISOString().slice(0, 10),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to record stock entry");
      toast.success(entryType === "receipt" ? "Stock receipt recorded" : "Stock issue recorded");
      router.push("/inventory?tab=balances");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record stock entry");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Inventory / Record Stock Movement"
      title="Record Stock Movement"
      mode="create"
      hasDraft={false}
      onSave={recordEntry}
      onCancel={() => router.push("/inventory?tab=balances")}
      onBack={() => router.push("/inventory?tab=balances")}
      saveDisabled={submitting || !itemId || !warehouseId || !quantity}
      saveDisabledReason={submitting ? "Recording…" : (!itemId || !warehouseId || !quantity) ? "Item, warehouse, and quantity are required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Movement Type</Label>
          <Select value={entryType} onValueChange={(v) => setEntryType(v as "receipt" | "issue")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="receipt">Receipt (stock in)</SelectItem>
              <SelectItem value="issue">Issue (stock out)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Item</Label>
          <Select value={itemId} onValueChange={setItemId}>
            <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
            <SelectContent>{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.itemName} ({i.itemCode})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Warehouse</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
            <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
          {entryType === "receipt" && (
            <div className="space-y-1.5"><Label>Rate (optional)</Label><Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          )}
        </div>
      </div>
    </ObjectScreen>
  );
}
