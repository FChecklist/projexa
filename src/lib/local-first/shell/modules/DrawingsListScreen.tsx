"use client";

// LOCAL-FIRST shell, Drawings & 3D: the drawing register, read from the laptop's own copy. Columns as online (Name, Drawing No., Rev,
// Kind, Discipline, Status, Added); "Current only" is the default filter, as online. Uploading and the export need a connection.

import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusText } from "@/lib/drawing-status";
import type { ShellScreenProps } from "../types";
import type { DrawingsListData } from "./drawings-adapter";
import { CopyNote, NOT_SYNCED, NO_PROJECT, OnlineOnly, StateMessage, Waiting, dateText, projectQuery } from "./DocumentsShared";
import { FilesWaiting } from "./FilesWaiting";
import { withProject } from "./DeliveryParts";

export default function DrawingsListScreen({ shell, data }: ShellScreenProps<DrawingsListData>) {
  const [currentOnly, setCurrentOnly] = useState(true);
  const project = shell.data.projects.find((p) => p.id === shell.projectId);
  const title = `Drawings & 3D${project ? ` / ${project.name}` : ""}`;
  if (data.state === "no_project") return <StateMessage testId="drawings-list" state="no_project" title="Drawings & 3D">{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="drawings-list" state="not_synced" title={title}>{NOT_SYNCED}</StateMessage>;

  const rows = currentOnly ? data.rows.filter((r) => r.status === "current") : data.rows;
  return (
    <section data-testid="drawings-list" data-state="local">
      <h1 className="font-heading text-2xl text-px-ink">{title}</h1>
      <CopyNote testId="drawings-list-copy-note" syncedAt={data.syncedAt} />
      <label className="mt-3 flex items-center gap-2 text-sm text-px-ink">
        <input type="checkbox" data-testid="drawings-current-only" checked={currentOnly} onChange={(e) => setCurrentOnly(e.target.checked)} />
        Current only
      </label>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted" data-testid="drawings-empty">
          {data.rows.length === 0 ? "No drawings in this project yet." : "No current drawings. Untick \"Current only\" to see every revision."}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Drawing No.</TableHead>
                <TableHead>Rev</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Discipline</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="drawings-list-row" data-doc-id={row.id}>
                  <TableCell>
                    <a className="font-medium text-px-ink underline-offset-2 hover:underline" href={`/drawings/${encodeURIComponent(row.id)}${projectQuery(data.projectId)}`}>{row.name}</a>
                    <Waiting show={row.waiting} />
                  </TableCell>
                  <TableCell>{row.meta.drawingNo ?? "-"}</TableCell>
                  <TableCell>{row.meta.rev ?? "-"}</TableCell>
                  <TableCell>{row.kindLabel}</TableCell>
                  <TableCell>{row.meta.discipline ?? "-"}</TableCell>
                  <TableCell>{statusText(row.status)}</TableCell>
                  <TableCell>{dateText(row.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <OnlineOnly>You can add a drawing here without a connection: it is kept on this laptop and its file is sent when you are connected. <a className="text-px-ink underline underline-offset-2" href={withProject("/drawings/new", data.state === "local" ? data.projectId : null)}>New drawing</a> The register export needs a connection.</OnlineOnly>
      <FilesWaiting shell={shell} kinds={["drawing"]} projectId={data.state === "local" ? data.projectId : null} tick={data} />
    </section>
  );
}
