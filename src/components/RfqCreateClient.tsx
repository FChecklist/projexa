"use client";

// Real-screen conversion (2026-08-30): replaces ProcurementClient.tsx's old
// "New RFQ" Dialog popup with a real create screen.
//
// R80 GAP-7 (2026-09-08): the screen held ONE description/quantity pair in
// two scalar useStates and posted `items: [{ … }]` -- a literal one-element
// array -- so an RFQ sent to N vendors could only ever ask them to price a
// single item, while the vendor list beside it was already multi-select.
// The API has always taken an array of any length (VERIDIAN
// erp-procurement-workflow-service.ts createRfq:
// `if (!input.items?.length) throw new ServiceError("At least one line item
// is required", 400)` -- a MINIMUM of one -- then `input.items.map(…)` into
// a bulk insert). Converted to the same repeatable line editor
// PurchaseOrderCreateClient.tsx uses (add / edit / remove a row, last row
// not removable).
//
// NO RUNNING TOTAL HERE, deliberately: an RFQ is the document that ASKS for
// prices, so its lines carry description + quantity and no rate. There is
// no money on it to total until the supplier quotations come back (see
// QuotationCreateClient.tsx, which does total).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Requisition = { id: string; requisitionNumber: number };
type Vendor = { id: string; vendorName: string };
type Line = { description: string; quantity: string };

export default function RfqCreateClient() {
  const router = useRouter();
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [requisitionId, setRequisitionId] = useState("none");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1" }]);
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ requisitions?: Requisition[] }>("/api/procurement/requisitions").then((d) => setRequisitions(d.requisitions ?? [])).catch(() => {});
    fetchJson<{ vendors?: Vendor[] }>("/api/vendors").then((d) => setVendors(d.vendors ?? [])).catch(() => {});
  }, []);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const missing = [
    ...(lines.every((l) => l.description.trim()) ? [] : ["A description on every line"]),
    ...(supplierIds.length ? [] : ["At least one vendor"]),
  ];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      const rfq = await fetchJson<{ id: string }>("/api/procurement/rfqs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requisitionId: requisitionId !== "none" ? requisitionId : undefined,
          postingDate: new Date().toISOString().slice(0, 10),
          items: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 1 })),
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
        <div className="space-y-2">
          <Label>Line Items</Label>
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="flex-1" />
              <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-20" />
              <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { description: "", quantity: "1" }])}>
            <Plus className="size-3.5" /> Add Line
          </Button>
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
