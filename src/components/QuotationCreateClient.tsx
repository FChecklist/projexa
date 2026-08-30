"use client";

// Real-screen conversion (2026-08-30): replaces ProcurementClient.tsx's old
// "Record Quotation" Dialog popup with a real create screen. No Object
// Page -- no getSupplierQuotation() exists (only listSupplierQuotations),
// matching Expenses' own "create-only" precedent. "Convert to PO" stays a
// real inline action on the list, unchanged.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Rfq = { id: string; rfqNumber: number };
type Vendor = { id: string; vendorName: string };

export default function QuotationCreateClient() {
  const router = useRouter();
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [rfqId, setRfqId] = useState("none");
  const [supplierId, setSupplierId] = useState("");
  const [itemDesc, setItemDesc] = useState("");
  const [itemQty, setItemQty] = useState("1");
  const [itemRate, setItemRate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ rfqs?: Rfq[] }>("/api/procurement/rfqs").then((d) => setRfqs(d.rfqs ?? [])).catch(() => {});
    fetchJson<{ vendors?: Vendor[] }>("/api/vendors").then((d) => setVendors(d.vendors ?? [])).catch(() => {});
  }, []);

  const missing = [...(supplierId ? [] : ["Vendor"]), ...(itemDesc.trim() ? [] : ["Item description"])];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      await fetchJson("/api/procurement/quotations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rfqId: rfqId !== "none" ? rfqId : undefined, supplierId,
          postingDate: new Date().toISOString().slice(0, 10),
          items: [{ description: itemDesc, quantity: Number(itemQty) || 1, rate: Number(itemRate) || 0 }],
        }),
      });
      toast.success("Quotation recorded");
      router.push("/procurement?tab=quotations");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't record quotation"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Procurement / Record Quotation"
      title="Record Supplier Quotation"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/procurement?tab=quotations")}
      onBack={() => router.push("/procurement?tab=quotations")}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Recording…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>RFQ (optional)</Label>
          <Select value={rfqId} onValueChange={setRfqId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {rfqs.map((r) => <SelectItem key={r.id} value={r.id}>RFQ-{r.rfqNumber}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Vendor</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
            <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5"><Label>Item description</Label><Input value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={itemQty} onChange={(e) => setItemQty(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Rate</Label><Input type="number" value={itemRate} onChange={(e) => setItemRate(e.target.value)} /></div>
        </div>
      </div>
    </ObjectScreen>
  );
}
