"use client";

// LOCAL-FIRST shell, one timesheet entry (/design-studio/timesheets/:id): the online object page's facts (task, date, hours, category,
// project, status) from the laptop's own copy, and Submit (submit_timesheet through the outbox) for the designer's own entry in a state
// they can still send. The status stays the server's; "Submit waiting to be sent" shows beside it until the server answers.
//
// NEEDS A CONNECTION (not synced, or no registered function): the entry's TS-number, who logged it by name (unless it is the person's
// own), comments, the reason a manager sent it back, Edit and Delete.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDayLabel, formatHours } from "@/lib/design-studio-timesheet";
import type { ShellScreenProps } from "../types";
import { canSubmitEntry, type TimeEntryObjectData } from "./design-change-adapter";
import { notQueuedMessage, submitTimeEntryOffline } from "./design-change-writes";
import { CopyNote, Facts, NOT_SYNCED, NO_PROJECT, Note, OnlineOnly, StateMessage, keptNote, mayOffer, projectQuery, writeAccess } from "./DesignChangeShared";
import { EntryStatus } from "./DesignStudioTimesheetScreen";

const BACK = { href: "/design-studio", label: "Back to the timesheet" };

export default function DesignStudioEntryScreen({ shell, data }: ShellScreenProps<TimeEntryObjectData>) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (data.state === "no_project") return <StateMessage testId="ds-entry" state="no_project" title="Timesheet entry" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="ds-entry" state="not_synced" title="Timesheet entry" back={BACK}>{NOT_SYNCED}</StateMessage>;
  if (data.state === "not_found") return <StateMessage testId="ds-entry" state="not_found" title="Timesheet entry" back={BACK}>This entry is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</StateMessage>;

  const { entry, projectId } = data;
  const project = shell.data.projects.find((p) => p.id === projectId);
  const mayOfferSubmit = entry.mine && canSubmitEntry(entry) && mayOffer(shell.data.role, "submit_timesheet");

  async function submit() {
    setBusy(true);
    const result = await submitTimeEntryOffline({ projectId, timeEntryId: entry.id }, writeAccess(shell));
    setBusy(false);
    setNote(result.queued ? `Submit for review. ${keptNote(shell)}` : notQueuedMessage(result.reason));
    if (result.queued) shell.refresh();
  }

  return (
    <section data-testid="ds-entry" data-state="local">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={`/design-studio${projectQuery(projectId)}`}>Design Studio</a></p>
      <h1 className="font-heading text-2xl text-px-ink" data-testid="ds-entry-title">{formatHours(entry.hours)} h on {entry.task}</h1>
      <p className="text-sm text-px-muted"><EntryStatus entry={entry} /></p>
      <CopyNote testId="ds-entry-copy-note" syncedAt={data.syncedAt} />
      <Facts
        rows={[
          ["Date", formatDayLabel(entry.spentOn)],
          ["Project", project?.name ?? "—"],
          ["Category", entry.activityType ?? "—"],
          ["Task", entry.task],
          ["Hours", `${formatHours(entry.hours)} h`],
          ["Logged by", entry.mine ? "You" : "Another designer (the name is shown online)"],
        ]}
      />
      {entry.comments ? <p className="mt-4 whitespace-pre-wrap text-sm" data-testid="ds-entry-comments">{entry.comments}</p> : null}
      {entry.approvalStatus === "rejected" ? <p className="mt-4 text-sm text-px-muted" data-testid="ds-entry-sent-back">Your manager sent this entry back. The reason is shown when you are online.</p> : null}
      {entry.localOnly ? <p className="mt-4 text-sm text-px-muted">This entry was made on this laptop. It can be submitted once the server has accepted it.</p> : null}
      {mayOfferSubmit ? (
        <Button className="mt-4" size="sm" data-testid="ds-entry-submit" disabled={busy} onClick={() => void submit()}>{entry.approvalStatus === "rejected" ? "Send again" : "Submit"}</Button>
      ) : null}
      <Note text={note} />
      <OnlineOnly>The entry number, the reason it was sent back, editing and deleting need a connection.</OnlineOnly>
    </section>
  );
}
