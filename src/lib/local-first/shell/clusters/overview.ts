// LOCAL-FIRST shell route cluster "overview": Overview: dashboard, reports, analysis.
// One engineer fills this file; the route table spreads it. Nothing else is shared, so clusters never conflict.
// Use nav orders 0 to 9 for the dashboard, 80 to 99 for the rest. See docs/local-first/ROUTE_TABLE.md for how to add one.
//
// These screens show numbers the SERVER computes. The laptop keeps the last server answer (shell/snapshot-cache.ts) and shows it
// "As of ..., from this laptop"; only non-money counts the replica answers exactly are worked out here (modules/dashboard-facts.ts).

import { defineShellRoute, type ShellApi, type ShellRoute } from "../types";
import { loadDashboard } from "../modules/dashboard-adapter";
import { loadReports } from "../modules/reports-adapter";
import { loadAnalysisHub, loadExceptions, loadProject360 } from "../modules/analysis-adapter";

const dashboardAdapter = async (shell: ShellApi) =>
  loadDashboard(shell.data, shell.projectId, { shellEdits: (await shell.writer.list().catch(() => [])).length });

export const ROUTES: readonly ShellRoute[] = [
  defineShellRoute({
    pattern: "/dashboard",
    title: "Dashboard",
    nav: { label: "Dashboard", order: 0 },
    load: () => import("../modules/DashboardLocalScreen"),
    adapter: dashboardAdapter,
  }),
  // The online project dashboard reads the same endpoint; on the laptop it is the same screen.
  defineShellRoute({
    pattern: "/dashboard/project",
    title: "Project dashboard",
    load: () => import("../modules/DashboardLocalScreen"),
    adapter: dashboardAdapter,
  }),
  defineShellRoute({
    pattern: "/reports",
    title: "Reports",
    nav: { label: "Reports", order: 80 },
    load: () => import("../modules/ReportsLocalScreen"),
    adapter: (shell, _params, query) => loadReports(shell.data, shell.projectId, query),
  }),
  defineShellRoute({
    pattern: "/analysis",
    title: "Analysis",
    nav: { label: "Analysis", order: 81 },
    load: () => import("../modules/AnalysisHubScreen"),
    adapter: async (shell) => loadAnalysisHub(shell.projectId),
  }),
  defineShellRoute({
    pattern: "/analysis/exceptions",
    title: "Exceptions",
    load: () => import("../modules/ExceptionsLocalScreen"),
    adapter: (shell) => loadExceptions(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/analysis/project-360",
    title: "Project 360 Analysis",
    load: () => import("../modules/Project360LocalScreen"),
    adapter: (shell) => loadProject360(shell.data, shell.projectId),
  }),
];
