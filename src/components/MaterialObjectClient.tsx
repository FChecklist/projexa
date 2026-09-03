"use client";

// Real-screen conversion (2026-08-30): materials never had a detail view or
// any way to edit/retire one short of re-creating it -- updateMaterial()
// didn't exist in construction-materials-service.ts at all before this
// conversion. Real Object Page on the kit's ObjectScreen. Real Delete =
// real Deactivate (isActive: false), matching Labour's Roster/Budget's
// Cancel/Documents' Dispose convention. No Object Page for Inbound
// Receipts -- a write-once transaction log, same class as Attendance.
//
// R67 G-05 (R-260), second pass. This screen is the OTHER half of the same
// field: MaterialCreateClient's Unit became a closed <Select> so "bag" and
// "Bag" cannot both be created, but this edit form still had the free-text
// <Input>, on the same records, feeding the same unit-grouped cost report. A
// vocabulary you can only close on one of two doors is not closed. Its Unit
// Cost facet also glued a currency label straight onto the raw drizzle numeric
// string ("AED 12.5000"), which is the exact defect format-money.ts removed
// from MaterialsClient one screen away.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
// R67 F-34 (D-09): the FORKED ObjectScreen, which adds the `loading` variant.
import { KitObjectScreen } from "@/components/screens/KitObjectScreen";
import { MATERIAL_OBJECT_BREADCRUMB } from "@/lib/object-breadcrumbs";
import { useDeleteConfirmation } from "@/components/DeleteConfirmation";
import { ObjectContext } from "@/components/shell/shell-screen-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoneyInput } from "@/components/ui/money-input";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import { MATERIAL_UNITS, isMaterialUnit, materialUnitLabel, normaliseMaterialUnit } from "@/lib/material-units";
import { useOrgMoney } from "@/lib/use-org-money";
import { EMPTY_VALUE, formatQty } from "@/lib/format-money";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Material = {
  id: string;
  projectId: string;
  name: string;
  spec: string | null;
  unit: string;
  unitCost: string;
  isActive: boolean;
  // R67 D-40: computed by the service (received minus issued, voided receipts
  // excluded), never stored -- so the master and the Cost Report cannot
  // disagree. Absent rather than 0 when there is no stock ledger for the item.
  receivedToDate?: string | number | null;
  issuedToDate?: string | number | null;
  onHand?: string | number | null;
  /** null means "no threshold"; 0 means "flag me the moment it runs out". */
  reorderLevel?: string | number | null;
};

export default function MaterialObjectClient({ materialId }: { materialId: string }) {
  const router = useRouter();
  const orgMoney = useOrgMoney();
  const [material, setMaterial] = useState<Material | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ name: "", spec: "", unit: "", unitCost: "", reorderLevel: "" });
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
    // normaliseMaterialUnit folds the spellings that already exist ("Bags" ->
    // "bag") onto the canonical value, so an edit that touches only the NAME
    // still leaves the unit in the vocabulary. It returns null for anything it
    // does not recognise, and in that case the raw stored string is kept and
    // offered back as its own option -- an unrecognised unit is shown, never
    // silently rewritten to something the record never said.
    setDraft({
      name: material.name,
      spec: material.spec ?? "",
      unit: normaliseMaterialUnit(material.unit) ?? material.unit,
      unitCost: material.unitCost,
      reorderLevel:
        material.reorderLevel === null || material.reorderLevel === undefined ? "" : String(material.reorderLevel),
    });
    setMode("edit");
  }

  async function saveEdit() {
    if (!draft.name.trim() || !draft.unit.trim()) { toast.error("Name and unit are required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/materials/master/${materialId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reorderLevel: draft.reorderLevel === "" ? null : Number(draft.reorderLevel), name: draft.name.trim(), spec: draft.spec || null, unit: draft.unit.trim(), unitCost: draft.unitCost ? Number(draft.unitCost) : undefined }),
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

  // R67 D-67. Deactivating is reversible in the data but not in the UI --
  // the master list only offers active materials and there is no reactivate
  // control anywhere -- and it silently removes the item from every receipt
  // form in the project. One click was not enough deliberation for that.
  // Declared before the early returns below, because a hook must be.
  const removal = useDeleteConfirmation({
    objectLabel: "Material",
    identifier: material?.name ?? null,
    extra: "and remove it from the Record Receipt form",
    verb: "Deactivate",
    run: deactivate,
  });

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
    <KitObjectScreen
      loading
      breadcrumb={MATERIAL_OBJECT_BREADCRUMB.breadcrumb}
      label={MATERIAL_OBJECT_BREADCRUMB.label}
      actions={MATERIAL_OBJECT_BREADCRUMB.actions}
    />
  );

  // A stored unit the vocabulary does not recognise. It stays selectable so
  // the record can be edited without being forced to change a field the editor
  // may know nothing about.
  const legacyUnit = draft.unit && !isMaterialUnit(draft.unit) ? draft.unit : null;

  return (
    <>
    {/* R67 A-21: the strip reads "<project> › Material OPC 43-grade cement"
        rather than naming the module, and the project is the one on the record
        rather than whichever one the top rail was left on. */}
    <ObjectContext moduleId="materials" label={material.name} projectId={material.projectId} />
    <KitObjectScreen
      breadcrumb={MATERIAL_OBJECT_BREADCRUMB.breadcrumb}
      title={mode === "edit" ? "Edit Material" : material.name}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: material.isActive ? "done" : "late", label: material.isActive ? "active" : "inactive" }}
      facets={[
        // R67 D-40: On hand LEADS -- it is the figure a storekeeper opened this
        // page for -- with what produced it beneath. An absent figure is the
        // en-dash, never 0: "no stock ledger for this item" and "none left" are
        // different facts, and only one of them means stop work.
        { label: `On hand${material.unit ? ` (${material.unit})` : ""}`, value: formatQty(material.onHand) },
        { label: "Received to date", value: formatQty(material.receivedToDate) },
        { label: "Issued to date", value: formatQty(material.issuedToDate) },
        {
          label: "Reorder level",
          value:
            material.reorderLevel === null || material.reorderLevel === undefined
              ? EMPTY_VALUE
              : `${formatQty(material.reorderLevel)} ${material.unit}`,
        },
        { label: "Spec", value: material.spec ?? "—" },
        { label: "Unit", value: materialUnitLabel(material.unit) },
        // Was `${label}${material.unitCost}` -- a currency label glued to the
        // raw numeric string drizzle returns, so a rate stored as 12.5000
        // read "AED 12.5000" here and "AED 12.50" on the list one click away.
        { label: `Unit Cost${orgMoney.unitSuffix}`, value: orgMoney.money(material.unitCost) },
      ]}
      onEdit={material.isActive && mode === "display" ? startEdit : undefined}
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      onDelete={material.isActive && mode === "display" ? removal.request : undefined}
      deleteDisabledReason={deactivating ? "Deactivating…" : undefined}
      onBack={() => router.push(`/materials?projectId=${material.projectId}`)}
      saveDisabled={saving || !draft.name.trim() || !draft.unit.trim()}
      saveDisabledReason={saving ? "Saving…" : !draft.name.trim() || !draft.unit.trim() ? "Name and unit are required" : undefined}
      messages={[]}
    >
      {removal.card}
      {mode === "edit" && (
        <div className="space-y-3 px-4 py-3">
          <div className="space-y-1.5"><Label>Name</Label><Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Spec (optional)</Label><Input value={draft.spec} onChange={(e) => setDraft((d) => ({ ...d, spec: e.target.value }))} placeholder="e.g. 43-grade OPC" /></div>
          {/* R67 G-05: the same closed vocabulary MaterialCreateClient uses.
              A legacy value outside it is offered back as its own option --
              visible, keepable, and replaceable in one click -- rather than
              being dropped by a <Select> that cannot represent it. */}
          <div className="space-y-1.5">
            <Label htmlFor="material-unit">Unit</Label>
            <Select value={draft.unit} onValueChange={(v) => setDraft((d) => ({ ...d, unit: v }))}>
              <SelectTrigger id="material-unit" className="w-full"><SelectValue placeholder="Pick a unit" /></SelectTrigger>
              <SelectContent>
                {legacyUnit && <SelectItem value={legacyUnit}>{legacyUnit} (as recorded)</SelectItem>}
                {MATERIAL_UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="material-reorder-level">Reorder level (optional)</Label>
            <Input
              id="material-reorder-level"
              type="number"
              min="0"
              value={draft.reorderLevel}
              onChange={(e) => setDraft((d) => ({ ...d, reorderLevel: e.target.value }))}
              placeholder="e.g. 50"
            />
            <p className="text-[12px] text-px-muted">
              Leave blank for no threshold. 0 flags this material the moment it runs out.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="material-unit-cost">Unit Cost{orgMoney.unitSuffix} (optional)</Label>
            <MoneyInput
              id="material-unit-cost"
              currency={orgMoney.currency}
              pending={!orgMoney.loaded}
              value={draft.unitCost}
              onChange={(e) => setDraft((d) => ({ ...d, unitCost: e.target.value }))}
            />
          </div>
        </div>
      )}
      {/* The facets above prefix the rate with the warning glyph when the org
          has no currency; this is the one sentence that says what it means. */}
      {orgMoney.showNotice && (
        <div className="px-4 pb-3">
          <CurrencyNotSetNotice currencySet={false} />
        </div>
      )}
    </KitObjectScreen>
    </>
  );
}
