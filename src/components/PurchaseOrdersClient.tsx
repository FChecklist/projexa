"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
// Priority 17 final gap (2026-07-16): erp_purchase_orders gained a
// companyId column this wave -- reuses the exact selector
// AccountingClient.tsx/LeadsClient.tsx already built (company-scope.tsx),
// not a second copy. consolidate has no meaning for a flat PO list, so the
// toggle is hidden here, same as Leads/Quotations/Sales Orders.
import { type Company, type CompanyScope, CompanySelector } from "@/components/company-scope";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

// Priority 17 Wave 1 (multi-currency Selling & Buying): the first Purchase
// Order creation UI in PROJEXA -- VendorsClient.tsx only ever managed
// vendor master data, confirmed by a full-repo search that no PO creation
// form existed anywhere before this wave.
//
// Real-screen conversion (2026-08-30): "New Purchase Order" routes to a
// real create screen (PurchaseOrderCreateClient.tsx, unchanged fields).
// Rows route to the real Object Page already built for this exact entity
// in Procurement's own PO stage (module #22) -- erp_purchase_orders is the
// SAME table both surfaces read/write, so this reuses that Object Page
// rather than building a second, duplicate one.
type PurchaseOrder = {
  id: string; poNumber: number; vendorId: string; orderDate: string; expectedDeliveryDate: string | null;
  status: string; companyId: string | null; currencyId: string | null; exchangeRate: string; grandTotal: string;
};
type Vendor = { id: string; vendorName: string };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", partially_received: "secondary", completed: "default", cancelled: "destructive",
};

export default function PurchaseOrdersClient() {
  const router = useRouter();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const currencies = useCurrencies();
  const [loading, setLoading] = useState(true);

  // Priority 17 final gap: companies list + the list-level filter scope.
  // Defaults to "All companies" -- an org that hasn't set up companies/
  // offices yet (or a PO never attributed to one) sees no change.
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (scope.companyId) params.set("companyId", scope.companyId);
      const qs = params.toString();
      const data = await fetchJson<{ purchaseOrders?: PurchaseOrder[] }>(`/api/purchase-orders${qs ? `?${qs}` : ""}`);
      setOrders(data.purchaseOrders ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load purchase orders"));
    } finally {
      setLoading(false);
    }
  }, [scope.companyId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/vendors").then((r) => r.json()).then((d) => setVendors(d.vendors ?? [])).catch(() => {}); }, []);
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchJson<{ companies?: Company[] }>("/api/companies");
        setCompanies(data.companies ?? []);
      } catch {
        // Non-fatal -- CompanySelector renders nothing when companies is
        // empty, so a failed fetch just means no selector, not a broken page.
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <CompanySelector companies={companies} scope={scope} onChange={setScope} showConsolidateToggle={false} />
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Purchase Order" Dialog popup with a real create route. */}
        <Button onClick={() => router.push("/purchase-orders/new")}><Plus className="size-4" /> New Purchase Order</Button>
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
                {/* Real screen navigation (2026-08-30) -- rows open the real
                    Object Page built for this entity in Procurement (module
                    #22), where Submit/Receive Goods live. */}
                {orders.map((po) => (
                  <TableRow key={po.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/procurement/purchase-orders/${po.id}`)}>
                    <TableCell className="font-medium">{po.poNumber}</TableCell>
                    <TableCell className="text-px-muted">{vendors.find((v) => v.id === po.vendorId)?.vendorName ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{po.orderDate}</TableCell>
                    <TableCell className="text-px-muted">
                      {currencyLabel(po.currencyId, currencies)}{Number(po.grandTotal).toLocaleString("en-US")}
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
