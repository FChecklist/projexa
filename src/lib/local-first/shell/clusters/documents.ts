// LOCAL-FIRST shell route cluster "documents": Documents: permits, drawings, documents, minutes of meetings (moms).
// One engineer fills this file; the route table spreads it. Nothing else is shared, so clusters never conflict.
// Use nav orders 40 to 59. See docs/local-first/ROUTE_TABLE.md for how to add a module.
//
// Every screen reads the laptop's own database (modules/documents-records.ts and the four adapters). The create screens (/permits/new,
// /drawings/new, /documents/upload, /moms/new) are NOT converted: each uploads a file or needs data the laptop does not hold. They are
// registered as server-only routes (DocumentsServerOnlyScreen) so that "/permits/new" is never read as the permit whose id is "new": the
// server's page opens when online, a plain sentence explains offline.

import { defineShellRoute, type ShellRoute } from "../types";
import type { ServerOnlyData } from "../modules/DocumentsServerOnlyScreen";
import { loadDocumentObject, loadDocumentsList } from "../modules/documents-adapter";
import { loadDrawingObject, loadDrawingsList } from "../modules/drawings-adapter";
import { loadMomObject, loadMomsList } from "../modules/moms-adapter";
import { loadPermitObject, loadPermitsList } from "../modules/permits-adapter";

/** A create screen: opened from the server when online, explained offline (DocumentsServerOnlyScreen). Reads nothing locally. */
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
  defineShellRoute({
    pattern: "/permits/new", title: "New permit",
    load: () => import("../modules/PermitNewScreen"), adapter: (shell, _params, query) => loadPermitsList(shell.data, shell.projectId, query.get("withinDays")),
  }),
  defineShellRoute({
    pattern: "/drawings/new", title: "New drawing",
    load: () => import("../modules/DrawingNewScreen"), adapter: (shell) => loadDrawingsList(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/documents/upload", title: "Upload document",
    load: () => import("../modules/DocumentNewScreen"), adapter: (shell) => loadDocumentsList(shell.data, shell.projectId),
  }),
  serverOnlyRoute("/moms/new", "New meeting", "A new meeting is created on the server (its number and attendees come from there), so it needs a connection."),
  defineShellRoute({
    pattern: "/permits",
    title: "Permits",
    nav: { label: "Permits", order: 40 },
    load: () => import("../modules/PermitsListScreen"),
    adapter: (shell, _params, query) => loadPermitsList(shell.data, shell.projectId, query.get("withinDays")),
  }),
  defineShellRoute({
    pattern: "/permits/:id",
    title: "Permit",
    load: () => import("../modules/PermitObjectScreen"),
    adapter: (shell, params, query) => loadPermitObject(shell.data, params.id!, query.get("projectId")),
  }),
  defineShellRoute({
    pattern: "/drawings",
    title: "Drawings & 3D",
    nav: { label: "Drawings", order: 44 },
    load: () => import("../modules/DrawingsListScreen"),
    adapter: (shell) => loadDrawingsList(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/drawings/:id",
    title: "Drawing",
    load: () => import("../modules/DrawingObjectScreen"),
    adapter: (shell, params, query) => loadDrawingObject(shell.data, params.id!, query.get("projectId")),
  }),
  defineShellRoute({
    pattern: "/documents",
    title: "Documents",
    nav: { label: "Documents", order: 48 },
    load: () => import("../modules/DocumentsListScreen"),
    adapter: (shell) => loadDocumentsList(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/documents/:id",
    title: "Document",
    load: () => import("../modules/DocumentObjectScreen"),
    adapter: (shell, params, query) => loadDocumentObject(shell.data, params.id!, query.get("projectId")),
  }),
  defineShellRoute({
    pattern: "/moms",
    title: "Minutes of Meetings",
    nav: { label: "MoMs", order: 52 },
    load: () => import("../modules/MomsListScreen"),
    adapter: (shell) => loadMomsList(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/moms/:id",
    title: "Minutes of Meeting",
    load: () => import("../modules/MomObjectScreen"),
    adapter: (shell, params, query) => loadMomObject(shell.data, params.id!, query.get("projectId")),
  }),
];
