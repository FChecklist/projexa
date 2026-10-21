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
import { readCurrentBoqLines } from "@/lib/scope-list-reads";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GuidedError, GuidedSubmitFailure } from "@/components/GuidedError";
import { DraftRestoredNote } from "@/components/DraftRestoredNote";
import { contextFromFailure } from "@/lib/error-guide/context";
import { fault, notANumber, todayLocalIso, useCheckedSubmit, useFormDraft } from "@/lib/guided-form";
import { useSubmit } from "@/lib/use-submit";
import { KitObjectScreen } from "@/components/screens/KitObjectScreen";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatQty } from "@/lib/format-money";
import { issueQuantityError, onHandLimitMessage } from "@/lib/unit-label";

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

  const [materialsLoaded, setMaterialsLoaded] = useState(false);
  const [activeMaterialCount, setActiveMaterialCount] = useState(0);
  // G3 guided errors: every typed value survives a "Fix it now" detour (for example to record the missing receipt) and comes back with the person.
  const draft = useFormDraft(`material-issue:${projectId}`, { materialId: initialMaterialId ?? "", issuedDate: new Date().toISOString().slice(0, 10), quantity: "", boqLineItemId: "", issuedTo: "" });
  const { materialId, issuedDate, quantity, boqLineItemId, issuedTo } = draft.values;
  const setMaterialId = (v: string) => draft.onChange("materialId", v);
  const setIssuedDate = (v: string) => draft.onChange("issuedDate", v);
  const setQuantity = (v: string) => draft.onChange("quantity", v);
  const setBoqLineItemId = (v: string) => draft.onChange("boqLineItemId", v);
  const setIssuedTo = (v: string) => draft.onChange("issuedTo", v);

  async function loadMaterials() {
    try {
      const data = await fetchJson<{ materials?: Material[] }>(`/api/materials/master?projectId=${encodeURIComponent(projectId)}`);
      // Only what can actually be issued. Offering a material with nothing on
      // hand is offering a choice that can only end in a refusal.
      setMaterials((data.materials ?? []).filter((m) => m.isActive && (m.onHand ?? 0) > 0));
      setActiveMaterialCount((data.materials ?? []).filter((m) => m.isActive).length);
      setMaterialsError(null);
    } catch (err) {
      setMaterials([]);
      setMaterialsError(errorMessage(err, "Couldn't load the material master"));
    } finally {
      setMaterialsLoaded(true);
    }
  }

  async function loadBoqLines() {
    try {
      setBoqLines(await readCurrentBoqLines<BoqLineItem>(projectId));
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

  const submit = useSubmit<unknown>({
    objectLabel: "Issue",
    buildRequest: () => ({
      input: "/api/materials/issues",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, materialId, issuedDate, quantity: Number(quantity),
          boqLineItemId: boqLineItemId || undefined,
          issuedTo: issuedTo.trim() || undefined,
        }),
      },
    }),
    onSuccess: () => {
      draft.clear();
      router.push(`/materials?projectId=${projectId}&tab=issues`);
    },
  });

  // The form's own checks run before anything is sent. Each fault names the exact input, so "Fix it now" highlights it.
  const checked = useCheckedSubmit(submit, () => {
    const q = quantity.trim();
    if (notANumber(q) || Number(q) <= 0) return fault("QTY_NOT_POSITIVE", "quantity", `The quantity "${q}" is not valid. An issue must be a number greater than 0.`);
    if (selected && Number(q) > onHand) return fault("ISSUE_EXCEEDS_STOCK", "quantity", `${onHandLimitMessage(onHand, selected.unit)}, so ${q} cannot be issued.`);
    if (issuedDate > todayLocalIso()) return fault("DATE_FUTURE", "issuedDate", `The issued date ${issuedDate} is in the future. An issue records material that has already left the store.`);
    return null;
  });
  const noMaterialsAtAll = materialsLoaded && !materialsError && activeMaterialCount === 0;
  const nothingOnHand = materialsLoaded && !materialsError && activeMaterialCount > 0 && materials.length === 0;

  return (
    <KitObjectScreen
      breadcrumb="Materials / Record Issue"
      title="Issue to Site"
      mode="create"
      hasDraft={false}
      onSave={checked.onSubmit}
      onCancel={() => router.push(`/materials?projectId=${projectId}&tab=issues`)}
      onBack={() => router.push(`/materials?projectId=${projectId}&tab=issues`)}
      saveDisabled={submit.saving || missing.length > 0}
      saveDisabledReason={
        submit.saving ? "Saving…" : missing.length ? missing.join(", ") : undefined
      }
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <DraftRestoredNote draft={draft} />
        <GuidedSubmitFailure failure={checked.failure} onRetry={checked.onRetry} draftKey={`material-issue:${projectId}`} />
        {noMaterialsAtAll && <GuidedError ctx={contextFromFailure(fault("NO_MATERIALS", "materialId", "No material has been added to this project yet."), { projectId })} draftKey={`material-issue:${projectId}`} />}
        {nothingOnHand && <GuidedError ctx={contextFromFailure(fault("NOTHING_ON_HAND", "materialId", "Every material on this project has nothing on hand, so there is nothing to issue."), { projectId })} draftKey={`material-issue:${projectId}`} />}
        <FormField
          label="Material"
          required
          error={materialsError ?? undefined}
          hint={selected ? `${formatQty(onHand)} ${selected.unit} on hand` : undefined}
        >
          {(f) => (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={materialId} onValueChange={(next) => { setMaterialId(next); checked.clearFault(); }}>
                <SelectTrigger {...f} data-testid="materialId" className="min-w-64" disabled={materials.length === 0}>
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
          {(f) => <Input {...f} name="issuedDate" type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />}
        </FormField>

        <FormField label="Quantity" required error={quantityError}>
          {(f) => (
            <Input
              {...f}
              name="quantity"
              type="number"
              // The cap is on the control as well as in the message, so the
              // browser's own stepper cannot walk past it.
              max={selected ? onHand : undefined}
              min={0}
              step="any"
              value={quantity}
              onChange={(e) => { setQuantity(e.target.value); checked.clearFault(); }}
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
                <SelectTrigger {...f} data-testid="boqLineItemId" className="min-w-64" disabled={boqLines.length === 0}>
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

      </div>
    </KitObjectScreen>
  );
}
