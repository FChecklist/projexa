"use client";

// Priority 15: PROJEXA's Invoicing surface -- full sales-invoice lifecycle
// (draft -> submitted -> partially_paid/paid/overdue -> cancelled), credit
// notes linked to their original invoice, and a full AR aging report.
// Extends Priority 13's sales-invoices alias (list/create) rather than
// replacing it -- payments/cancel are new sub-actions on the same
// resource. Sized for 500-project scale: filter by status/customer/date
// range, paginated list.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import PrimarySubmit from "@/components/PrimarySubmit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Receipt, ChevronLeft, ChevronRight, Banknote, Ban } from "lucide-react";
import { currencyLabel, useCurrencies, type Currency } from "@/lib/currency";
import { formatDate } from "@/lib/format-date";

type Invoice = { id: string; invoiceNumber: number; customerId: string; customerName: string | null; postingDate: string; dueDate: string | null; grandTotal: string; outstandingAmount: string; status: string };
type CreditNote = { id: string; creditNoteNumber: number; customerId: string; salesInvoiceId: string | null; postingDate: string; reason: string | null; status: string; totalAmount: string };
type Customer = { id: string; customerName: string };
type Account = { id: string; accountName: string; accountNumber: string | null; accountType: string | null };
type AgingReport = { asOfDate: string; totalOutstanding: number; buckets: Record<string, number>; invoices: { invoiceId: string; invoiceNumber: number; customerName: string | null; dueDate: string | null; outstandingAmount: string; daysOverdue: number; bucket: string }[] };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", partially_paid: "secondary", paid: "default", overdue: "destructive", cancelled: "outline",
};
const NEW_CUSTOMER = "__new__";

// Priority 17 re-sweep fix: was a plain function hardcoding "₹" -- now takes
// the caller's own `currencies` list (each panel below fetches it
// independently via useCurrencies()) and resolves the org's real base
// currency instead.
function money(v: string | number, currencies: Currency[]) {
  return `${currencyLabel(undefined, currencies)}${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// ---------------------------------------------------------------------------
// Invoices tab
// ---------------------------------------------------------------------------
function InvoicesPanel() {
  const currencies = useCurrencies();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [rate, setRate] = useState("");

  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      // Status read before body -- the old `await res.json()` turned a failing
      // upstream into "No invoices found." (A4S14_10's empty invoice table).
      const data = await fetchJson<{ salesInvoices?: Invoice[]; totalPages?: number }>(
        `/api/sales-invoices?${params.toString()}`
      );
      setInvoices(data.salesInvoices ?? []);
      setTotalPages(data.totalPages ?? 1);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load invoices"));
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, statusFilter]);

  async function loadLookups() {
    try {
      const [custData, acctData] = await Promise.all([
        fetchJson<{ customers?: Customer[] }>("/api/customers"),
        fetchJson<{ accounts?: Account[] }>("/api/accounts"),
      ]);
      setCustomers(custData.customers ?? []);
      setAccounts(acctData.accounts ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load customers / accounts from VERIDIAN"));
    }
  }

  function onCreateOpenChange(next: boolean) {
    setCreateOpen(next);
    if (next && customers.length === 0) loadLookups();
  }

  // What still blocks Create. Drives the disabled state AND the count shown
  // beside the button, so the silent guards below cannot be reached by a click.
  const createMissing = [
    ...(customerId ? [] : ["Customer"]),
    ...(customerId === NEW_CUSTOMER && !newCustomerName.trim() ? ["New customer name"] : []),
    ...(description.trim() ? [] : ["Description"]),
    ...(rate ? [] : ["Rate"]),
  ];

  async function createInvoice() {
    if (!description.trim() || !rate) return;
    if (!customerId || (customerId === NEW_CUSTOMER && !newCustomerName.trim())) return;
    setSubmitting(true);
    try {
      let resolvedCustomerId = customerId;
      if (customerId === NEW_CUSTOMER) {
        const created = await fetchJson<{ id: string }>("/api/customers", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerName: newCustomerName }),
        });
        resolvedCustomerId = created.id;
      }
      await fetchJson("/api/sales-invoices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: resolvedCustomerId, postingDate, items: [{ description, quantity: Number(quantity), rate: Number(rate) }] }),
      });
      toast.success("Invoice created");
      setCustomerId(""); setNewCustomerName(""); setDescription(""); setQuantity("1"); setRate(""); setCreateOpen(false);
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create invoice"));
    } finally {
      setSubmitting(false);
    }
  }

  function openPayment(inv: Invoice) {
    setPaymentInvoice(inv);
    setPaymentAmount(inv.outstandingAmount);
    if (accounts.length === 0) loadLookups();
  }

  async function recordPayment() {
    if (!paymentInvoice || !paymentAmount || !paymentAccountId) return;
    setPaymentSubmitting(true);
    try {
      await fetchJson(`/api/sales-invoices/${paymentInvoice.id}/payments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(paymentAmount), bankOrCashAccountId: paymentAccountId, postingDate: paymentDate }),
      });
      toast.success("Payment recorded");
      setPaymentInvoice(null); setPaymentAmount(""); setPaymentAccountId("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record payment");
    } finally {
      setPaymentSubmitting(false);
    }
  }

  async function cancelInvoice(id: string) {
    try {
      await fetchJson(`/api/sales-invoices/${id}/cancel`, { method: "POST" });
      toast.success("Invoice cancelled");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel invoice");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {["draft", "submitted", "partially_paid", "paid", "overdue", "cancelled"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
          <DialogTrigger asChild><Button size="sm"><Receipt className="size-4" /> Create Invoice</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Sales Invoice</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger><SelectValue placeholder="Select a customer" /></SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}
                    <SelectItem value={NEW_CUSTOMER}>+ New customer…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {customerId === NEW_CUSTOMER && <div className="space-y-1.5"><Label>New Customer Name</Label><Input value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} /></div>}
              <div className="space-y-1.5"><Label>Posting Date</Label><Input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Line Item Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Interior fit-out — Milestone 1" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Rate</Label><Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
              </div>
            </div>
            <DialogFooter>
              <PrimarySubmit missing={createMissing} submitting={submitting} submittingLabel="Creating…" onClick={createInvoice}>
                Create Invoice
              </PrimarySubmit>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            // Never an empty table where an error belongs.
            <div className="p-4"><DataLoadError messages={[loadError]} onRetry={load} /></div>
          ) : invoices.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No invoices found.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Customer</TableHead><TableHead>Posting Date</TableHead><TableHead>Due Date</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="text-px-muted">{inv.invoiceNumber}</TableCell>
                    <TableCell className="font-medium">{inv.customerName ?? "—"}</TableCell>
                    <TableCell>{formatDate(inv.postingDate)}</TableCell>
                    <TableCell className="text-px-muted">{inv.dueDate ? formatDate(inv.dueDate) : "—"}</TableCell>
                    <TableCell className="text-right">{money(inv.grandTotal, currencies)}</TableCell>
                    <TableCell className="text-right">{money(inv.outstandingAmount, currencies)}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[inv.status] ?? "outline"} className="capitalize">{inv.status.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-right space-x-1">
                      {["submitted", "partially_paid", "overdue"].includes(inv.status) && (
                        <Button variant="ghost" size="sm" onClick={() => openPayment(inv)}><Banknote className="size-3.5" /> Record Payment</Button>
                      )}
                      {inv.status === "draft" && (
                        <Button variant="ghost" size="sm" className="text-red-600" onClick={() => cancelInvoice(inv.id)}><Ban className="size-3.5" /> Cancel</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm text-px-muted">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="size-4" /></Button>
          Page {page} of {totalPages}
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="size-4" /></Button>
        </div>
      )}

      <Dialog open={!!paymentInvoice} onOpenChange={(next) => !next && setPaymentInvoice(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment — Invoice #{paymentInvoice?.invoiceNumber}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label>Amount</Label><Input type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Posting Date</Label><Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Bank / Cash Account</Label>
              <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                <SelectTrigger><SelectValue placeholder={accounts.length ? "Select an account" : "Loading…"} /></SelectTrigger>
                <SelectContent>{accounts.filter((a) => a.accountType === "bank" || a.accountType === "cash").map((a) => <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={recordPayment} disabled={paymentSubmitting}>{paymentSubmitting ? "Recording…" : "Record Payment"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Credit Notes tab
// ---------------------------------------------------------------------------
function CreditNotesPanel() {
  const currencies = useCurrencies();
  const [notes, setNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [salesInvoiceId, setSalesInvoiceId] = useState("");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await fetchJson<{ creditNotes?: CreditNote[] }>("/api/credit-notes");
      setNotes(data.creditNotes ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load credit notes"));
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next || invoices.length > 0) return;
    try {
      const data = await fetchJson<{ salesInvoices?: Invoice[] }>("/api/sales-invoices?limit=100");
      setInvoices(data.salesInvoices ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load invoices to link"));
    }
  }

  const noteMissing = [
    ...(invoices.find((i) => i.id === salesInvoiceId) ? [] : ["Invoice"]),
    ...(description.trim() ? [] : ["Description"]),
    ...(amount ? [] : ["Amount"]),
  ];

  async function createNote() {
    const invoice = invoices.find((i) => i.id === salesInvoiceId);
    if (!invoice || !description.trim() || !amount) return;
    setSubmitting(true);
    try {
      await fetchJson("/api/credit-notes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: invoice.customerId, salesInvoiceId: invoice.id, postingDate: new Date().toISOString().slice(0, 10),
          reason: reason || undefined, items: [{ description, quantity: 1, rate: Number(amount) }],
        }),
      });
      toast.success("Credit note created");
      setSalesInvoiceId(""); setReason(""); setDescription(""); setAmount(""); setOpen(false);
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create credit note"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> New Credit Note</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Sales Credit Note</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Against Invoice</Label>
                <Select value={salesInvoiceId} onValueChange={setSalesInvoiceId}>
                  <SelectTrigger><SelectValue placeholder="Select an invoice" /></SelectTrigger>
                  <SelectContent>{invoices.map((i) => <SelectItem key={i.id} value={i.id}>#{i.invoiceNumber} — {i.customerName ?? "—"}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Reason (optional)</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Scope reduction, Milestone 2" /></div>
              <div className="space-y-1.5"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Amount</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <PrimarySubmit missing={noteMissing} submitting={submitting} submittingLabel="Creating…" onClick={createNote}>
                Create Credit Note
              </PrimarySubmit>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            <div className="p-4"><DataLoadError messages={[loadError]} onRetry={load} /></div>
          ) : notes.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No credit notes yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Posting Date</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {notes.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="text-px-muted">{n.creditNoteNumber}</TableCell>
                    <TableCell>{formatDate(n.postingDate)}</TableCell>
                    <TableCell className="text-px-muted">{n.reason ?? "—"}</TableCell>
                    <TableCell className="text-right">{money(n.totalAmount, currencies)}</TableCell>
                    <TableCell><Badge variant={n.status === "submitted" ? "default" : "outline"} className="capitalize">{n.status}</Badge></TableCell>
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

// ---------------------------------------------------------------------------
// AR Aging tab
// ---------------------------------------------------------------------------
function ArAgingPanel() {
  const currencies = useCurrencies();
  const [report, setReport] = useState<AgingReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ar-aging");
        setReport(await res.json());
      } catch {
        toast.error("Couldn't load AR aging report");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  if (!report) return <p className="py-10 text-center text-sm text-px-muted">Couldn&apos;t load the AR aging report.</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2 text-center text-sm">
        {[["Current", report.buckets.current], ["1-30d", report.buckets.d1_30], ["31-60d", report.buckets.d31_60], ["61-90d", report.buckets.d61_90], ["90+d", report.buckets.d90Plus]].map(([label, value]) => (
          <Card key={label as string} className="shadow-card"><CardContent className="p-3"><p className="text-xs text-px-muted">{label}</p><p className="mt-1 font-semibold text-px-ink">{money(value as number, currencies)}</p></CardContent></Card>
        ))}
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {report.invoices.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No outstanding invoices.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Due Date</TableHead><TableHead>Days Overdue</TableHead><TableHead>Bucket</TableHead><TableHead className="text-right">Outstanding</TableHead></TableRow></TableHeader>
              <TableBody>
                {report.invoices.map((inv) => (
                  <TableRow key={inv.invoiceId}>
                    <TableCell className="font-medium">#{inv.invoiceNumber}</TableCell>
                    <TableCell className="text-px-muted">{inv.customerName ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{inv.dueDate ? formatDate(inv.dueDate) : "—"}</TableCell>
                    <TableCell className={inv.daysOverdue > 0 ? "text-red-600" : "text-px-muted"}>{inv.daysOverdue}d</TableCell>
                    <TableCell><Badge variant="outline">{inv.bucket}</Badge></TableCell>
                    <TableCell className="text-right">{money(inv.outstandingAmount, currencies)}</TableCell>
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

// ---------------------------------------------------------------------------
// Root client
// ---------------------------------------------------------------------------
export default function InvoicesClient() {
  return (
    <Tabs defaultValue="invoices">
      <TabsList>
        <TabsTrigger value="invoices">Invoices</TabsTrigger>
        <TabsTrigger value="credit-notes">Credit Notes</TabsTrigger>
        <TabsTrigger value="aging">AR Aging</TabsTrigger>
      </TabsList>
      <TabsContent value="invoices"><InvoicesPanel /></TabsContent>
      <TabsContent value="credit-notes"><CreditNotesPanel /></TabsContent>
      <TabsContent value="aging"><ArAgingPanel /></TabsContent>
    </Tabs>
  );
}
