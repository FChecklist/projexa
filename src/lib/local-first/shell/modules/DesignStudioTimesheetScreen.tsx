"use client";

// LOCAL-FIRST shell, Design Studio (/design-studio): MY timesheet for the project, from the laptop's own copy -- the online day grid in
// Sumeet's columns (Date | Project | Category | Task | Hours | Status), the week view as a filter over the same rows (the seven days ending
// on the chosen day, as online), the inline "Add entry" row, Submit per row and "Submit day". The words are the online module's own
// (design-studio-timesheet.ts: "Total today: 7.50 h", "Submit today (4 rows, 7.50 h)", "No hours logged for 2 Sep 2026. Add a row below.").
//
// WRITES (outbox, sent when the laptop can reach the server): Add entry = record_timesheet; Submit = submit_timesheet; Submit day = one
// submit_timesheet per entry of the day the designer can still send. A status is never changed here: a submitted row keeps the server's
// word, with "Submit waiting to be sent" beside it. An entry made here is submitted once the server has accepted it.
//
// NEEDS A CONNECTION: the designer-wise status strip (needs designer names, not synced), comments on a new row (record_timesheet takes
// none), the reviewer's task that the online "Submit day" also creates (no registered function), Export, and logging time on another
// project from this row (switch project in the header instead: only the selected project's tasks are read here).

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DESIGN_STUDIO_CATEGORIES, dayTotalLabel, emptyDayMessage, formatDayLabel, formatHours, rowStatus, submitDayLabel, totalHours,
} from "@/lib/design-studio-timesheet";
import type { ShellScreenProps } from "../types";
import { canSubmitEntry, entriesInView, entryStatusWord, taskLabel, type EntryView, type TimesheetData } from "./design-change-adapter";
import { notQueuedMessage, recordTimeEntryOffline, submitTimeEntryOffline, validateNewTimeEntry } from "./design-change-writes";
import { CopyNote, NOT_SYNCED, NO_PROJECT, Note, OnlineOnly, PendingMark, StateMessage, keptNote, mayOffer, projectQuery, textInput, writeAccess } from "./DesignChangeShared";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function EntryStatus({ entry }: { entry: Pick<EntryView, "approvalStatus" | "localOnly" | "waitingOn" | "trouble"> }) {
  const pending = entryStatusWord(entry);
  if (entry.approvalStatus === null) return <PendingMark word={pending ?? "Waiting to be sent"} />;
  return (
    <span data-testid="dc-entry-status">
      {rowStatus(entry.approvalStatus).label}
      <PendingMark word={pending} />
    </span>
  );
}

export default function DesignStudioTimesheetScreen({ shell, query, data }: ShellScreenProps<TimesheetData>) {
  const asked = query.get("day");
  const [day, setDay] = useState(asked && DAY_RE.test(asked) ? asked : data.state === "local" ? data.today : "");
  const [view, setView] = useState<"day" | "week">(query.get("view") === "week" ? "week" : "day");
  const [category, setCategory] = useState<string>(DESIGN_STUDIO_CATEGORIES[0]);
  const [taskId, setTaskId] = useState("");
  const [hours, setHours] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"issueId" | "hours" | "spentOn", string>>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const entries = data.state === "local" ? data.entries : [];
  const visible = useMemo(() => entriesInView(entries, view, day), [entries, view, day]);
  const dayEntries = useMemo(() => entries.filter((e) => e.spentOn === day), [entries, day]);

  const project = shell.data.projects.find((p) => p.id === shell.projectId);
  const title = `Design Studio${project ? ` / ${project.name}` : ""} / Timesheet`;
  if (data.state === "no_project") return <StateMessage testId="ds-timesheet" state="no_project" title="Design Studio">{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="ds-timesheet" state="not_synced" title={title}>{NOT_SYNCED}</StateMessage>;

  const { projectId, today } = data;
  const projectName = project?.name ?? "This project";
  const mayLog = mayOffer(shell.data.role, "record_timesheet");
  const maySubmit = mayOffer(shell.data.role, "submit_timesheet");
  const sendable = dayEntries.filter(canSubmitEntry);

  async function addRow() {
    const input = { projectId, issueId: taskId, hours, spentOn: day, activityType: category, otherHoursThatDay: totalHours(dayEntries) };
    const errs = validateNewTimeEntry(input);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    const result = await recordTimeEntryOffline(input, writeAccess(shell));
    setBusy(false);
    if (!result.queued) return setNote(notQueuedMessage(result.reason));
    setHours("");
    setNote(`${formatHours(hours)} h on ${formatDayLabel(day)}. ${keptNote(shell)}`);
    shell.refresh();
  }

  async function submit(list: EntryView[]) {
    setBusy(true);
    let kept = 0;
    let refused: string | null = null;
    for (const e of list) {
      const result = await submitTimeEntryOffline({ projectId, timeEntryId: e.id }, writeAccess(shell));
      if (result.queued) kept++;
      else refused = notQueuedMessage(result.reason);
    }
    setBusy(false);
    setNote(kept > 0 ? `${kept} row${kept === 1 ? "" : "s"} to submit for review. ${keptNote(shell)}` : refused);
    shell.refresh();
  }

  const select = "w-full rounded border border-black/20 p-1.5 text-sm";
  const taskPlaceholder = !data.tasksSynced ? "This project's tasks are not on this laptop yet" : data.tasks.length === 0 ? `No tasks on ${projectName}` : "Select a task";

  return (
    <section data-testid="ds-timesheet" data-state="local">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-heading text-2xl text-px-ink">{title}</h1>
        <nav className="flex gap-3 text-sm">
          <a className="underline underline-offset-2" href={`/design-studio/timesheets/new${projectQuery(projectId)}`}>New</a>
          <a className="underline underline-offset-2" href={`/design-studio/review${projectQuery(projectId)}`}>Review</a>
          <a className="underline underline-offset-2" href={`/design-studio/cost-analysis${projectQuery(projectId)}`}>Cost analysis</a>
        </nav>
      </div>
      <CopyNote testId="ds-copy-note" syncedAt={data.syncedAt} />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">Day<input type="date" className="mt-1 block w-44 rounded border border-black/20 p-1.5 text-sm" data-testid="ds-day" value={day} {...textInput((v) => DAY_RE.test(v) && setDay(v))} /></label>
        <label className="text-sm">View
          <select className="mt-1 block w-40 rounded border border-black/20 p-1.5 text-sm" data-testid="ds-view" value={view} onChange={(e) => setView(e.target.value === "week" ? "week" : "day")}>
            <option value="day">This day</option>
            <option value="week">This week</option>
          </select>
        </label>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="sr-only">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((e) => (
              <TableRow key={e.id} data-testid="ds-row" data-entry-id={e.id}>
                <TableCell>{formatDayLabel(e.spentOn)}</TableCell>
                <TableCell>{projectName}</TableCell>
                <TableCell>{e.activityType ?? "-"}</TableCell>
                <TableCell><a className="underline-offset-2 hover:underline" href={`/design-studio/timesheets/${encodeURIComponent(e.id)}${projectQuery(projectId)}`}>{e.task}</a></TableCell>
                <TableCell>{formatHours(e.hours)}</TableCell>
                <TableCell><EntryStatus entry={e} /></TableCell>
                <TableCell className="text-right">
                  {maySubmit && canSubmitEntry(e) ? (
                    <Button size="sm" variant="outline" data-testid="ds-submit-row" disabled={busy} onClick={() => void submit([e])}>{e.approvalStatus === "rejected" ? "Send again" : "Submit"}</Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-px-muted" data-testid="ds-empty">{emptyDayMessage(day)}</TableCell>
              </TableRow>
            ) : null}
            {mayLog ? (
              <TableRow data-testid="ds-add-row">
                <TableCell>{formatDayLabel(day)}</TableCell>
                <TableCell>{projectName}</TableCell>
                <TableCell>
                  <select aria-label="Category" className={select} value={category} onChange={(e) => setCategory(e.target.value)}>
                    {DESIGN_STUDIO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </TableCell>
                <TableCell>
                  <select aria-label="Task" className={select} data-testid="ds-task" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                    <option value="">{taskPlaceholder}</option>
                    {data.tasks.map((t) => <option key={t.id} value={t.id}>{taskLabel(t)}</option>)}
                  </select>
                  {errors.issueId ? <p className="mt-1 text-xs text-px-error">{errors.issueId}</p> : null}
                </TableCell>
                <TableCell>
                  <input aria-label="Hours" className="w-24 rounded border border-black/20 p-1.5 text-sm" data-testid="ds-hours" inputMode="decimal" value={hours} {...textInput(setHours)} />
                  {errors.hours ? <p className="mt-1 text-xs text-px-error" data-testid="ds-hours-error">{errors.hours}</p> : null}
                </TableCell>
                <TableCell />
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" data-testid="ds-add" disabled={busy} onClick={() => void addRow()}>Add entry</Button>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {maySubmit ? (
          <Button data-testid="ds-submit-day" disabled={busy || sendable.length === 0} title={sendable.length === 0 ? "Add at least one entry for this day first" : undefined} onClick={() => void submit(sendable)}>
            {submitDayLabel(sendable.length, totalHours(sendable), day, today)}
          </Button>
        ) : null}
        <span className="ml-auto text-sm font-medium text-px-ink" data-testid="ds-day-total">{dayTotalLabel(totalHours(dayEntries), day, today)}</span>
      </div>
      <Note text={note} />
      <OnlineOnly>The designer-wise status, comments on a new row, the reviewer&apos;s task for a submitted day, and Export need a connection.</OnlineOnly>
    </section>
  );
}
