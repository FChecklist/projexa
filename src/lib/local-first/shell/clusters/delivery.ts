// LOCAL-FIRST shell route cluster "delivery": Project delivery: work progress (list, entry, export), labour, materials, schedule.
// One engineer fills this file; the route table spreads it. Nothing else is shared, so clusters never conflict.
// Use nav orders 20 to 39. See docs/local-first/ROUTE_TABLE.md for how to add a module.
//
// Every adapter reads the laptop's own database only (modules/delivery-local.ts). Writes go through modules/delivery-writes.ts (the
// outbox). Static paths win over ":param" paths (paths.ts matchRoute), so /labour/attendance/new is never read as a date; the four
// create/import pages that would otherwise be taken by an object route (/labour/new as a worker id ...) are registered as
// DeliveryServerOnlyScreen, which behaves like the shell's own "not on this laptop" fallback.

import { defineShellRoute, type ShellRoute } from "../types";
import { localDay } from "../modules/delivery-local";
import { loadWorkProgress, loadWorkProgressEntry } from "../modules/work-progress-adapter";
import { loadAttendanceSheet, loadLabour, loadWorker } from "../modules/labour-adapter";
import { loadMaterial, loadMaterials, loadReceipt } from "../modules/materials-adapter";
import { loadSchedule, loadScheduleTask } from "../modules/schedule-adapter";

const serverOnly = (pattern: string, what: string) =>
  defineShellRoute({ pattern, title: what, load: () => import("../modules/DeliveryServerOnlyScreen"), adapter: async () => ({ path: pattern, what }) });

export const ROUTES: readonly ShellRoute[] = [
  // Work progress (?tab=entry | analytics | report; export lives in the report tab)
  defineShellRoute({
    pattern: "/work-progress", title: "Work Progress", nav: { label: "Work Progress", order: 20 },
    load: () => import("../modules/WorkProgressScreen"), adapter: (shell) => loadWorkProgress(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/work-progress/:id", title: "Progress entry",
    load: () => import("../modules/WorkProgressEntryScreen"), adapter: (shell, params, query) => loadWorkProgressEntry(shell.data, params.id!, query.get("projectId")),
  }),

  // Labour (?tab=roster | attendance | summary)
  defineShellRoute({
    pattern: "/labour", title: "Labour", nav: { label: "Labour", order: 24 },
    load: () => import("../modules/LabourScreen"), adapter: (shell) => loadLabour(shell.data, shell.projectId, localDay()),
  }),
  defineShellRoute({
    pattern: "/labour/:id", title: "Worker",
    load: () => import("../modules/LabourWorkerScreen"), adapter: (shell, params, query) => loadWorker(shell.data, params.id!, query.get("projectId")),
  }),
  defineShellRoute({
    pattern: "/labour/attendance/new", title: "Mark attendance",
    load: () => import("../modules/LabourAttendanceNewScreen"), adapter: (shell) => loadLabour(shell.data, shell.projectId, localDay()),
  }),
  defineShellRoute({
    pattern: "/labour/attendance/:date", title: "Attendance sheet",
    load: () => import("../modules/LabourAttendanceSheetScreen"), adapter: (shell, params) => loadAttendanceSheet(shell.data, shell.projectId, params.date!),
  }),
  serverOnly("/labour/new", "Adding a worker"),
  serverOnly("/labour/import", "Importing a roster"),

  // Materials (?tab=master | receipts | issues | cost-report)
  defineShellRoute({
    pattern: "/materials", title: "Materials", nav: { label: "Materials", order: 28 },
    load: () => import("../modules/MaterialsScreen"), adapter: (shell) => loadMaterials(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/materials/:id", title: "Material",
    load: () => import("../modules/MaterialObjectScreen"), adapter: (shell, params, query) => loadMaterial(shell.data, params.id!, query.get("projectId")),
  }),
  defineShellRoute({
    pattern: "/materials/receipts/new", title: "Record receipt",
    load: () => import("../modules/MaterialReceiptNewScreen"), adapter: (shell) => loadMaterials(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/materials/receipts/:id", title: "Receipt",
    load: () => import("../modules/MaterialReceiptScreen"), adapter: (shell, params, query) => loadReceipt(shell.data, params.id!, query.get("projectId")),
  }),
  defineShellRoute({
    pattern: "/materials/issues/new", title: "Issue material",
    load: () => import("../modules/MaterialIssueNewScreen"), adapter: (shell) => loadMaterials(shell.data, shell.projectId),
  }),
  serverOnly("/materials/new", "Adding a material"),

  // Schedule (?tab=timeline | milestones | board | sprints | timesheet)
  defineShellRoute({
    pattern: "/schedule", title: "Schedule", nav: { label: "Schedule", order: 32 },
    load: () => import("../modules/ScheduleScreen"), adapter: (shell) => loadSchedule(shell.data, shell.projectId, localDay()),
  }),
  defineShellRoute({
    pattern: "/schedule/tasks/:id", title: "Task",
    load: () => import("../modules/ScheduleTaskScreen"), adapter: (shell, params, query) => loadScheduleTask(shell.data, params.id!, query.get("projectId"), localDay()),
  }),
  serverOnly("/schedule/tasks/new", "Adding a task"),
];
