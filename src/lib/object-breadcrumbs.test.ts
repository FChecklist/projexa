/// <reference types="bun-types" />
// R67 F-34 (R-290). The rule this file guards is a rule about the REPO, not
// about a component: every object route ships a frame-first loading.tsx, every
// object client renders that same frame while it waits, and neither of them
// carries its own copy of the breadcrumb string.
//
// A unit test of ObjectScreen alone cannot see any of that -- it would keep
// passing on the day someone adds an object route with a bare "Loading…" in it.
// So this reads the real files, the same way nav-routes.test.ts keeps
// SHIPPED_ROUTES honest.
//
// readdirSync/readFileSync rather than a shell glob, deliberately: these paths
// contain [id] segments, and bracket paths are wildcards in PowerShell that
// silently match nothing (a known way to get a confidently wrong file count in
// this project).
import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OBJECT_BREADCRUMBS, type ObjectBreadcrumb } from "./object-breadcrumbs";

const APP_ROOT = join(import.meta.dir, "..", "app", "(app)");
const COMPONENTS = join(import.meta.dir, "..", "components");

/** route segment on disk -> the client that renders it -> its breadcrumb entry. */
const OBJECT_ROUTES: Array<{
  segment: string[];
  client: string;
  constName: string;
  entry: ObjectBreadcrumb;
}> = [
  { segment: ["moms", "[id]"], client: "MoMObjectClient.tsx", constName: "MOM_OBJECT_BREADCRUMB", entry: OBJECT_BREADCRUMBS.moms },
  { segment: ["scope", "[id]"], client: "ScopeObjectClient.tsx", constName: "SCOPE_OBJECT_BREADCRUMB", entry: OBJECT_BREADCRUMBS.scope },
  { segment: ["labour", "[id]"], client: "RosterObjectClient.tsx", constName: "LABOUR_OBJECT_BREADCRUMB", entry: OBJECT_BREADCRUMBS.labour },
  { segment: ["materials", "[id]"], client: "MaterialObjectClient.tsx", constName: "MATERIAL_OBJECT_BREADCRUMB", entry: OBJECT_BREADCRUMBS.materials },
  { segment: ["permits", "[id]"], client: "PermitObjectClient.tsx", constName: "PERMIT_OBJECT_BREADCRUMB", entry: OBJECT_BREADCRUMBS.permits },
  { segment: ["drawings", "[id]"], client: "DrawingObjectClient.tsx", constName: "DRAWING_OBJECT_BREADCRUMB", entry: OBJECT_BREADCRUMBS.drawings },
  { segment: ["schedule", "tasks", "[id]"], client: "ScheduleTaskObjectClient.tsx", constName: "SCHEDULE_TASK_OBJECT_BREADCRUMB", entry: OBJECT_BREADCRUMBS.scheduleTask },
];

function loadingPath(segment: string[]): string {
  return join(APP_ROOT, ...segment, "loading.tsx");
}

function clientSource(client: string): string {
  return readFileSync(join(COMPONENTS, client), "utf8");
}

describe("every object route paints its frame before its record", () => {
  for (const route of OBJECT_ROUTES) {
    const name = "/" + route.segment.join("/");

    test(`${name} ships a loading.tsx`, () => {
      expect(existsSync(loadingPath(route.segment))).toBe(true);
    });

    test(`${name}'s loading.tsx mounts the loading ObjectScreen with ${route.constName}`, () => {
      const source = readFileSync(loadingPath(route.segment), "utf8");
      expect(source).toContain('from "@/components/screens/ObjectScreen"');
      expect(source).toContain(route.constName);
      expect(source).toContain("loading");
      // The literal must NOT be re-typed here -- that is exactly the drift the
      // shared constant exists to prevent.
      expect(source).not.toContain(`"${route.entry.breadcrumb}"`);
    });

    test(`${route.client} renders the same frame while it waits, and no bare "Loading…"`, () => {
      const source = clientSource(route.client);
      // The fork, not the kit's ObjectScreen: the kit has no loading variant and
      // D-09 forbids changing it.
      expect(source).toContain('import { ObjectScreen } from "@/components/screens/ObjectScreen"');
      expect(source).not.toContain('import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens"');
      // The exact shape this item removes: a paragraph whose whole content is
      // the word Loading.
      expect(source).not.toMatch(/>\s*Loading…\s*<\/p>/);
      expect(source).toContain(route.constName);
    });

    test(`${route.client} takes its breadcrumb from ${route.constName}, not from a re-typed literal`, () => {
      expect(clientSource(route.client)).not.toContain(`breadcrumb="${route.entry.breadcrumb}"`);
    });
  }
});

describe("the breadcrumb table itself", () => {
  test("every entry names a module and the noun a user would wait on", () => {
    for (const [key, entry] of Object.entries(OBJECT_BREADCRUMBS)) {
      expect(entry.breadcrumb.length, key).toBeGreaterThan(0);
      // "Module / Object": the object route is one level below its list.
      expect(entry.breadcrumb, key).toContain(" / ");
      // The waiting sentence reads "Still loading <label>…", so the label is a
      // noun phrase for the RECORD, never the module's own name.
      expect(entry.label.startsWith("the "), key).toBe(true);
      expect(entry.actions.length, key).toBeGreaterThan(0);
    }
  });

  test("no two modules share a breadcrumb -- the frame always says which screen you are on", () => {
    const all = Object.values(OBJECT_BREADCRUMBS).map((e) => e.breadcrumb);
    expect(new Set(all).size).toBe(all.length);
  });

  test("every route in the table above is covered by an entry, and every entry by a route", () => {
    expect(OBJECT_ROUTES.length).toBe(Object.keys(OBJECT_BREADCRUMBS).length);
  });
});
