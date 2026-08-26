"use client";

// Priority 13: closes the Dashboard's "Total Revenue shows ₹0" gap
// (PROJEXA_GAP_ANALYSIS.md) -- VERIDIAN's ERP Sales module previously had
// no self-serve API reachable from PROJEXA to create or link a sales
// invoice to a project. This dialog lets a user pick (or quick-create) a
// VERIDIAN ERP customer, add one line item, and post a real invoice via
// /api/sales-invoices -> VERIDIAN's /api/v1/projexa/sales-invoices.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Receipt } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Customer = { id: string; customerName: string };

const NEW_CUSTOMER = "__new__";

export function CreateInvoiceDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [customerId, setCustomerId] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [rate, setRate] = useState("");

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setLoadingCustomers(true);
    try {
      const data = await fetchJson("/api/customers");
      setCustomers(data.customers ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load customers from VERIDIAN"));
    } finally {
      setLoadingCustomers(false);
    }
  }

  async function createInvoice() {
    if (!description.trim() || !rate) return;
    if (!customerId || (customerId === NEW_CUSTOMER && !newCustomerName.trim())) return;
    setSubmitting(true);
    try {
      let resolvedCustomerId = customerId;
      if (customerId === NEW_CUSTOMER) {
        const res = await fetch("/api/customers", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerName: newCustomerName }),
        });
        if (!res.ok) throw new Error();
        const created = await res.json();
        resolvedCustomerId = created.id;
      }

      const res = await fetch("/api/sales-invoices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: resolvedCustomerId,
          postingDate,
          items: [{ description, quantity: Number(quantity), rate: Number(rate) }],
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Invoice created and linked");
      setCustomerId(""); setNewCustomerName(""); setDescription(""); setQuantity("1"); setRate(""); setOpen(false);
      router.refresh();
    } catch {
      toast.error("Couldn't create invoice");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Receipt className="size-4" /> Create / Link Invoice</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Sales Invoice</DialogTitle></DialogHeader>
        {loadingCustomers ? (
          <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
        ) : (
          <div className="space-y-3">
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
        )}
        <DialogFooter><Button onClick={createInvoice} disabled={submitting || loadingCustomers}>{submitting ? "Creating…" : "Create Invoice"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
