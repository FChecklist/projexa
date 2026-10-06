"use client";

// LOCAL-FIRST shell, Add a material (/materials/new): name, unit, spec, unit cost, reorder level; kept on the laptop at once and sent
// through the registry's create_material when connected (G-15: this screen used to need a connection).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ShellScreenProps } from "../types";
import { createMaterialOffline } from "./delivery-writes";
import { CopyNote, ReadOnlyNote, SaveNote, Screen, StateMessage, fieldClass, mayWrite, projectName, textHandlers, useLocalSave, withProject } from "./DeliveryParts";
import type { MaterialsData } from "./materials-adapter";

const numberOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v));

export default function MaterialNewScreen({ shell, data }: ShellScreenProps<MaterialsData>) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [spec, setSpec] = useState("");
  const [cost, setCost] = useState("");
  const [reorder, setReorder] = useState("");
  const { saving, note, save } = useLocalSave(shell);

  if (data.state !== "local") return <StateMessage testId="material-new" title="Add a material" state={data.state} what="material" />;
  const projectId = data.projectId;
  const label = projectName(shell, projectId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await save(() => createMaterialOffline(shell.data, { projectId, name, unit, spec, unitCost: numberOrNull(cost), reorderLevel: numberOrNull(reorder) }));
    if (ok) {
      setName("");
      setUnit("");
      setSpec("");
      setCost("");
      setReorder("");
    }
  }

  return (
    <Screen testId="material-new" state="local" title={`Add a material${label ? ` / ${label}` : ""}`}>
      <CopyNote testId="material-new-copy-note" syncedAt={data.syncedAt} />
      {!mayWrite(shell) ? (
        <ReadOnlyNote />
      ) : (
        <form onSubmit={submit} className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="material-new-form">
          <label className="block text-sm">
            Name
            <input aria-label="Name" className={fieldClass} value={name} {...textHandlers(setName)} required />
          </label>
          <label className="mt-3 block text-sm">
            Unit (bag, cum, nos ...)
            <input aria-label="Unit" className={fieldClass} value={unit} {...textHandlers(setUnit)} required />
          </label>
          <label className="mt-3 block text-sm">
            Specification (optional)
            <input aria-label="Specification" className={fieldClass} value={spec} {...textHandlers(setSpec)} />
          </label>
          <label className="mt-3 block text-sm">
            Unit cost (optional)
            <input aria-label="Unit cost" className={fieldClass} inputMode="decimal" value={cost} {...textHandlers(setCost)} />
          </label>
          <label className="mt-3 block text-sm">
            Reorder level (optional)
            <input aria-label="Reorder level" className={fieldClass} inputMode="decimal" value={reorder} {...textHandlers(setReorder)} />
          </label>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Add material"}</Button>
          <SaveNote note={note} />
        </form>
      )}
      <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={withProject("/materials", projectId)}>Back to materials</a></p>
    </Screen>
  );
}
