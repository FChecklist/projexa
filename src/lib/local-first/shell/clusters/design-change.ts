// LOCAL-FIRST shell route cluster "design-change": Design and change: design studio, change orders.
// One engineer fills this file; the route table spreads it. Nothing else is shared, so clusters never conflict.
// Use nav orders 60 to 79. See docs/local-first/ROUTE_TABLE.md for how to add a module.
//
// Every adapter reads the laptop's own database only (modules/design-change-adapter.ts). Writes go through modules/design-change-writes.ts
// (the outbox): create_change_order, submit_change_order_for_approval, record_timesheet, submit_timesheet, approve_timesheet,
// reject_timesheet. Static paths win over ":param" paths (paths.ts matchRoute), so /change-orders/new is never read as an id.
//
// Converted: the VISIBLE modules of the catalogue, Change Orders and the Design Studio (its timesheet, entries, log time, review).
// FF&E, mood boards and floor plans are hidden modules (module-catalogue.ts `hidden: true`) and are not converted here.
// Cost analysis stays on the server (DesignChangeServerOnlyScreen): it is a money report the laptop does not hold.

import { todayIso } from "@/lib/design-studio-timesheet";
import { defineShellRoute, type ShellRoute } from "../types";
import type { DesignChangeServerOnlyData } from "../modules/DesignChangeServerOnlyScreen";
import {
  loadChangeOrderNew, loadChangeOrderObject, loadChangeOrdersList, loadReview, loadTimeEntryNew, loadTimeEntryObject, loadTimesheet,
} from "../modules/design-change-adapter";

/** The day the timesheet opens on: today in the UTC frame the server stores spent_on in (the online page's todayIso). */
const today = () => todayIso(new Date());

export const ROUTES: readonly ShellRoute[] = [
  // Change Orders
  defineShellRoute({
    pattern: "/change-orders", title: "Change Orders", nav: { label: "Change Orders", order: 60 },
    load: () => import("../modules/ChangeOrdersListScreen"), adapter: (shell) => loadChangeOrdersList(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/change-orders/new", title: "New Change Order",
    load: () => import("../modules/ChangeOrderNewScreen"), adapter: (shell) => loadChangeOrderNew(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/change-orders/:id", title: "Change Order",
    load: () => import("../modules/ChangeOrderObjectScreen"), adapter: (shell, params, query) => loadChangeOrderObject(shell.data, params.id!, query.get("projectId")),
  }),

  // Design Studio (the designer's timesheet, ?day=YYYY-MM-DD&view=day|week)
  defineShellRoute({
    pattern: "/design-studio", title: "Design Studio", nav: { label: "Design Studio", order: 64 },
    load: () => import("../modules/DesignStudioTimesheetScreen"), adapter: (shell) => loadTimesheet(shell.data, shell.projectId, today()),
  }),
  defineShellRoute({
    pattern: "/design-studio/timesheets/new", title: "New Timesheet Entry",
    load: () => import("../modules/DesignStudioEntryNewScreen"), adapter: (shell, _params, query) => loadTimeEntryNew(shell.data, shell.projectId, today(), query.get("taskId")),
  }),
  defineShellRoute({
    pattern: "/design-studio/timesheets/:id", title: "Timesheet entry",
    load: () => import("../modules/DesignStudioEntryScreen"), adapter: (shell, params, query) => loadTimeEntryObject(shell.data, params.id!, query.get("projectId")),
  }),
  defineShellRoute({
    pattern: "/design-studio/review", title: "Design review",
    load: () => import("../modules/DesignStudioReviewScreen"), adapter: (shell) => loadReview(shell.data, shell.projectId),
  }),
  defineShellRoute<DesignChangeServerOnlyData>({
    pattern: "/design-studio/cost-analysis", title: "Design cost analysis",
    load: () => import("../modules/DesignChangeServerOnlyScreen"),
    adapter: async (_shell, _params, query) => {
      const search = query.toString();
      return {
        path: "/design-studio/cost-analysis", search: search ? `?${search}` : "", title: "Design cost analysis",
        reason: "Budget against actual design cost is worked out on the server from rates and budgets this laptop does not hold, so it needs a connection.",
      };
    },
  }),
];
