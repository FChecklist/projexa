"use client";

// LOCAL-FIRST shell, New Timesheet Entry (/design-studio/timesheets/new): the online create screen's fields (Task, Date, Hours, Category),
// its checks and words ("Hours must be more than 0", the day's 24-hour rule counted over this person's hours of that day on the laptop),
// and "Save (2 required: Task, Hours)". Saving keeps the entry on the laptop at once as record_timesheet in the outbox and opens the
// timesheet on that day, where it shows "Waiting to be sent". A ?taskId= that is on the laptop is preselected, as online.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DESIGN_STUDIO_CATEGORIES, saveLabel } from "@/lib/design-studio-timesheet";
import type { ShellScreenProps } from "../types";
import { taskLabel, type TimeEntryNewData } from "./design-change-adapter";
import { notQueuedMessage, recordTimeEntryOffline, validateNewTimeEntry } from "./design-change-writes";
import { NOT_SYNCED, NO_PROJECT, Note, StateMessage, mayOffer, projectQuery, writeAccess } from "./DesignChangeShared";

const BACK = { href: "/design-studio", label: "Back to the timesheet" };

export default function DesignStudioEntryNewScreen({ shell, data }: ShellScreenProps<TimeEntryNewData>) {
  const ready = data.state === "ready" ? data : null;
  const [taskId, setTaskId] = useState(ready?.preselectedTaskId ?? "");
  const [spentOn, setSpentOn] = useState(ready?.today ?? "");
  const [hours, setHours] = useState("");
  const [category, setCategory] = useState<string>(DESIGN_STUDIO_CATEGORIES[0]);
  const [errors, setErrors] = useState<Partial<Record<"issueId" | "hours" | "spentOn", string>>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (data.state === "no_project") return <StateMessage testId="ds-entry-new" state="no_project" title="New Timesheet Entry" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="ds-entry-new" state="not_synced" title="New Timesheet Entry" back={BACK}>{NOT_SYNCED}</StateMessage>;
  const { projectId, tasks, tasksSynced, myHoursByDay } = data;
  const back = { href: `/design-studio${projectQuery(projectId)}`, label: BACK.label };
  if (!mayOffer(shell.data.role, "record_timesheet")) return <StateMessage testId="ds-entry-new" state="role" title="New Timesheet Entry" back={back}>Your role can read timesheets but not log time.</StateMessage>;

  const missing = [...(taskId ? [] : ["Task"]), ...(hours.trim() ? [] : ["Hours"])];

  async function save() {
    const input = { projectId, issueId: taskId, hours, spentOn, activityType: category, otherHoursThatDay: myHoursByDay[spentOn] ?? 0 };
    const errs = validateNewTimeEntry(input);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    const result = await recordTimeEntryOffline(input, writeAccess(shell));
    setBusy(false);
    if (!result.queued) return setNote(notQueuedMessage(result.reason));
    shell.navigate(`/design-studio${projectQuery(projectId)}&day=${spentOn}`);
  }

  const input = "mt-1 block w-full rounded border border-black/20 p-1.5 text-sm";
  const err = (k: "issueId" | "hours" | "spentOn") => (errors[k] ? <p className="mt-1 text-xs text-px-error" data-testid={`ds-new-error-${k}`}>{errors[k]}</p> : null);

  return (
    <section data-testid="ds-entry-new" data-state="ready">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={back.href}>Design Studio</a></p>
      <h1 className="font-heading text-2xl text-px-ink">New Timesheet Entry</h1>
      <form
        className="mt-4 max-w-md space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="block text-sm">Task *
          <select className={input} data-testid="ds-new-task" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">{tasksSynced ? (tasks.length ? "Select a task" : "No tasks on this project") : "This project's tasks are not on this laptop yet"}</option>
            {tasks.map((t) => <option key={t.id} value={t.id}>{taskLabel(t)}</option>)}
          </select>
        </label>
        {err("issueId")}
        <label className="block text-sm">Date<input type="date" className={input} data-testid="ds-new-date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} /></label>
        {err("spentOn")}
        <label className="block text-sm">Hours *<input className={input} data-testid="ds-new-hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></label>
        {err("hours")}
        <label className="block text-sm">Category
          <select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
            {DESIGN_STUDIO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <Button type="submit" size="sm" data-testid="ds-new-save" disabled={busy || missing.length > 0}>{saveLabel(missing)}</Button>
          <a className="px-2 py-1.5 text-sm underline underline-offset-2" href={back.href}>Cancel</a>
        </div>
      </form>
      <Note text={note} />
    </section>
  );
}
