"use client";

// LOCAL-FIRST shell, Change Orders (/change-orders): the project's change orders from the laptop's own copy, in the online list's columns
// (# | Title | Cost Impact | Schedule Impact | Status). A change order made here and not yet accepted by the server has no number and no
// status of its own: it says "Waiting to be sent". The signature progress of one pending approval is not synced (GAP): the screen says
// it is shown online rather than "no signature request".

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import { changeOrderPendingWord, changeOrderStatusText, scheduleImpactText, type ChangeOrdersListData } from "./design-change-adapter";
import { CoMoney, CopyNote, NOT_SYNCED, NO_PROJECT, OnlineOnly, PendingMark, StateMessage, mayOffer, projectQuery } from "./DesignChangeShared";

export default function ChangeOrdersListScreen({ shell, data }: ShellScreenProps<ChangeOrdersListData>) {
  const project = shell.data.projects.find((p) => p.id === shell.projectId);
  const title = `Change Orders${project ? ` / ${project.name}` : ""}`;
  if (data.state === "no_project") return <StateMessage testId="co-list" state="no_project" title="Change Orders">{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="co-list" state="not_synced" title={title}>{NOT_SYNCED}</StateMessage>;

  const mayCreate = mayOffer(shell.data.role, "create_change_order");
  return (
    <section data-testid="co-list" data-state="local">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-heading text-2xl text-px-ink">{title}</h1>
        {mayCreate ? (
          <a className="rounded-md bg-px-ink px-3 py-1.5 text-sm text-white" data-testid="co-new" href={`/change-orders/new${projectQuery(data.projectId)}`}>New Change Order</a>
        ) : null}
      </div>
      <CopyNote testId="co-copy-note" syncedAt={data.syncedAt} />
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted" data-testid="co-empty">No change orders yet{project ? ` for ${project.name}` : ""}.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Cost Impact</TableHead>
                <TableHead>Schedule Impact</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((co) => (
                <TableRow key={co.id} data-testid="co-row" data-co-id={co.id}>
                  <TableCell className="font-mono text-xs">{co.number !== null ? `CO-${co.number}` : "—"}</TableCell>
                  <TableCell>
                    <a className="font-medium text-px-ink underline-offset-2 hover:underline" href={`/change-orders/${encodeURIComponent(co.id)}${projectQuery(data.projectId)}`}>{co.title}</a>
                    <PendingMark word={changeOrderPendingWord(co)} />
                  </TableCell>
                  <TableCell data-testid="co-cost"><CoMoney value={co.costImpact} hidden={data.costHidden} /></TableCell>
                  <TableCell className="text-px-muted">{scheduleImpactText(co.scheduleImpactDays)}</TableCell>
                  <TableCell className="capitalize" data-testid="co-status">{changeOrderStatusText(co.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <OnlineOnly>The progress of an e-signature request is shown when you are online.</OnlineOnly>
    </section>
  );
}
