"use client";

// Real-screen conversion (2026-08-30): replaces MaterialsClient.tsx's old
// "Record Receipt" Dialog popup with a real create screen. No Object Page
// -- a write-once inbound-receipt transaction, same class as Attendance.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// R67 C-06: a multi-field create route IS the card -- band 2 stays empty
// while this form is open -- so the save reports itself back to the shell
// and the receipt line lands in the same band a composer write's would.
import { useShellChain } from "@/components/shell/shell-chain-context";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Material = { id: string; name: string; isActive: boolean };

export default function MaterialReceiptCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { pushReceipt } = useShellChain();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialId, setMaterialId] = useState("");
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ materials?: Material[] }>(`/api/materials/master?projectId=${encodeURIComponent(projectId)}`)
      .then((d) => setMaterials((d.materials ?? []).filter((m) => m.isActive)))
      .catch((err) => toast.error(errorMessage(err, "Couldn't load material master")));
  }, [projectId]);

  const missing = [...(materialId ? [] : ["Material"]), ...(receivedDate ? [] : ["Received Date"]), ...(quantity ? [] : ["Quantity"])];

  async function createReceipt() {
    if (missing.length) return;
    setSubmitting(true);
    try {
      await fetchJson("/api/materials", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, materialId, receivedDate, quantity: Number(quantity), unitCost: unitCost ? Number(unitCost) : undefined }),
      });
      toast.success("Receipt recorded");
      const material = materials.find((m) => m.id === materialId);
      pushReceipt({
        text: `Recorded ${quantity} of ${material?.name ?? "this material"} on ${receivedDate}`,
        href: `/materials?projectId=${projectId}&tab=receipts`,
      });
      router.push(`/materials?projectId=${projectId}&tab=receipts`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't record receipt"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Materials / Record Receipt"
      title="Record Inbound Receipt"
      mode="create"
      hasDraft={false}
      onSave={createReceipt}
      onCancel={() => router.push(`/materials?projectId=${projectId}&tab=receipts`)}
      onBack={() => router.push(`/materials?projectId=${projectId}&tab=receipts`)}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Saving…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Material</Label>
          <Select value={materialId} onValueChange={setMaterialId}>
            <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
            <SelectContent>{materials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Received Date</Label><Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Unit Cost (optional — defaults to the master cost)</Label><Input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
