"use client";

// R67 D-40 (Sumeet's item 8, "material database -- spec, cost, qty").
//
// The module could say what arrived on site and never what left it, so the
// master carried no quantity at all and "how many bags do we have?" -- the one
// question a storekeeper actually asks -- had no answer anywhere in the
// product. This is the OUT side, and it mirrors MaterialReceiptCreateClient
// deliberately: same ObjectScreen, same "Save (…)" counting label, same
// posture on optional lookups (a lookup that fails degrades the field, never
// the form).
//
// THE CAP IS SHOWN HERE AND ENFORCED ON THE SERVER. The Material select only
// offers materials with something on hand, and Quantity refuses more than the
// balance with the field message "Only 120 bags on hand". That is a courtesy:
// two storekeepers on two phones would both pass it. createMaterialIssue()
// re-reads the balance inside the writing transaction and refuses with its own
// copy of the same sentence, which is shown verbatim if it ever fires.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatQty } from "@/lib/format-money";
import { issueQuantityError } from "@/lib/unit-label";

type Material = {
  id: string; name: string; unit: string; isActive: boolean;
  receivedToDate?: number; issuedToDate?: number; onHand?: number;
};
type BoqLineItem = { id: string; itemCode: string | null; description: string | null };
type Boq = { id: string; lineItems?: BoqLineItem[] };

export default function MaterialIssueCreateClient({
  projectId,
  initialMaterialId,
}: {
  projectId: string;
  /**
   * From ?materialId= -- set when the storekeeper started from one material's
   * row rather than from the Issues tab, so the picker does not ask a question
   * they have already answered.
   */
  initialMaterialId?: string;
}) {
  const router = useRouter();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [boqLines, setBoqLines] = useState<BoqLineItem[]>([]);
  const [boqError, setBoqError] = useState<string | null>(null);

  const [materialId, setMaterialId] = useState(initialMaterialId ?? "");
  const [issuedDate, setIssuedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");
  const [boqLineItemId, setBoqLineItemId] = useState("");
  const [issuedTo, setIssuedTo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function loadMaterials() {
    try {
      const data = await fetchJson<{ materials?: Material[] }>(`/api/materials/master?projectId=${encodeURIComponent(projectId)}`);
      // Only what can actually be issued. Offering a material with nothing on
      // hand is offering a choice that can only end in a refusal.
      setMaterials((data.materials ?? []).filter((m) => m.isActive && (m.onHand ?? 0) > 0));
      setMaterialsError(null);
    } catch (err) {
      setMaterials([]);
      setMaterialsError(errorMessage(err, "Couldn't load the material master"));
    }
  }

  async function loadBoqLines() {
    try {
      const data = await fetchJson<{ boqs?: Boq[] }>(`/api/scope?projectId=${encodeURIComponent(projectId)}`);
      setBoqLines((data.boqs ?? []).flatMap((boq) => boq.lineItems ?? []));
      setBoqError(null);
    } catch (err) {
      setBoqLines([]);
      setBoqError(errorMessage(err, "Couldn't load this project's BOQ lines"));
    }
  }

  useEffect(() => { void loadMaterials(); void loadBoqLines(); }, [projectId]);

  const selected = useMemo(() => materials.find((m) => m.id === materialId) ?? null, [materials, materialId]);
  const onHand = selected?.onHand ?? 0;

  // The rule lives in src/lib/unit-label.ts so it can be exercised directly --
  // see that file's test for why a component test cannot type into a field here.
  const quantityError = useMemo(
    () => issueQuantityError(quantity, selected ? onHand : null, selected?.unit),
    [quantity, selected, onHand]
  );

  const missing = [
    ...(materialId ? [] : ["Material"]),
    ...(issuedDate ? [] : ["Issued Date"]),
    ...(quantity ? [] : ["Quantity"]),
  ];

  async function createIssue() {
    if (missing.length || quantityError) return;
    setSubmitting(true);
    setSaveError(null);
    try {
      await fetchJson("/api/materials/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, materialId, issuedDate, quantity: Number(quantity),
          boqLineItemId: boqLineItemId || undefined,
          issuedTo: issuedTo.trim() || undefined,
        }),
      });
      toast.success("Material issued");
      router.push(`/materials?projectId=${projectId}&tab=issues`);
    } catch (err) {
      // The backend's own sentence -- including its on-hand refusal -- stays on
      // screen rather than in a toast that has gone by the time the storekeeper
      // looks up.
      setSaveError(errorMessage(err, "Couldn't record this issue"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Materials / Record Issue"
      title="Issue to Site"
      mode="create"
      hasDraft={false}
      onSave={createIssue}
      onCancel={() => router.push(`/materials?projectId=${projectId}&tab=issues`)}
      onBack={() => router.push(`/materials?projectId=${projectId}&tab=issues`)}
      saveDisabled={submitting || missing.length > 0 || !!quantityError}
      saveDisabledReason={
        submitting ? "Saving…" : missing.length ? missing.join(", ") : quantityError ? quantityError : undefined
      }
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <FormField
          label="Material"
          required
          error={materialsError ?? undefined}
          hint={selected ? `${formatQty(onHand)} ${selected.unit} on hand` : undefined}
        >
          {(f) => (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={materialId} onValueChange={(next) => { setMaterialId(next); setSaveError(null); }}>
                <SelectTrigger {...f} className="min-w-64" disabled={materials.length === 0}>
                  <SelectValue placeholder={materials.length === 0 ? "Nothing on hand to issue" : "Select material"} />
                </SelectTrigger>
                <SelectContent>
                  {materials.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} — {formatQty(m.onHand ?? 0)} {m.unit} on hand
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {materialsError && (
                <Button type="button" variant="outline" size="sm" onClick={() => void loadMaterials()}>Retry</Button>
              )}
            </div>
          )}
        </FormField>

        <FormField label="Issued Date" required>
          {(f) => <Input {...f} type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />}
        </FormField>

        <FormField label="Quantity" required error={quantityError}>
          {(f) => (
            <Input
              {...f}
              type="number"
              // The cap is on the control as well as in the message, so the
              // browser's own stepper cannot walk past it.
              max={selected ? onHand : undefined}
              min={0}
              step="any"
              value={quantity}
              onChange={(e) => { setQuantity(e.target.value); setSaveError(null); }}
            />
          )}
        </FormField>

        <FormField
          label="BOQ item (optional)"
          error={boqError ?? undefined}
        >
          {(f) => (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={boqLineItemId} onValueChange={setBoqLineItemId}>
                <SelectTrigger {...f} className="min-w-64" disabled={boqLines.length === 0}>
                  <SelectValue placeholder={boqLines.length === 0 ? "No BOQ lines on this project yet" : "Select a BOQ line"} />
                </SelectTrigger>
                <SelectContent>
                  {boqLines.map((line) => (
                    <SelectItem key={line.id} value={line.id}>
                      {[line.itemCode, line.description].filter(Boolean).join(" — ") || line.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {boqError && (
                <Button type="button" variant="outline" size="sm" onClick={() => void loadBoqLines()}>Retry</Button>
              )}
            </div>
          )}
        </FormField>

        <FormField label="Issued to (optional)" hint="The gang, subcontractor or person who took it">
          {(f) => <Input {...f} value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="e.g. Falcon gang 3" />}
        </FormField>

        {saveError && <p role="alert" className="text-[13px] text-px-error">{saveError}</p>}
      </div>
    </ObjectScreen>
  );
}
