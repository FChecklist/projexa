"use client";

// Real-screen conversion (2026-08-30): replaces MaterialsClient.tsx's old
// "Add Material" Dialog popup with a real create screen.
//
// R67 D-37 (audit R-096). Three vocabulary/state defects, all of them the same
// defect from different angles -- the screen knew something the user did not:
//
//   * The title said "Add Material" while its own breadcrumb said "New
//     Material" and the button that opens it says "+ New Material". Three names
//     for one screen. It is "New Material" everywhere now.
//   * Name and Unit were required by the service but carried no required
//     marker and no validation: the user found out by watching a disabled Save
//     button do nothing. They are marked, and they validate on BLUR -- at the
//     field, in the field's own words -- rather than on submit.
//   * The Save label keeps this product's counting form ("Save (Name, Unit)"),
//     which /labour/new already established.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import { Input } from "@/components/ui/input";
import { FormField, type FieldErrors } from "@/components/ui/form-field";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

// The exact sentences the audit specifies. "e.g. bag" is carried in the Unit
// message itself because a unit is the one field a site user has no default
// intuition for -- the example IS the instruction.
export const NAME_REQUIRED_MESSAGE = "Name is required";
export const UNIT_REQUIRED_MESSAGE = "Unit is required — e.g. bag";

export default function MaterialCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [unit, setUnit] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const [errors, setErrors] = useState<FieldErrors<"name" | "unit">>({});
  const [submitting, setSubmitting] = useState(false);

  const missing = [...(name.trim() ? [] : ["Name"]), ...(unit.trim() ? [] : ["Unit"])];

  // Validation runs on blur, so a field the user has not reached yet is never
  // shouted at, and a field they left empty says so the moment they leave it.
  function validateOnBlur(field: "name" | "unit") {
    const value = field === "name" ? name : unit;
    const message = field === "name" ? NAME_REQUIRED_MESSAGE : UNIT_REQUIRED_MESSAGE;
    setErrors((prev) => ({ ...prev, [field]: value.trim() ? undefined : message }));
  }

  async function createMaterial() {
    if (missing.length) {
      setErrors({
        name: name.trim() ? undefined : NAME_REQUIRED_MESSAGE,
        unit: unit.trim() ? undefined : UNIT_REQUIRED_MESSAGE,
      });
      return;
    }
    setSubmitting(true);
    try {
      const material = await fetchJson<{ id: string }>("/api/materials/master", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, name, spec: spec || undefined, unit,
          unitCost: unitCost ? Number(unitCost) : undefined,
          // R67 D-40: omitted means "no threshold" (null), which is a different
          // fact from 0 ("flag me the moment it runs out").
          reorderLevel: reorderLevel.trim() === "" ? undefined : Number(reorderLevel),
        }),
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
      title="New Material"
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
        <FormField label="Name" required error={errors.name}>
          {(f) => (
            <Input
              {...f}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => validateOnBlur("name")}
            />
          )}
        </FormField>
        <FormField label="Spec (optional)">
          {(f) => <Input {...f} value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="e.g. 43-grade OPC" />}
        </FormField>
        <FormField label="Unit" required error={errors.unit}>
          {(f) => (
            <Input
              {...f}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              onBlur={() => validateOnBlur("unit")}
              placeholder="e.g. bag, cum, kg"
            />
          )}
        </FormField>
        <FormField label="Unit Cost (optional)">
          {(f) => <Input {...f} type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />}
        </FormField>
        <FormField
          label="Reorder level (optional)"
          hint="When On hand falls below this, the master row is flagged Low. Leave empty for no threshold."
        >
          {(f) => <Input {...f} type="number" min={0} step="any" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />}
        </FormField>
      </div>
    </ObjectScreen>
  );
}
