"use client";

// LOCAL-FIRST shell, Permits: the project's permits, read from the laptop's own copy, soonest end date first, with the online list's own
// status words (permitStatus). ?withinDays=N (the dashboard's "expiring" link) narrows the list as online. Recording a permit needs a
// connection (the online form uploads its PDF).

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { permitStatus } from "@/components/permit-status";
import type { ShellScreenProps } from "../types";
import type { PermitsListData } from "./permits-adapter";
import { CopyNote, NOT_SYNCED, NO_PROJECT, OnlineOnly, StateMessage, Waiting, dateText, projectQuery } from "./DocumentsShared";
import { FilesWaiting } from "./FilesWaiting";
import { withProject } from "./DeliveryParts";

export default function PermitsListScreen({ shell, data }: ShellScreenProps<PermitsListData>) {
  const project = shell.data.projects.find((p) => p.id === shell.projectId);
  const title = `Permits${project ? ` / ${project.name}` : ""}`;
  if (data.state === "no_project") return <StateMessage testId="permits-list" state="no_project" title="Permits">{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="permits-list" state="not_synced" title={title}>{NOT_SYNCED}</StateMessage>;

  return (
    <section data-testid="permits-list" data-state="local">
      <h1 className="font-heading text-2xl text-px-ink">{title}</h1>
      <CopyNote testId="permits-list-copy-note" syncedAt={data.syncedAt} />
      {data.withinDays !== null ? (
        <p className="mt-2 text-sm text-px-ink" data-testid="permits-within">
          Showing permits that end within {data.withinDays} days (expired ones included). <a className="underline underline-offset-2" href={`/permits${projectQuery(data.projectId)}`}>Show all</a>
        </p>
      ) : null}
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">{data.withinDays !== null ? "No permits end in that window." : "No permits in this project yet."}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Permit number</TableHead>
                <TableHead>Permit name</TableHead>
                <TableHead>Issuing authority</TableHead>
                <TableHead>Issue date</TableHead>
                <TableHead>End date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id} data-testid="permits-list-row" data-doc-id={row.id}>
                  <TableCell>{row.permitNumber ?? "-"}</TableCell>
                  <TableCell>
                    <a className="font-medium text-px-ink underline-offset-2 hover:underline" href={`/permits/${encodeURIComponent(row.id)}${projectQuery(data.projectId)}`}>{row.name}</a>
                    <Waiting show={row.waiting} />
                  </TableCell>
                  <TableCell>{row.permitAuthority ?? "-"}</TableCell>
                  <TableCell>{dateText(row.issueDate)}</TableCell>
                  <TableCell>{dateText(row.endDate)}</TableCell>
                  <TableCell data-testid="permit-status">{permitStatus(row.daysToExpiry).label}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <OnlineOnly>You can record a new permit here without a connection: the permit is kept on this laptop and its PDF is sent when you are connected. <a className="text-px-ink underline underline-offset-2" href={withProject("/permits/new", data.state === "local" ? data.projectId : null)}>New permit</a></OnlineOnly>
      <FilesWaiting shell={shell} kinds={["permit"]} projectId={data.state === "local" ? data.projectId : null} tick={data} />
    </section>
  );
}
