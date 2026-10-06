"use client";

// LOCAL-FIRST shell, Add a worker (/labour/new): name, trade, daily rate, code; kept on the laptop at once and sent through the registry's
// add_roster_entry when connected (G-15: this screen used to need a connection). The server decides (a duplicate code, the person's role).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ShellScreenProps } from "../types";
import { addWorkerOffline } from "./delivery-writes";
import { CopyNote, ReadOnlyNote, SaveNote, Screen, StateMessage, fieldClass, mayWrite, projectName, textHandlers, useLocalSave, withProject } from "./DeliveryParts";
import type { LabourData } from "./labour-adapter";

export default function LabourWorkerNewScreen({ shell, data }: ShellScreenProps<LabourData>) {
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [rate, setRate] = useState("");
  const [code, setCode] = useState("");
  const { saving, note, save } = useLocalSave(shell);

  if (data.state !== "local") return <StateMessage testId="labour-worker-new" title="Add a worker" state={data.state} what="worker" />;
  const projectId = data.projectId;
  const label = projectName(shell, projectId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await save(() => addWorkerOffline(shell.data, { projectId, name, trade, dailyRate: Number(rate), employeeCode: code }));
    if (ok) {
      setName("");
      setTrade("");
      setRate("");
      setCode("");
    }
  }

  return (
    <Screen testId="labour-worker-new" state="local" title={`Add a worker${label ? ` / ${label}` : ""}`}>
      <CopyNote testId="labour-worker-new-copy-note" syncedAt={data.syncedAt} />
      {!mayWrite(shell) ? (
        <ReadOnlyNote />
      ) : (
        <form onSubmit={submit} className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="labour-worker-form">
          <label className="block text-sm">
            Name
            <input aria-label="Name" className={fieldClass} value={name} {...textHandlers(setName)} required />
          </label>
          <label className="mt-3 block text-sm">
            Trade (optional)
            <input aria-label="Trade" className={fieldClass} value={trade} {...textHandlers(setTrade)} />
          </label>
          <label className="mt-3 block text-sm">
            Daily rate
            <input aria-label="Daily rate" className={fieldClass} inputMode="decimal" value={rate} {...textHandlers(setRate)} required />
          </label>
          <label className="mt-3 block text-sm">
            Employee code (optional)
            <input aria-label="Employee code" className={fieldClass} value={code} {...textHandlers(setCode)} />
          </label>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Add worker"}</Button>
          <SaveNote note={note} />
        </form>
      )}
      <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={withProject("/labour", projectId)}>Back to labour</a></p>
    </Screen>
  );
}
