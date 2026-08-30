"use client";

// Real-screen conversion (2026-08-30): replaces ProcurementClient.tsx's old
// "New Requisition" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function RequisitionCreateClient() {
  const router = useRouter();
  const [purpose, setPurpose] = useState("");
  const [itemDesc, setItemDesc] = useState("");
  const [itemQty, setItemQty] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  async function create() {
    if (!itemDesc.trim()) { toast.error("Describe at least one item"); return; }
    setSubmitting(true);
    try {
      const req = await fetchJson<{ id: string }>("/api/procurement/requisitions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: purpose || undefined, postingDate: new Date().toISOString().slice(0, 10),
          items: [{ description: itemDesc, quantity: Number(itemQty) || 1 }],
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
      saveDisabled={submitting || !itemDesc.trim()}
      saveDisabledReason={submitting ? "Creating…" : !itemDesc.trim() ? "Describe at least one item" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Purpose (optional)</Label><Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Why is this needed?" /></div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2 space-y-1.5"><Label>Item description</Label><Input value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} placeholder="e.g. TMT bars 12mm" /></div>
          <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={itemQty} onChange={(e) => setItemQty(e.target.value)} /></div>
        </div>
      </div>
    </ObjectScreen>
  );
}
