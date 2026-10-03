// LOCAL-FIRST shell route cluster "site / procurement / design" (group 2): RFIs, submittals, punch list, site diary, FF&E, vendors.
// Nav orders 60 to 79. See docs/local-first/ROUTE_TABLE.md.
//
// NOT REGISTERED (no data on the laptop, so the shell's own "not on this laptop yet" fallback already says the true thing):
//   floor-plans, mood-boards, inventory, procurement (requisitions, RFQs, goods receipts), purchase-orders.
// The sync service (projexa-sync) serves 28 project kinds and 9 organisation kinds; none of those modules' tables is among them (see the PR).
// Create paths for RFIs, submittals, punch items and diary entries are real screens (writes through the outbox); /ffe/new and /vendors/new
// carry cost and master data the laptop does not hold, so they are server-only routes (registered so "new" is never read as an id).

import { defineShellRoute, type ShellRoute } from "../types";
import type { ServerOnlyData } from "../modules/DocumentsServerOnlyScreen";
import { loadFfeItemWithVendor } from "../modules/ffe-adapter";
import { loadDiaries, loadDiary, loadFfeItems, loadPunchItem, loadPunchList, loadRfi, loadRfis, loadSubmittal, loadSubmittals } from "../modules/site-records";
import { loadVendor, loadVendors } from "../modules/vendors-adapter";

function serverOnly(pattern: string, title: string, reason: string): ShellRoute<ServerOnlyData> {
  return defineShellRoute<ServerOnlyData>({
    pattern, title,
    load: () => import("../modules/DocumentsServerOnlyScreen"),
    adapter: async (_s, _p, query) => ({ path: pattern, search: query.toString() ? `?${query.toString()}` : "", title, reason }),
  });
}

export const ROUTES: readonly ShellRoute[] = [
  defineShellRoute({
    pattern: "/rfis", title: "RFIs", nav: { label: "RFIs", order: 60 },
    load: () => import("../modules/SiteIssueScreens").then((m) => ({ default: m.RfisListScreen })), adapter: (shell) => loadRfis(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/rfis/new", title: "New RFI",
    load: () => import("../modules/SiteIssueScreens").then((m) => ({ default: m.RfiNewScreen })), adapter: (shell) => loadRfis(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/rfis/:id", title: "RFI",
    load: () => import("../modules/SiteIssueScreens").then((m) => ({ default: m.RfiObjectScreen })), adapter: (shell, params, query) => loadRfi(shell.data, params.id!, query.get("projectId")),
  }),
  defineShellRoute({
    pattern: "/submittals", title: "Submittals", nav: { label: "Submittals", order: 62 },
    load: () => import("../modules/SiteIssueScreens").then((m) => ({ default: m.SubmittalsListScreen })), adapter: (shell) => loadSubmittals(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/submittals/new", title: "New submittal",
    load: () => import("../modules/SiteIssueScreens").then((m) => ({ default: m.SubmittalNewScreen })), adapter: (shell) => loadSubmittals(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/submittals/:id", title: "Submittal",
    load: () => import("../modules/SiteIssueScreens").then((m) => ({ default: m.SubmittalObjectScreen })), adapter: (shell, params, query) => loadSubmittal(shell.data, params.id!, query.get("projectId")),
  }),
  defineShellRoute({
    pattern: "/punch-list", title: "Punch List", nav: { label: "Punch List", order: 64 },
    load: () => import("../modules/SiteIssueScreens").then((m) => ({ default: m.PunchListScreen })), adapter: (shell) => loadPunchList(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/punch-list/new", title: "New punch list item",
    load: () => import("../modules/SiteIssueScreens").then((m) => ({ default: m.PunchItemNewScreen })), adapter: (shell) => loadPunchList(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/punch-list/:id", title: "Punch list item",
    load: () => import("../modules/SiteIssueScreens").then((m) => ({ default: m.PunchItemObjectScreen })), adapter: (shell, params, query) => loadPunchItem(shell.data, params.id!, query.get("projectId")),
  }),
  defineShellRoute({
    pattern: "/site-diary", title: "Site Diary", nav: { label: "Site Diary", order: 66 },
    load: () => import("../modules/SiteDiaryScreens").then((m) => ({ default: m.SiteDiaryListScreen })), adapter: (shell) => loadDiaries(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/site-diary/new", title: "New site diary entry",
    load: () => import("../modules/SiteDiaryScreens").then((m) => ({ default: m.SiteDiaryNewScreen })), adapter: (shell) => loadDiaries(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/site-diary/:id", title: "Site Diary entry",
    load: () => import("../modules/SiteDiaryScreens").then((m) => ({ default: m.SiteDiaryObjectScreen })), adapter: (shell, params, query) => loadDiary(shell.data, params.id!, query.get("projectId")),
  }),
  serverOnly("/ffe/new", "New FF&E item", "A new FF&E item carries cost and price, so it needs a connection."),
  defineShellRoute({
    pattern: "/ffe", title: "FF&E", nav: { label: "FF&E", order: 68 },
    load: () => import("../modules/FfeVendorScreens").then((m) => ({ default: m.FfeListScreen })), adapter: (shell) => loadFfeItems(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/ffe/:id", title: "FF&E item",
    load: () => import("../modules/FfeVendorScreens").then((m) => ({ default: m.FfeObjectScreen })), adapter: (shell, params, query) => loadFfeItemWithVendor(shell.data, params.id!, query.get("projectId")),
  }),
  serverOnly("/vendors/new", "New vendor", "A new vendor is created on the server, so it needs a connection."),
  defineShellRoute({
    pattern: "/vendors", title: "Vendors", nav: { label: "Vendors", order: 70 },
    load: () => import("../modules/FfeVendorScreens").then((m) => ({ default: m.VendorsListScreen })), adapter: (shell) => loadVendors(shell.data),
  }),
  defineShellRoute({
    pattern: "/vendors/:id", title: "Vendor",
    load: () => import("../modules/FfeVendorScreens").then((m) => ({ default: m.VendorObjectScreen })), adapter: (shell, params) => loadVendor(shell.data, params.id!),
  }),
];
