"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, ArrowRight } from "lucide-react";
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

const STATUS_VARIANT: Record<string, "default" | "outline" | "secondary"> = {
  draft: "outline", submitted: "secondary", approved: "default", sent: "secondary",
  completed: "default", partially_received: "secondary",
};

// R43 F_032: which of the eight concurrent data sources backs which of the
// five tabs, so a tab whose own source failed can say so instead of falling
// into its `array.length === 0` empty-state copy. vendors/warehouses/items
// are shared lookups (now used by the Create screens, not dialog
// dropdowns), not a tab of their own.
type ProcurementLoadKey =
  | "requisitions" | "rfqs" | "quotations" | "purchaseOrders" | "goodsReceipts"
  | "vendors" | "warehouses" | "items";

const VALID_TABS = new Set(["requisitions", "rfqs", "quotations", "purchase-orders", "goods-receipts"]);

// Real-screen conversion (2026-08-30): every "New X" Dialog popup is gone --
// each routes to a real create screen; every row routes to a real Object
// Page (Requisition/RFQ/PurchaseOrder/GoodsReceipt -- all 4 gained real
// detail screens this conversion; none existed for RFQ/PurchaseOrder/
// GoodsReceipt before, and Requisition's screen was the flat list itself).
// Submit/Send/Post-to-Stock actions moved from inline list buttons onto
// their respective Object Pages. Quotations keep "Convert to PO" as a real
// inline action -- no Object Page exists for quotations (no get function).
// Also fixes the same uncontrolled-Tabs-no-URL-sync bug found and fixed
// repeatedly this session.
export default function ProcurementClient({ initialTab }: { initialTab?: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "requisitions");
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [goodsReceipts, setGoodsReceipts] = useState<GoodsReceipt[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  // R43 F_032: per-source, so each tab can gate on its OWN failure instead
  // of a single generic loadError that only ever named "some request" and,
  // being one flag, hid every tab except the one wired to read it
  // (Requisitions) behind the same fake "No X yet." the fault is about.
  const [loadErrors, setLoadErrors] = useState<Partial<Record<ProcurementLoadKey, string>>>({});

  async function load() {
    setLoading(true);
    setLoadErrors({});

    // allSettled (not Promise.all) so one failing source never discards the
    // seven siblings that succeeded, and so EVERY failure is named instead
    // of only the first rejection's reason -- what Promise.all did here.
    const sources: {
      key: ProcurementLoadKey;
      url: string;
      respKey: string;
      label: string;
      setter: (v: never[]) => void;
    }[] = [
      { key: "requisitions", url: "/api/procurement/requisitions", respKey: "requisitions", label: "Requisitions", setter: setRequisitions as (v: never[]) => void },
      { key: "rfqs", url: "/api/procurement/rfqs", respKey: "rfqs", label: "RFQs", setter: setRfqs as (v: never[]) => void },
      { key: "quotations", url: "/api/procurement/quotations", respKey: "quotations", label: "Quotations", setter: setQuotations as (v: never[]) => void },
      { key: "purchaseOrders", url: "/api/procurement/purchase-orders", respKey: "purchaseOrders", label: "Purchase orders", setter: setPurchaseOrders as (v: never[]) => void },
      { key: "goodsReceipts", url: "/api/procurement/goods-receipts", respKey: "goodsReceipts", label: "Goods receipts", setter: setGoodsReceipts as (v: never[]) => void },
      { key: "vendors", url: "/api/vendors", respKey: "vendors", label: "Vendors", setter: setVendors as (v: never[]) => void },
    ];

    const results = await Promise.allSettled(sources.map((s) => fetchJson<Record<string, unknown>>(s.url)));

    const errors: Partial<Record<ProcurementLoadKey, string>> = {};
    results.forEach((result, i) => {
      const s = sources[i];
      if (result.status === "fulfilled") {
        s.setter(((result.value[s.respKey] as never[]) ?? []) as never[]);
      } else {
        errors[s.key] = errorMessage(result.reason, s.label);
      }
    });

    setLoading(false);
    if (Object.keys(errors).length > 0) {
      setLoadErrors(errors);
      toast.error("Some procurement data couldn't be loaded");
    }
  }

  useEffect(() => { load(); }, []);

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.vendorName ?? id;

  // ── Convert quotation -> PO ──────────────────────────────────────────
  // Real, already-working inline action -- no Object Page exists for
  // quotations, so this stays exactly as it was, not converted to a route.
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

  function goToTab(tab: string) {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  if (loading) {
    return <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  }

  return (
    <Tabs value={activeTab} onValueChange={goToTab}>
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
          {/* Real screen navigation (2026-08-30) -- replaces the old "New
              Requisition" Dialog popup with a real create route. */}
          <Button onClick={() => router.push("/procurement/requisitions/new")}><Plus className="size-4" /> New Requisition</Button>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadErrors.requisitions ? (
              // F_032: "No purchase requisitions yet." rendered, with a
              // working New Requisition button beside it, while
              // /api/procurement/requisitions, /purchase-orders and /vendors
              // were all returning 504. A real outage, painted as an empty list.
              <DataLoadError messages={[loadErrors.requisitions]} onRetry={load} />
            ) : requisitions.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No purchase requisitions yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Purpose</TableHead><TableHead>Items</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {/* Real screen navigation (2026-08-30) -- rows open the
                      real Object Page, where Submit now lives. */}
                  {requisitions.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/procurement/requisitions/${r.id}`)}>
                      <TableCell className="font-medium">PR-{r.requisitionNumber}</TableCell>
                      <TableCell className="text-px-muted">{r.purpose ?? "—"}</TableCell>
                      <TableCell>{r.items?.length ?? 0}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
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
          {/* Real screen navigation (2026-08-30) -- replaces the old "New
              RFQ" Dialog popup with a real create route. */}
          <Button onClick={() => router.push("/procurement/rfqs/new")}><Plus className="size-4" /> New RFQ</Button>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadErrors.rfqs ? (
              <DataLoadError messages={[loadErrors.rfqs]} onRetry={load} />
            ) : rfqs.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No RFQs yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Items</TableHead><TableHead>Vendors invited</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {/* Real screen navigation (2026-08-30) -- rows open the
                      real Object Page, where Send + the quotation
                      comparison now live. */}
                  {rfqs.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/procurement/rfqs/${r.id}`)}>
                      <TableCell className="font-medium">RFQ-{r.rfqNumber}</TableCell>
                      <TableCell>{r.items?.length ?? 0}</TableCell>
                      <TableCell>{r.suppliers?.length ?? 0}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
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
          {/* Real screen navigation (2026-08-30) -- replaces the old
              "Record Quotation" Dialog popup with a real create route. */}
          <Button onClick={() => router.push("/procurement/quotations/new")}><Plus className="size-4" /> Record Quotation</Button>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadErrors.quotations ? (
              <DataLoadError messages={[loadErrors.quotations]} onRetry={load} />
            ) : quotations.length === 0 ? (
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
            {loadErrors.purchaseOrders ? (
              <DataLoadError messages={[loadErrors.purchaseOrders]} onRetry={load} />
            ) : purchaseOrders.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No purchase orders yet. Convert a quotation to create one.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Vendor</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {/* Real screen navigation (2026-08-30) -- rows open the
                      real Object Page, where Submit + Receive Goods now
                      live. */}
                  {purchaseOrders.map((po) => (
                    <TableRow key={po.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/procurement/purchase-orders/${po.id}`)}>
                      <TableCell className="font-medium">PO-{po.poNumber}</TableCell>
                      <TableCell>{vendorName(po.supplierId)}</TableCell>
                      <TableCell>{currencyLabel(undefined, currencies)}{Number(po.grandTotal).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[po.status] ?? "outline"}>{po.status}</Badge></TableCell>
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
          {/* Real screen navigation (2026-08-30) -- replaces the old "New
              Goods Receipt" Dialog popup with a real create route. */}
          <Button onClick={() => router.push("/procurement/goods-receipts/new")}><Plus className="size-4" /> New Goods Receipt</Button>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadErrors.goodsReceipts ? (
              <DataLoadError messages={[loadErrors.goodsReceipts]} onRetry={load} />
            ) : goodsReceipts.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No goods receipts recorded yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Vendor</TableHead><TableHead>Items</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {/* Real screen navigation (2026-08-30) -- rows open the
                      real Object Page, where Post to Stock now lives. */}
                  {goodsReceipts.map((gr) => (
                    <TableRow key={gr.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/procurement/goods-receipts/${gr.id}`)}>
                      <TableCell className="font-medium">GRN-{gr.receiptNumber}</TableCell>
                      <TableCell>{vendorName(gr.supplierId)}</TableCell>
                      <TableCell>{gr.items?.length ?? 0}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[gr.status] ?? "outline"}>{gr.status}</Badge></TableCell>
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
