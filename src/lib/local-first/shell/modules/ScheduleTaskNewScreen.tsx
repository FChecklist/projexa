"use client";

// LOCAL-FIRST shell, Add a task (/schedule/tasks/new): title, start, due, days, priority, notes; kept on the laptop at once and sent
// through the registry's create_schedule_task when connected (G-15: this screen used to need a connection). The task's number and
// status are the server's.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ShellScreenProps } from "../types";
import { localDay } from "./delivery-local";
import { TASK_PRIORITIES, createTaskOffline } from "./delivery-writes";
import { CopyNote, ReadOnlyNote, SaveNote, Screen, StateMessage, fieldClass, mayWrite, projectName, textHandlers, useLocalSave, withProject } from "./DeliveryParts";
import type { ScheduleData } from "./schedule-adapter";

export default function ScheduleTaskNewScreen({ shell, data }: ShellScreenProps<ScheduleData>) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(localDay());
  const [due, setDue] = useState("");
  const [days, setDays] = useState("");
  const [priority, setPriority] = useState("");
  const [description, setDescription] = useState("");
  const { saving, note, save } = useLocalSave(shell);

  if (data.state !== "local") return <StateMessage testId="schedule-task-new" title="Add a task" state={data.state} what="task" />;
  const projectId = data.projectId;
  const label = projectName(shell, projectId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await save(() => createTaskOffline(shell.data, {
      projectId, title, startDate: start, dueDate: due || null, durationDays: days.trim() === "" ? null : Number(days), priority: priority || null, description,
    }));
    if (ok) {
      setTitle("");
      setDue("");
      setDays("");
      setPriority("");
      setDescription("");
    }
  }

  return (
    <Screen testId="schedule-task-new" state="local" title={`Add a task${label ? ` / ${label}` : ""}`}>
      <CopyNote testId="schedule-task-new-copy-note" syncedAt={data.syncedAt} />
      {!mayWrite(shell) ? (
        <ReadOnlyNote />
      ) : (
        <form onSubmit={submit} className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="schedule-task-form">
          <label className="block text-sm">
            Title
            <input aria-label="Title" className={fieldClass} value={title} {...textHandlers(setTitle)} required />
          </label>
          <label className="mt-3 block text-sm">
            Start date
            <input aria-label="Start date" type="date" className={fieldClass} value={start} {...textHandlers(setStart)} required />
          </label>
          <label className="mt-3 block text-sm">
            Due date (optional)
            <input aria-label="Due date" type="date" className={fieldClass} value={due} {...textHandlers(setDue)} />
          </label>
          <label className="mt-3 block text-sm">
            Days (optional)
            <input aria-label="Days" className={fieldClass} inputMode="numeric" value={days} {...textHandlers(setDays)} />
          </label>
          <label className="mt-3 block text-sm">
            Priority (optional)
            <select aria-label="Priority" className={fieldClass} value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">No priority</option>
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p[0]!.toUpperCase() + p.slice(1)}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            Notes (optional)
            <input aria-label="Notes" className={fieldClass} value={description} {...textHandlers(setDescription)} />
          </label>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Add task"}</Button>
          <SaveNote note={note} />
        </form>
      )}
      <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={withProject("/schedule", projectId)}>Back to schedule</a></p>
    </Screen>
  );
}
