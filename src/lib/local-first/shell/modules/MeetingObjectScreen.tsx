"use client";

// LOCAL-FIRST shell, one meeting: title, when, duration and repeat rule from the laptop's own copy. The agenda, the participants and
// the recorded outcomes are NOT synced: the screen says so (rather than showing empty lists that look like "none"), and rescheduling
// or recording an outcome needs the server.

import type { ShellScreenProps } from "../types";
import type { LocalMeeting, ObjectData } from "./platform-adapter";
import { whenText } from "./platform-format";
import { CopyNote, Facts, NOT_SYNCED, NO_PROJECT, OnlineOnly, StateMessage, projectQuery } from "./DocumentsShared";

const BACK = { href: "/meetings", label: "Back to Meetings" };

export default function MeetingObjectScreen({ data }: ShellScreenProps<ObjectData<LocalMeeting>>) {
  if (data.state === "no_project") return <StateMessage testId="meeting-object" state="no_project" title="Meeting" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="meeting-object" state="not_synced" title="Meeting" back={BACK}>{NOT_SYNCED}</StateMessage>;
  if (data.state === "not_found") {
    return <StateMessage testId="meeting-object" state="not_found" title="Meeting" back={BACK}>This meeting is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</StateMessage>;
  }
  const meeting = data.item;
  return (
    <section data-testid="meeting-object" data-state="local">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={`/meetings${projectQuery(data.projectId)}`}>Meetings</a></p>
      <h1 className="font-heading text-2xl text-px-ink" data-testid="meeting-title">{meeting.title}</h1>
      <CopyNote testId="meeting-copy-note" syncedAt={data.syncedAt} />
      <Facts
        rows={[
          ["When", whenText(meeting.scheduledAt)],
          ["Duration", meeting.durationMinutes ? `${meeting.durationMinutes} min` : "-"],
          ["Repeats", meeting.recurrenceRule ?? "-"],
        ]}
      />
      <OnlineOnly>The agenda, the participants and the recorded outcomes are shown online. Changing the meeting or recording an outcome needs a connection.</OnlineOnly>
    </section>
  );
}
