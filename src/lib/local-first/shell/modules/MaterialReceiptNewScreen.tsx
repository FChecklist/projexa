"use client";

// LOCAL-FIRST shell, Record receipt (/materials/receipts/new): material, quantity, date, reference, notes; kept on the laptop and sent
// through record_material_receipt when connected. NO unit cost and no vendor offline: a cost is money (the server keeps the
// material's own cost) and vendors are not on the laptop yet. Both can be set on the receipt online.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ShellScreenProps } from "../types";
import { localDay } from "./delivery-local";
import { recordReceiptOffline } from "./delivery-writes";
import { CopyNote, SaveNote, Screen, StateMessage, fieldClass, projectName, textHandlers, useLocalSave, withProject } from "./DeliveryParts";
import type { MaterialsData } from "./materials-adapter";

export default function MaterialReceiptNewScreen({ shell, query, data }: ShellScreenProps<MaterialsData>) {
  const materials = data.state === "local" ? data.materials.filter((m) => m.isActive) : [];
  const wanted = query.get("materialId");
  const [materialId, setMaterialId] = useState(materials.some((m) => m.id === wanted) ? wanted! : "");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState(localDay());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const { saving, note, save } = useLocalSave(shell);

  if (data.state !== "local") return <StateMessage testId="material-receipt-new" title="Record receipt" state={data.state} what="material" />;
  const projectId = data.projectId;
  const unit = materials.find((m) => m.id === materialId)?.unit;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await save(() => recordReceiptOffline(shell.data, { projectId, materialId, quantity: Number(quantity), receivedDate: date, reference, notes }));
    if (ok) {
      setQuantity("");
      setReference("");
      setNotes("");
    }
  }

  return (
    <Screen testId="material-receipt-new" state="local" title={`Record receipt${projectName(shell, projectId) ? ` / ${projectName(shell, projectId)}` : ""}`}>
      <CopyNote testId="material-receipt-new-copy-note" syncedAt={data.syncedAt} />
      {materials.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">There is no active material on this project on this laptop. New materials are added while you are online.</p>
      ) : (
        <form onSubmit={submit} className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="material-receipt-form">
          <label className="block text-sm">
            Material
            <select aria-label="Material" className={fieldClass} value={materialId} onChange={(e) => setMaterialId(e.target.value)} required>
              <option value="">Choose a material</option>
              {materials.map((m) => <option key={m.id} value={m.id}>{m.name}{m.unit ? ` (${m.unit})` : ""}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            Quantity{unit ? ` (${unit})` : ""}
            <input aria-label="Quantity" className={fieldClass} inputMode="decimal" value={quantity} {...textHandlers(setQuantity)} required />
          </label>
          <label className="mt-3 block text-sm">
            Received on
            <input aria-label="Received on" type="date" className={fieldClass} value={date} {...textHandlers(setDate)} required />
          </label>
          <label className="mt-3 block text-sm">
            Reference (delivery note)
            <input aria-label="Reference" className={fieldClass} value={reference} {...textHandlers(setReference)} />
          </label>
          <label className="mt-3 block text-sm">
            Notes
            <input aria-label="Notes" className={fieldClass} value={notes} {...textHandlers(setNotes)} />
          </label>
          <p className="mt-3 text-xs text-px-muted">The unit cost and the vendor are set by the server and can be changed online.</p>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Save receipt"}</Button>
          <SaveNote note={note} />
        </form>
      )}
      <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={withProject("/materials?tab=receipts", projectId)}>Back to receipts</a></p>
    </Screen>
  );
}
