"use client";

// Real-screen conversion (2026-08-30): replaces ProcurementClient.tsx's old
// "New RFQ" Dialog popup with a real create screen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Requisition = { id: string; requisitionNumber: number };
type Vendor = { id: string; vendorName: string };

export default function RfqCreateClient() {
  const router = useRouter();
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [requisitionId, setRequisitionId] = useState("none");
  const [itemDesc, setItemDesc] = useState("");
  const [itemQty, setItemQty] = useState("1");
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ requisitions?: Requisition[] }>("/api/procurement/requisitions").then((d) => setRequisitions(d.requisitions ?? [])).catch(() => {});
    fetchJson<{ vendors?: Vendor[] }>("/api/vendors").then((d) => setVendors(d.vendors ?? [])).catch(() => {});
  }, []);

  const missing = [...(itemDesc.trim() ? [] : ["Item description"]), ...(supplierIds.length ? [] : ["At least one vendor"])];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      const rfq = await fetchJson<{ id: string }>("/api/procurement/rfqs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requisitionId: requisitionId !== "none" ? requisitionId : undefined,
          postingDate: new Date().toISOString().slice(0, 10),
          items: [{ description: itemDesc, quantity: Number(itemQty) || 1 }],
          supplierIds,
        }),
      });
      toast.success("RFQ created");
      router.push(`/procurement/rfqs/${rfq.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create RFQ"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Procurement / New RFQ"
      title="New Request for Quotation"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/procurement?tab=rfqs")}
      onBack={() => router.push("/procurement?tab=rfqs")}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Creating…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Linked Requisition (optional)</Label>
          <Select value={requisitionId} onValueChange={setRequisitionId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None — raise directly</SelectItem>
              {requisitions.map((r) => <SelectItem key={r.id} value={r.id}>PR-{r.requisitionNumber}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2 space-y-1.5"><Label>Item description</Label><Input value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={itemQty} onChange={(e) => setItemQty(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5">
          <Label>Vendors to invite</Label>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
            {vendors.map((v) => (
              <label key={v.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={supplierIds.includes(v.id)} onChange={(e) => setSupplierIds((prev) => e.target.checked ? [...prev, v.id] : prev.filter((id) => id !== v.id))} />
                {v.vendorName}
              </label>
            ))}
            {vendors.length === 0 && <p className="text-xs text-px-muted">No vendors yet — add one on the Vendors page first.</p>}
          </div>
        </div>
      </div>
    </ObjectScreen>
  );
}
