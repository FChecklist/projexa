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
  const [customerId, setCustomerId] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", rate: "" }]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ customers?: Customer[] }>("/api/customers").then((d) => setCustomers(d.customers ?? [])).catch((err) => toast.error(errorMessage(err, "Couldn't load customers")));
  }, []);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const subtotal = lines.reduce((sum, l) => sum + num(l.quantity) * num(l.rate), 0);

  const missing = [
    ...(customerId ? [] : ["Customer"]),
    ...(customerId === NEW_CUSTOMER && !newCustomerName.trim() ? ["New customer name"] : []),
    ...(lines.every((l) => l.description.trim()) ? [] : ["A description on every line"]),
    ...(lines.every((l) => l.quantity) ? [] : ["A quantity on every line"]),
    ...(lines.every((l) => l.rate) ? [] : ["A rate on every line"]),
  ];

  async function createInvoice() {
    if (missing.length) return;
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
      router.push(`/invoices/${invoice.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create invoice"));
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
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Creating…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
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
        {customerId === NEW_CUSTOMER && (
          <div className="space-y-1.5"><Label>New Customer Name</Label><Input value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} /></div>
        )}
        <div className="space-y-1.5"><Label>Posting Date</Label><Input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} /></div>
        <div className="space-y-2">
          <Label>Line Items</Label>
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="flex-1" />
              <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-16" />
              <Input placeholder="Rate" type="number" value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} className="w-24" />
              <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { description: "", quantity: "1", rate: "" }])}>
            <Plus className="size-3.5" /> Add Line
          </Button>
        </div>
        <div className="rounded-md border border-px-border p-2 text-sm">
          Subtotal ({lines.length} {lines.length === 1 ? "line" : "lines"}) — {orgMoney.money(subtotal)}
          <p className="text-xs text-px-muted">Tax is applied by VERIDIAN from each line&apos;s tax template on save.</p>
        </div>
      </div>
    </ObjectScreen>
  );
}
