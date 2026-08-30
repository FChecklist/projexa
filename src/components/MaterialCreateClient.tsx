"use client";

// Real-screen conversion (2026-08-30): replaces MaterialsClient.tsx's old
// "Add Material" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function MaterialCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [unit, setUnit] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const missing = [...(name.trim() ? [] : ["Name"]), ...(unit.trim() ? [] : ["Unit"])];

  async function createMaterial() {
    if (missing.length) return;
    setSubmitting(true);
    try {
      const material = await fetchJson<{ id: string }>("/api/materials/master", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name, spec: spec || undefined, unit, unitCost: unitCost ? Number(unitCost) : undefined }),
      });
      toast.success("Material added");
      router.push(`/materials/${material.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add material"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Materials / New Material"
      title="Add Material"
      mode="create"
      hasDraft={false}
      onSave={createMaterial}
      onCancel={() => router.push(`/materials?projectId=${projectId}`)}
      onBack={() => router.push(`/materials?projectId=${projectId}`)}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Adding…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Spec (optional)</Label><Input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="e.g. 43-grade OPC" /></div>
        <div className="space-y-1.5"><Label>Unit</Label><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. bag, cum, kg" /></div>
        <div className="space-y-1.5"><Label>Unit Cost (optional)</Label><Input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
