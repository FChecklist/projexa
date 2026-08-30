"use client";

// Real-screen conversion (2026-08-30): replaces InvoicesClient.tsx's old
// inline "New Credit Note" Dialog popup with a real create screen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Invoice = { id: string; invoiceNumber: number; customerId: string; customerName: string | null };

export default function CreditNoteCreateClient() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [salesInvoiceId, setSalesInvoiceId] = useState("");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ salesInvoices?: Invoice[] }>("/api/sales-invoices?limit=100").then((d) => setInvoices(d.salesInvoices ?? [])).catch((err) => toast.error(errorMessage(err, "Couldn't load invoices to link")));
  }, []);

  const missing = [
    ...(invoices.find((i) => i.id === salesInvoiceId) ? [] : ["Invoice"]),
    ...(description.trim() ? [] : ["Description"]),
    ...(amount ? [] : ["Amount"]),
  ];

  async function createNote() {
    const invoice = invoices.find((i) => i.id === salesInvoiceId);
    if (!invoice || missing.length) return;
    setSubmitting(true);
    try {
      const note = await fetchJson<{ id: string }>("/api/credit-notes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: invoice.customerId, salesInvoiceId: invoice.id, postingDate: new Date().toISOString().slice(0, 10),
          reason: reason || undefined, items: [{ description, quantity: 1, rate: Number(amount) }],
        }),
      });
      toast.success("Credit note created");
      router.push(`/invoices/credit-notes/${note.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create credit note"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Invoices / New Credit Note"
      title="New Sales Credit Note"
      mode="create"
      hasDraft={false}
      onSave={createNote}
      onCancel={() => router.push("/invoices?tab=credit-notes")}
      onBack={() => router.push("/invoices?tab=credit-notes")}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Creating…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
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
    </ObjectScreen>
  );
}
