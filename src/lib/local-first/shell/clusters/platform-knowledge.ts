// LOCAL-FIRST shell route cluster "platform and knowledge": Wiki, Meetings, Projects, Workspace, Settings (nav orders 90-99).
//
// NOT REGISTERED, on purpose: GRC, KPIs and the Knowledge Base. The sync service serves no data kind for them (`kpi_entries` is left
// out of the sync, the org-wide knowledge-base pages and every GRC table have no kind), so there is nothing a screen could draw. The
// shell's generic "Not on this laptop yet" already says that calmly (online it opens the server's page), and registering a screen that
// repeats it would add nothing. They start working here the moment the sync service serves their kinds.
//
// /wiki/new and /meetings/new ARE registered, as server-only routes, so that "new" is never read as the id of a page or a meeting.

import { defineShellRoute, type ShellRoute } from "../types";
import type { ServerOnlyData } from "../modules/DocumentsServerOnlyScreen";
import { loadMeetingObject, loadMeetingsList, loadProjectsList, loadSettings, loadWikiList, loadWikiObject, loadWorkspace } from "../modules/platform-adapter";

/** A create screen: opened from the server when online, explained offline. Reads nothing locally. */
function serverOnlyRoute(pattern: string, title: string, reason: string): ShellRoute<ServerOnlyData> {
  return defineShellRoute<ServerOnlyData>({
    pattern,
    title,
    load: () => import("../modules/DocumentsServerOnlyScreen"),
    adapter: async (_shell, _params, query) => {
      const search = query.toString();
      return { path: pattern, search: search ? `?${search}` : "", title, reason };
    },
  });
}

export const ROUTES: readonly ShellRoute[] = [
  serverOnlyRoute("/wiki/new", "New wiki page", "A new page is created on the server, so it needs a connection."),
  serverOnlyRoute("/meetings/new", "New meeting", "A new meeting is created on the server, so it needs a connection."),
  defineShellRoute({
    pattern: "/projects",
    title: "Projects",
    nav: { label: "Projects", order: 90 },
    load: () => import("../modules/ProjectsListScreen"),
    adapter: (shell) => loadProjectsList(shell.data),
  }),
  defineShellRoute({
    pattern: "/workspace/:id",
    title: "Project workspace",
    load: () => import("../modules/WorkspaceScreen"),
    adapter: (shell, params) => loadWorkspace(shell.data, params.id!),
  }),
  defineShellRoute({
    pattern: "/meetings",
    title: "Meetings",
    nav: { label: "Meetings", order: 92 },
    load: () => import("../modules/MeetingsListScreen"),
    adapter: (shell) => loadMeetingsList(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/meetings/:id",
    title: "Meeting",
    load: () => import("../modules/MeetingObjectScreen"),
    adapter: (shell, params, query) => loadMeetingObject(shell.data, params.id!, query.get("projectId")),
  }),
  defineShellRoute({
    pattern: "/wiki",
    title: "Wiki",
    nav: { label: "Wiki", order: 94 },
    load: () => import("../modules/WikiListScreen"),
    adapter: (shell) => loadWikiList(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/wiki/:id",
    title: "Wiki page",
    load: () => import("../modules/WikiObjectScreen"),
    adapter: (shell, params, query) => loadWikiObject(shell.data, params.id!, query.get("projectId")),
  }),
  defineShellRoute({
    pattern: "/settings",
    title: "Settings",
    nav: { label: "Settings", order: 96 },
    load: () => import("../modules/SettingsLocalScreen"),
    adapter: (shell) => loadSettings(shell.data),
  }),
];
