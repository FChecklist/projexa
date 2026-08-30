"use client";

// Real-screen conversion (2026-08-30): replaces InvoicesClient.tsx's old
// inline "Create Invoice" Dialog popup with a real create screen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Customer = { id: string; customerName: string };
const NEW_CUSTOMER = "__new__";

export default function InvoiceCreateClient() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [rate, setRate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ customers?: Customer[] }>("/api/customers").then((d) => setCustomers(d.customers ?? [])).catch((err) => toast.error(errorMessage(err, "Couldn't load customers")));
  }, []);

  const missing = [
    ...(customerId ? [] : ["Customer"]),
    ...(customerId === NEW_CUSTOMER && !newCustomerName.trim() ? ["New customer name"] : []),
    ...(description.trim() ? [] : ["Description"]),
    ...(rate ? [] : ["Rate"]),
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
        body: JSON.stringify({ customerId: resolvedCustomerId, postingDate, items: [{ description, quantity: Number(quantity), rate: Number(rate) }] }),
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
        <div className="space-y-1.5"><Label>Line Item Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Interior fit-out — Milestone 1" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Rate</Label><Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        </div>
      </div>
    </ObjectScreen>
  );
}
