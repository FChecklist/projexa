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
// R80 GAP-14: the FORKED object screen, not the kit's. The kit hard-codes the
// word "Delete" on its destructive footer action
// (node_modules/@fchecklist/veridian-ui-kit/src/screens/ObjectScreen.tsx:122),
// and that word is a lie here -- the action sets isActive=false and keeps
// every opportunity, quotation, order and invoice on this customer. Decision
// D-33 exists for exactly this: KitObjectScreen adds `deleteLabel` and the
// display-mode `secondaryAction` (Reactivate) and changes nothing else, so a
// screen can name the act it actually performs.
import { KitObjectScreen } from "@/components/screens/KitObjectScreen";
import { DeleteConfirmationCard } from "@/components/DeleteConfirmation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  // R80 GAP-14: armed by the footer's Deactivate, disarmed by Cancel. Nothing
  // destructive happens until the card's own second click.
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

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

  /**
   * R80 GAP-14. Retiring a customer goes through the NEW `DELETE
   * /api/customers/{id}` -- the module's real delete verb -- while bringing
   * one back stays a PATCH. They are deliberately not one symmetrical call:
   * DELETE is the destructive-intent verb the object screen's footer fires and
   * the one api-write-policy gates as such, and reactivating is an ordinary
   * field edit. Both end at the same soft-delete row (see that route's header
   * for why a hard delete would orphan every document on this customer).
   */
  async function setActive(next: boolean) {
    setBusy(true);
    try {
      if (next) {
        await fetchJson(`/api/customers/${customerId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: true }),
        });
      } else {
        await fetchJson(`/api/customers/${customerId}`, { method: "DELETE" });
      }
      toast.success(next ? "Customer reactivated" : "Customer deactivated");
      setIsActive(next);
      setConfirmingDeactivate(false);
    } catch (err) {
      toast.error(errorMessage(err, next ? "Couldn't reactivate this customer" : "Couldn't deactivate this customer"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  if (loadError) return <DataLoadError messages={[loadError]} onRetry={load} />;
  // Only reachable now when the read SUCCEEDED and genuinely returned no
  // customer -- which really is "not found".
  if (!data?.customer) return <p className="py-10 text-center text-sm text-px-muted">Customer not found.</p>;

  // R80 GAP-14: what the deactivation does NOT destroy, counted off the 360
  // aggregation this page has already loaded -- no extra read to state the
  // blast radius.
  const keptRecords =
    data.opportunities.length + data.quotations.length + data.salesOrders.length + data.salesInvoices.length;

  return (
    <KitObjectScreen
      breadcrumb="Customers / Customer"
      title={mode === "edit" ? "Edit Customer" : data.customer.customerName}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: isActive ? "done" : "late", label: isActive ? "active" : "inactive" }}
      facets={[{ label: "GSTIN", value: data.customer.gstin ?? "—" }, { label: "Credit Limit", value: data.customer.creditLimit ? inr(Number(data.customer.creditLimit)) : "—" }]}
      onEdit={mode === "display" && isActive ? startEdit : undefined}
      editDisabledReason={mode === "display" && !isActive ? "This customer is inactive" : undefined}
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      // R80 GAP-14 -- the Delete this screen never had. It ARMS the
      // confirmation below; it never writes. Withheld while editing or on an
      // already-inactive customer, but the control stays on screen with its
      // reason (D-22) instead of vanishing, so a missing feature is never
      // mistaken for a broken one.
      onDelete={isActive && mode === "display" ? () => setConfirmingDeactivate(true) : undefined}
      // D-33 / R-093: the word names the act. This keeps the row and every
      // document on it, so it cannot say "Delete".
      deleteLabel="Deactivate"
      deleteDisabledReason={busy ? "Working…" : !isActive ? "Already inactive" : mode === "edit" ? "Finish editing first" : undefined}
      // D-33 point 2: deactivation is not one-way. Reactivate replaces the
      // body toggle this screen used to carry -- one status control, in the
      // action bar where every other verb on this page lives.
      secondaryAction={
        !isActive && mode === "display"
          ? { label: "Reactivate", onClick: () => void setActive(true), disabledReason: busy ? "Working…" : undefined }
          : undefined
      }
      onBack={() => router.push("/customers")}
      saveDisabled={saving || !draft.customerName.trim()}
      saveDisabledReason={saving ? "Saving…" : !draft.customerName.trim() ? "Customer name is required" : undefined}
      messages={[]}
    >
      {/* R80 GAP-14. The shared confirm card (the same component
          useDeleteConfirmation renders), driven directly rather than through
          that hook for ONE reason: the hook's sentence comes from
          deleteConfirmation(), which hard-codes "Delete <x>? This cannot be
          undone." Both halves are false here -- nothing is deleted, and
          Reactivate above undoes it in one click -- and a confirmation that
          misstates what it is about to do is worse than none. Everything else
          is the sanctioned flow: same card, same role="alertdialog", same
          two-click arming, and the sentence still names the blast radius
          rather than asking "are you sure". */}
      {confirmingDeactivate && (
        <DeleteConfirmationCard
          sentence={`Deactivate ${data.customer.customerName}? Its ${keptRecords} linked ${keptRecords === 1 ? "record is" : "records are"} kept — opportunities, quotations, sales orders and invoices are untouched — and you can reactivate it from this page.`}
          confirmLabel="Deactivate customer"
          running={busy}
          onConfirm={() => void setActive(false)}
          onCancel={() => setConfirmingDeactivate(false)}
        />
      )}
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
          {/* R80 GAP-14: the status badge and its toggle used to live here, a
              second action bar inside the body. The badge is now the header's
              own headerStatus and the two verbs are Deactivate/Reactivate in
              the footer, so the record has ONE place that states its status
              and ONE place that changes it. */}
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
    </KitObjectScreen>
  );
}
