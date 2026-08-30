"use client";

// Real-screen conversion (2026-08-30): purchase orders never had a detail
// view -- getPurchaseOrder() already existed in erp-buying-service.ts with
// no plain GET route until this conversion. Real Object Page on the kit's
// ObjectScreen. No generic Edit/Delete -- no updatePurchaseOrder() exists.
// No Create screen -- POs are only ever created via "Convert to PO" from a
// Quotation (a real, already-working inline action, unchanged).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Send, PackageCheck } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type PurchaseOrder = {
  id: string; poNumber: number; status: string; orderDate: string; supplierId: string; grandTotal: string;
  items: { id: string; description: string; quantity: string; rate: string; amount: string }[];
};
type Vendor = { id: string; vendorName: string };

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", submitted: "waiting", partially_received: "waiting", completed: "done" };

export default function PurchaseOrderObjectClient({ poId }: { poId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const label = currencyLabel(undefined, currencies);
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <ObjectScreen
      breadcrumb="Procurement / Purchase Order"
      title={`PO-${po.poNumber}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[po.status] ?? "neutral", label: po.status.replace(/_/g, " ") }}
      facets={[
        { label: "Vendor", value: vendorName },
        { label: "Order Date", value: formatDate(po.orderDate) },
        { label: "Grand Total", value: `${label}${Number(po.grandTotal).toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
      ]}
      onBack={() => router.push("/procurement?tab=purchase-orders")}
      messages={[]}
    >
      <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
        {po.status === "draft" && (
          <Button size="sm" disabled={submitting} onClick={submit}><Send className="size-4" /> {submitting ? "Submitting…" : "Submit"}</Button>
        )}
        {po.status !== "draft" && (
          <Button size="sm" variant="outline" onClick={() => router.push(`/procurement/goods-receipts/new?poId=${po.id}`)}>
            <PackageCheck className="size-4" /> Receive Goods
          </Button>
        )}
      </div>
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
