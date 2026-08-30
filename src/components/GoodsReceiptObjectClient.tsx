"use client";

// Real-screen conversion (2026-08-30): goods receipts never had a detail
// view -- getPurchaseReceipt() already existed in erp-goods-receipt-
// service.ts with no plain GET route until this conversion. Real Object
// Page on the kit's ObjectScreen. No generic Edit/Delete -- no
// updateGoodsReceipt() exists (updatePutawayLocation()/markPutawayComplete()
// do, but putaway management is a separate depth wave this pass doesn't
// build, same disclosed scope cut as RfqObjectClient.tsx's scoring/
// negotiation/auctions).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PackageCheck } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type GoodsReceipt = {
  id: string; receiptNumber: number; status: string; postingDate: string; supplierId: string; purchaseOrderId: string | null;
  items: { id: string; itemId: string | null; quantity: string; warehouseId: string }[];
};
type Vendor = { id: string; vendorName: string };
type ItemRow = { id: string; itemName: string };
type WarehouseRow = { id: string; warehouseName: string };

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", submitted: "done" };

export default function GoodsReceiptObjectClient({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const [receipt, setReceipt] = useState<GoodsReceipt | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const [data, vendorData, itemData, whData] = await Promise.all([
        fetchJson<GoodsReceipt>(`/api/procurement/goods-receipts/${receiptId}`),
        fetchJson<{ vendors?: Vendor[] }>("/api/vendors").catch(() => ({ vendors: [] })),
        fetchJson<{ items?: ItemRow[] }>("/api/inventory/items").catch(() => ({ items: [] })),
        fetchJson<{ warehouses?: WarehouseRow[] }>("/api/inventory/warehouses").catch(() => ({ warehouses: [] })),
      ]);
      setReceipt(data);
      setVendors(vendorData.vendors ?? []);
      setItems(itemData.items ?? []);
      setWarehouses(whData.warehouses ?? []);
      setLoadError(null);
    } catch (err) {
      setReceipt(null);
      setLoadError(errorMessage(err, "Couldn't load this goods receipt"));
    }
  }
  useEffect(() => { load(); }, [receiptId]);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/procurement/goods-receipts/${receiptId}/submit`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to submit goods receipt");
      toast.success("Goods receipt posted to stock");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit goods receipt");
    } finally {
      setSubmitting(false);
    }
  }

  const vendorName = vendors.find((v) => v.id === receipt?.supplierId)?.vendorName ?? receipt?.supplierId ?? "—";
  const itemName = (id: string | null) => (id && items.find((i) => i.id === id)?.itemName) || "—";
  const warehouseName = (id: string) => warehouses.find((w) => w.id === id)?.warehouseName ?? id;

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!receipt) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Procurement / Goods Receipt"
      title={`GRN-${receipt.receiptNumber}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[receipt.status] ?? "neutral", label: receipt.status }}
      facets={[{ label: "Vendor", value: vendorName }, { label: "Posting Date", value: formatDate(receipt.postingDate) }]}
      onBack={() => router.push("/procurement?tab=goods-receipts")}
      messages={[]}
    >
      {receipt.status === "draft" && (
        <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
          <Button size="sm" disabled={submitting} onClick={submit}><PackageCheck className="size-4" /> {submitting ? "Posting…" : "Post to Stock"}</Button>
        </div>
      )}
      <Table>
        <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Warehouse</TableHead><TableHead className="text-right">Quantity</TableHead></TableRow></TableHeader>
        <TableBody>
          {receipt.items.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-medium">{itemName(i.itemId)}</TableCell>
              <TableCell>{warehouseName(i.warehouseId)}</TableCell>
              <TableCell className="text-right">{i.quantity}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ObjectScreen>
  );
}
