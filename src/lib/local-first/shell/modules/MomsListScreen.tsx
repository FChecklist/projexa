"use client";

// LOCAL-FIRST shell, Minutes of Meetings: the project's MoMs, read from the laptop's own copy, latest first. Columns as online where the
// laptop has the data (Meeting, Date & time, Attendees as a count, Status); "Open actions" is not synced and is not shown as zero.

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format-date";
import type { ShellScreenProps } from "../types";
import type { MomsListData } from "./moms-adapter";
import { CopyNote, NOT_SYNCED, NO_PROJECT, OnlineOnly, StateMessage, Waiting, projectQuery } from "./DocumentsShared";

export default function MomsListScreen({ shell, data }: ShellScreenProps<MomsListData>) {
  const project = shell.data.projects.find((p) => p.id === shell.projectId);
  const title = `Minutes of Meetings${project ? ` / ${project.name}` : ""}`;
  if (data.state === "no_project") return <StateMessage testId="moms-list" state="no_project" title="Minutes of Meetings">{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="moms-list" state="not_synced" title={title}>{NOT_SYNCED}</StateMessage>;

  return (
    <section data-testid="moms-list" data-state="local">
      <h1 className="font-heading text-2xl text-px-ink">{title}</h1>
      <CopyNote testId="moms-list-copy-note" syncedAt={data.syncedAt} />
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">No meetings in this project yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Meeting</TableHead>
                <TableHead>Date &amp; time</TableHead>
                <TableHead className="text-right">Attendees</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id} data-testid="moms-list-row" data-mom-id={row.id}>
                  <TableCell>
                    <a className="font-medium text-px-ink underline-offset-2 hover:underline" href={`/moms/${encodeURIComponent(row.id)}${projectQuery(data.projectId)}`}>{row.title}</a>
                    <Waiting show={row.waiting} />
                  </TableCell>
                  <TableCell>{row.scheduledAt && Number.isFinite(Date.parse(row.scheduledAt)) ? formatDateTime(row.scheduledAt) : "-"}</TableCell>
                  <TableCell className="text-right">{row.attendeeCount ?? "-"}</TableCell>
                  <TableCell className="capitalize">{row.status ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <OnlineOnly>A new meeting, open action items and the PDF export need a connection.</OnlineOnly>
    </section>
  );
}
