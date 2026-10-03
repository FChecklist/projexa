"use client";

// LOCAL-FIRST shell, Project workspace (/workspace/:id): the project's name and facts from the laptop's own copy, and one link per
// section THIS ROLE sees online (workspace-links.ts: the online page's own visibility rule). Each section opens as its own screen,
// from the laptop where it has one. The completion badge and every embedded figure are server-computed and are not drawn here.

import type { ShellScreenProps } from "../types";
import type { WorkspaceData } from "./platform-adapter";
import { dayText } from "./platform-format";
import { workspaceLinks } from "./workspace-links";
import { Facts, OnlineOnly, StateMessage } from "./DocumentsShared";

const BACK = { href: "/projects", label: "Back to Projects" };

export default function WorkspaceScreen({ shell, data }: ShellScreenProps<WorkspaceData>) {
  if (data.state === "not_found") {
    return <StateMessage testId="workspace" state="not_found" title="Project workspace" back={BACK}>This project is not on this laptop, or you do not have access to it.</StateMessage>;
  }
  const links = workspaceLinks(shell.data.role, data.projectId);
  const p = data.project;
  return (
    <section data-testid="workspace" data-state="local">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href="/projects">Projects</a></p>
      <h1 className="font-heading text-2xl text-px-ink" data-testid="workspace-title">{data.name}</h1>
      <p className="mt-1 text-xs text-px-muted">Saved on this laptop</p>
      {p ? (
        <Facts rows={[["Status", p.status ?? "-"], ["Health", p.health ?? "-"], ["Starts", dayText(p.startDate)], ["Target", dayText(p.targetDate)]]} />
      ) : (
        <p className="mt-3 text-sm text-px-muted" data-testid="workspace-not-copied">This project&apos;s details have not finished copying to this laptop yet.</p>
      )}
      <nav className="mt-6" aria-label="Workspace sections">
        {links.length === 0 ? (
          <p className="text-sm text-px-muted" data-testid="workspace-no-sections">Your role has no workspace sections.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" data-testid="workspace-sections">
            {links.map((l) => (
              <li key={l.key}>
                <a data-testid="workspace-section" data-section={l.key} className="inline-block rounded-full border border-black/15 px-3 py-1 text-sm text-px-ink hover:border-px-teal" href={l.href}>{l.label}</a>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <OnlineOnly>The completion figure, the combined one-page view and printing it are shown online.</OnlineOnly>
    </section>
  );
}
