"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
// Priority 17 final gap (2026-07-16): erp_sales_orders gained a companyId
// column this wave -- reuses the exact selector AccountingClient.tsx/
// LeadsClient.tsx already built (company-scope.tsx), not a second copy.
// consolidate has no meaning for a flat sales-orders list, so the toggle is
// hidden here, same as Leads/Quotations.
import { type Company, type CompanyScope, CompanySelector } from "@/components/company-scope";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

// Real-screen conversion (2026-08-30): "New Sales Order" routes to a real
// create screen (SalesOrderCreateClient.tsx). Rows route to a real Object
// Page (SalesOrderObjectClient.tsx, which gained a real detail view this
// conversion -- line items and their per-item deliveredQuantity were
// completely invisible before -- plus a real SAP-style Document Flow
// trace, a fully-built feature that had no PROJEXA proxy until now). The
// inline status Select and bulk-status bar were already real (no Dialog)
// and stay unchanged.
type SalesOrder = {
  id: string; soNumber: number; customerId: string; customerName: string | null;
  orderDate: string; deliveryDate: string | null; status: string;
  companyId: string | null;
  currencyId: string | null; exchangeRate: string; grandTotal: string;
};

const STATUS_OPTIONS = ["draft", "confirmed", "partially_fulfilled", "fulfilled", "cancelled"];
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", confirmed: "secondary", partially_fulfilled: "secondary", fulfilled: "default", cancelled: "destructive",
};

export default function SalesOrdersClient() {
  const router = useRouter();
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Priority 17 final gap: companies list + the list-level filter scope.
  // Defaults to "All companies" -- an org that hasn't set up companies/
  // offices yet (or an order never attributed to one) sees no change.
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });
  const currencies = useCurrencies();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (scope.companyId) params.set("companyId", scope.companyId);
      const data = await fetchJson<{ salesOrders?: SalesOrder[]; total?: number }>(`/api/sales-orders?${params.toString()}`);
      setOrders(data.salesOrders ?? []);
      setTotal(data.total ?? 0);
      setSelected(new Set());
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load sales orders"));
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, scope.companyId]);

  useEffect(() => { load(); }, [load]);
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

  async function updateStatus(order: SalesOrder, status: string) {
    try {
      const res = await fetch(`/api/sales-orders/${order.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error); }
      toast.success(`Order #${order.soNumber} → ${status}`);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't update sales order");
    }
  }

  async function bulkStatus(status: string) {
    if (!selected.size) return;
    try {
      const res = await fetch("/api/sales-orders/bulk-status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesOrderIds: Array.from(selected), status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const skipped = data.skippedIds?.length ?? 0;
      toast.success(`Updated ${data.updated?.length ?? 0} order(s)${skipped ? `, ${skipped} skipped (invalid transition)` : ""}`);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't bulk-update status");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <CompanySelector companies={companies} scope={scope} onChange={(s) => { setPage(1); setScope(s); }} showConsolidateToggle={false} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search by customer…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} className="w-56" />
          <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Sales Order" Dialog popup with a real create route. */}
        <Button onClick={() => router.push("/sales-orders/new")}><Plus className="size-4" /> New Sales Order</Button>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-px-orange/30 bg-px-orange/5 px-3 py-2 text-sm">
          <span>{selected.size} selected</span>
          {STATUS_OPTIONS.map((s) => (
            <Button key={s} size="sm" variant="outline" onClick={() => bulkStatus(s)}>Mark {s.replace("_", " ")}</Button>
          ))}
        </div>
      )}

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : orders.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No sales orders found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={selected.size === orders.length && orders.length > 0}
                      onCheckedChange={(c) => setSelected(c ? new Set(orders.map((o) => o.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead>#</TableHead><TableHead>Customer</TableHead><TableHead>Order Date</TableHead>
                  <TableHead>Total</TableHead><TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows open the
                    real Object Page, where line items + Document Flow now
                    live. */}
                {orders.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/sales-orders/${o.id}`)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(o.id)}
                        onCheckedChange={(c) => setSelected((prev) => { const next = new Set(prev); if (c) next.add(o.id); else next.delete(o.id); return next; })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{o.soNumber}</TableCell>
                    <TableCell className="text-px-muted">{o.customerName ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{o.orderDate}</TableCell>
                    <TableCell className="text-px-muted">
                      {currencyLabel(o.currencyId, currencies)}{Number(o.grandTotal).toLocaleString("en-US")}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Select value={o.status} onValueChange={(v) => updateStatus(o, v)}>
                        <SelectTrigger className="h-7 w-40 border-none p-0 shadow-none">
                          <Badge variant={STATUS_VARIANT[o.status] ?? "outline"}>{o.status.replace("_", " ")}</Badge>
                        </SelectTrigger>
                        <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {total > pageSize && (
        <div className="flex items-center justify-between text-sm text-px-muted">
          <span>Page {page} of {totalPages} — {total} order(s)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
