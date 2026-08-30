"use client";

// Priority 15: PROJEXA's Invoicing surface -- full sales-invoice lifecycle
// (draft -> submitted -> partially_paid/paid/overdue -> cancelled), credit
// notes linked to their original invoice, and a full AR aging report.
// Extends Priority 13's sales-invoices alias (list/create) rather than
// replacing it -- payments/cancel are new sub-actions on the same
// resource. Sized for 500-project scale: filter by status/customer/date
// range, paginated list.
//
// Real-screen conversion (2026-08-30): the old "Create Invoice"/"New Credit
// Note"/"Record Payment" Dialog popups are gone -- Create routes to real
// screens (InvoiceCreateClient/CreditNoteCreateClient), rows route to real
// Object Pages (InvoiceObjectClient/CreditNoteObjectClient) where Submit
// (post to ledger) and Record Payment now live as real inline actions. Also
// fixes the same uncontrolled-Tabs-no-URL-sync bug found and fixed 5 times
// already this session (Accounting/Schedule/Employees/GRC/Inventory) --
// without this, a redirect back here with ?tab=credit-notes would silently
// land on the "invoices" tab instead.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Receipt, ChevronLeft, ChevronRight } from "lucide-react";
import { currencyLabel, useCurrencies, type Currency } from "@/lib/currency";
import { formatDate } from "@/lib/format-date";

type Invoice = { id: string; invoiceNumber: number; customerId: string; customerName: string | null; postingDate: string; dueDate: string | null; grandTotal: string; outstandingAmount: string; status: string };
type CreditNote = { id: string; creditNoteNumber: number; customerId: string; salesInvoiceId: string | null; postingDate: string; reason: string | null; status: string; totalAmount: string };
type AgingReport = { asOfDate: string; totalOutstanding: number; buckets: Record<string, number>; invoices: { invoiceId: string; invoiceNumber: number; customerName: string | null; dueDate: string | null; outstandingAmount: string; daysOverdue: number; bucket: string }[] };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", partially_paid: "secondary", paid: "default", overdue: "destructive", cancelled: "outline",
};

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
  const router = useRouter();
  const currencies = useCurrencies();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");

  async function load() {
    setLoading(true);
    setLoadError(null);
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
        {/* Real screen navigation (2026-08-30) -- replaces the old "Create
            Invoice" Dialog popup with a real create route. */}
        <Button size="sm" onClick={() => router.push("/invoices/new")}><Receipt className="size-4" /> Create Invoice</Button>
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
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Customer</TableHead><TableHead>Posting Date</TableHead><TableHead>Due Date</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows open the real
                    Object Page, where Submit/Record Payment/Cancel now live
                    as real inline actions instead of list-row popups. */}
                {invoices.map((inv) => (
                  <TableRow key={inv.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/invoices/${inv.id}`)}>
                    <TableCell className="text-px-muted">{inv.invoiceNumber}</TableCell>
                    <TableCell className="font-medium">{inv.customerName ?? "—"}</TableCell>
                    <TableCell>{formatDate(inv.postingDate)}</TableCell>
                    <TableCell className="text-px-muted">{inv.dueDate ? formatDate(inv.dueDate) : "—"}</TableCell>
                    <TableCell className="text-right">{money(inv.grandTotal, currencies)}</TableCell>
                    <TableCell className="text-right">{money(inv.outstandingAmount, currencies)}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[inv.status] ?? "outline"} className="capitalize">{inv.status.replace("_", " ")}</Badge></TableCell>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Credit Notes tab
// ---------------------------------------------------------------------------
function CreditNotesPanel() {
  const router = useRouter();
  const currencies = useCurrencies();
  const [notes, setNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Credit Note" Dialog popup with a real create route. */}
        <Button size="sm" onClick={() => router.push("/invoices/credit-notes/new")}><Plus className="size-4" /> New Credit Note</Button>
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
                  <TableRow key={n.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/invoices/credit-notes/${n.id}`)}>
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
        setReport(await fetchJson("/api/ar-aging"));
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't load AR aging report"));
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
const VALID_TABS = new Set(["invoices", "credit-notes", "aging"]);

export default function InvoicesClient({ initialTab }: { initialTab?: string }) {
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "invoices");

  function goToTab(tab: string) {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <Tabs value={activeTab} onValueChange={goToTab}>
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
