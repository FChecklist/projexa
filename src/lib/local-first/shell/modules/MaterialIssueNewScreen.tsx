"use client";

// LOCAL-FIRST shell, Issue material (/materials/issues/new): material, quantity, date, BOQ item, issued to, note; kept on the laptop
// and sent through record_material_issue when connected. Like the online form, only materials with stock are offered and the
// quantity is checked against what is on hand -- here the laptop's own count (receipts minus issues on this laptop). The server checks
// again when it receives the issue.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ShellScreenProps } from "../types";
import { localDay } from "./delivery-local";
import { recordIssueOffline } from "./delivery-writes";
import { CopyNote, SaveNote, Screen, StateMessage, fieldClass, projectName, textHandlers, useLocalSave, withProject } from "./DeliveryParts";
import type { MaterialsData } from "./materials-adapter";

export default function MaterialIssueNewScreen({ shell, query, data }: ShellScreenProps<MaterialsData>) {
  const materials = data.state === "local" ? data.materials.filter((m) => m.isActive && m.onHand !== null && m.onHand > 0) : [];
  const wanted = query.get("materialId");
  const [materialId, setMaterialId] = useState(materials.some((m) => m.id === wanted) ? wanted! : "");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState(localDay());
  const [lineId, setLineId] = useState("");
  const [issuedTo, setIssuedTo] = useState("");
  const [noteText, setNoteText] = useState("");
  const [tooMuch, setTooMuch] = useState<string | null>(null);
  const { saving, note, save } = useLocalSave(shell);

  if (data.state !== "local") return <StateMessage testId="material-issue-new" title="Issue material" state={data.state} what="material" />;
  const projectId = data.projectId;
  const chosen = materials.find((m) => m.id === materialId);
  const stockUnknown = data.receipts === null || data.issues === null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = Number(quantity);
    if (chosen && chosen.onHand !== null && q > chosen.onHand) {
      setTooMuch(`Only ${chosen.onHand}${chosen.unit ? ` ${chosen.unit}` : ""} is on hand on this laptop.`);
      return;
    }
    setTooMuch(null);
    const ok = await save(() => recordIssueOffline(shell.data, { projectId, materialId, quantity: q, issuedDate: date, boqLineItemId: lineId || null, issuedTo, note: noteText }));
    if (ok) {
      setQuantity("");
      setIssuedTo("");
      setNoteText("");
    }
  }

  return (
    <Screen testId="material-issue-new" state="local" title={`Issue material${projectName(shell, projectId) ? ` / ${projectName(shell, projectId)}` : ""}`}>
      <CopyNote testId="material-issue-new-copy-note" syncedAt={data.syncedAt} />
      {stockUnknown ? (
        <p className="mt-4 text-sm text-px-muted">Receipts and issues have not finished copying to this laptop yet, so stock cannot be checked here.</p>
      ) : materials.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">No material has stock on hand on this laptop.</p>
      ) : (
        <form onSubmit={submit} className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="material-issue-form">
          <label className="block text-sm">
            Material
            <select aria-label="Material" className={fieldClass} value={materialId} onChange={(e) => setMaterialId(e.target.value)} required>
              <option value="">Choose a material</option>
              {materials.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.onHand}{m.unit ? ` ${m.unit}` : ""} on hand</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            Quantity{chosen?.unit ? ` (${chosen.unit})` : ""}
            <input aria-label="Quantity" className={fieldClass} inputMode="decimal" value={quantity} {...textHandlers(setQuantity)} required />
          </label>
          <label className="mt-3 block text-sm">
            Issued on
            <input aria-label="Issued on" type="date" className={fieldClass} value={date} {...textHandlers(setDate)} required />
          </label>
          {data.lines && data.lines.length > 0 ? (
            <label className="mt-3 block text-sm">
              BOQ item (optional)
              <select aria-label="BOQ item" className={fieldClass} value={lineId} onChange={(e) => setLineId(e.target.value)}>
                <option value="">None</option>
                {data.lines.map((l) => <option key={l.id} value={l.id}>{l.itemCode ? `${l.itemCode} · ${l.description}` : l.description}</option>)}
              </select>
            </label>
          ) : null}
          <label className="mt-3 block text-sm">
            Issued to
            <input aria-label="Issued to" className={fieldClass} value={issuedTo} {...textHandlers(setIssuedTo)} />
          </label>
          <label className="mt-3 block text-sm">
            Note
            <input aria-label="Note" className={fieldClass} value={noteText} {...textHandlers(setNoteText)} />
          </label>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Save issue"}</Button>
          {tooMuch ? <p role="status" className="mt-2 text-sm text-red-800" data-testid="material-issue-too-much">{tooMuch}</p> : null}
          <SaveNote note={note} />
        </form>
      )}
      <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={withProject("/materials?tab=issues", projectId)}>Back to issues</a></p>
    </Screen>
  );
}
