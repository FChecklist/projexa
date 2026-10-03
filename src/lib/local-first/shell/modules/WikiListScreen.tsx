"use client";

// LOCAL-FIRST shell, Wiki: the project's pages from the laptop's own copy (Title, Version as online). New pages need the server
// (the screen is registered as server-only), so the laptop says so calmly instead of offering a button that cannot work.

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import type { ListData, LocalWikiPage } from "./platform-adapter";
import { CopyNote, NOT_SYNCED, NO_PROJECT, OnlineOnly, StateMessage, projectQuery } from "./DocumentsShared";

export default function WikiListScreen({ shell, data }: ShellScreenProps<ListData<LocalWikiPage>>) {
  const project = shell.data.projects.find((p) => p.id === shell.projectId);
  const title = `Wiki${project ? ` / ${project.name}` : ""}`;
  if (data.state === "no_project") return <StateMessage testId="wiki-list" state="no_project" title="Wiki">{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="wiki-list" state="not_synced" title={title}>{NOT_SYNCED}</StateMessage>;
  return (
    <section data-testid="wiki-list" data-state="local">
      <h1 className="font-heading text-2xl text-px-ink">{title}</h1>
      <CopyNote testId="wiki-list-copy-note" syncedAt={data.syncedAt} />
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">No pages yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Version</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id} data-testid="wiki-list-row" data-page-id={row.id}>
                  <TableCell><a className="font-medium text-px-ink underline-offset-2 hover:underline" href={`/wiki/${encodeURIComponent(row.id)}${projectQuery(data.projectId)}`}>{row.title}</a></TableCell>
                  <TableCell className="text-px-muted">{row.version === null ? "-" : `v${row.version}`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <OnlineOnly>A new page needs a connection.</OnlineOnly>
    </section>
  );
}
