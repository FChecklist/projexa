/// <reference types="bun-types" />
// R67 D-79 -- the module create table, checked against reality.
//
// The table is only worth having if two things are true of it: every route it
// names is a page that exists, and every tab of the three modules knows which
// object it is about. Both are asserted here rather than trusted, because a
// menu entry pointing at a 404 is worse than the missing button it replaced.
import { describe, expect, test } from "bun:test";
import { SHIPPED_ROUTES } from "./nav-routes";
import { SCHEDULE_TABS } from "./schedule-tabs";
import {
  DEFAULT_ACTION_BY_TAB,
  MODULE_CREATE_ACTIONS,
  createActionHref,
  createActionsFor,
  defaultActionLabel,
  type CreateMenuModule,
} from "./module-create-routes";

const MODULES: CreateMenuModule[] = ["labour", "materials", "schedule"];

describe("every create route is a page that ships", () => {
  test("no action points anywhere nav-routes.ts does not list", () => {
    // DE-40: "the same name reaches the same destination as the pills".
    // nav-routes.test.ts regenerates SHIPPED_ROUTES from src/app/**/page.tsx
    // in both directions, so this transitively asserts the file exists.
    const shipped = new Set(SHIPPED_ROUTES);
    const missing = MODULES.flatMap((m) =>
      MODULE_CREATE_ACTIONS[m].filter((a) => !shipped.has(a.route)).map((a) => `${m}: ${a.route}`)
    );
    expect(missing).toEqual([]);
  });

  test("R-301's own list is present in full -- Worker/Attendance, Material/Receipt, Task/Log time", () => {
    // R67 integration: "Workers from Excel" is D-34's bulk import, which used
    // to be a button on the Roster tab alone. It is a create route of this
    // module, so it belongs in the one menu; the assertion is corrected to the
    // merged reality rather than dropped, and R-301's own two entries are
    // still asserted to come FIRST and in order.
    expect(MODULE_CREATE_ACTIONS.labour.map((a) => a.label)).toEqual(["Worker", "Attendance", "Workers from Excel"]);
    expect(MODULE_CREATE_ACTIONS.materials.map((a) => a.label)).toEqual(["Material", "Receipt"]);
    // "plus Sprint where it exists".
    expect(MODULE_CREATE_ACTIONS.schedule.map((a) => a.label)).toEqual(["Task", "Sprint", "Log time"]);
  });
});

describe("the active tab's own object comes first", () => {
  test("R-301's mapping, tab by tab", () => {
    expect(defaultActionLabel("labour", "roster")).toBe("Worker");
    expect(defaultActionLabel("labour", "attendance")).toBe("Attendance");
    expect(defaultActionLabel("materials", "master")).toBe("Material");
    expect(defaultActionLabel("materials", "receipts")).toBe("Receipt");
    expect(defaultActionLabel("schedule", "board")).toBe("Task");
    expect(defaultActionLabel("schedule", "timeline")).toBe("Task");
    expect(defaultActionLabel("schedule", "timesheet")).toBe("Log time");
  });

  test("reordering never DROPS an action -- the menu always lists the whole module", () => {
    for (const m of MODULES) {
      for (const tab of Object.keys(DEFAULT_ACTION_BY_TAB[m])) {
        const ordered = createActionsFor(m, tab);
        expect(ordered).toHaveLength(MODULE_CREATE_ACTIONS[m].length);
        expect(new Set(ordered.map((a) => a.label))).toEqual(
          new Set(MODULE_CREATE_ACTIONS[m].map((a) => a.label))
        );
      }
    }
  });

  test("an unknown or absent tab keeps the module's own order rather than emptying the menu", () => {
    expect(createActionsFor("labour", "not-a-tab")).toEqual(MODULE_CREATE_ACTIONS.labour);
    expect(createActionsFor("labour", null)).toEqual(MODULE_CREATE_ACTIONS.labour);
    expect(createActionsFor("labour")).toEqual(MODULE_CREATE_ACTIONS.labour);
  });

  test("EVERY schedule tab has a default -- the module's tab list is the oracle, not this file", () => {
    // If a tab is added to SCHEDULE_TABS and not to the table, its "+ New"
    // would silently offer the wrong object first. That fails here.
    for (const tab of SCHEDULE_TABS) {
      expect(DEFAULT_ACTION_BY_TAB.schedule[tab]).toBeTruthy();
    }
  });

  test("the Cost Report tab, which R-301 does not name, still offers the module rather than nothing", () => {
    expect(defaultActionLabel("materials", "cost-report")).toBe("Material");
  });
});

describe("createActionHref", () => {
  test("carries the project the user is looking at", () => {
    expect(createActionHref({ label: "Worker", route: "/labour/new" }, "p-cedar")).toBe(
      "/labour/new?projectId=p-cedar"
    );
  });

  test("encodes an id that would otherwise break the query string", () => {
    expect(createActionHref({ label: "Worker", route: "/labour/new" }, "a b&c")).toBe(
      "/labour/new?projectId=a%20b%26c"
    );
  });

  test("without a project it is still the real route, never a dead '#'", () => {
    expect(createActionHref({ label: "Task", route: "/schedule/tasks/new" }, null)).toBe("/schedule/tasks/new");
    expect(createActionHref({ label: "Task", route: "/schedule/tasks/new" }, "  ")).toBe("/schedule/tasks/new");
  });
});
