"use client";

// Real-screen conversion (2026-08-30): replaces MaterialsClient.tsx's old
// "Add Material" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoneyInput } from "@/components/ui/money-input";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import { MATERIAL_UNITS } from "@/lib/material-units";
import { useOrgMoney } from "@/lib/use-org-money";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function MaterialCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [unit, setUnit] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const orgMoney = useOrgMoney();

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
        {/* R67 G-05: was a free-text Input with the placeholder
            "e.g. bag, cum, kg". Free text on an enumeration produces a
            vocabulary, not a value -- "bag", "Bag" and "bags" are three
            different strings to the materials cost report, which groups by
            unit, so one material becomes three rows and no total is right. */}
        <div className="space-y-1.5">
          <Label>Unit</Label>
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Pick a unit" /></SelectTrigger>
            <SelectContent>
              {MATERIAL_UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {/* R67 G-05: the currency sits inside the box, beside the caret, so
            the unit is visible while the number is being typed -- not in a
            placeholder that vanishes on the first keystroke. */}
        <div className="space-y-1.5">
          <Label htmlFor="material-unit-cost">
            Unit Cost{orgMoney.unitSuffix} (optional)
          </Label>
          <MoneyInput
            id="material-unit-cost"
            currency={orgMoney.currency}
            pending={!orgMoney.loaded}
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
          />
          <CurrencyNotSetNotice currencySet={orgMoney.currencySet} loaded={orgMoney.loaded} />
        </div>
      </div>
    </ObjectScreen>
  );
}
