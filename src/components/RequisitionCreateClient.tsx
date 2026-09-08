"use client";

// Real-screen conversion (2026-08-30): replaces ProcurementClient.tsx's old
// "New Requisition" Dialog popup with a real create screen.
//
// R80 GAP-7 (2026-09-08): the screen held ONE description/quantity pair in
// two scalar useStates and posted `items: [{ … }]` -- a literal one-element
// array -- so a purchase requisition raised from PROJEXA could only ever
// ask for one material, which is not what a site requisition is. The API
// has always taken an array of any length (VERIDIAN
// erp-procurement-workflow-service.ts createPurchaseRequisition:
// `if (!input.items?.length) throw new ServiceError("At least one line item
// is required", 400)` -- a MINIMUM of one -- then `input.items.map(…)` into
// a bulk insert). Converted to the same repeatable line editor
// PurchaseOrderCreateClient.tsx uses (add / edit / remove a row, last row
// not removable).
//
// NO RUNNING TOTAL HERE, deliberately: a requisition line in this payload
// carries description + quantity and no rate, so there is no money on this
// document to total. (erp_purchase_requisition_items does have an
// estimatedRate column, but nothing in PROJEXA has ever sent one and adding
// a field to the payload is not what this item is.)
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Line = { description: string; quantity: string };

export default function RequisitionCreateClient() {
  const router = useRouter();
  const [purpose, setPurpose] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1" }]);
  const [submitting, setSubmitting] = useState(false);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const missing = lines.every((l) => l.description.trim()) ? [] : ["A description on every line"];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      const req = await fetchJson<{ id: string }>("/api/procurement/requisitions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: purpose || undefined, postingDate: new Date().toISOString().slice(0, 10),
          items: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 1 })),
        }),
      });
      toast.success("Requisition created");
      router.push(`/procurement/requisitions/${req.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create requisition"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Procurement / New Requisition"
      title="New Purchase Requisition"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/procurement?tab=requisitions")}
      onBack={() => router.push("/procurement?tab=requisitions")}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Creating…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Purpose (optional)</Label><Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Why is this needed?" /></div>
        <div className="space-y-2">
          <Label>Line Items</Label>
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input placeholder="Description — e.g. TMT bars 12mm" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="flex-1" />
              <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-20" />
              <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { description: "", quantity: "1" }])}>
            <Plus className="size-3.5" /> Add Line
          </Button>
        </div>
      </div>
    </ObjectScreen>
  );
}
