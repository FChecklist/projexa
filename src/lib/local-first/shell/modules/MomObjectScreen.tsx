"use client";

// LOCAL-FIRST shell, one Minutes of Meeting: details, agenda and minutes from the laptop's own copy, and "Amend the minutes" offline
// (update_mom_minutes through the outbox; the amendment is shown at once and marked "Waiting to sync"). Published minutes are locked, as
// online. Attendee names, action items, the AI summary, share links, publish, edit details and the PDF need a connection (not synced, or
// no registered function).

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format-date";
import type { ShellScreenProps } from "../types";
import { isPublished, type MomObjectData } from "./moms-adapter";
import { amendMinutesOffline, canProposeEdits } from "./documents-writes";
import { CopyNote, Facts, NOT_SYNCED, NO_PROJECT, OnlineOnly, StateMessage, Waiting, dateText, projectQuery } from "./DocumentsShared";

const BACK = { href: "/moms", label: "Back to Minutes of Meetings" };

export default function MomObjectScreen({ shell, data }: ShellScreenProps<MomObjectData>) {
  const [editing, setEditing] = useState(false);
  // The minutes box is uncontrolled (read at Save): long free text, no re-render per keystroke.
  const minutesRef = useRef<HTMLTextAreaElement | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (data.state === "no_project") return <StateMessage testId="mom-object" state="no_project" title="Minutes of Meeting" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="mom-object" state="not_synced" title="Minutes of Meeting" back={BACK}>{NOT_SYNCED}</StateMessage>;
  if (data.state === "not_found") return <StateMessage testId="mom-object" state="not_found" title="Minutes of Meeting" back={BACK}>This meeting is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</StateMessage>;

  const { mom, projectId } = data;
  const locked = isPublished(mom);
  const mayAmend = !locked && canProposeEdits(shell.data.role);

  async function save() {
    const draft = minutesRef.current?.value ?? "";
    if (draft === (mom.minutes ?? "")) {
      setEditing(false);
      return setNote("Nothing was changed.");
    }
    setSaving(true);
    const result = await amendMinutesOffline(shell.data, { projectId, meetingId: mom.id, minutes: draft });
    setSaving(false);
    if (!result.ok) return setNote(result.message);
    setEditing(false);
    setNote(shell.connectivity === "online" ? "Saved on this laptop and being sent." : "Saved on this laptop. It will be sent to the server when you are connected.");
    shell.refresh();
  }

  return (
    <section data-testid="mom-object" data-state="local">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={`/moms${projectQuery(projectId)}`}>Minutes of Meetings</a></p>
      <h1 className="font-heading text-2xl text-px-ink" data-testid="mom-title">{mom.title}<Waiting show={mom.waiting} /></h1>
      <p className="text-sm capitalize text-px-muted" data-testid="mom-status">{mom.status ?? "-"}{locked ? " · locked" : ""}</p>
      <CopyNote testId="mom-copy-note" syncedAt={data.syncedAt} />
      <Facts
        rows={[
          ["When", mom.scheduledAt && Number.isFinite(Date.parse(mom.scheduledAt)) ? formatDateTime(mom.scheduledAt) : "-"],
          ["Type", mom.meetingType ?? "-"],
          ["Published", dateText(mom.publishedAt)],
          ["Attendees", mom.attendeeCount === null ? "-" : `${mom.attendeeCount} invited (names are shown online)`],
        ]}
      />
      <div className="mt-5">
        <h2 className="text-sm font-medium text-px-ink">Agenda</h2>
        {mom.agenda && mom.agenda.length > 0 ? (
          <ol className="mt-1 list-decimal pl-5 text-sm" data-testid="mom-agenda">{mom.agenda.map((a, i) => <li key={i}>{a}</li>)}</ol>
        ) : (
          <p className="mt-1 text-sm text-px-muted">No agenda on this laptop.</p>
        )}
      </div>
      <div className="mt-5">
        <h2 className="text-sm font-medium text-px-ink">Minutes</h2>
        {editing ? (
          <form
            data-testid="mom-amend-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <textarea className="mt-1 h-48 w-full rounded border border-black/20 p-2 text-sm" data-testid="mom-minutes-input" ref={minutesRef} defaultValue={mom.minutes ?? ""} />
            <div className="mt-2 flex gap-2">
              <Button type="submit" size="sm" data-testid="mom-amend-save" disabled={saving}>Save</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <>
            <p className="mt-1 whitespace-pre-wrap text-sm" data-testid="mom-minutes">{mom.minutes ?? "No minutes recorded yet."}</p>
            {mayAmend ? (
              <Button
                className="mt-2"
                variant="outline"
                size="sm"
                data-testid="mom-amend-open"
                onClick={() => setEditing(true)}
              >
                Amend the minutes
              </Button>
            ) : null}
            {locked ? <p className="mt-2 text-xs text-px-muted" data-testid="mom-locked">These minutes are published and locked.</p> : null}
          </>
        )}
        {note ? <p className="mt-2 text-xs text-px-muted" data-testid="mom-note">{note}</p> : null}
      </div>
      <OnlineOnly>Attendee names, action items, the AI summary, share links, editing the details, publishing and the PDF need a connection.</OnlineOnly>
    </section>
  );
}
