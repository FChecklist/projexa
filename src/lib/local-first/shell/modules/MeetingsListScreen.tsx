"use client";

// LOCAL-FIRST shell, Meetings (the scheduling module): Title, When, Duration from the laptop's own copy, latest first. Creating a
// meeting needs the server. (Minutes of Meetings is a different module: /moms.)

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import type { ListData, LocalMeeting } from "./platform-adapter";
import { whenText } from "./platform-format";
import { CopyNote, NOT_SYNCED, NO_PROJECT, OnlineOnly, StateMessage, projectQuery } from "./DocumentsShared";

export default function MeetingsListScreen({ shell, data }: ShellScreenProps<ListData<LocalMeeting>>) {
  const project = shell.data.projects.find((p) => p.id === shell.projectId);
  const title = `Meetings${project ? ` / ${project.name}` : ""}`;
  if (data.state === "no_project") return <StateMessage testId="meetings-list" state="no_project" title="Meetings">{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="meetings-list" state="not_synced" title={title}>{NOT_SYNCED}</StateMessage>;
  return (
    <section data-testid="meetings-list" data-state="local">
      <h1 className="font-heading text-2xl text-px-ink">{title}</h1>
      <CopyNote testId="meetings-list-copy-note" syncedAt={data.syncedAt} />
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">No meetings scheduled yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>When</TableHead><TableHead>Duration</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id} data-testid="meetings-list-row" data-meeting-id={row.id}>
                  <TableCell><a className="font-medium text-px-ink underline-offset-2 hover:underline" href={`/meetings/${encodeURIComponent(row.id)}${projectQuery(data.projectId)}`}>{row.title}</a></TableCell>
                  <TableCell className="text-px-muted">{whenText(row.scheduledAt)}</TableCell>
                  <TableCell className="text-px-muted">{row.durationMinutes ? `${row.durationMinutes} min` : "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <OnlineOnly>Scheduling a new meeting needs a connection.</OnlineOnly>
    </section>
  );
}
