"use client";

// R-94/R-95: the "Invoice" action for an approved billing claim, usable from any screen that lists claims (the online page and the
// laptop-first shell's screen). Asks for the bill date and tax template (the two things the server needs), sends the existing
// PATCH /api/billing-claims/[id] {action:"invoice"}, then shows the invoice number it raised with a link to /invoices/<id>. A refusal
// ("No new progress to bill ...") is shown exactly as the server worded it, and nothing is claimed as raised.
import { useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { invoiceLabel, invoicePath, readInvoiceReceipt, type InvoiceReceipt } from "@/lib/billing-invoice";
// GUIDED ERRORS (G2): a missing bill date or tax template, and every refusal ("No new progress to bill ..."), is the guide panel: what happened in the
// server's own words, why, the numbered steps, the exact place to fix it and the way back. Nothing is claimed as raised unless the server confirmed an invoice.
import { GuidedError } from "@/components/GuidedError";
import FormFaultPanel from "@/components/FormFaultPanel";
import { contextFromError, currentScreen } from "@/lib/error-guide/context";
import { invoiceInputFaults, type Fault } from "@/lib/error-guide/g2-faults";
import { findFocusTarget, highlightElement } from "@/lib/error-guide/focus";
import type { GuideContext } from "@/lib/error-guide/types";

type TaxTemplate = { id: string; name: string; isDefault?: boolean };

/** How long the invoice request may take before the person is told, so the button never stays disabled for ever. */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export default function ClaimInvoiceAction({ claimId, onInvoiced, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }: { claimId: string; onInvoiced?: (receipt: InvoiceReceipt) => void; requestTimeoutMs?: number }) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TaxTemplate[] | null>(null);
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [taxTemplateId, setTaxTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<GuideContext | null>(null);
  const [faults, setFaults] = useState<Fault[]>([]);
  const [receipt, setReceipt] = useState<InvoiceReceipt | null>(null);

  async function openForm() {
    setOpen(true);
    setFailure(null);
    setFaults([]);
    if (templates) return;
    try {
      const d = await fetchJson<{ taxTemplates?: TaxTemplate[] }>("/api/tax-templates");
      const list = d.taxTemplates ?? [];
      setTemplates(list);
      // prefill: the organisation's default template, or the only one there is (several and none marked: the person chooses)
      const preset = list.find((t) => t.isDefault) ?? (list.length === 1 ? list[0] : undefined);
      if (preset) setTaxTemplateId((cur) => cur || preset.id);
    } catch (err) {
      setTemplates([]);
      setFailure(contextFromError(err, { entityId: claimId, entityType: "progress_claim" }));
    }
  }

  async function confirm() {
    const problems = invoiceInputFaults({ billDate, taxTemplateId, hasTemplates: (templates?.length ?? 0) > 0, ids: { billDate: "claim-invoice-bill-date", taxTemplate: "claim-invoice-tax-template" } });
    if (problems.length > 0) {
      setFaults(problems);
      setFailure(null);
      const el = findFocusTarget(problems[0].field);
      if (el) highlightElement(el);
      return;
    }
    setFaults([]);
    setBusy(true);
    setFailure(null);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), requestTimeoutMs);
    try {
      const body = await fetchJson<{ invoice?: { id?: string; invoiceNumber?: number } | null }>(`/api/billing-claims/${encodeURIComponent(claimId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invoice", billDate, taxTemplateId }),
        signal: ctl.signal,
      });
      const r = readInvoiceReceipt(body);
      setReceipt(r);
      setOpen(false);
      onInvoiced?.(r);
    } catch (err) {
      setFailure(
        ctl.signal.aborted
          ? { ...currentScreen(), entityId: claimId, entityType: "progress_claim", status: 0, code: "TIMEOUT", method: "PATCH", apiPath: `/api/billing-claims/${claimId}`, serverMessage: "The server did not answer in time. The invoice may already have been raised - check the Invoices list before trying again." }
          : contextFromError(err, { entityId: claimId, entityType: "progress_claim", ...(err instanceof Error && /did not confirm an invoice/i.test(err.message) ? { code: "UNCONFIRMED", method: "PATCH", apiPath: `/api/billing-claims/${claimId}`, status: 200 } : {}) })
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  if (receipt) {
    return (
      <p className="text-sm" data-testid="claim-invoice-receipt">
        {invoiceLabel(receipt.invoiceNumber)} raised.{" "}
        <a className="text-px-ink underline underline-offset-2" target="_top" href={invoicePath(receipt.invoiceId)} data-testid="claim-invoice-link">Open the invoice</a>
      </p>
    );
  }
  return (
    <div className="space-y-2" data-testid="claim-invoice">
      {!open ? (
        <button type="button" data-testid="claim-invoice-open" className="rounded-md bg-ct-navy px-3 py-1.5 text-sm text-white" onClick={() => void openForm()}>Invoice</button>
      ) : (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-black/10 p-3">
          <label className="text-xs">Bill date<input aria-label="Bill date" id="claim-invoice-bill-date" data-testid="claim-invoice-bill-date" type="date" className="mt-1 block h-9 w-40 rounded-md border border-black/20 px-2 text-sm" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></label>
          <label className="text-xs">Tax template
            <select aria-label="Tax template" id="claim-invoice-tax-template" data-testid="claim-invoice-tax-template" className="mt-1 block h-9 w-48 rounded-md border border-black/20 px-2 text-sm" value={taxTemplateId} onChange={(e) => setTaxTemplateId(e.target.value)}>
              <option value="">{templates === null ? "Loading…" : "Select…"}</option>
              {(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <button type="button" data-testid="claim-invoice-confirm" disabled={busy} className="rounded-md bg-ct-navy px-3 py-1.5 text-sm text-white disabled:opacity-50" onClick={() => void confirm()}>{busy ? "Raising…" : "Confirm invoice"}</button>
          <button type="button" className="px-2 py-1.5 text-sm underline" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
      {templates !== null && templates.length === 0 && open && !failure && faults.length === 0 ? (
        <p className="text-xs text-px-muted" data-testid="claim-invoice-no-template">No tax template is set up for this organisation yet. Create one on the online billing page, then try again.</p>
      ) : null}
      <FormFaultPanel faults={faults} />
      {failure ? <div data-testid="claim-invoice-error"><GuidedError ctx={failure} onRetry={() => void confirm()} /></div> : null}
    </div>
  );
}
