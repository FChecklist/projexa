"use client";

// Real-screen conversion (2026-08-30) -- replaces FfeClient.tsx's old "New
// Item" Dialog popup with a real create screen, same fields.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencyLabel, useCurrencies } from "@/lib/currency";

const CATEGORIES = ["furniture", "fixture", "equipment", "finish", "textile", "lighting", "other"];

export default function FfeCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const [itemName, setItemName] = useState("");
  const [roomOrArea, setRoomOrArea] = useState("");
  const [category, setCategory] = useState("furniture");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [depthCm, setDepthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createItem() {
    if (!itemName.trim()) {
      toast.error("Item name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/ffe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, itemName, roomOrArea: roomOrArea || undefined, category,
          quantity: Number(quantity) || 1, unitCost: Number(unitCost) || 0, unitPrice: Number(unitPrice) || 0,
          widthCm: widthCm ? Number(widthCm) : undefined, depthCm: depthCm ? Number(depthCm) : undefined, heightCm: heightCm ? Number(heightCm) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add item");
      toast.success("FF&E item added");
      router.push(`/ffe/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add item");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="FF&E / New Item"
      title="New FF&E Item"
      mode="create"
      hasDraft={false}
      onSave={createItem}
      onCancel={() => router.push(`/ffe?projectId=${projectId}`)}
      onBack={() => router.push(`/ffe?projectId=${projectId}`)}
      saveDisabled={submitting || !itemName.trim()}
      saveDisabledReason={submitting ? "Adding…" : !itemName.trim() ? "Item name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Item Name</Label><Input value={itemName} onChange={(e) => setItemName(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Room / Area</Label><Input value={roomOrArea} onChange={(e) => setRoomOrArea(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5"><Label>Qty</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Cost ({currencyLabel(undefined, currencies).trim()})</Label><Input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Client Price ({currencyLabel(undefined, currencies).trim()})</Label><Input type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5"><Label>Width (cm)</Label><Input type="number" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} placeholder="for 3D" /></div>
          <div className="space-y-1.5"><Label>Depth (cm)</Label><Input type="number" value={depthCm} onChange={(e) => setDepthCm(e.target.value)} placeholder="for 3D" /></div>
          <div className="space-y-1.5"><Label>Height (cm)</Label><Input type="number" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="for 3D" /></div>
        </div>
      </div>
    </ObjectScreen>
  );
}
