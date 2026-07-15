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
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";

type SalesOrderItem = { id: string; description: string; quantity: string; rate: string; amount: string; deliveredQuantity: string };
type SalesOrder = {
  id: string; soNumber: number; customerId: string; customerName: string | null;
  orderDate: string; deliveryDate: string | null; status: string;
  currencyId: string | null; exchangeRate: string; grandTotal: string; items: SalesOrderItem[];
};
type Customer = { id: string; customerName: string };
type Project = { id: string; name: string };
// currencyLabel()/useCurrencies() now live in @/lib/currency (Priority 17
// re-sweep consolidation -- this was previously a per-file copy).
type Line = { description: string; quantity: string; rate: string };

const STATUS_OPTIONS = ["draft", "confirmed", "partially_fulfilled", "fulfilled", "cancelled"];
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", confirmed: "secondary", partially_fulfilled: "secondary", fulfilled: "default", cancelled: "destructive",
};

export default function SalesOrdersClient() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", rate: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const currencies = useCurrencies();
  const [currencyId, setCurrencyId] = useState("");
  const [exchangeRate, setExchangeRate] = useState("1");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/sales-orders?${params.toString()}`);
      const data = await res.json();
      setOrders(data.salesOrders ?? []);
      setTotal(data.total ?? 0);
      setSelected(new Set());
    } catch {
      toast.error("Couldn't load sales orders");
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/customers").then((r) => r.json()).then((d) => setCustomers(d.customers ?? [])).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/projects").then((r) => r.json()).then((d) => setProjects(d.projects ?? [])).catch(() => {}); }, []);

  const selectedCurrency = currencies.find((c) => c.id === currencyId);
  const needsExchangeRate = !!currencyId && !selectedCurrency?.isBaseCurrency;

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function createOrder() {
    if (!customerId || lines.some((l) => !l.description.trim() || !l.rate)) return;
    if (needsExchangeRate && (!exchangeRate || Number(exchangeRate) <= 0)) {
      toast.error("An exchange rate is required for a non-base currency");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/sales-orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId, projectId: projectId || undefined, orderDate, deliveryDate: deliveryDate || undefined,
          currencyId: currencyId || undefined, exchangeRate: currencyId ? Number(exchangeRate) : undefined,
          items: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 1, rate: Number(l.rate) })),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Sales order created");
      setCustomerId(""); setProjectId(""); setLines([{ description: "", quantity: "1", rate: "" }]);
      setCurrencyId(""); setExchangeRate("1"); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't create sales order");
    } finally {
      setSubmitting(false);
    }
  }

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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Sales Order</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Sales Order</DialogTitle></DialogHeader>
            <div className="max-h-[70vh] space-y-3 overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Customer</Label>
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                    <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Project (optional)</Label>
                  <Select value={projectId} onValueChange={setProjectId}>
                    <SelectTrigger><SelectValue placeholder="No project" /></SelectTrigger>
                    <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Order Date</Label><Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Delivery Date (optional)</Label><Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></div>
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
            <DialogFooter><Button onClick={createOrder} disabled={submitting || !customerId}>{submitting ? "Creating…" : "Create Sales Order"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
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
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(o.id)}
                        onCheckedChange={(c) => setSelected((prev) => { const next = new Set(prev); if (c) next.add(o.id); else next.delete(o.id); return next; })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{o.soNumber}</TableCell>
                    <TableCell className="text-px-muted">{o.customerName ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{o.orderDate}</TableCell>
                    <TableCell className="text-px-muted">
                      {currencyLabel(o.currencyId, currencies)}{Number(o.grandTotal).toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell>
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
