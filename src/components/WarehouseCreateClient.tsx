"use client";

// Real-screen conversion (2026-08-30) -- replaces InventoryClient.tsx's old
// "New Warehouse" Dialog popup with a real create screen. No Object Page:
// no getWarehouse()/updateWarehouse() exists server-side (create+list
// only) -- an honest scope cut.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";

type WarehouseRow = { id: string; warehouseName: string };

export default function WarehouseCreateClient() {
  const router = useRouter();
  const [warehouseName, setWarehouseName] = useState("");
  const [parentWarehouseId, setParentWarehouseId] = useState("__none__");
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ warehouses?: WarehouseRow[] }>("/api/inventory/warehouses").then((d) => setWarehouses(d.warehouses ?? [])).catch(() => {});
  }, []);

  async function createWarehouse() {
    if (!warehouseName.trim()) {
      toast.error("Warehouse name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/inventory/warehouses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseName, parentWarehouseId: parentWarehouseId === "__none__" ? undefined : parentWarehouseId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add warehouse");
      toast.success("Warehouse added");
      router.push("/inventory?tab=warehouses");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add warehouse");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Inventory / New Warehouse"
      title="New Warehouse"
      mode="create"
      hasDraft={false}
      onSave={createWarehouse}
      onCancel={() => router.push("/inventory?tab=warehouses")}
      onBack={() => router.push("/inventory?tab=warehouses")}
      saveDisabled={submitting || !warehouseName.trim()}
      saveDisabledReason={submitting ? "Adding…" : !warehouseName.trim() ? "Warehouse name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Warehouse Name</Label><Input value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)} placeholder="e.g. Site Store - Block A" /></div>
        {warehouses.length > 0 && (
          <div className="space-y-1.5">
            <Label>Parent Warehouse (optional)</Label>
            <Select value={parentWarehouseId} onValueChange={setParentWarehouseId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None (top-level)</SelectItem>
                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
