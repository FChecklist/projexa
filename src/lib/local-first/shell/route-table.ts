// LOCAL-FIRST shell: the ROUTE TABLE. Every screen the on-laptop shell can draw is one entry here: the app's own path, a lazy-loaded
// client component, and the adapter that reads the local database for it. A path that is not here is opened from the server (when
// the laptop is online) or explained calmly (when it is not): see LocalShell.tsx.
//
// ADDING A MODULE is one file of screens plus ~10 lines below; docs/local-first/ROUTE_TABLE.md has the walk-through.

import { defineShellRoute, type ShellRoute } from "./types";
import { loadScopeList, loadScopeObject } from "./modules/scope-adapter";
import { matchRoute } from "./paths";
import { ROUTES as DELIVERY } from "./clusters/delivery";
import { ROUTES as DOCUMENTS } from "./clusters/documents";
import { ROUTES as DESIGN_CHANGE } from "./clusters/design-change";
import { ROUTES as OVERVIEW } from "./clusters/overview";

export const SHELL_ROUTES: readonly ShellRoute[] = [
  // Scope of Work (BOQ): the first module in the shell.
  defineShellRoute({
    pattern: "/scope",
    title: "Scope of Work (BOQ)",
    nav: { label: "Scope (BOQ)", order: 10 },
    load: () => import("./modules/ScopeListScreen"),
    adapter: (shell) => loadScopeList(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/scope/:id",
    title: "BOQ",
    load: () => import("./modules/ScopeObjectScreen"),
    adapter: async (shell, params, query) => loadScopeObject(shell.data, params.id!, query.get("projectId"), await shell.writer.list()),
  }),
  // One file per cluster of modules, filled by separate engineers (see clusters/*.ts).
  ...OVERVIEW,
  ...DELIVERY,
  ...DOCUMENTS,
  ...DESIGN_CHANGE,
];

/** The screen for an app path, with its parameters; null when the shell does not have one. */
export function findShellRoute(path: string, routes: readonly ShellRoute[] = SHELL_ROUTES) {
  return matchRoute(routes, path);
}

/** The routes that appear as links in the header, in order. */
export function navRoutes(routes: readonly ShellRoute[] = SHELL_ROUTES): { href: string; label: string }[] {
  return routes
    .filter((r): r is ShellRoute & { nav: { label: string; order: number } } => Boolean(r.nav) && !r.pattern.includes(":"))
    .sort((a, b) => a.nav.order - b.nav.order)
    .map((r) => ({ href: r.pattern, label: r.nav.label }));
}
