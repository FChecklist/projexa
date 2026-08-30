"use client";

// Real-screen conversion (2026-08-30): Credit Notes never had a detail view
// -- no way to see line items or submit a draft. Real Object Page on the
// kit's ObjectScreen. Submit is the genuinely new capability this closes:
// submitSalesCreditNote() has existed in erp-credit-note-service.ts since
// Wave 52 with NO route anywhere (not even a VERIDIAN-internal one) -- every
// credit note ever created via PROJEXA stayed "draft" forever, meaning the
// invoice it was meant to reverse never actually got its GL adjustment
// posted. See PROJEXA_REAL_SCREEN_CONVERSION_TRACKER.md module #13. No
// Delete/Cancel here -- there is no cancelSalesCreditNote() in the backend,
// so no Delete button is offered rather than faking one.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type NoteItem = { id: string; description: string; quantity: string; rate: string; amount: string };
type CreditNote = {
  id: string; creditNoteNumber: number; customerId: string; customerName: string | null; salesInvoiceId: string | null;
  postingDate: string; reason: string | null; status: string; totalAmount: string; items: NoteItem[];
};

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", submitted: "done" };

function money(v: string | number, label: string) {
  return `${label}${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export default function CreditNoteObjectClient({ noteId }: { noteId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const label = currencyLabel(undefined, currencies);
  const [note, setNote] = useState<CreditNote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      setNote(await fetchJson<CreditNote>(`/api/credit-notes/${noteId}`));
      setLoadError(null);
    } catch (err) {
      setNote(null);
      setLoadError(errorMessage(err, "Couldn't load this credit note"));
    }
  }
  useEffect(() => { load(); }, [noteId]);

  async function submitNote() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/credit-notes/${noteId}/submit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit credit note");
      toast.success("Credit note submitted");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit credit note");
    } finally {
      setSubmitting(false);
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
  if (!note) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Invoices / Credit Note"
      title={`Credit Note #${note.creditNoteNumber}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[note.status] ?? "neutral", label: note.status }}
      facets={[
        { label: "Customer", value: note.customerName ?? "—" },
        { label: "Posting Date", value: formatDate(note.postingDate) },
        { label: "Reason", value: note.reason ?? "—" },
        { label: "Total Amount", value: money(note.totalAmount, label) },
        ...(note.salesInvoiceId ? [{ label: "Against Invoice", value: note.salesInvoiceId }] : []),
      ]}
      onBack={() => router.push("/invoices?tab=credit-notes")}
      messages={[]}
    >
      {note.status === "draft" && (
        <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
          <Button size="sm" disabled={submitting} onClick={submitNote}>{submitting ? "Submitting…" : "Submit"}</Button>
        </div>
      )}
      <Table>
        <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
        <TableBody>
          {note.items.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-medium">{i.description}</TableCell>
              <TableCell className="text-right">{Number(i.quantity).toLocaleString()}</TableCell>
              <TableCell className="text-right">{money(i.rate, label)}</TableCell>
              <TableCell className="text-right">{money(i.amount, label)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ObjectScreen>
  );
}
