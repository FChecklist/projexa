// LOCAL-FIRST shell, Workspace: which sections of the one-project workspace a ROLE sees, and the shell screen each one opens.
// The visibility rule is the online page's own (src/lib/workspace-visibility.ts, a pure function): the laptop adds no rule of its own,
// so a role that does not see a section online gets no link to it here. A section whose screen is not on the laptop yet still has a
// link: the shell opens the server's page when online and says plainly "not on this laptop yet" when offline.

import { WORKSPACE_SECTIONS, visibleWorkspaceSections, type WorkspaceSectionKey } from "@/lib/workspace-visibility";

/** Where each workspace section lives as its own screen (the module page the online workspace embeds). */
export const SECTION_PATH: Record<WorkspaceSectionKey, string> = {
  progress: "/work-progress",
  "site-diary": "/site-diary",
  boq: "/scope",
  timeline: "/schedule",
  milestones: "/schedule",
  "scope-change-orders": "/change-orders",
  rfis: "/rfis",
  "billing-milestones": "/billing-milestones",
  resources: "/materials",
  records: "/documents",
  insights: "/analysis",
};

export type WorkspaceLink = { key: WorkspaceSectionKey; label: string; href: string };

/** The sections `role` may see, in the online order, each as a link carrying the project. A null or unknown role sees none. */
export function workspaceLinks(role: string | null, projectId: string): WorkspaceLink[] {
  const visible = new Set<WorkspaceSectionKey>(visibleWorkspaceSections(role));
  return WORKSPACE_SECTIONS.filter((s) => visible.has(s.key)).map((s) => ({ key: s.key, label: s.label, href: `${SECTION_PATH[s.key]}?projectId=${encodeURIComponent(projectId)}` }));
}
