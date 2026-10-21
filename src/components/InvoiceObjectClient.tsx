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
// GUIDED ERRORS (G2): a refusal (posting, payment, cancel, load) is the guide panel -- what happened in full, why, numbered steps, the exact place to fix
// it, the way back -- and a missing or wrong entry is written beside its box and explained, with nothing sent.
import { GuidedError } from "@/components/GuidedError";
import FormFaultPanel from "@/components/FormFaultPanel";
import { contextFromError } from "@/lib/error-guide/context";
import { invoicePostFaults, messageFor, paymentFaults, type Fault } from "@/lib/error-guide/g2-faults";
import { findFocusTarget, highlightElement } from "@/lib/error-guide/focus";
import type { GuideContext } from "@/lib/error-guide/types";
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

import { viaPxApi } from "@/lib/px-api";
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
  const [loadError, setLoadError] = useState<GuideContext | null>(null);
  const [failure, setFailure] = useState<GuideContext | null>(null);
  const [faults, setFaults] = useState<Fault[]>([]);
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
      setLoadError(contextFromError(err, { entityId: invoiceId, entityType: "sales_invoice" }));
    }
  }
  useEffect(() => { load(); }, [invoiceId]);

  async function submitInvoice() {
    const problems = invoicePostFaults({ revenueAccountId, hasRevenueAccounts: accounts.some((a) => a.rootType === "income") });
    setFailure(null);
    if (problems.length) { setFaults(problems); const el = findFocusTarget(problems[0].field); if (el) highlightElement(el); return; }
    setFaults([]);
    setActionBusy("submit");
    try {
      const res = await viaPxApi(`/api/sales-invoices/${invoiceId}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revenueAccountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit invoice");
      toast.success("Invoice posted to the ledger");
      await load();
    } catch (err) {
      setFailure(contextFromError(err, { entityId: invoiceId, entityType: "sales_invoice", method: "POST", apiPath: `/api/sales-invoices/${invoiceId}/submit` }));
    } finally {
      setActionBusy(null);
    }
  }

  async function recordPayment() {
    const problems = paymentFaults({ amount: paymentAmount, outstanding: Number(invoice?.outstandingAmount ?? 0), accountId: paymentAccountId, hasBankAccounts: accounts.some((a) => a.accountType?.toLowerCase() === "bank" || a.accountType?.toLowerCase() === "cash"), date: paymentDate });
    setFailure(null);
    if (problems.length) { setFaults(problems); const el = findFocusTarget(problems[0].field); if (el) highlightElement(el); return; }
    setFaults([]);
    setActionBusy("payment");
    try {
      const res = await viaPxApi(`/api/sales-invoices/${invoiceId}/payments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(paymentAmount), bankOrCashAccountId: paymentAccountId, postingDate: paymentDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to record payment");
      toast.success("Payment recorded");
      setPaymentAccountId("");
      await load();
    } catch (err) {
      setFailure(contextFromError(err, { entityId: invoiceId, entityType: "sales_invoice", method: "POST", apiPath: `/api/sales-invoices/${invoiceId}/payments` }));
    } finally {
      setActionBusy(null);
    }
  }

  async function cancelInvoice() {
    setActionBusy("cancel");
    setFailure(null);
    setFaults([]);
    try {
      const res = await viaPxApi(`/api/sales-invoices/${invoiceId}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to cancel invoice");
      toast.success("Invoice cancelled");
      await load();
    } catch (err) {
      setFailure(contextFromError(err, { entityId: invoiceId, entityType: "sales_invoice", method: "POST", apiPath: `/api/sales-invoices/${invoiceId}/cancel` }));
    } finally {
      setActionBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <GuidedError ctx={loadError} onRetry={() => void load()} />
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
      {(failure || faults.length > 0) && (
        <div className="space-y-2 border-b border-ct-border px-4 py-3">
          <FormFaultPanel faults={faults} />
          {failure && <GuidedError ctx={failure} onRetry={() => void (failure.apiPath?.endsWith("/payments") ? recordPayment() : failure.apiPath?.endsWith("/cancel") ? cancelInvoice() : submitInvoice())} />}
        </div>
      )}
      {invoice.status === "draft" && (
        <div className="flex flex-wrap items-end gap-2 border-b border-ct-border px-4 py-3">
          <div className="space-y-1.5">
            <Label>Revenue Account</Label>
            <Select value={revenueAccountId} onValueChange={setRevenueAccountId}>
              <SelectTrigger className="w-64" data-testid="inv-revenue-account"><SelectValue placeholder="Select a revenue account" /></SelectTrigger>
              <SelectContent>{revenueAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button size="sm" disabled={actionBusy !== null} onClick={submitInvoice}>
            {actionBusy === "submit" ? "Posting…" : "Submit (Post to Ledger)"}
          </Button>
        </div>
      )}

      {canRecordPayment && (
        <div className="flex flex-wrap items-end gap-2 border-b border-ct-border px-4 py-3">
          <div className="space-y-1.5">
            <Label>Amount</Label>
            <Input data-testid="inv-payment-amount" type="text" inputMode="decimal" className="w-32" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Bank / Cash Account</Label>
            <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
              <SelectTrigger className="w-56" data-testid="inv-payment-account"><SelectValue placeholder={bankAccounts.length ? "Select an account" : "Loading…"} /></SelectTrigger>
              <SelectContent>{bankAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Posting Date</Label>
            <Input data-testid="inv-payment-date" type="date" className="w-40" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </div>
          <Button size="sm" disabled={actionBusy !== null} onClick={recordPayment}>
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
