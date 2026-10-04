"use client";

// LOCAL-FIRST shell, Projects: every project this person has on the laptop. Name, status, health and dates come from the `project`
// kind where it was copied; the project value is the server's stored figure, printed only when the server sent it for this role.
// NOT shown (the server computes them from the BOQ and the laptop never does): "% complete" and "Contract value".

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import type { ProjectsListData } from "./platform-adapter";
import { formatInBase } from "./org-masters";
import { dayText } from "./platform-format";
import { NO_PROJECT, OnlineOnly, StateMessage } from "./DocumentsShared";

const label = (v: string | null) => (v ? v.replace(/_/g, " ") : "-");

export default function ProjectsListScreen({ data }: ShellScreenProps<ProjectsListData>) {
  if (data.state === "no_project") return <StateMessage testId="projects-list" state="no_project" title="Projects">{NO_PROJECT}</StateMessage>;
  const anyValue = data.entries.some((e) => e.project?.projectValue != null);
  return (
    <section data-testid="projects-list" data-state="local">
      <h1 className="font-heading text-2xl text-px-ink">Projects</h1>
      <p className="mt-1 text-xs text-px-muted">Saved on this laptop</p>
      <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Starts</TableHead>
              <TableHead>Target</TableHead>
              {anyValue ? <TableHead className="text-right">Project value</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entries.map((e) => {
              const p = e.project;
              const value = p?.projectValue != null ? formatInBase(p.projectValue, data.currency) ?? String(p.projectValue) : "-";
              return (
                <TableRow key={e.id} data-testid="projects-list-row" data-project-id={e.id} data-copied={p ? "1" : "0"}>
                  <TableCell>
                    <a className="font-medium text-px-ink underline-offset-2 hover:underline" href={`/workspace/${encodeURIComponent(e.id)}`}>{e.name}</a>
                    {p ? null : <span className="ml-2 text-xs text-px-muted">details not copied yet</span>}
                  </TableCell>
                  <TableCell className="capitalize">{label(p?.status ?? null)}</TableCell>
                  <TableCell className="capitalize">{label(p?.health ?? null)}</TableCell>
                  <TableCell>{dayText(p?.startDate ?? null)}</TableCell>
                  <TableCell>{dayText(p?.targetDate ?? null)}</TableCell>
                  {anyValue ? <TableCell className="text-right">{value}</TableCell> : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <OnlineOnly>% complete, contract value and creating a project are shown online.</OnlineOnly>
    </section>
  );
}
