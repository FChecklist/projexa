"use client";

// Real-screen conversion (2026-08-30): replaces InvoicesClient.tsx's old
// inline "New Credit Note" Dialog popup with a real create screen.
//
// R80 GAP-7 (2026-09-08): the screen held ONE description and ONE amount in
// two scalar useStates and posted `items: [{ description, quantity: 1, rate:
// Number(amount) }]` -- a literal one-element array with the quantity nailed
// to 1 -- so a credit against a multi-line invoice could only ever be
// entered as a single lump. The API has always taken an array of any length
// (VERIDIAN erp-credit-note-service.ts createSalesCreditNote:
// `if (!input.items?.length) throw new ServiceError("At least one line item
// is required", 400)` -- a MINIMUM of one -- then `input.items.map(…)` into
// a bulk insert, with the header's totalAmount computed by
// `computeTotal(input.items)` over the whole array). Converted to the same
// repeatable line editor SalesQuotationCreateClient.tsx uses, with the
// running credit total.
//
// The old single "Amount" box is now the row's Rate, times a real Qty --
// same `{ description, quantity, rate }` payload field names as before, so
// the old behaviour is just the Qty=1 case of the new one.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { useOrgMoney } from "@/lib/use-org-money";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Invoice = { id: string; invoiceNumber: number; customerId: string; customerName: string | null };
type Line = { description: string; quantity: string; rate: string };

// R80 (2026-09-08): ONE parse, used by BOTH the credit total the user reads
// and the payload that gets posted. They used to disagree -- the total read an
// empty Qty as 0 while the payload sent `Number(l.quantity) || 1`, and nothing
// required a quantity -- so clearing a Qty box showed a credit that was not
// the one about to be booked against the customer. The quantity is now
// REQUIRED (below) and posted exactly as parsed, with no `|| 1` fallback.
function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function CreditNoteCreateClient() {
  const router = useRouter();
  const orgMoney = useOrgMoney();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [salesInvoiceId, setSalesInvoiceId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", rate: "" }]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ salesInvoices?: Invoice[] }>("/api/sales-invoices?limit=100").then((d) => setInvoices(d.salesInvoices ?? [])).catch((err) => toast.error(errorMessage(err, "Couldn't load invoices to link")));
  }, []);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const creditTotal = lines.reduce((sum, l) => sum + num(l.quantity) * num(l.rate), 0);

  const missing = [
    ...(invoices.find((i) => i.id === salesInvoiceId) ? [] : ["Invoice"]),
    ...(lines.every((l) => l.description.trim()) ? [] : ["A description on every line"]),
    ...(lines.every((l) => l.quantity) ? [] : ["A quantity on every line"]),
    ...(lines.every((l) => l.rate) ? [] : ["An amount on every line"]),
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
          reason: reason || undefined,
          items: lines.map((l) => ({ description: l.description, quantity: num(l.quantity), rate: num(l.rate) })),
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
        <div className="space-y-2">
          <Label>Line Items</Label>
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="flex-1" />
              <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-16" />
              <Input placeholder="Amount" type="number" value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} className="w-24" />
              <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { description: "", quantity: "1", rate: "" }])}>
            <Plus className="size-3.5" /> Add Line
          </Button>
        </div>
        <div className="rounded-md border border-px-border p-2 text-sm">
          Credit total ({lines.length} {lines.length === 1 ? "line" : "lines"}) — {orgMoney.money(creditTotal)}
        </div>
      </div>
    </ObjectScreen>
  );
}
