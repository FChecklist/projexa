"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";

type Overview = {
  customer: { id: string; customerName: string; gstin: string | null; creditLimit: string | null };
  opportunities: { id: string; name: string; stage: string; estimatedValue: string | null }[];
  quotations: { id: string; quotationNumber: number; status: string; grandTotal: string; version: number }[];
  salesOrders: { id: string; soNumber: number; status: string; grandTotal: string }[];
  salesInvoices: { id: string; invoiceNumber: number; status: string; grandTotal: string; outstandingAmount: string }[];
  linkedProjects: { id: string; name: string }[];
  summary: { lifetimeInvoiced: number; lifetimeOutstanding: number; openQuotationValue: number; openSalesOrderValue: number };
};

function inr(n: number) { return `₹${n.toLocaleString("en-IN")}`; }

export default function CustomerOverviewClient({ customerId }: { customerId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/customers/${customerId}/overview`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => toast.error("Couldn't load customer overview"))
      .finally(() => setLoading(false));
  }, [customerId]);

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  if (!data?.customer) return <p className="py-10 text-center text-sm text-px-muted">Customer not found.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold">{data.customer.customerName}</h2>
        <p className="text-sm text-px-muted">{data.customer.gstin ?? "No GSTIN on file"}{data.customer.creditLimit ? ` · Credit limit ₹${Number(data.customer.creditLimit).toLocaleString("en-IN")}` : ""}</p>
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
