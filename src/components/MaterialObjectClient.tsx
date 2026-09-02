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
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField, type FieldErrors } from "@/components/ui/form-field";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { formatQty } from "@/lib/format-money";
import { NAME_REQUIRED_MESSAGE, UNIT_REQUIRED_MESSAGE } from "@/components/MaterialCreateClient";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Material = {
  id: string; projectId: string; name: string; spec: string | null; unit: string; unitCost: string; isActive: boolean;
  // R67 D-40: computed by the single-material GET, the same way the master list
  // computes them, so this page and that list can never disagree.
  reorderLevel: string | null;
  receivedToDate?: number;
  issuedToDate?: number;
  onHand?: number;
};

export default function MaterialObjectClient({ materialId }: { materialId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const label = currencyLabel(undefined, currencies);
  const [material, setMaterial] = useState<Material | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ name: "", spec: "", unit: "", unitCost: "", reorderLevel: "" });
  // R67 D-37: the same two required fields as the create screen, validated the
  // same way, in the same words -- edit mode used to fail with a toast that
  // named neither field.
  const [errors, setErrors] = useState<FieldErrors<"name" | "unit">>({});
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
    setDraft({
      name: material.name,
      spec: material.spec ?? "",
      unit: material.unit,
      unitCost: material.unitCost,
      reorderLevel: material.reorderLevel ?? "",
    });
    setErrors({});
    setMode("edit");
  }

  function validateOnBlur(field: "name" | "unit") {
    const value = field === "name" ? draft.name : draft.unit;
    const message = field === "name" ? NAME_REQUIRED_MESSAGE : UNIT_REQUIRED_MESSAGE;
    setErrors((prev) => ({ ...prev, [field]: value.trim() ? undefined : message }));
  }

  async function saveEdit() {
    if (!draft.name.trim() || !draft.unit.trim()) {
      setErrors({
        name: draft.name.trim() ? undefined : NAME_REQUIRED_MESSAGE,
        unit: draft.unit.trim() ? undefined : UNIT_REQUIRED_MESSAGE,
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/materials/master/${materialId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          spec: draft.spec || null,
          unit: draft.unit.trim(),
          unitCost: draft.unitCost ? Number(draft.unitCost) : undefined,
          // R67 D-40: an emptied field CLEARS the threshold (explicit null),
          // which is a different fact from "0 -- tell me the moment it runs
          // out". The service honours that distinction; see updateMaterial().
          reorderLevel: draft.reorderLevel.trim() === "" ? null : Number(draft.reorderLevel),
        }),
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
  if (!material) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Materials / Material"
      title={mode === "edit" ? "Edit Material" : material.name}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: material.isActive ? "done" : "late", label: material.isActive ? "active" : "inactive" }}
      // R67 D-40: On hand LEADS. What a storekeeper opens this page to find out
      // is how much is on site; the spec and the planned price are context for
      // that number, not the headline. Received and issued sit beneath it so
      // the figure can always be traced to the two movements that produced it.
      subtitle={
        material.onHand === undefined
          ? undefined
          : `On hand ${formatQty(material.onHand)} ${material.unit} · received ${formatQty(material.receivedToDate)} · issued ${formatQty(material.issuedToDate)}`
      }
      facets={[
        { label: "Spec", value: material.spec ?? "—" },
        { label: "Unit", value: material.unit },
        { label: "Unit Cost", value: `${label}${material.unitCost}` },
        {
          label: "Reorder level",
          value: material.reorderLevel === null || material.reorderLevel === undefined
            ? "—"
            : `${formatQty(material.reorderLevel)} ${material.unit}`,
        },
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
          <FormField label="Name" required error={errors.name}>
            {(f) => <Input {...f} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} onBlur={() => validateOnBlur("name")} />}
          </FormField>
          <FormField label="Spec (optional)">
            {(f) => <Input {...f} value={draft.spec} onChange={(e) => setDraft((d) => ({ ...d, spec: e.target.value }))} placeholder="e.g. 43-grade OPC" />}
          </FormField>
          <FormField label="Unit" required error={errors.unit}>
            {(f) => <Input {...f} value={draft.unit} onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))} onBlur={() => validateOnBlur("unit")} placeholder="e.g. bag, cum, kg" />}
          </FormField>
          <FormField label="Unit Cost (optional)">
            {(f) => <Input {...f} type="number" value={draft.unitCost} onChange={(e) => setDraft((d) => ({ ...d, unitCost: e.target.value }))} />}
          </FormField>
          <FormField
            label="Reorder level (optional)"
            hint="When On hand falls below this, the master row is flagged Low. Leave empty for no threshold."
          >
            {(f) => <Input {...f} type="number" min={0} step="any" value={draft.reorderLevel} onChange={(e) => setDraft((d) => ({ ...d, reorderLevel: e.target.value }))} />}
          </FormField>
        </div>
      )}
    </ObjectScreen>
  );
}
