"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import LoadError from "@/components/LoadError";

type Overview = {
  customer: { id: string; customerName: string; gstin: string | null; creditLimit: string | null };
  opportunities: { id: string; name: string; stage: string; estimatedValue: string | null }[];
  quotations: { id: string; quotationNumber: number; status: string; grandTotal: string; version: number }[];
  salesOrders: { id: string; soNumber: number; status: string; grandTotal: string }[];
  salesInvoices: { id: string; invoiceNumber: number; status: string; grandTotal: string; outstandingAmount: string }[];
  linkedProjects: { id: string; name: string }[];
  summary: { lifetimeInvoiced: number; lifetimeOutstanding: number; openQuotationValue: number; openSalesOrderValue: number };
};

export default function CustomerOverviewClient({ customerId }: { customerId: string }) {
  const currencies = useCurrencies();
  // Priority 17 re-sweep fix: was a module-level `inr()` hardcoding "₹" --
  // now a closure over `currencies` so every existing inr(...) call site
  // below resolves the org's real base currency instead, with zero
  // call-site changes needed.
  const inr = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-US")}`;
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // R52 Gate 2 / A4S14_customerid_01. GET /api/customers/{id}/overview 504s and
  // res.ok was never read, so the error body was stored AS the overview. It has
  // no `customer` key, so the guard below fell through to "Customer not found."
  // -- the app telling a CRM user that a customer it just linked to does not
  // exist, when the truth is the read failed. Those two answers must never share
  // a branch: one is about the data, the other is about the request.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const d = await fetchJson<Overview>(`/api/customers/${customerId}/overview`);
      setData(d);
    } catch (err) {
      setData(null);
      const msg = errorMessage(err, "Couldn't load customer overview");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  if (loadError) return <LoadError message={loadError} onRetry={load} />;
  if (!data?.customer) return <p className="py-10 text-center text-sm text-px-muted">Customer not found.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold">{data.customer.customerName}</h2>
        <p className="text-sm text-px-muted">{data.customer.gstin ?? "No GSTIN on file"}{data.customer.creditLimit ? ` · Credit limit ${inr(Number(data.customer.creditLimit))}` : ""}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="shadow-card"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-px-muted">Lifetime Invoiced</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{inr(data.summary.lifetimeInvoiced)}</CardContent></Card>
        <Card className="shadow-card"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-px-muted">Outstanding</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{inr(data.summary.lifetimeOutstanding)}</CardContent></Card>
        <Card className="shadow-card"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-px-muted">Open Quotations</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{inr(data.summary.openQuotationValue)}</CardContent></Card>
        <Card className="shadow-card"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-px-muted">Open Sales Orders</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{inr(data.summary.openSalesOrderValue)}</CardContent></Card>
      </div>

      {data.linkedProjects.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.linkedProjects.map((p) => <Badge key={p.id} variant="outline">{p.name}</Badge>)}
        </div>
      )}

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Opportunities ({data.opportunities.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.opportunities.length === 0 ? <p className="px-6 pb-4 text-sm text-px-muted">None yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Stage</TableHead><TableHead>Value</TableHead></TableRow></TableHeader>
              <TableBody>{data.opportunities.map((o) => (
                <TableRow key={o.id}><TableCell>{o.name}</TableCell><TableCell><Badge variant="outline">{o.stage}</Badge></TableCell><TableCell>{o.estimatedValue ? inr(Number(o.estimatedValue)) : "—"}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Quotations ({data.quotations.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.quotations.length === 0 ? <p className="px-6 pb-4 text-sm text-px-muted">None yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
              <TableBody>{data.quotations.map((q) => (
                <TableRow key={q.id}><TableCell>{q.quotationNumber}</TableCell><TableCell>v{q.version}</TableCell><TableCell><Badge variant="outline">{q.status.replace("_", " ")}</Badge></TableCell><TableCell>{inr(Number(q.grandTotal))}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Sales Orders ({data.salesOrders.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.salesOrders.length === 0 ? <p className="px-6 pb-4 text-sm text-px-muted">None yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
              <TableBody>{data.salesOrders.map((so) => (
                <TableRow key={so.id}><TableCell>{so.soNumber}</TableCell><TableCell><Badge variant="outline">{so.status.replace("_", " ")}</Badge></TableCell><TableCell>{inr(Number(so.grandTotal))}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Sales Invoices ({data.salesInvoices.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.salesInvoices.length === 0 ? <p className="px-6 pb-4 text-sm text-px-muted">None yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead><TableHead>Outstanding</TableHead></TableRow></TableHeader>
              <TableBody>{data.salesInvoices.map((inv) => (
                <TableRow key={inv.id}><TableCell>{inv.invoiceNumber}</TableCell><TableCell><Badge variant="outline">{inv.status}</Badge></TableCell><TableCell>{inr(Number(inv.grandTotal))}</TableCell><TableCell>{inr(Number(inv.outstandingAmount))}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
