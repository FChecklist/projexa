// R67 D-79 -- every module tab offers the module's create actions.
//
// WHAT R-301 FOUND. A module's tabs each showed exactly one create button,
// and it was the one belonging to the tab you were already on:
//
//   /labour     Roster tab      -> "Add Worker"        (and nothing else)
//               Attendance tab  -> "Mark Attendance"   (and nothing else)
//   /materials  Master tab      -> "Add Material"
//               Receipts tab    -> "Record Receipt"
//               Cost Report tab -> nothing at all
//   /schedule   every tab       -> nothing in the header
//
// So marking attendance from the roster meant finding the Attendance TAB
// first, and logging time from the Gantt meant leaving the module. The
// destinations all existed; nothing on screen led to them.
//
// This table is the module's whole create surface, in words, in one place.
// The routes are the SAME strings nav-routes.ts ships and the pills navigate
// to -- module-create-routes.test.ts asserts every one of them against
// SHIPPED_ROUTES, so a create action can never point somewhere that is not a
// page (DE-40: "the same name reaches the same destination as the pills").

export type ModuleCreateAction = {
  /** What the user reads in the menu. A noun, never a verb phrase. */
  label: string;
  /** A route from nav-routes.ts's SHIPPED_ROUTES, without a query string. */
  route: string;
};

/** The three modules R-301 names. */
export type CreateMenuModule = "labour" | "materials" | "schedule";

/**
 * Every create route of each module, in the module's own reading order. The
 * ACTIVE TAB decides which of them comes first at render time; this order is
 * the tiebreak for the rest.
 */
export const MODULE_CREATE_ACTIONS: Record<CreateMenuModule, ModuleCreateAction[]> = {
  labour: [
    { label: "Worker", route: "/labour/new" },
    { label: "Attendance", route: "/labour/attendance/new" },
    // R67 D-34 (R-091), added by the integration train. Adding 38 workers one
    // form at a time is why real rosters never got entered, so the bulk import
    // is a create action of this module -- not a button that only existed on
    // the Roster tab, which is where D-34 first put it and which is exactly
    // the per-tab scattering D-79 exists to end.
    { label: "Workers from Excel", route: "/labour/import" },
  ],
  materials: [
    { label: "Material", route: "/materials/new" },
    { label: "Receipt", route: "/materials/receipts/new" },
  ],
  schedule: [
    { label: "Task", route: "/schedule/tasks/new" },
    // "plus Sprint where it exists" -- it does, /schedule/sprints/new.
    { label: "Sprint", route: "/schedule/sprints/new" },
    { label: "Log time", route: "/schedule/log-time" },
  ],
};

/**
 * The object a tab is ABOUT, which is what its "+ New" offers first. R-301
 * states the mapping; the two entries it does not name are the two tabs that
 * are reports rather than registers, and both fall back to their module's own
 * first object rather than to nothing.
 */
export const DEFAULT_ACTION_BY_TAB: Record<CreateMenuModule, Record<string, string>> = {
  labour: { roster: "Worker", attendance: "Attendance" },
  materials: { master: "Material", receipts: "Receipt", "cost-report": "Material" },
  schedule: { timeline: "Task", board: "Task", sprints: "Sprint", timesheet: "Log time" },
};

/**
 * The module's create actions with the active tab's own object first.
 *
 * The order is the whole point: R-301's cost is measured in clicks, and the
 * first item in an open menu is the one already under the pointer.
 */
export function createActionsFor(module: CreateMenuModule, tab?: string | null): ModuleCreateAction[] {
  const actions = MODULE_CREATE_ACTIONS[module];
  const defaultLabel = DEFAULT_ACTION_BY_TAB[module][(tab ?? "").trim()];
  if (!defaultLabel) return actions;
  const first = actions.find((a) => a.label === defaultLabel);
  if (!first) return actions;
  return [first, ...actions.filter((a) => a !== first)];
}

/** The label the active tab's own object carries. */
export function defaultActionLabel(module: CreateMenuModule, tab?: string | null): string {
  return createActionsFor(module, tab)[0]?.label ?? "";
}

/**
 * The href for an action, carrying the project the user is looking at.
 *
 * Every one of these routes resolves its project from `?projectId=`; dropping
 * it is how a create screen ends up guessing, which is the fault D-20 exists
 * to stop.
 */
export function createActionHref(action: ModuleCreateAction, projectId?: string | null): string {
  const id = (projectId ?? "").trim();
  return id ? `${action.route}?projectId=${encodeURIComponent(id)}` : action.route;
}
