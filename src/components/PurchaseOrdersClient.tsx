"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";

// Priority 17 Wave 1 (multi-currency Selling & Buying): the first Purchase
// Order creation UI in PROJEXA -- VendorsClient.tsx only ever managed
// vendor master data, confirmed by a full-repo search that no PO creation
// form existed anywhere before this wave. Deliberately minimal (list +
// create, no submit/status-transition lifecycle UI yet) to match the real
// scope of this wave -- currency capture from day one, not bolted on later.
type PurchaseOrderItem = { id: string; description: string; quantity: string; rate: string; amount: string; receivedQuantity: string };
type PurchaseOrder = {
  id: string; poNumber: number; vendorId: string; orderDate: string; expectedDeliveryDate: string | null;
  status: string; currencyId: string | null; exchangeRate: string; grandTotal: string; items: PurchaseOrderItem[];
};
type Vendor = { id: string; vendorName: string };
// currencyLabel()/useCurrencies() now live in @/lib/currency (Priority 17
// re-sweep consolidation -- this was previously a per-file copy).
type Line = { description: string; quantity: string; rate: string };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", partially_received: "secondary", completed: "default", cancelled: "destructive",
};

export default function PurchaseOrdersClient() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const currencies = useCurrencies();
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const [vendorId, setVendorId] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", rate: "" }]);
  const [currencyId, setCurrencyId] = useState("");
  const [exchangeRate, setExchangeRate] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/purchase-orders");
      const data = await res.json();
      setOrders(data.purchaseOrders ?? []);
    } catch {
      toast.error("Couldn't load purchase orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/vendors").then((r) => r.json()).then((d) => setVendors(d.vendors ?? [])).catch(() => {}); }, []);

  const selectedCurrency = currencies.find((c) => c.id === currencyId);
  const needsExchangeRate = !!currencyId && !selectedCurrency?.isBaseCurrency;

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function createPurchaseOrder() {
    if (!vendorId || lines.some((l) => !l.description.trim() || !l.rate)) return;
    if (needsExchangeRate && (!exchangeRate || Number(exchangeRate) <= 0)) {
      toast.error("An exchange rate is required for a non-base currency");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/purchase-orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId, orderDate, expectedDeliveryDate: expectedDeliveryDate || undefined,
          currencyId: currencyId || undefined, exchangeRate: currencyId ? Number(exchangeRate) : undefined,
          items: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 1, rate: Number(l.rate) })),
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error); }
      toast.success("Purchase order created");
      setVendorId(""); setExpectedDeliveryDate(""); setLines([{ description: "", quantity: "1", rate: "" }]);
      setCurrencyId(""); setExchangeRate("1"); setOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create purchase order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Purchase Order</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Purchase Order</DialogTitle></DialogHeader>
            <div className="max-h-[70vh] space-y-3 overflow-y-auto">
              <div className="space-y-1.5">
                <Label>Vendor</Label>
                <Select value={vendorId} onValueChange={setVendorId}>
                  <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Order Date</Label><Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Expected Delivery (optional)</Label><Input type="date" value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.target.value)} /></div>
              </div>
              {currencies.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Currency (optional)</Label>
                    <Select value={currencyId || "base"} onValueChange={(v) => setCurrencyId(v === "base" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Org base currency" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="base">Org base currency</SelectItem>
                        {currencies.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}{c.isBaseCurrency ? " (base)" : ""}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {needsExchangeRate && (
                    <div className="space-y-1.5">
                      <Label>Exchange Rate (to base)</Label>
                      <Input type="number" step="0.0001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} placeholder="e.g. 83.25" />
                    </div>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <Label>Line Items</Label>
                {lines.map((l, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="flex-1" />
                    <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-16" />
                    <Input placeholder="Rate" type="number" value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} className="w-24" />
                    <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { description: "", quantity: "1", rate: "" }])}>
                  <Plus className="size-3.5" /> Add Line
                </Button>
              </div>
            </div>
            <DialogFooter><Button onClick={createPurchaseOrder} disabled={submitting || !vendorId}>{submitting ? "Creating…" : "Create Purchase Order"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : orders.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No purchase orders yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>#</TableHead><TableHead>Vendor</TableHead><TableHead>Order Date</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-medium">{po.poNumber}</TableCell>
                    <TableCell className="text-px-muted">{vendors.find((v) => v.id === po.vendorId)?.vendorName ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{po.orderDate}</TableCell>
                    <TableCell className="text-px-muted">
                      {currencyLabel(po.currencyId, currencies)}{Number(po.grandTotal).toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[po.status] ?? "outline"}>{po.status.replace("_", " ")}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
