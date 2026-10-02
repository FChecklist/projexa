"use client";

// LOCAL-FIRST shell, Scope of Work (BOQ) list: the BOQs of the selected project, read from the laptop's own copy.

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAmount } from "@/lib/boq-helpers";
import { revisionLabel } from "@/lib/boq-lineage";
import { formatDateTime } from "@/lib/format-date";
import type { ShellScreenProps } from "../types";
import type { ScopeListData } from "./scope-adapter";

export default function ScopeListScreen({ shell, data }: ShellScreenProps<ScopeListData>) {
  const project = shell.data.projects.find((p) => p.id === shell.projectId);

  if (data.state === "no_project") {
    return (
      <section data-testid="scope-list" data-state="no_project">
        <h1 className="font-heading text-2xl text-px-ink">Scope of Work (BOQ)</h1>
        <p className="mt-3 text-sm text-px-muted">There is no project on this laptop yet. Open PROJEXA once while you are online and your projects will be copied here.</p>
      </section>
    );
  }
  if (data.state === "not_synced") {
    return (
      <section data-testid="scope-list" data-state="not_synced">
        <h1 className="font-heading text-2xl text-px-ink">Scope of Work (BOQ){project ? ` / ${project.name}` : ""}</h1>
        <p className="mt-3 text-sm text-px-muted">This project has not finished copying to this laptop yet. It will appear here as soon as it has, while you are online.</p>
      </section>
    );
  }

  return (
    <section data-testid="scope-list" data-state="local">
      <h1 className="font-heading text-2xl text-px-ink">Scope of Work (BOQ){project ? ` / ${project.name}` : ""}</h1>
      <p className="mt-1 text-xs text-px-muted" data-testid="scope-list-copy-note">
        Saved on this laptop{data.syncedAt ? ` · last copied ${formatDateTime(data.syncedAt)}` : ""}
      </p>
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">No BOQ in this project yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>BOQ</TableHead>
                <TableHead>Revision</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id} data-testid="scope-list-row">
                  <TableCell>
                    <a className="font-medium text-px-ink underline-offset-2 hover:underline" href={`/scope/${encodeURIComponent(row.id)}?projectId=${encodeURIComponent(data.projectId)}`}>
                      {row.title}
                    </a>
                  </TableCell>
                  <TableCell>{revisionLabel(row.version)}</TableCell>
                  <TableCell className="capitalize">{row.status}</TableCell>
                  <TableCell className="text-right">{row.lineCount}</TableCell>
                  <TableCell className="text-right">{formatAmount(row.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
