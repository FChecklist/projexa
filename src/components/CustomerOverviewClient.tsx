"use client";

// Real-screen conversion (2026-08-30): wraps the existing Customer 360
// overview (unchanged -- it was already real and rich: opportunities/
// quotations/sales orders/invoices/summary, all from a real
// getCustomerOverview() aggregation) in a real Object Page with the
// Back/Edit/Deactivate this route never had. getCustomer()/the isActive
// branch of updateCustomer() didn't exist before this conversion.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useOrgRole } from "@/hooks/use-org-role";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import DataLoadError from "@/components/DataLoadError";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Overview = {
  customer: { id: string; customerName: string; gstin: string | null; creditLimit: string | null };
  opportunities: { id: string; name: string; stage: string; estimatedValue: string | null }[];
  quotations: { id: string; quotationNumber: number; status: string; grandTotal: string; version: number }[];
  salesOrders: { id: string; soNumber: number; status: string; grandTotal: string }[];
  salesInvoices: { id: string; invoiceNumber: number; status: string; grandTotal: string; outstandingAmount: string }[];
  linkedProjects: { id: string; name: string }[];
  summary: { lifetimeInvoiced: number; lifetimeOutstanding: number; openQuotationValue: number; openSalesOrderValue: number };
};
type CustomerDetail = { id: string; customerName: string; gstin: string | null; pan: string | null; defaultPaymentTermsDays: number | null; creditLimit: string | null; isActive: boolean };

export default function CustomerOverviewClient({ customerId }: { customerId: string }) {
  const router = useRouter();
  const { isIndiaOrg } = useOrgRole();
  const currencies = useCurrencies();
  // Priority 17 re-sweep fix: was a module-level `inr()` hardcoding "₹" --
  // now a closure over `currencies` so every existing inr(...) call site
  // below resolves the org's real base currency instead, with zero
  // call-site changes needed.
  const inr = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-US")}`;
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ customerName: "", gstin: "", pan: "", defaultPaymentTermsDays: "", creditLimit: "" });
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  // A4S14_customerid_01: GET /api/customers/{id}/overview returned 504 on
  // 2 of 2 attempts for a REAL customer id, and this used to parse the error
  // body as if it were the overview. `data` then had no `customer` key, so
  // the page told the user "Customer not found." -- a false statement about
  // a customer that demonstrably exists, with nothing on screen saying the
  // read had failed. Read the status first, and keep the backend's words.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [overview, detail] = await Promise.all([
        fetchJson<Overview>(`/api/customers/${customerId}/overview`),
        fetchJson<CustomerDetail>(`/api/customers/${customerId}`),
      ]);
      setData(overview);
      setIsActive(detail.isActive);
    } catch (err) {
      const msg = errorMessage(err, "Couldn't load customer overview");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  async function startEdit() {
    try {
      const c = await fetchJson<CustomerDetail>(`/api/customers/${customerId}`);
      setDraft({
        customerName: c.customerName, gstin: c.gstin ?? "", pan: c.pan ?? "",
        defaultPaymentTermsDays: c.defaultPaymentTermsDays != null ? String(c.defaultPaymentTermsDays) : "",
        creditLimit: c.creditLimit ?? "",
      });
      setIsActive(c.isActive);
      setMode("edit");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load customer details"));
    }
  }

  async function saveEdit() {
    if (!draft.customerName.trim()) { toast.error("Customer name is required"); return; }
    setSaving(true);
    try {
      await fetchJson(`/api/customers/${customerId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: draft.customerName.trim(), gstin: draft.gstin || undefined, pan: draft.pan || undefined,
          defaultPaymentTermsDays: draft.defaultPaymentTermsDays ? Number(draft.defaultPaymentTermsDays) : undefined,
          creditLimit: draft.creditLimit ? Number(draft.creditLimit) : undefined,
        }),
      });
      toast.success("Customer saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save customer"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await fetchJson(`/api/customers/${customerId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      toast.success(isActive ? "Customer deactivated" : "Customer activated");
      setIsActive((v) => !v);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update customer status"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  if (loadError) return <DataLoadError messages={[loadError]} onRetry={load} />;
  // Only reachable now when the read SUCCEEDED and genuinely returned no
  // customer -- which really is "not found".
  if (!data?.customer) return <p className="py-10 text-center text-sm text-px-muted">Customer not found.</p>;

  return (
    <ObjectScreen
      breadcrumb="Customers / Customer"
      title={mode === "edit" ? "Edit Customer" : data.customer.customerName}
      mode={mode}
      hasDraft={false}
      facets={[{ label: "GSTIN", value: data.customer.gstin ?? "—" }, { label: "Credit Limit", value: data.customer.creditLimit ? inr(Number(data.customer.creditLimit)) : "—" }]}
      onEdit={mode === "display" ? startEdit : undefined}
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      onBack={() => router.push("/customers")}
      saveDisabled={saving || !draft.customerName.trim()}
      saveDisabledReason={saving ? "Saving…" : !draft.customerName.trim() ? "Customer name is required" : undefined}
      messages={[]}
    >
      {mode === "edit" ? (
        <div className="space-y-3 px-4 py-3">
          <div className="space-y-1.5"><Label>Customer Name</Label><Input value={draft.customerName} onChange={(e) => setDraft((d) => ({ ...d, customerName: e.target.value }))} /></div>
          {isIndiaOrg && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label>GSTIN</Label><Input value={draft.gstin} onChange={(e) => setDraft((d) => ({ ...d, gstin: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>PAN</Label><Input value={draft.pan} onChange={(e) => setDraft((d) => ({ ...d, pan: e.target.value }))} /></div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>Payment Terms (days)</Label><Input type="number" value={draft.defaultPaymentTermsDays} onChange={(e) => setDraft((d) => ({ ...d, defaultPaymentTermsDays: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Credit Limit</Label><Input type="number" value={draft.creditLimit} onChange={(e) => setDraft((d) => ({ ...d, creditLimit: e.target.value }))} /></div>
          </div>
        </div>
      ) : (
        <div className="space-y-6 px-4 py-3">
          <div className="flex items-center justify-between">
            <Badge variant={isActive ? "default" : "outline"}>{isActive ? "active" : "inactive"}</Badge>
            <Button size="sm" variant="outline" disabled={busy} onClick={toggleActive}>{busy ? "Saving…" : isActive ? "Deactivate" : "Activate"}</Button>
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
      )}
    </ObjectScreen>
  );
}
