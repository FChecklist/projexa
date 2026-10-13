"use client";

// LOCAL-FIRST shell, Milestones (R-94: a milestone is its own record, distinct from the schedule's tasks). Add a milestone
// (/schedule/milestones/new) and change one (/schedule/milestones/:id): kept on the laptop at once and sent through the registry's
// create_milestone / update_milestone when connected. The milestone's completion % is the server's (worked out from its linked tasks) and
// is not shown or sent from here. A milestone made on this laptop and not yet sent cannot be changed until the server has it.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ShellScreenProps } from "../types";
import { MILESTONE_STATUSES, createMilestoneOffline, updateMilestoneOffline } from "./delivery-writes";
import { CopyNote, ReadOnlyNote, SaveNote, Screen, StateMessage, Waiting, fieldClass, mayWrite, projectName, textHandlers, useLocalSave, withProject } from "./DeliveryParts";
import type { ScheduleData } from "./schedule-adapter";

const BACK = "text-px-ink underline underline-offset-2";
const statusWords = (s: string) => s.replace(/_/g, " ");

export function MilestoneNewScreen({ shell, data }: ShellScreenProps<ScheduleData>) {
  const [title, setTitle] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [description, setDescription] = useState("");
  const { saving, note, save } = useLocalSave(shell);

  if (data.state !== "local") return <StateMessage testId="milestone-new" title="Add a milestone" state={data.state} what="project" />;
  const projectId = data.projectId;
  const label = projectName(shell, projectId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await save(() => createMilestoneOffline(shell.data, { projectId, title, targetDate, description }));
    if (ok) {
      setTitle("");
      setTargetDate("");
      setDescription("");
    }
  }

  return (
    <Screen testId="milestone-new" state="local" title={`Add a milestone${label ? ` / ${label}` : ""}`}>
      <CopyNote testId="milestone-new-copy-note" syncedAt={data.syncedAt} />
      {!mayWrite(shell) ? (
        <ReadOnlyNote />
      ) : (
        <form onSubmit={submit} className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="milestone-form">
          <label className="block text-sm">
            Title
            <input aria-label="Title" className={fieldClass} value={title} {...textHandlers(setTitle)} required />
          </label>
          <label className="mt-3 block text-sm">
            Target date
            <input aria-label="Target date" type="date" className={fieldClass} value={targetDate} {...textHandlers(setTargetDate)} />
          </label>
          <label className="mt-3 block text-sm">
            Description
            <textarea aria-label="Description" rows={2} className={fieldClass} value={description} {...textHandlers(setDescription)} />
          </label>
          <p className="mt-3 text-xs text-px-muted">How far along it is comes from the tasks linked to it, and is worked out by the server.</p>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Save milestone"}</Button>
          <SaveNote note={note} />
        </form>
      )}
      <p className="mt-3 text-sm"><a className={BACK} href={withProject("/schedule?tab=milestones", projectId)}>Back to the milestones</a></p>
    </Screen>
  );
}

export function MilestoneEditScreen({ shell, params, data }: ShellScreenProps<ScheduleData>) {
  const milestone = data.state === "local" ? data.milestones?.find((m) => m.id === params.id) ?? null : null;
  const [title, setTitle] = useState(milestone?.name ?? "");
  const [targetDate, setTargetDate] = useState(milestone?.targetDate ?? "");
  const [description, setDescription] = useState(milestone?.description ?? "");
  const [status, setStatus] = useState(milestone?.status ?? "");
  const { saving, note, save } = useLocalSave(shell);

  if (data.state !== "local") return <StateMessage testId="milestone-edit" title="Milestone" state={data.state} what="milestone" />;
  const projectId = data.projectId;
  if (!milestone) {
    return <StateMessage testId="milestone-edit" title="Milestone" state="not_found" what="milestone" back={{ href: withProject("/schedule?tab=milestones", projectId), label: "Back to the milestones" }} />;
  }
  const m = milestone;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // only what changed is sent, so a field the person did not touch is never overwritten on the server
    await save(() =>
      updateMilestoneOffline(shell.data, {
        projectId, milestoneId: m.id,
        ...(title.trim() !== m.name ? { title } : {}),
        ...(targetDate !== (m.targetDate ?? "") ? { targetDate } : {}),
        ...(description.trim() !== (m.description ?? "") ? { description } : {}),
        ...(status !== (m.status ?? "") ? { status } : {}),
      })
    );
  }

  return (
    <Screen testId="milestone-edit" state="local" title={m.name}>
      <CopyNote testId="milestone-edit-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-2 text-sm"><Waiting on={m.waiting} /></p>
      {!mayWrite(shell) ? (
        <ReadOnlyNote />
      ) : (
        <form onSubmit={submit} className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="milestone-edit-form">
          <label className="block text-sm">
            Title
            <input aria-label="Title" className={fieldClass} value={title} {...textHandlers(setTitle)} required />
          </label>
          <label className="mt-3 block text-sm">
            Target date
            <input aria-label="Target date" type="date" className={fieldClass} value={targetDate} {...textHandlers(setTargetDate)} />
          </label>
          <label className="mt-3 block text-sm">
            Status
            <select aria-label="Status" className={fieldClass} value={status} onChange={(e) => setStatus(e.currentTarget.value)}>
              <option value="">{m.status ? statusWords(m.status) : "Not set"}</option>
              {MILESTONE_STATUSES.filter((s) => s !== m.status).map((s) => <option key={s} value={s}>{statusWords(s)}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            Description
            <textarea aria-label="Description" rows={2} className={fieldClass} value={description} {...textHandlers(setDescription)} />
          </label>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
          <SaveNote note={note} />
        </form>
      )}
      <p className="mt-3 text-sm"><a className={BACK} href={withProject("/schedule?tab=milestones", projectId)}>Back to the milestones</a></p>
    </Screen>
  );
}
