"use client";

// Real-screen conversion (2026-08-30): materials never had a detail view or
// any way to edit/retire one short of re-creating it -- updateMaterial()
// didn't exist in construction-materials-service.ts at all before this
// conversion. Real Object Page on the kit's ObjectScreen. Real Delete =
// real Deactivate (isActive: false), matching Labour's Roster/Budget's
// Cancel/Documents' Dispose convention. No Object Page for Inbound
// Receipts -- a write-once transaction log, same class as Attendance.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import { MATERIAL_OBJECT_BREADCRUMB } from "@/lib/object-breadcrumbs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Material = { id: string; projectId: string; name: string; spec: string | null; unit: string; unitCost: string; isActive: boolean };

export default function MaterialObjectClient({ materialId }: { materialId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const label = currencyLabel(undefined, currencies);
  const [material, setMaterial] = useState<Material | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ name: "", spec: "", unit: "", unitCost: "" });
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  async function load() {
    try {
      const data = await fetchJson<Material>(`/api/materials/master/${materialId}`);
      setMaterial(data);
      setLoadError(null);
    } catch (err) {
      setMaterial(null);
      setLoadError(errorMessage(err, "Couldn't load this material"));
    }
  }
  useEffect(() => { load(); }, [materialId]);

  function startEdit() {
    if (!material) return;
    setDraft({ name: material.name, spec: material.spec ?? "", unit: material.unit, unitCost: material.unitCost });
    setMode("edit");
  }

  async function saveEdit() {
    if (!draft.name.trim() || !draft.unit.trim()) { toast.error("Name and unit are required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/materials/master/${materialId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), spec: draft.spec || null, unit: draft.unit.trim(), unitCost: draft.unitCost ? Number(draft.unitCost) : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save material");
      toast.success("Material saved");
      setMode("display");
      setMaterial(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save material");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    setDeactivating(true);
    try {
      const res = await fetch(`/api/materials/master/${materialId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to deactivate material");
      toast.success("Material deactivated");
      setMaterial(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't deactivate material");
    } finally {
      setDeactivating(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  // R67 F-34 (R-290): the SAME frame the route's own loading.tsx paints, so the
  // hand-over from the route skeleton to this client is invisible and the word
  // "Loading" is never alone on the screen. It says what it is waiting for after
  // 3 s and offers Retry at 8 s, D-04's abort budget.
  if (!material) return (
    <ObjectScreen
      loading
      breadcrumb={MATERIAL_OBJECT_BREADCRUMB.breadcrumb}
      label={MATERIAL_OBJECT_BREADCRUMB.label}
      actions={MATERIAL_OBJECT_BREADCRUMB.actions}
    />
  );

  return (
    <ObjectScreen
      breadcrumb={MATERIAL_OBJECT_BREADCRUMB.breadcrumb}
      title={mode === "edit" ? "Edit Material" : material.name}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: material.isActive ? "done" : "late", label: material.isActive ? "active" : "inactive" }}
      facets={[
        { label: "Spec", value: material.spec ?? "—" },
        { label: "Unit", value: material.unit },
        { label: "Unit Cost", value: `${label}${material.unitCost}` },
      ]}
      onEdit={material.isActive && mode === "display" ? startEdit : undefined}
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      onDelete={material.isActive && mode === "display" ? deactivate : undefined}
      deleteDisabledReason={deactivating ? "Deactivating…" : undefined}
      onBack={() => router.push(`/materials?projectId=${material.projectId}`)}
      saveDisabled={saving || !draft.name.trim() || !draft.unit.trim()}
      saveDisabledReason={saving ? "Saving…" : !draft.name.trim() || !draft.unit.trim() ? "Name and unit are required" : undefined}
      messages={[]}
    >
      {mode === "edit" && (
        <div className="space-y-3 px-4 py-3">
          <div className="space-y-1.5"><Label>Name</Label><Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Spec (optional)</Label><Input value={draft.spec} onChange={(e) => setDraft((d) => ({ ...d, spec: e.target.value }))} placeholder="e.g. 43-grade OPC" /></div>
          <div className="space-y-1.5"><Label>Unit</Label><Input value={draft.unit} onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))} placeholder="e.g. bag, cum, kg" /></div>
          <div className="space-y-1.5"><Label>Unit Cost (optional)</Label><Input type="number" value={draft.unitCost} onChange={(e) => setDraft((d) => ({ ...d, unitCost: e.target.value }))} /></div>
        </div>
      )}
    </ObjectScreen>
  );
}
