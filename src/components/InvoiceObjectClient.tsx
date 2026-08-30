"use client";

// Real-screen conversion (2026-08-30): Invoices never had a detail view --
// no way to see line items, post (submit) a draft to the GL, or record a
// payment except from the flat list's own popups. Real Object Page on the
// kit's ObjectScreen. Real Delete = real Cancel (cancelSalesInvoice() -- a
// designed lifecycle end-state, draft only, matching BudgetObjectClient's
// same convention). Submit is the genuinely new capability this
// conversion closes: submitSalesInvoice() has existed in
// erp-invoicing-service.ts since Wave 60 with no PROJEXA-reachable route at
// all -- every invoice PROJEXA ever created stayed "draft" forever, and
// recordSalesInvoicePayment only accepts submitted/partially_paid/overdue,
// so it could never actually be paid either. See
// PROJEXA_REAL_SCREEN_CONVERSION_TRACKER.md module #13.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type InvoiceItem = { id: string; description: string; quantity: string; rate: string; amount: string; hsnSacCode: string | null };
type Invoice = {
  id: string; invoiceNumber: number; customerId: string; customerName: string | null; postingDate: string; dueDate: string | null;
  subtotal: string; taxAmount: string; grandTotal: string; outstandingAmount: string; status: string; items: InvoiceItem[];
};
type Account = { id: string; accountName: string; accountNumber: string | null; rootType: string | null; accountType: string | null };

const STATUS_TONE: Record<string, StatusTone> = {
  draft: "neutral", submitted: "running", partially_paid: "waiting", paid: "done", overdue: "late", cancelled: "late",
};

function money(v: string | number, label: string) {
  return `${label}${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export default function InvoiceObjectClient({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const label = currencyLabel(undefined, currencies);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const [revenueAccountId, setRevenueAccountId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));

  async function load() {
    try {
      const [data, acctData] = await Promise.all([
        fetchJson<Invoice>(`/api/sales-invoices/${invoiceId}`),
        fetchJson<{ accounts?: Account[] }>("/api/accounts").catch(() => ({ accounts: [] })),
      ]);
      setInvoice(data);
      setAccounts(acctData.accounts ?? []);
      setPaymentAmount(data.outstandingAmount);
      setLoadError(null);
    } catch (err) {
      setInvoice(null);
      setLoadError(errorMessage(err, "Couldn't load this invoice"));
    }
  }
  useEffect(() => { load(); }, [invoiceId]);

  async function submitInvoice() {
    if (!revenueAccountId) { toast.error("Choose a revenue account first"); return; }
    setActionBusy("submit");
    try {
      const res = await fetch(`/api/sales-invoices/${invoiceId}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revenueAccountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit invoice");
      toast.success("Invoice posted to the ledger");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit invoice");
    } finally {
      setActionBusy(null);
    }
  }

  async function recordPayment() {
    if (!paymentAmount || !paymentAccountId) { toast.error("Amount and bank/cash account are required"); return; }
    setActionBusy("payment");
    try {
      const res = await fetch(`/api/sales-invoices/${invoiceId}/payments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(paymentAmount), bankOrCashAccountId: paymentAccountId, postingDate: paymentDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to record payment");
      toast.success("Payment recorded");
      setPaymentAccountId("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record payment");
    } finally {
      setActionBusy(null);
    }
  }

  async function cancelInvoice() {
    setActionBusy("cancel");
    try {
      const res = await fetch(`/api/sales-invoices/${invoiceId}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to cancel invoice");
      toast.success("Invoice cancelled");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel invoice");
    } finally {
      setActionBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!invoice) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const revenueAccounts = accounts.filter((a) => a.rootType === "income");
  // accountType is free text (admin-extensible, per erp-accounts schema
  // comment) -- real production data has both "bank" and "Bank" for the
  // same org (verified live), so an exact match would silently hide the
  // capitalized variant. Case-insensitive on purpose.
  const bankAccounts = accounts.filter((a) => a.accountType?.toLowerCase() === "bank" || a.accountType?.toLowerCase() === "cash");
  const canRecordPayment = ["submitted", "partially_paid", "overdue"].includes(invoice.status);

  return (
    <ObjectScreen
      breadcrumb="Invoices / Invoice"
      title={`Invoice #${invoice.invoiceNumber}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[invoice.status] ?? "neutral", label: invoice.status.replace("_", " ") }}
      facets={[
        { label: "Customer", value: invoice.customerName ?? "—" },
        { label: "Posting Date", value: formatDate(invoice.postingDate) },
        { label: "Due Date", value: invoice.dueDate ? formatDate(invoice.dueDate) : "—" },
        { label: "Grand Total", value: money(invoice.grandTotal, label) },
        { label: "Outstanding", value: money(invoice.outstandingAmount, label) },
      ]}
      onDelete={invoice.status === "draft" ? cancelInvoice : undefined}
      deleteDisabledReason={actionBusy ? "Working…" : undefined}
      onBack={() => router.push("/invoices?tab=invoices")}
      messages={[]}
    >
      {invoice.status === "draft" && (
        <div className="flex flex-wrap items-end gap-2 border-b border-ct-border px-4 py-3">
          <div className="space-y-1.5">
            <Label>Revenue Account</Label>
            <Select value={revenueAccountId} onValueChange={setRevenueAccountId}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select a revenue account" /></SelectTrigger>
              <SelectContent>{revenueAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button size="sm" disabled={actionBusy !== null || !revenueAccountId} onClick={submitInvoice}>
            {actionBusy === "submit" ? "Posting…" : "Submit (Post to Ledger)"}
          </Button>
        </div>
      )}

      {canRecordPayment && (
        <div className="flex flex-wrap items-end gap-2 border-b border-ct-border px-4 py-3">
          <div className="space-y-1.5">
            <Label>Amount</Label>
            <Input type="number" className="w-32" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Bank / Cash Account</Label>
            <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
              <SelectTrigger className="w-56"><SelectValue placeholder={bankAccounts.length ? "Select an account" : "Loading…"} /></SelectTrigger>
              <SelectContent>{bankAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Posting Date</Label>
            <Input type="date" className="w-40" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </div>
          <Button size="sm" disabled={actionBusy !== null || !paymentAmount || !paymentAccountId} onClick={recordPayment}>
            {actionBusy === "payment" ? "Recording…" : "Record Payment"}
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow><TableHead>Description</TableHead><TableHead>HSN/SAC</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {invoice.items.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-medium">{i.description}</TableCell>
              <TableCell className="text-ct-muted">{i.hsnSacCode ?? "—"}</TableCell>
              <TableCell className="text-right">{Number(i.quantity).toLocaleString()}</TableCell>
              <TableCell className="text-right">{money(i.rate, label)}</TableCell>
              <TableCell className="text-right">{money(i.amount, label)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex justify-end gap-6 border-t border-ct-border px-4 py-3 text-[13px]">
        <div><span className="text-ct-muted">Subtotal: </span><span className="font-medium text-ct-navy">{money(invoice.subtotal, label)}</span></div>
        <div><span className="text-ct-muted">Tax: </span><span className="font-medium text-ct-navy">{money(invoice.taxAmount, label)}</span></div>
        <div><span className="text-ct-muted">Grand Total: </span><span className="font-medium text-ct-navy">{money(invoice.grandTotal, label)}</span></div>
      </div>
    </ObjectScreen>
  );
}
