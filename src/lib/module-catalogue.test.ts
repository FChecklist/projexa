/// <reference types="bun-types" />
// R67 WS-A (A-01, A-02). The catalogue is the one place a module's route, its
// leaves and its example prompts are written down, so it is also the one place
// a typo can silently produce a dead pill. These tests close both directions:
// every route it can navigate to must be a real shipped page, and every module
// the composer can stand on must resolve from its own pathname.
import { describe, test, expect } from "bun:test";
import {
  MODULE_CATALOGUE,
  catalogueRoutes,
  chainModuleForPathname,
  chainOptionsFor,
  createSegmentForPathname,
  moduleForPathname,
  moduleForPill,
  moduleHref,
  moduleRoute,
  noProjectPromptFor,
  normalisePillKey,
  pillPointsAtCurrentScreen,
  truncateSegmentLabel,
} from "./module-catalogue";
import { isShippedRoute } from "./nav-routes";

describe("MODULE_CATALOGUE", () => {
  test("every route and every leaf points at a real shipped page (R-81)", () => {
    const dead = catalogueRoutes().filter((route) => !isShippedRoute(route));
    expect(dead).toEqual([]);
  });

  test("module ids and leaf ids are unique", () => {
    const moduleIds = MODULE_CATALOGUE.map((m) => m.id);
    expect(new Set(moduleIds).size).toBe(moduleIds.length);
    const leafIds = MODULE_CATALOGUE.flatMap((m) => m.leaves.map((l) => l.id));
    expect(new Set(leafIds).size).toBe(leafIds.length);
  });

  test("every module carries a placeholder and exactly two example prompts", () => {
    for (const mod of MODULE_CATALOGUE) {
      expect(mod.placeholder.length).toBeGreaterThan(0);
      expect(mod.examples).toHaveLength(2);
    }
  });

  test("no route prefix is claimed by two modules", () => {
    const prefixes = MODULE_CATALOGUE.flatMap((m) => m.prefixes);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe("moduleForPathname", () => {
  test("resolves a list route", () => {
    expect(moduleForPathname("/permits")?.id).toBe("permits");
  });

  test("resolves a create route to the same module as its list", () => {
    expect(moduleForPathname("/permits/new")?.id).toBe("permits");
    expect(moduleForPathname("/moms/new")?.id).toBe("moms");
  });

  test("resolves an object route to the same module", () => {
    expect(moduleForPathname("/scope/2b0f-1")?.id).toBe("scope");
  });

  test("ignores a trailing slash and a query string", () => {
    expect(moduleForPathname("/work-progress/")?.id).toBe("work-progress");
    expect(moduleForPathname("/work-progress?tab=report")?.id).toBe("work-progress");
  });

  test("returns null for a route no module owns", () => {
    expect(moduleForPathname("/settings")).toBeNull();
    expect(moduleForPathname("/")).toBeNull();
  });
});

describe("chainModuleForPathname (A-02: what the strip already says)", () => {
  test("a module route puts its module in the strip", () => {
    expect(chainModuleForPathname("/permits")?.label).toBe("Permits");
    expect(chainModuleForPathname("/moms/new")?.label).toBe("Minutes of Meeting");
  });

  test("the Dashboard is a module directory, not a strip segment", () => {
    // It still matches pills -- "Dashboard" must not be offered on /dashboard
    // -- but "Dashboard >" is not the start of a sentence anyone finishes.
    expect(moduleForPathname("/dashboard")?.id).toBe("dashboard");
    expect(chainModuleForPathname("/dashboard")).toBeNull();
  });

  test("a route no module owns puts nothing in the strip", () => {
    expect(chainModuleForPathname("/settings")).toBeNull();
  });
});

describe("noProjectPromptFor (A-02/A-03)", () => {
  test("uses the module's own words where it has them", () => {
    const moms = MODULE_CATALOGUE.find((m) => m.id === "moms")!;
    expect(noProjectPromptFor(moms)).toBe("Choose a project for these minutes");
  });

  test("names the module by default rather than saying 'pick something'", () => {
    const permits = MODULE_CATALOGUE.find((m) => m.id === "permits")!;
    expect(noProjectPromptFor(permits)).toBe("Choose a project for Permits");
  });
});

describe("moduleForPill", () => {
  test("matches the server's snake_case key", () => {
    expect(moduleForPill("minutes_of_meeting")?.id).toBe("moms");
  });

  test("matches a human label the server ranked", () => {
    expect(moduleForPill("some-unknown-key", "Minutes of Meeting")?.id).toBe("moms");
    expect(moduleForPill("wp", "Work Progress")?.id).toBe("work-progress");
  });

  test("matches an ampersand label", () => {
    expect(moduleForPill("drawings_and_3d")?.id).toBe("drawings");
    expect(moduleForPill("x", "Drawings & 3D")?.id).toBe("drawings");
  });

  test("returns null for a pill with no PROJEXA screen", () => {
    expect(moduleForPill("policies")).toBeNull();
    expect(moduleForPill("email")).toBeNull();
  });
});

describe("pillPointsAtCurrentScreen (A-01: no self-referential pill)", () => {
  test("Dashboard is a dead end on /dashboard", () => {
    expect(pillPointsAtCurrentScreen("dashboard", "Dashboard", "/dashboard")).toBe(true);
  });

  test("Work Progress is a dead end on /work-progress", () => {
    expect(pillPointsAtCurrentScreen("work_progress", "Work Progress", "/work-progress")).toBe(true);
  });

  test("Work Progress is NOT a dead end on /permits", () => {
    expect(pillPointsAtCurrentScreen("work_progress", "Work Progress", "/permits")).toBe(false);
  });

  test("a pill with no module is never treated as a dead end", () => {
    expect(pillPointsAtCurrentScreen("policies", "Policies", "/dashboard")).toBe(false);
  });
});

describe("moduleHref", () => {
  test("carries the project", () => {
    expect(moduleHref({ path: "/permits/new" }, "p1")).toBe("/permits/new?projectId=p1");
  });

  test("keeps the leaf's own query and adds the project", () => {
    const leaf = MODULE_CATALOGUE.find((m) => m.id === "permits")!.leaves.find((l) => l.id === "permits.expiring")!;
    expect(moduleHref(leaf, "p1")).toBe("/permits?withinDays=30&projectId=p1");
  });

  test("omits the project when there is none", () => {
    expect(moduleHref({ path: "/permits" }, null)).toBe("/permits");
  });

  test("omits the project for an org-wide leaf", () => {
    expect(moduleHref({ path: "/reports", needsProject: false }, "p1")).toBe("/reports");
  });

  test("moduleRoute is the module's own list route with the project", () => {
    const permits = MODULE_CATALOGUE.find((m) => m.id === "permits")!;
    expect(moduleRoute(permits, "p1")).toBe("/permits?projectId=p1");
  });
});

describe("Work Progress screen cards (A-04)", () => {
  const wp = MODULE_CATALOGUE.find((m) => m.id === "work-progress")!;

  test("the first two cards are the two verbs, in that order", () => {
    expect(chainOptionsFor(wp).slice(0, 2).map((l) => l.label)).toEqual(["Record progress", "Run WPR"]);
  });

  test("'Record progress' asks the screen to put the cursor in the form", () => {
    const card = chainOptionsFor(wp)[0];
    expect(moduleHref(card, "p1")).toBe("/work-progress?tab=entry&focus=activity&projectId=p1");
  });

  test("'Run WPR' asks the report to run on arrival, not to sit there filled in", () => {
    const card = chainOptionsFor(wp)[1];
    expect(moduleHref(card, "p1")).toBe("/work-progress?tab=report&run=1&projectId=p1");
  });

  test("the screen's own module is never offered as a way out of itself", () => {
    expect(pillPointsAtCurrentScreen("work_progress", "Work Progress", "/work-progress")).toBe(true);
  });
});

describe("Minutes of Meeting screen cards (A-03)", () => {
  const moms = MODULE_CATALOGUE.find((m) => m.id === "moms")!;

  test("'New Meeting' is the same URL the screen's own header button produces", () => {
    const card = chainOptionsFor(moms).find((l) => l.label === "New Meeting")!;
    expect(moduleHref(card, "p1")).toBe("/moms/new?projectId=p1");
  });

  test("the module's own route carries the project too", () => {
    expect(moduleRoute(moms, "p1")).toBe("/moms?projectId=p1");
  });
});

describe("normalisePillKey", () => {
  test("collapses case, spaces, ampersands and punctuation", () => {
    expect(normalisePillKey("Minutes of Meeting")).toBe("minutes_of_meeting");
    expect(normalisePillKey("Drawings & 3D")).toBe("drawings_and_3d");
    expect(normalisePillKey("  work-progress  ")).toBe("work_progress");
  });
});

// ── R67 A-06 ────────────────────────────────────────────────────────────────
describe("createSegmentForPathname (A-06: the create sentence)", () => {
  test("a create page becomes the third word of the same sentence", () => {
    expect(createSegmentForPathname("/permits/new")).toEqual({ id: "screen:permits.new", label: "New permit" });
    expect(createSegmentForPathname("/moms/new")).toEqual({ id: "screen:moms.new", label: "New meeting" });
    expect(createSegmentForPathname("/labour/attendance/new")).toEqual({
      id: "screen:labour.attendance",
      label: "Mark attendance",
    });
  });

  test("the module's own list route adds no third segment", () => {
    // "Permits › Open" on /permits would be the strip narrating the obvious.
    expect(createSegmentForPathname("/permits")).toBeNull();
    expect(createSegmentForPathname("/permits?withinDays=30")).toBeNull();
  });

  test("a filter leaf that shares the list route never becomes a segment", () => {
    // "Expiring soon" points at /permits, so it must not match the way
    // /permits/new does -- otherwise every visit to /permits would read
    // "Permits › Expiring soon" whatever the query said.
    const expiring = MODULE_CATALOGUE.find((m) => m.id === "permits")!.leaves.find(
      (l) => l.id === "permits.expiring"
    )!;
    expect(expiring.path).toBe("/permits");
    expect(expiring.chainLabel).toBeUndefined();
  });

  test("a route no module owns has no create sentence", () => {
    expect(createSegmentForPathname("/settings")).toBeNull();
  });

  test("every leaf with its own page carries the strip's words for it", () => {
    // A create page with no chainLabel would silently fall back to no third
    // segment at all, which is the half-sentence A-06 exists to close.
    const missing = MODULE_CATALOGUE.flatMap((mod) =>
      mod.leaves
        .filter((leaf) => leaf.path !== mod.route && !leaf.chainLabel)
        .map((leaf) => leaf.id)
    );
    // The Dashboard's two leaves are other SCREENS, not create pages -- they
    // publish their own module and are excused by name rather than by silence.
    expect(missing).toEqual(["dashboard.project", "dashboard.hierarchy"]);
  });
});

describe("truncateSegmentLabel (A-06: fold at a word, never mid-word)", () => {
  test("a short name is untouched", () => {
    expect(truncateSegmentLabel("Permits")).toBe("Permits");
  });

  test("a long project name folds at the last whole word", () => {
    expect(truncateSegmentLabel("Cedar Heights Villa - Phase 1", 20)).toBe("Cedar Heights Villa…");
  });

  test("it never cuts a word in half when a boundary is available", () => {
    const folded = truncateSegmentLabel("Cedar Heights Villa - Phase 1", 16);
    expect(folded.endsWith("…")).toBe(true);
    expect(folded.replace("…", "").trimEnd().split(" ").pop()).toBe("Heights");
  });

  test("it never leaves a dangling separator hanging off the fold", () => {
    // "Cedar Heights Villa -…" reads as a broken name, not a shortened one.
    expect(truncateSegmentLabel("Cedar Heights Villa - Phase 1", 23)).toBe("Cedar Heights Villa…");
  });

  test("a single unbroken word still folds rather than overflowing", () => {
    expect(truncateSegmentLabel("Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 10)).toBe("Aaaaaaaaa…");
  });

  test("the default budget keeps a real project name readable", () => {
    expect(truncateSegmentLabel("Cedar Heights Villa - Phase 1")).toBe("Cedar Heights Villa - Phase…");
  });
});
