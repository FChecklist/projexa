"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, Send, ArrowRight, PackageCheck } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import DataLoadError from "@/components/DataLoadError";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Requisition = {
  id: string; requisitionNumber: number; purpose: string | null; status: string; postingDate: string;
  items: { id: string; description: string; quantity: string; estimatedRate: string | null }[];
};
type Rfq = {
  id: string; rfqNumber: number; status: string; postingDate: string; requisitionId: string | null;
  items: { id: string; description: string; quantity: string }[];
  suppliers: { supplierId: string }[];
};
type Quotation = {
  id: string; quotationNumber: number; status: string; postingDate: string; rfqId: string | null; supplierId: string;
  items: { id: string; description: string; quantity: string; rate: string }[];
};
type PurchaseOrder = {
  id: string; poNumber: number; status: string; orderDate: string; supplierId: string; grandTotal: string;
  items: { id: string; description: string; quantity: string; rate: string }[];
};
type GoodsReceipt = {
  id: string; receiptNumber: number; status: string; postingDate: string; supplierId: string; purchaseOrderId: string | null;
  items: { id: string; itemId: string | null; quantity: string; warehouseId: string }[];
};
type Vendor = { id: string; vendorName: string };
type WarehouseRow = { id: string; warehouseName: string };
type ItemRow = { id: string; itemCode: string; itemName: string };

const STATUS_VARIANT: Record<string, "default" | "outline" | "secondary"> = {
  draft: "outline", submitted: "secondary", approved: "default", sent: "secondary",
  completed: "default", partially_received: "secondary",
};

export default function ProcurementClient() {
  const currencies = useCurrencies();
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [goodsReceipts, setGoodsReceipts] = useState<GoodsReceipt[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [reqData, rfqData, quoteData, poData, grData, vendorData, whData, itemData] = await Promise.all([
        fetchJson("/api/procurement/requisitions"),
        fetchJson("/api/procurement/rfqs"),
        fetchJson("/api/procurement/quotations"),
        fetchJson("/api/procurement/purchase-orders"),
        fetchJson("/api/procurement/goods-receipts"),
        fetchJson("/api/vendors"),
        fetchJson("/api/inventory/warehouses"),
        fetchJson("/api/inventory/items"),
      ]);
      setRequisitions(reqData.requisitions ?? []);
      setRfqs(rfqData.rfqs ?? []);
      setQuotations(quoteData.quotations ?? []);
      setPurchaseOrders(poData.purchaseOrders ?? []);
      setGoodsReceipts(grData.goodsReceipts ?? []);
      setVendors(vendorData.vendors ?? []);
      setWarehouses(whData.warehouses ?? []);
      setItems(itemData.items ?? []);
    } catch (err) {
      const msg = errorMessage(err, "Couldn't load procurement data");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.vendorName ?? id;

  // ── Requisition create ──────────────────────────────────────────────
  const [reqOpen, setReqOpen] = useState(false);
  const [reqPurpose, setReqPurpose] = useState("");
  const [reqItemDesc, setReqItemDesc] = useState("");
  const [reqItemQty, setReqItemQty] = useState("1");
  const [reqSubmitting, setReqSubmitting] = useState(false);

  async function createRequisition() {
    if (!reqItemDesc.trim()) { toast.error("Describe at least one item"); return; }
    setReqSubmitting(true);
    try {
      const res = await fetch("/api/procurement/requisitions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: reqPurpose || undefined, postingDate: new Date().toISOString().slice(0, 10),
          items: [{ description: reqItemDesc, quantity: Number(reqItemQty) || 1 }],
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Requisition created");
      setReqPurpose(""); setReqItemDesc(""); setReqItemQty("1"); setReqOpen(false);
      load();
    } catch {
      toast.error("Couldn't create requisition");
    } finally {
      setReqSubmitting(false);
    }
  }

  async function submitRequisition(id: string) {
    try {
      const res = await fetch(`/api/procurement/requisitions/${id}/submit`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed");
      }
      toast.success("Requisition submitted");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit requisition (requires a real user session)");
    }
  }

  // ── RFQ create + send ───────────────────────────────────────────────
  const [rfqOpen, setRfqOpen] = useState(false);
  const [rfqRequisitionId, setRfqRequisitionId] = useState<string>("none");
  const [rfqItemDesc, setRfqItemDesc] = useState("");
  const [rfqItemQty, setRfqItemQty] = useState("1");
  const [rfqSupplierIds, setRfqSupplierIds] = useState<string[]>([]);
  const [rfqSubmitting, setRfqSubmitting] = useState(false);

  async function createRfq() {
    if (!rfqItemDesc.trim() || rfqSupplierIds.length === 0) {
      toast.error("Describe an item and select at least one vendor");
      return;
    }
    setRfqSubmitting(true);
    try {
      const res = await fetch("/api/procurement/rfqs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requisitionId: rfqRequisitionId !== "none" ? rfqRequisitionId : undefined,
          postingDate: new Date().toISOString().slice(0, 10),
          items: [{ description: rfqItemDesc, quantity: Number(rfqItemQty) || 1 }],
          supplierIds: rfqSupplierIds,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("RFQ created");
      setRfqItemDesc(""); setRfqItemQty("1"); setRfqSupplierIds([]); setRfqOpen(false);
      load();
    } catch {
      toast.error("Couldn't create RFQ");
    } finally {
      setRfqSubmitting(false);
    }
  }

  async function sendRfq(id: string) {
    try {
      const res = await fetch(`/api/procurement/rfqs/${id}/send`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("RFQ sent to suppliers");
      load();
    } catch {
      toast.error("Couldn't send RFQ");
    }
  }

  // ── Quotation (supplier response) create ────────────────────────────
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteRfqId, setQuoteRfqId] = useState<string>("none");
  const [quoteSupplierId, setQuoteSupplierId] = useState("");
  const [quoteItemDesc, setQuoteItemDesc] = useState("");
  const [quoteItemQty, setQuoteItemQty] = useState("1");
  const [quoteItemRate, setQuoteItemRate] = useState("");
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);

  async function createQuotation() {
    if (!quoteSupplierId || !quoteItemDesc.trim()) { toast.error("Vendor and at least one item are required"); return; }
    setQuoteSubmitting(true);
    try {
      const res = await fetch("/api/procurement/quotations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rfqId: quoteRfqId !== "none" ? quoteRfqId : undefined, supplierId: quoteSupplierId,
          postingDate: new Date().toISOString().slice(0, 10),
          items: [{ description: quoteItemDesc, quantity: Number(quoteItemQty) || 1, rate: Number(quoteItemRate) || 0 }],
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Quotation recorded");
      setQuoteSupplierId(""); setQuoteItemDesc(""); setQuoteItemQty("1"); setQuoteItemRate(""); setQuoteOpen(false);
      load();
    } catch {
      toast.error("Couldn't record quotation");
    } finally {
      setQuoteSubmitting(false);
    }
  }

  // ── Convert quotation -> PO ──────────────────────────────────────────
  async function convertToPo(q: Quotation) {
    try {
      const res = await fetch("/api/procurement/purchase-orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: q.supplierId, orderDate: new Date().toISOString().slice(0, 10),
          items: q.items.map((i) => ({ description: i.description, quantity: Number(i.quantity), rate: Number(i.rate) })),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Purchase order created from quotation");
      load();
    } catch {
      toast.error("Couldn't convert quotation to a purchase order");
    }
  }

  async function submitPo(id: string) {
    try {
      const res = await fetch(`/api/procurement/purchase-orders/${id}/submit`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Purchase order submitted");
      load();
    } catch {
      toast.error("Couldn't submit purchase order");
    }
  }

  // ── Goods receipt create + submit ───────────────────────────────────
  const [grOpen, setGrOpen] = useState(false);
  const [grPoId, setGrPoId] = useState<string>("none");
  const [grSupplierId, setGrSupplierId] = useState("");
  const [grItemId, setGrItemId] = useState("");
  const [grWarehouseId, setGrWarehouseId] = useState("");
  const [grQty, setGrQty] = useState("1");
  const [grSubmitting, setGrSubmitting] = useState(false);

  function openGoodsReceiptFor(po: PurchaseOrder) {
    setGrPoId(po.id);
    setGrSupplierId(po.supplierId);
    setGrOpen(true);
  }

  async function createGoodsReceipt() {
    if (!grSupplierId || !grWarehouseId || !grQty) { toast.error("Vendor, warehouse, and quantity are required"); return; }
    setGrSubmitting(true);
    try {
      const res = await fetch("/api/procurement/goods-receipts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: grSupplierId, purchaseOrderId: grPoId !== "none" ? grPoId : undefined,
          postingDate: new Date().toISOString().slice(0, 10),
          items: [{ itemId: grItemId || undefined, quantity: Number(grQty) || 1, warehouseId: grWarehouseId }],
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Goods receipt recorded (draft)");
      setGrPoId("none"); setGrSupplierId(""); setGrItemId(""); setGrWarehouseId(""); setGrQty("1"); setGrOpen(false);
      load();
    } catch {
      toast.error("Couldn't record goods receipt");
    } finally {
      setGrSubmitting(false);
    }
  }

  async function submitGoodsReceipt(id: string) {
    try {
      const res = await fetch(`/api/procurement/goods-receipts/${id}/submit`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed");
      }
      toast.success("Goods receipt posted to stock");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit goods receipt");
    }
  }

  if (loading) {
    return <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  }

  return (
    <Tabs defaultValue="requisitions">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="requisitions">1. Requisitions</TabsTrigger>
        <TabsTrigger value="rfqs">2. RFQs</TabsTrigger>
        <TabsTrigger value="quotations">3. Quotations</TabsTrigger>
        <TabsTrigger value="purchase-orders">4. Purchase Orders</TabsTrigger>
        <TabsTrigger value="goods-receipts">5. Goods Receipts</TabsTrigger>
      </TabsList>

      {/* Stage 1: Requisitions */}
      <TabsContent value="requisitions" className="space-y-3">
        <div className="flex justify-end">
          <Dialog open={reqOpen} onOpenChange={setReqOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> New Requisition</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Purchase Requisition</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5"><Label>Purpose (optional)</Label><Textarea value={reqPurpose} onChange={(e) => setReqPurpose(e.target.value)} placeholder="Why is this needed?" /></div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-1.5"><Label>Item description</Label><Input value={reqItemDesc} onChange={(e) => setReqItemDesc(e.target.value)} placeholder="e.g. TMT bars 12mm" /></div>
                  <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={reqItemQty} onChange={(e) => setReqItemQty(e.target.value)} /></div>
                </div>
              </div>
              <DialogFooter><Button onClick={createRequisition} disabled={reqSubmitting}>{reqSubmitting ? "Creating…" : "Create Requisition"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadError ? (
              // F_032: "No purchase requisitions yet." rendered, with a
              // working New Requisition button beside it, while
              // /api/procurement/requisitions, /purchase-orders and /vendors
              // were all returning 504. A real outage, painted as an empty list.
              <DataLoadError messages={[loadError]} onRetry={load} />
            ) : requisitions.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No purchase requisitions yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Purpose</TableHead><TableHead>Items</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {requisitions.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">PR-{r.requisitionNumber}</TableCell>
                      <TableCell className="text-px-muted">{r.purpose ?? "—"}</TableCell>
                      <TableCell>{r.items?.length ?? 0}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        {r.status === "draft" && <Button size="sm" variant="outline" onClick={() => submitRequisition(r.id)}><Send className="size-3.5" /> Submit</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Stage 2: RFQs */}
      <TabsContent value="rfqs" className="space-y-3">
        <div className="flex justify-end">
          <Dialog open={rfqOpen} onOpenChange={setRfqOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> New RFQ</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Request for Quotation</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Linked Requisition (optional)</Label>
                  <Select value={rfqRequisitionId} onValueChange={setRfqRequisitionId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None — raise directly</SelectItem>
                      {requisitions.map((r) => <SelectItem key={r.id} value={r.id}>PR-{r.requisitionNumber}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-1.5"><Label>Item description</Label><Input value={rfqItemDesc} onChange={(e) => setRfqItemDesc(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={rfqItemQty} onChange={(e) => setRfqItemQty(e.target.value)} /></div>
                </div>
                <div className="space-y-1.5">
                  <Label>Vendors to invite</Label>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                    {vendors.map((v) => (
                      <label key={v.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={rfqSupplierIds.includes(v.id)}
                          onChange={(e) => setRfqSupplierIds((prev) => e.target.checked ? [...prev, v.id] : prev.filter((id) => id !== v.id))}
                        />
                        {v.vendorName}
                      </label>
                    ))}
                    {vendors.length === 0 && <p className="text-xs text-px-muted">No vendors yet — add one on the Vendors page first.</p>}
                  </div>
                </div>
              </div>
              <DialogFooter><Button onClick={createRfq} disabled={rfqSubmitting}>{rfqSubmitting ? "Creating…" : "Create RFQ"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {rfqs.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No RFQs yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Items</TableHead><TableHead>Vendors invited</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {rfqs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">RFQ-{r.rfqNumber}</TableCell>
                      <TableCell>{r.items?.length ?? 0}</TableCell>
                      <TableCell>{r.suppliers?.length ?? 0}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        {r.status === "draft" && <Button size="sm" variant="outline" onClick={() => sendRfq(r.id)}><Send className="size-3.5" /> Send to Vendors</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Stage 3: Quotations */}
      <TabsContent value="quotations" className="space-y-3">
        <div className="flex justify-end">
          <Dialog open={quoteOpen} onOpenChange={setQuoteOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> Record Quotation</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Record Supplier Quotation</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>RFQ (optional)</Label>
                  <Select value={quoteRfqId} onValueChange={setQuoteRfqId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {rfqs.map((r) => <SelectItem key={r.id} value={r.id}>RFQ-{r.rfqNumber}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Vendor</Label>
                  <Select value={quoteSupplierId} onValueChange={setQuoteSupplierId}>
                    <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                    <SelectContent>
                      {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1.5"><Label>Item description</Label><Input value={quoteItemDesc} onChange={(e) => setQuoteItemDesc(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={quoteItemQty} onChange={(e) => setQuoteItemQty(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Rate</Label><Input type="number" value={quoteItemRate} onChange={(e) => setQuoteItemRate(e.target.value)} /></div>
                </div>
              </div>
              <DialogFooter><Button onClick={createQuotation} disabled={quoteSubmitting}>{quoteSubmitting ? "Recording…" : "Record Quotation"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {quotations.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No supplier quotations recorded yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Vendor</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {quotations.map((q) => {
                    const total = q.items?.reduce((sum, i) => sum + Number(i.quantity) * Number(i.rate), 0) ?? 0;
                    return (
                      <TableRow key={q.id}>
                        <TableCell className="font-medium">SQ-{q.quotationNumber}</TableCell>
                        <TableCell>{vendorName(q.supplierId)}</TableCell>
                        <TableCell>{currencyLabel(undefined, currencies)}{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell><Badge variant={STATUS_VARIANT[q.status] ?? "outline"}>{q.status}</Badge></TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => convertToPo(q)}><ArrowRight className="size-3.5" /> Convert to PO</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Stage 4: Purchase Orders */}
      <TabsContent value="purchase-orders" className="space-y-3">
        <Card className="shadow-card">
          <CardContent className="p-0">
            {purchaseOrders.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No purchase orders yet. Convert a quotation to create one.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Vendor</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {purchaseOrders.map((po) => (
                    <TableRow key={po.id}>
                      <TableCell className="font-medium">PO-{po.poNumber}</TableCell>
                      <TableCell>{vendorName(po.supplierId)}</TableCell>
                      <TableCell>{currencyLabel(undefined, currencies)}{Number(po.grandTotal).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[po.status] ?? "outline"}>{po.status}</Badge></TableCell>
                      <TableCell className="text-right space-x-2">
                        {po.status === "draft" && <Button size="sm" variant="outline" onClick={() => submitPo(po.id)}><Send className="size-3.5" /> Submit</Button>}
                        {po.status !== "draft" && <Button size="sm" variant="outline" onClick={() => openGoodsReceiptFor(po)}><PackageCheck className="size-3.5" /> Receive Goods</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Stage 5: Goods Receipts */}
      <TabsContent value="goods-receipts" className="space-y-3">
        <div className="flex justify-end">
          <Dialog open={grOpen} onOpenChange={setGrOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> New Goods Receipt</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Record Goods Receipt</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Purchase Order (optional)</Label>
                  <Select value={grPoId} onValueChange={(v) => {
                    setGrPoId(v);
                    const po = purchaseOrders.find((p) => p.id === v);
                    if (po) setGrSupplierId(po.supplierId);
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
                  <Select value={grSupplierId} onValueChange={setGrSupplierId}>
                    <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                    <SelectContent>
                      {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Item (optional — a stock item to post FIFO receipt for)</Label>
                  <Select value={grItemId} onValueChange={setGrItemId}>
                    <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                    <SelectContent>
                      {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.itemName} ({i.itemCode})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Receiving Warehouse</Label>
                    <Select value={grWarehouseId} onValueChange={setGrWarehouseId}>
                      <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                      <SelectContent>
                        {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={grQty} onChange={(e) => setGrQty(e.target.value)} /></div>
                </div>
              </div>
              <DialogFooter><Button onClick={createGoodsReceipt} disabled={grSubmitting}>{grSubmitting ? "Recording…" : "Record Receipt (draft)"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {goodsReceipts.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No goods receipts recorded yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Vendor</TableHead><TableHead>Items</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {goodsReceipts.map((gr) => (
                    <TableRow key={gr.id}>
                      <TableCell className="font-medium">GRN-{gr.receiptNumber}</TableCell>
                      <TableCell>{vendorName(gr.supplierId)}</TableCell>
                      <TableCell>{gr.items?.length ?? 0}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[gr.status] ?? "outline"}>{gr.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        {gr.status === "draft" && <Button size="sm" variant="outline" onClick={() => submitGoodsReceipt(gr.id)}><PackageCheck className="size-3.5" /> Post to Stock</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
