/// <reference types="bun-types" />
// R67 WS-A (A-17). The acceptance clicks all thirteen expanded pills against a
// dev server this lane may not start, so what is asserted here is the half that
// decides the outcome of every one of those clicks: the destination table
// itself. Three properties matter and all three are invisible to a reader --
// every key resolves, every route it resolves to is a page that really ships,
// and "is my route open" is exact rather than a prefix guess.
import { describe, test, expect } from "bun:test";
import {
  NOT_IN_PROJEXA,
  PILL_ROUTES,
  VERIDIAN_LINK,
  isPillRouteOpen,
  pillHref,
  pillTargetFor,
  pillViewRoutes,
} from "./pill-routes";
import { isShippedRoute } from "./nav-routes";
import { MODULE_CATALOGUE } from "./module-catalogue";

describe("every destination is real", () => {
  test("every view path is a page that actually ships", () => {
    const missing = pillViewRoutes().filter((path) => !isShippedRoute(path));
    expect(missing).toEqual([]);
  });

  test("every module target names a module in the catalogue", () => {
    const broken = Object.entries(PILL_ROUTES)
      .filter(([, t]) => t.kind === "module")
      .filter(([, t]) => !MODULE_CATALOGUE.some((m) => m.id === (t as { moduleId: string }).moduleId))
      .map(([key]) => key);
    expect(broken).toEqual([]);
  });

  test("only names with no PROJEXA screen at all are 'platform'", () => {
    const platform = Object.entries(PILL_ROUTES)
      .filter(([, t]) => t.kind === "platform")
      .map(([key]) => key)
      .sort();
    // A-17 named four; two of them turned out to have shipped screens, which
    // the item itself allows for ("their platform routes where nav-routes has
    // one"), so only these two are left with nothing.
    expect(platform).toEqual(["email", "teams"]);
  });

  test("the two that DO have screens point at them, not at VERIDIAN", () => {
    expect(pillTargetFor("policies")).toEqual({
      kind: "view",
      path: "/grc",
      query: { tab: "policies" },
      needsProject: false,
    });
    expect(pillTargetFor("department")).toEqual({
      kind: "view",
      path: "/employees",
      query: { tab: "departments" },
      needsProject: false,
    });
  });
});

describe("A-17's own list of pill keys", () => {
  const expected: Record<string, string> = {
    "Minutes of Meeting": "moms",
    Reports: "reports",
    Customers: "customers",
    Vendors: "vendors",
    Scope: "scope",
    "Work Progress": "work-progress",
    Manpower: "labour",
    Materials: "materials",
    Permits: "permits",
    Drawings: "drawings",
  };

  for (const [label, moduleId] of Object.entries(expected)) {
    test(`${label} resolves to the ${moduleId} module`, () => {
      expect(pillTargetFor(label)).toEqual({ kind: "module", moduleId });
    });
  }

  test("Tasks, Calendar, Analysis and Dashboard are VIEWS, and open their own URL", () => {
    expect(pillHref(pillTargetFor("tasks")!, "p1")).toBe("/schedule?tab=board&projectId=p1");
    expect(pillHref(pillTargetFor("calendar")!, "p1")).toBe("/schedule?projectId=p1");
    // R67 MERGE (D-11, lane E2's E-27): analysis-screens.ts's /analysis hub
    // lists all four analytical screens; this table used to send the pill to
    // just one of them (Work Progress's own analytics tab).
    expect(pillHref(pillTargetFor("analysis")!, "p1")).toBe("/analysis?projectId=p1");
    expect(pillHref(pillTargetFor("dashboard")!, "p1")).toBe("/dashboard?projectId=p1");
  });

  test("the kit's merged Tasks pill and both of its old keys reach one board", () => {
    const board = { kind: "view", path: "/schedule", query: { tab: "board" } };
    expect(pillTargetFor("task_master")).toEqual(board);
    expect(pillTargetFor("to_do")).toEqual(board);
    expect(pillTargetFor("Tasks")).toEqual(board);
  });

  test("Projects points at the rail, which is where a project is actually chosen", () => {
    expect(pillTargetFor("projects")).toEqual({ kind: "rail" });
  });

  test("an org-wide view never carries a projectId that means nothing there", () => {
    expect(pillHref(pillTargetFor("policies")!, "p1")).toBe("/grc?tab=policies");
    expect(pillHref(pillTargetFor("department")!, "p1")).toBe("/employees?tab=departments");
  });

  test("a key nothing in the table names has no destination, and so cannot render", () => {
    expect(pillTargetFor("payroll_wizard")).toBeNull();
    expect(pillTargetFor("")).toBeNull();
  });

  test("only a view has an href -- a module opens nothing itself, its verbs do", () => {
    expect(pillHref(pillTargetFor("permits")!, "p1")).toBeNull();
    expect(pillHref(pillTargetFor("projects")!, "p1")).toBeNull();
    expect(pillHref(pillTargetFor("email")!, "p1")).toBeNull();
  });
});

describe("aria-pressed: is THIS pill's route what is on screen?", () => {
  test("a view is open only when its own query matches too", () => {
    const tasks = pillTargetFor("tasks")!;
    expect(isPillRouteOpen(tasks, "/schedule", "tab=board")).toBe(true);
    expect(isPillRouteOpen(tasks, "/schedule", "tab=timeline")).toBe(false);
    expect(isPillRouteOpen(tasks, "/schedule", "")).toBe(false);
    expect(isPillRouteOpen(tasks, "/work-progress", "tab=board")).toBe(false);
  });

  test("a view with no query of its own is open on its bare path", () => {
    expect(isPillRouteOpen(pillTargetFor("calendar")!, "/schedule", "")).toBe(true);
    // ...and on the tab the bare path already renders, because clicking there
    // is a no-op. /schedule with no tab IS the timeline (schedule/page.tsx:119).
    expect(isPillRouteOpen(pillTargetFor("calendar")!, "/schedule", "tab=timeline")).toBe(true);
  });

  test("*** A-17: a query-less view is NOT open on a tab its bare path does not render ***", () => {
    // The defect this narrowing fixes. Object.entries({}).every(...) is
    // VACUOUSLY TRUE, so a view naming no query reported "open" on every query
    // of its path -- and aria-pressed drives the greying, so Calendar was
    // greyed out on three tabs where clicking it was the useful thing to do.
    //
    // "Already on this path" and "clicking would do nothing" are different
    // propositions. Greyed means the second.
    //
    // The rejected alternative was query: { tab: "timeline" } on the route
    // itself. That redefines the pill as ONE TAB, against the assertion above
    // that deliberately says the pill named the screen -- fixing what a pill
    // MEANS in order to correct when it looks disabled.
    const calendar = pillTargetFor("calendar")!;
    for (const tab of ["board", "sprints", "timesheet"]) {
      expect(`=${isPillRouteOpen(calendar, "/schedule", `tab=${tab}`)}`).toBe(`=false`);
    }
    // And still open where clicking changes nothing.
    expect(isPillRouteOpen(calendar, "/schedule", "")).toBe(true);
    expect(isPillRouteOpen(calendar, "/schedule", "tab=timeline")).toBe(true);
  });

  test("a module is 'open' anywhere inside itself, create and object pages included", () => {
    const permits = pillTargetFor("permits")!;
    expect(isPillRouteOpen(permits, "/permits", "")).toBe(true);
    expect(isPillRouteOpen(permits, "/permits/new", "")).toBe(true);
    expect(isPillRouteOpen(permits, "/permits/abc-123", "")).toBe(true);
    expect(isPillRouteOpen(permits, "/permitsX", "")).toBe(false);
    expect(isPillRouteOpen(permits, "/documents", "")).toBe(false);
  });

  test("the rail and the platform link are never 'open' -- neither is a screen", () => {
    expect(isPillRouteOpen(pillTargetFor("projects")!, "/dashboard", "")).toBe(false);
    expect(isPillRouteOpen(pillTargetFor("email")!, "/dashboard", "")).toBe(false);
  });

  test("a URLSearchParams is accepted as well as a raw query string", () => {
    expect(isPillRouteOpen(pillTargetFor("tasks")!, "/schedule", new URLSearchParams({ tab: "board" }))).toBe(true);
  });
});

// R81 -- AND THE SAME PREDICATE DECIDES THE GREYING.
//
// M24Shell used to answer "is this pill's route on screen" TWICE with two
// different questions: aria-pressed asked about the DESTINATION (this function),
// while the "you are here" greying asked about the pill's MODULE. A module is
// coarser than a destination whenever the destination carries a query, so a
// pill was disabled on screens it does not open -- and a control that would
// work, refusing to, is A-01's dead end pointing the other way. The shell now
// derives both from this one call. These are the URLs where the two answers
// used to differ, asserted as the destination question, which is the right one.
describe("R81: a query-carrying view is not 'here' on its screen's other tabs", () => {
  test("Tasks is live on every schedule tab except the board", () => {
    const tasks = pillTargetFor("tasks")!;
    // /schedule with no ?tab= renders the TIMELINE (schedule/page.tsx:119,
    // `isScheduleTab(tab) ? tab : "timeline"`), so the bare path is a real
    // screen the board pill can still take you away from.
    expect(isPillRouteOpen(tasks, "/schedule", "")).toBe(false);
    expect(isPillRouteOpen(tasks, "/schedule", "tab=timeline")).toBe(false);
    expect(isPillRouteOpen(tasks, "/schedule", "tab=sprints")).toBe(false);
    expect(isPillRouteOpen(tasks, "/schedule", "tab=timesheet")).toBe(false);
    // ...and on the module's create pages, which are not the board either.
    expect(isPillRouteOpen(tasks, "/schedule/tasks/new", "")).toBe(false);
    expect(isPillRouteOpen(tasks, "/schedule/log-time", "")).toBe(false);
    expect(isPillRouteOpen(tasks, "/schedule", "tab=board")).toBe(true);
  });

  test("Policies is live on the other /grc tabs and on its create pages", () => {
    const policies = pillTargetFor("policies")!;
    expect(isPillRouteOpen(policies, "/grc", "")).toBe(false);
    expect(isPillRouteOpen(policies, "/grc", "tab=risks")).toBe(false);
    expect(isPillRouteOpen(policies, "/grc/risks/new", "")).toBe(false);
    expect(isPillRouteOpen(policies, "/grc", "tab=policies")).toBe(true);
  });

  test("Analysis is live on /work-progress and 'here' only on /analysis", () => {
    const analysis = pillTargetFor("analysis")!;
    expect(isPillRouteOpen(analysis, "/work-progress", "")).toBe(false);
    expect(isPillRouteOpen(analysis, "/work-progress", "tab=analytics")).toBe(false);
    expect(isPillRouteOpen(analysis, "/analysis", "")).toBe(true);
  });

  test("Department is 'here' on the tab it opens -- it has no module to grey it", () => {
    // moduleForPill("department") is null (the `employees` module lists
    // "departments"), so the old module-based greying could never fire here and
    // the pill sat live and dead on the very screen it opens.
    const department = pillTargetFor("department")!;
    expect(isPillRouteOpen(department, "/employees", "tab=departments")).toBe(true);
    expect(isPillRouteOpen(department, "/employees", "tab=people")).toBe(false);
  });
});

describe("the words and the link the platform line uses", () => {
  test("the sentence is the item's own", () => {
    expect(NOT_IN_PROJEXA).toBe("Not part of PROJEXA — open VERIDIAN");
  });

  test("the link is a redirect this repo serves, never a hard-coded hostname", () => {
    expect(VERIDIAN_LINK).toBe("/api/veridian-link");
    expect(VERIDIAN_LINK.startsWith("/")).toBe(true);
  });
});
