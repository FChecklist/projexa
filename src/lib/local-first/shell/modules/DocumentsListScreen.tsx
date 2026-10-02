"use client";

// LOCAL-FIRST shell, Documents list: the project's documents (drawings and permits included, as online), read from the laptop's own
// copy. Columns are the online list's (DOCUMENTS_LIST_COLUMNS): Name, Category, Type, Size, Expiry, Added. Uploading needs a connection.

import { useEffect } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import type { DocumentsListData } from "./documents-adapter";
import { pruneKeptFiles } from "./documents-file-prune";
import { CopyNote, NOT_SYNCED, NO_PROJECT, OnlineOnly, StateMessage, Waiting, dateText, projectQuery, sizeText } from "./DocumentsShared";

export default function DocumentsListScreen({ shell, data }: ShellScreenProps<DocumentsListData>) {
  const project = shell.data.projects.find((p) => p.id === shell.projectId);
  const title = `Documents${project ? ` / ${project.name}` : ""}`;
  const syncedProject = data.state === "local" ? data.projectId : null;
  // Kept files of documents no longer on the laptop are dropped (only removes; see documents-file-prune.ts).
  useEffect(() => {
    if (syncedProject) void pruneKeptFiles(shell.data, syncedProject);
  }, [shell.data, syncedProject]);

  if (data.state === "no_project") return <StateMessage testId="documents-list" state="no_project" title="Documents">{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="documents-list" state="not_synced" title={title}>{NOT_SYNCED}</StateMessage>;

  return (
    <section data-testid="documents-list" data-state="local">
      <h1 className="font-heading text-2xl text-px-ink">{title}</h1>
      <CopyNote testId="documents-list-copy-note" syncedAt={data.syncedAt} />
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">No documents in this project yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id} data-testid="documents-list-row" data-doc-id={row.id}>
                  <TableCell>
                    <a className="font-medium text-px-ink underline-offset-2 hover:underline" href={`/documents/${encodeURIComponent(row.id)}${projectQuery(data.projectId)}`}>{row.name}</a>
                    <Waiting show={row.waiting} />
                  </TableCell>
                  <TableCell className="capitalize">{row.category ?? "-"}</TableCell>
                  <TableCell>{row.fileType ?? "-"}</TableCell>
                  <TableCell className="text-right">{sizeText(row.fileSize)}</TableCell>
                  <TableCell>{dateText(row.expiryDate)}</TableCell>
                  <TableCell>{dateText(row.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <OnlineOnly>Uploading a document, and the &quot;Relates to&quot; column, need a connection.</OnlineOnly>
    </section>
  );
}
