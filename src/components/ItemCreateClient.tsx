"use client";

// Real-screen conversion (2026-08-30) -- replaces InventoryClient.tsx's old
// "New Item" Dialog popup with a real create screen. Also surfaces
// standardBuyingRate/standardSellingRate/hsnSacCode/hasSerialNo, all of
// which createItem() has always accepted but the old dialog never asked for.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ItemCreateClient() {
  const router = useRouter();
  const [itemCode, setItemCode] = useState("");
  const [itemName, setItemName] = useState("");
  const [uom, setUom] = useState("");
  const [standardBuyingRate, setStandardBuyingRate] = useState("");
  const [standardSellingRate, setStandardSellingRate] = useState("");
  const [hsnSacCode, setHsnSacCode] = useState("");
  const [hasBatchNo, setHasBatchNo] = useState(false);
  const [hasSerialNo, setHasSerialNo] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function createItem() {
    if (!itemCode.trim() || !itemName.trim()) {
      toast.error("Item code and name are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/inventory/items", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemCode, itemName, uom: uom || undefined,
          standardBuyingRate: standardBuyingRate ? Number(standardBuyingRate) : undefined,
          standardSellingRate: standardSellingRate ? Number(standardSellingRate) : undefined,
          hsnSacCode: hsnSacCode || undefined, hasBatchNo, hasSerialNo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add item");
      toast.success("Item added");
      router.push(`/inventory/items/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add item");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Inventory / New Item"
      title="New Stock Item"
      mode="create"
      hasDraft={false}
      onSave={createItem}
      onCancel={() => router.push("/inventory?tab=items")}
      onBack={() => router.push("/inventory?tab=items")}
      saveDisabled={submitting || !itemCode.trim() || !itemName.trim()}
      saveDisabledReason={submitting ? "Adding…" : (!itemCode.trim() || !itemName.trim()) ? "Item code and name are required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Item Code</Label><Input value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="e.g. CEM-OPC53" /></div>
          <div className="space-y-1.5"><Label>Item Name</Label><Input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. OPC 53 Grade Cement" /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Unit of Measure (optional)</Label><Input value={uom} onChange={(e) => setUom(e.target.value)} placeholder="e.g. Bag, Kg, Nos" /></div>
          <div className="space-y-1.5"><Label>HSN/SAC Code (optional)</Label><Input value={hsnSacCode} onChange={(e) => setHsnSacCode(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Standard Buying Rate (optional)</Label><Input type="number" value={standardBuyingRate} onChange={(e) => setStandardBuyingRate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Standard Selling Rate (optional)</Label><Input type="number" value={standardSellingRate} onChange={(e) => setStandardSellingRate(e.target.value)} /></div>
        </div>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={hasBatchNo} onChange={(e) => setHasBatchNo(e.target.checked)} className="size-4" /> Batch tracked</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={hasSerialNo} onChange={(e) => setHasSerialNo(e.target.checked)} className="size-4" /> Serial tracked</label>
        </div>
      </div>
    </ObjectScreen>
  );
}
