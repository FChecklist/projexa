"use client";

// Real-screen conversion (2026-08-30): replaces InvoicesClient.tsx's old
// inline "Create Invoice" Dialog popup with a real create screen.
//
// R80 GAP-7 (2026-09-08): the screen used to hold ONE description/quantity/
// rate triple in three scalar useStates and post `items: [{ … }]` -- a
// literal one-element array -- so a sales invoice created from PROJEXA
// could never have a second line, however many the customer was actually
// being billed for. The API has always taken an array of any length (see
// createSalesInvoice in VERIDIAN's erp-invoicing-service.ts:
// `if (!input.items?.length) throw …` -- a MINIMUM of one, not exactly one
// -- then `resolvedItems.map(…)` into a bulk insert). Converted to the
// repeatable line editor SalesQuotationCreateClient.tsx already uses (add /
// edit / remove a row, last row not removable), with the running subtotal a
// billing document owes its reader before they save it.
//
// The one deliberate departure from that sibling: its data reads are raw
// `fetch(...).then(r => r.json())`, which is the defect
// src/lib/no-swallowed-http-errors.test.ts guards (its allowlist may only
// shrink). This screen's read already goes through fetchJson() and stays
// that way.
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
// GUIDED ERRORS (G2): what was typed survives leaving the form; a wrong or missing entry is written beside its box AND explained in the guide panel
// (nothing is sent while a fault exists); a refusal from the server is the same panel with the server's own words.
import { GuidedError } from "@/components/GuidedError";
import FormFaultPanel from "@/components/FormFaultPanel";
import { useDraft } from "@/lib/error-guide/use-draft";
import { contextFromError } from "@/lib/error-guide/context";
import { invoiceCreateFaults, messageFor } from "@/lib/error-guide/g2-faults";
import { findFocusTarget, highlightElement } from "@/lib/error-guide/focus";
import type { GuideContext } from "@/lib/error-guide/types";

type Customer = { id: string; customerName: string };
type Line = { description: string; quantity: string; rate: string };
const NEW_CUSTOMER = "__new__";

// R80 (2026-09-08): ONE parse, used by BOTH the subtotal the user reads and
// the payload that gets posted. They used to disagree -- the subtotal read an
// empty Qty as 0 while the payload sent `Number(l.quantity) || 1`, and nothing
// required a quantity -- so clearing a Qty box showed a total that was not the
// invoice about to be booked. A billing document must not invent a quantity
// the user did not type, so the quantity is now REQUIRED (below) and posted
// exactly as parsed, with no `|| 1` fallback.
function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function InvoiceCreateClient() {
  const router = useRouter();
  const orgMoney = useOrgMoney();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const draft = useDraft("invoice-new", { customerId: "", newCustomerName: "", postingDate: new Date().toISOString().slice(0, 10), lines: [{ description: "", quantity: "1", rate: "" }] as Line[] });
  const { customerId, newCustomerName, postingDate, lines } = draft.value;
  const setCustomerId = (v: string) => draft.set({ customerId: v });
  const setNewCustomerName = (v: string) => draft.set({ newCustomerName: v });
  const setPostingDate = (v: string) => draft.set({ postingDate: v });
  const setLines = (f: Line[] | ((prev: Line[]) => Line[])) => draft.set({ lines: typeof f === "function" ? f(lines) : f });
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverFailure, setServerFailure] = useState<GuideContext | null>(null);

  useEffect(() => {
    fetchJson<{ customers?: Customer[] }>("/api/customers").then((d) => setCustomers(d.customers ?? [])).catch((err) => setServerFailure(contextFromError(err, { entityType: "customer", serverMessage: errorMessage(err, "Couldn't load customers") })));
  }, []);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const subtotal = lines.reduce((sum, l) => sum + num(l.quantity) * num(l.rate), 0);

  const faults = invoiceCreateFaults({ customerId, isNewCustomer: customerId === NEW_CUSTOMER, newCustomerName, postingDate, lines });
  const shown = attempted ? faults : faults.filter((f) => !/_MISSING$|_INVALID$/.test(f.code));

  async function createInvoice() {
    setAttempted(true);
    setServerFailure(null);
    if (faults.length) {
      const el = findFocusTarget(faults[0].field);
      if (el) highlightElement(el);
      return;
    }
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
      const invoice = await fetchJson<{ id: string }>("/api/sales-invoices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: resolvedCustomerId, postingDate,
          items: lines.map((l) => ({ description: l.description, quantity: num(l.quantity), rate: num(l.rate) })),
        }),
      });
      toast.success("Invoice created");
      draft.clear();
      router.push(`/invoices/${invoice.id}`);
    } catch (err) {
      setServerFailure(contextFromError(err, { entityType: "sales_invoice" }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Invoices / New Invoice"
      title="New Sales Invoice"
      mode="create"
      hasDraft={false}
      onSave={createInvoice}
      onCancel={() => router.push("/invoices?tab=invoices")}
      onBack={() => router.push("/invoices?tab=invoices")}
      saveDisabled={submitting}
      saveDisabledReason={submitting ? "Creating…" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {draft.restored && !serverFailure && <p role="status" data-testid="inv-draft-restored" className="rounded-md border border-px-info-border bg-px-info-light px-3 py-2 text-[12.5px] text-px-info">We put back the invoice you had typed before you left. Check it, then press Save.</p>}
        <FormFaultPanel faults={shown} draftKey="invoice-new" />
        {serverFailure && <GuidedError ctx={serverFailure} onRetry={() => void createInvoice()} draftKey="invoice-new" />}
        <div className="space-y-1.5">
          <Label>Customer</Label>
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger data-testid="inv-customer"><SelectValue placeholder="Select a customer" /></SelectTrigger>
            <SelectContent>
              {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}
              <SelectItem value={NEW_CUSTOMER}>+ New customer…</SelectItem>
            </SelectContent>
          </Select>
          {messageFor(shown, "inv-customer") && <p role="alert" className="text-xs text-px-error">{messageFor(shown, "inv-customer")}</p>}
        </div>
        {customerId === NEW_CUSTOMER && (
          <div className="space-y-1.5"><Label>New Customer Name</Label><Input data-testid="inv-new-customer-name" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} />{messageFor(shown, "inv-new-customer-name") && <p role="alert" className="text-xs text-px-error">{messageFor(shown, "inv-new-customer-name")}</p>}</div>
        )}
        <div className="space-y-1.5"><Label>Posting Date</Label><Input data-testid="inv-posting-date" type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />{messageFor(shown, "inv-posting-date") && <p role="alert" className="text-xs text-px-error">{messageFor(shown, "inv-posting-date")}</p>}</div>
        <div className="space-y-2">
          <Label>Line Items</Label>
          {lines.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input data-testid={`inv-line-description-${i}`} placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="flex-1" />
              <Input data-testid={`inv-line-qty-${i}`} placeholder="Qty" type="text" inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-16" />
              <Input data-testid={`inv-line-rate-${i}`} placeholder="Rate" type="text" inputMode="decimal" value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} className="w-24" />
              <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></Button>
              {[`inv-line-description-${i}`, `inv-line-qty-${i}`, `inv-line-rate-${i}`].map((f) => messageFor(shown, f) && <p key={f} role="alert" className="basis-full text-xs text-px-error">{messageFor(shown, f)}</p>)}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { description: "", quantity: "1", rate: "" }])}>
            <Plus className="size-3.5" /> Add Line
          </Button>
        </div>
        <div className="rounded-md border border-px-border p-2 text-sm">
          Subtotal ({lines.length} {lines.length === 1 ? "line" : "lines"}) — {orgMoney.money(subtotal)}
          <p className="text-xs text-px-muted">Tax is applied by PROJEXA from each line&apos;s tax template on save.</p>
        </div>
      </div>
    </ObjectScreen>
  );
}
