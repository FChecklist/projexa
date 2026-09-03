/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  CARD_CATALOGUE,
  COMPOSER_CARD_CATALOGUE,
  DEFAULT_PERIOD,
  DESIGN_STUDIO_CARD,
  DOORS,
  DOOR_SEGMENT_PREFIX,
  KIND_GLYPH,
  KIND_WORD,
  MANPOWER_CARD,
  OTHER_ENTRY_LABEL,
  PERIOD_OPTIONS,
  PLATFORM_PILLS,
  REPORTS_ENTITY_SEGMENT,
  REPORT_LEAVES,
  SUMEET_MODULE_ORDER,
  allModulesEntries,
  cardForRoute,
  cardHref,
  cardOwnsRoute,
  cardUnmetReason,
  cardsForRole,
  doorById,
  doorRoute,
  doorSegments,
  doorSentence,
  coldStartCards,
  formatReportRange,
  matchTaskTitles,
  nearestScreen,
  periodLabel,
  periodOptionsLevel,
  rankCards,
  rankedKeyForCard,
  reportLeafById,
  reportOptionsLevel,
  reportReceiptLine,
  reportRoute,
  resolvePeriod,
  resolveTaskTitle,
  targetForCard,
  timesheetReceiptLine,
  timesheetRoute,
  weightFor,
  type CardPreconditionId,
} from "./card-catalogue";
import { MODULE_CATALOGUE } from "./module-catalogue";
import { PILL_CATALOGUE, isRankablePill, type PillEntry } from "./pill-catalogue";
import { isShippedRoute } from "./nav-routes";

const CEDAR = "Cedar Heights Villa - Phase 1";
const SEP_2 = new Date("2026-09-02T14:00:00.000Z");
const NO_UNMET = new Set<CardPreconditionId>();

// ═══════════════════════════════════════════════════════════════════════════
// R67 MERGE (decision D-11): this file proves BOTH card systems that share
// card-catalogue.ts -- see the merge note at the top of card-catalogue.ts.
// WS-C's own suite below is otherwise UNCHANGED except for the rename
// CARD_CATALOGUE -> COMPOSER_CARD_CATALOGUE (its own tests, not WS-A's).
// ═══════════════════════════════════════════════════════════════════════════

describe("the report leaves are the reports the picker already runs", () => {
  test("six leaves, each with a real /api/reports path segment", () => {
    expect(REPORT_LEAVES).toHaveLength(6);
    // Every id is a value in ReportsClient's own DEFAULT_REPORT_COLUMNS.
    const pickerValues = [
      "project-status", "project-completion", "work-progress", "category-progress",
      "weekly-project", "attendance", "manpower-cost", "site-picture", "scope",
      "budget-summary", "budget-vs-actual", "material-consumption", "vendor-cost",
      "designer-timesheet", "kpi", "revenue", "expense",
    ];
    for (const leaf of REPORT_LEAVES) expect(pickerValues).toContain(leaf.id);
  });

  test("ids are unique and every leaf reads as a report name", () => {
    expect(new Set(REPORT_LEAVES.map((r) => r.id)).size).toBe(6);
    for (const leaf of REPORT_LEAVES) {
      expect(leaf.label).toMatch(/Report$/);
      expect(leaf.label).not.toContain("_");
    }
  });

  test("lookup by id", () => {
    expect(reportLeafById("work-progress")?.label).toBe("Work Progress Report");
    expect(reportLeafById("not-a-report")).toBeNull();
  });

  test("the strip is seeded with an entity segment, not a step", () => {
    expect(REPORTS_ENTITY_SEGMENT).toEqual({ id: "reports", label: "Reports", kind: "action" });
  });
});

describe("the period step", () => {
  test("it defaults to this month", () => {
    expect(DEFAULT_PERIOD).toBe("this-month");
    expect(periodLabel(DEFAULT_PERIOD)).toBe("this month");
    expect(PERIOD_OPTIONS[0].id).toBe(DEFAULT_PERIOD);
  });

  test("an open period ends today, never in the future", () => {
    expect(resolvePeriod("this-month", SEP_2)).toEqual({ from: "2026-09-01", to: "2026-09-02" });
    expect(resolvePeriod("this-quarter", SEP_2)).toEqual({ from: "2026-07-01", to: "2026-09-02" });
    expect(resolvePeriod("this-year", SEP_2)).toEqual({ from: "2026-01-01", to: "2026-09-02" });
  });

  test("a closed period ends on its own last day", () => {
    expect(resolvePeriod("last-month", SEP_2)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    // January's "last month" crosses the year boundary.
    expect(resolvePeriod("last-month", new Date("2026-01-15T00:00:00.000Z"))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  test("the quarter boundaries are the real ones", () => {
    expect(resolvePeriod("this-quarter", new Date("2026-01-05T00:00:00.000Z")).from).toBe("2026-01-01");
    expect(resolvePeriod("this-quarter", new Date("2026-06-30T00:00:00.000Z")).from).toBe("2026-04-01");
    expect(resolvePeriod("this-quarter", new Date("2026-12-31T00:00:00.000Z")).from).toBe("2026-10-01");
  });
});

describe("a leaf lands where the page's own button lands", () => {
  test("Work Progress goes to the one report screen D-02 names", () => {
    const url = reportRoute({ report: "work-progress", projectId: "p1", from: "2026-09-01", to: "2026-09-02" });
    expect(url.startsWith("/work-progress?")).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("tab")).toBe("report");
    expect(qs.get("projectId")).toBe("p1");
    expect(qs.get("from")).toBe("2026-09-01");
    expect(qs.get("to")).toBe("2026-09-02");
  });

  test("every other report opens the Reports screen with its picker set and told to run", () => {
    const url = reportRoute({ report: "attendance", projectId: "p1", from: "2026-09-01", to: "2026-09-02" });
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(url.startsWith("/reports?")).toBe(true);
    expect(qs.get("report")).toBe("attendance");
    expect(qs.get("run")).toBe("1");
    expect(qs.get("projectId")).toBe("p1");
  });

  test("with no project the URL simply omits it rather than sending 'null'", () => {
    const url = reportRoute({ report: "attendance", projectId: null, from: "2026-01-01", to: "2026-09-02" });
    expect(url).not.toContain("projectId");
  });
});

describe("the receipt line", () => {
  test("C-02's sentence, verbatim", () => {
    expect(
      reportReceiptLine({
        reportLabel: "Work Progress Report",
        projectName: CEDAR,
        from: "2026-01-01",
        to: "2026-09-02",
      })
    ).toBe("Ran Work Progress Report for Cedar Heights Villa - Phase 1, 01 Jan to 02 Sep 2026");
  });

  test("a range crossing a year prints both years", () => {
    expect(formatReportRange("2025-12-01", "2026-01-31")).toBe("01 Dec 2025 to 31 Jan 2026");
  });

  test("a receipt never omits which project it was for", () => {
    const line = reportReceiptLine({
      reportLabel: "Attendance Report",
      projectName: null,
      from: "2026-09-01",
      to: "2026-09-02",
    });
    expect(line).toBe("Ran Attendance Report for all projects, 01 Sep to 02 Sep 2026");
    expect(line).not.toContain("  ");
  });
});

describe("the levels the composer asks", () => {
  test("level 1 asks which report, and every option is a leaf", () => {
    const level = reportOptionsLevel();
    expect(level.legend).toBe("Which report?");
    expect(level.options).toHaveLength(6);
    expect(level.options.every((o) => o.isLeaf)).toBe(true);
    expect(level.options.map((o) => o.label)).toContain("Work Progress Report");
  });

  test("level 2 asks the period", () => {
    const level = periodOptionsLevel();
    expect(level.legend).toBe("Over what period?");
    expect(level.options.map((o) => o.id)).toEqual(["this-month", "last-month", "this-quarter", "this-year"]);
  });
});

// --- R67 C-03 -------------------------------------------------------------

const TASKS = [
  { id: "i12", number: 12, title: "Joinery shop drawings" },
  { id: "i13", number: 13, title: "Joinery site survey" },
  { id: "i14", number: 14, title: "Facade cladding" },
];

describe("the Design Studio card (WS-C's own composer catalogue)", () => {
  test("it is an action card wired to the pipeline's second write", () => {
    expect(DESIGN_STUDIO_CARD.kind).toBe("action");
    expect(DESIGN_STUDIO_CARD.functionId).toBe("record_timesheet");
    expect(DESIGN_STUDIO_CARD.label).toBe("Design Studio");
    expect(COMPOSER_CARD_CATALOGUE).toContain(DESIGN_STUDIO_CARD);
  });

  test("its placeholder is C-03's own example sentence", () => {
    expect(DESIGN_STUDIO_CARD.placeholder).toBe("e.g. 3 hours on #12 joinery shop drawings today");
  });

  test("it owns both the Design Studio route and the real log-time screen", () => {
    expect(cardOwnsRoute(DESIGN_STUDIO_CARD, "/schedule/log-time")).toBe(true);
    expect(cardOwnsRoute(DESIGN_STUDIO_CARD, "/design-studio")).toBe(true);
    expect(cardOwnsRoute(DESIGN_STUDIO_CARD, "/design-studio/timesheet")).toBe(true);
    expect(cardOwnsRoute(DESIGN_STUDIO_CARD, "/schedule")).toBe(false);
    // A route that merely starts with the same letters is NOT the card's.
    expect(cardOwnsRoute(DESIGN_STUDIO_CARD, "/design-studio-archive")).toBe(false);
  });

  test("cardForRoute finds the chain a route should seed", () => {
    expect(cardForRoute("/schedule/log-time")).toBe(DESIGN_STUDIO_CARD);
    // R67 C-08: /labour is the Manpower card's own route now.
    expect(cardForRoute("/labour")).toBe(MANPOWER_CARD);
    expect(cardForRoute("/settings")).toBeNull();
    expect(cardForRoute("")).toBeNull();
  });

  test("it is cold-started for designer roles, and offered on its own screen to anyone", () => {
    expect(coldStartCards("designer", "/labour")).toEqual([DESIGN_STUDIO_CARD]);
    expect(coldStartCards("DESIGNER", "/labour")).toEqual([DESIGN_STUDIO_CARD]);
    expect(coldStartCards("member", "/labour")).toEqual([]);
    expect(coldStartCards("member", "/schedule/log-time")).toEqual([DESIGN_STUDIO_CARD]);
    expect(coldStartCards(null, "/labour")).toEqual([]);
  });
});

describe("matchTaskTitles mirrors the executor's own fuzzy match", () => {
  test("an issue number is exact", () => {
    expect(matchTaskTitles(TASKS, "#12").map((t) => t.id)).toEqual(["i12"]);
    expect(matchTaskTitles(TASKS, "12").map((t) => t.id)).toEqual(["i12"]);
  });

  test("words in any order find the real task", () => {
    expect(matchTaskTitles(TASKS, "joinery drawings").map((t) => t.id)).toEqual(["i12"]);
    expect(matchTaskTitles(TASKS, "shop drawings").map((t) => t.id)).toEqual(["i12"]);
  });

  test("*** an ambiguous needle returns every match so the caller can refuse ***", () => {
    expect(matchTaskTitles(TASKS, "joinery").map((t) => t.id)).toEqual(["i12", "i13"]);
    expect(resolveTaskTitle(TASKS, "joinery")).toBeNull();
    expect(resolveTaskTitle(TASKS, "joinery drawings")?.id).toBe("i12");
  });

  test("nothing matches nothing", () => {
    expect(matchTaskTitles(TASKS, "plumbing")).toEqual([]);
    expect(matchTaskTitles(TASKS, "")).toEqual([]);
    expect(resolveTaskTitle([], "joinery")).toBeNull();
  });
});

describe("the timesheet receipt", () => {
  test("C-03's line, with the hours to two places and the real task named", () => {
    expect(timesheetReceiptLine({ hours: "3", task: TASKS[0] })).toBe("Logged 3.00 h on #12 Joinery shop drawings");
    expect(timesheetReceiptLine({ hours: 2.5, task: TASKS[2] })).toBe("Logged 2.50 h on #14 Facade cladding");
  });

  test("with no resolved task it still reads as a sentence", () => {
    expect(timesheetReceiptLine({ hours: 1, task: null })).toBe("Logged 1.00 h on this task");
  });

  test("the right pane lands on the project's own timesheet tab", () => {
    expect(timesheetRoute("p1")).toBe("/schedule?projectId=p1&tab=timesheet");
    expect(timesheetRoute(null)).toBe("/schedule?tab=timesheet");
  });
});

// ---------------------------------------------------------------------------
// R67 C-06 -- THE DOORS
// ---------------------------------------------------------------------------

describe("DOORS", () => {
  test("every door id is unique -- two rows for one id is a silent override", () => {
    const ids = DOORS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every door has a route, a label and at least one step", () => {
    for (const door of DOORS) {
      expect(door.route.startsWith("/")).toBe(true);
      expect(door.label.trim().length).toBeGreaterThan(0);
      expect(door.steps.length).toBeGreaterThan(0);
    }
  });

  test("no door's route carries a query string -- the query is `query`, so it cannot be doubled", () => {
    for (const door of DOORS) {
      expect(door.route.includes("?")).toBe(false);
    }
  });

  test("doorById is null for an id nobody registered, rather than throwing", () => {
    expect(doorById("nope.nothing")).toBeNull();
    expect(doorById("labour.mark_attendance")?.label).toBe("Mark Attendance");
  });
});

describe("doorSentence", () => {
  test("C-06's acceptance string, verbatim", () => {
    const door = doorById("labour.mark_attendance")!;
    expect(doorSentence(door, "Cedar Heights Villa - Phase 1")).toBe(
      "Cedar Heights Villa - Phase 1 > Manpower > Mark attendance > Today"
    );
  });

  test("C-06's Permits tile, verbatim", () => {
    const door = doorById("project.permits_expiring")!;
    expect(doorSentence(door, "Cedar Heights")).toBe("Cedar Heights > Permits > Expiring soon");
  });

  test("with no project it is still a sentence, not a leading separator", () => {
    const door = doorById("dashboard.total_budget")!;
    expect(doorSentence(door, null)).toBe("Budget > All budgets");
    expect(doorSentence(door, "   ")).toBe("Budget > All budgets");
  });
});

describe("doorRoute", () => {
  test("C-06's Permits tile lands on /permits with the project and the 30-day filter", () => {
    const door = doorById("project.permits_expiring")!;
    expect(doorRoute(door, "p1")).toBe("/permits?projectId=p1&withinDays=30");
  });

  test("a door that is not project-scoped never carries a projectId it was handed", () => {
    const door = doorById("project.budget_vs_actual")!;
    expect(doorRoute(door, "p1")).toBe("/budgets");
  });

  test("the Work Progress Report is D-02's one screen", () => {
    const door = doorById("work_progress.run_report")!;
    expect(doorRoute(door, "p1")).toBe("/work-progress?projectId=p1&tab=report");
  });

  test("a project-scoped door with no project still opens its screen", () => {
    expect(doorRoute(doorById("scope.new_boq")!, null)).toBe("/scope/new");
  });
});

describe("doorSegments", () => {
  test("segments are namespaced, so the route effects can tell a door's own step apart", () => {
    const segments = doorSegments(doorById("scope.new_boq")!);
    expect(segments.map((s) => s.label)).toEqual(["Scope", "New BOQ"]);
    expect(segments[0].id).toBe(`${DOOR_SEGMENT_PREFIX}scope.new_boq:scope`);
    expect(segments[0].kind).toBe("action");
    expect(segments[1].kind).toBe("step");
  });

  test("no segment is a root -- the project root is the shell's, never a door's", () => {
    for (const door of DOORS) {
      for (const seg of doorSegments(door)) {
        expect(seg.kind === "action" || seg.kind === "step").toBe(true);
      }
    }
  });

  test("the ids a door writes are unique within that door", () => {
    for (const door of DOORS) {
      const ids = doorSegments(door).map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

// ---------------------------------------------------------------------------
// R67 C-12 -- the screen a refusal points at
// ---------------------------------------------------------------------------

describe("nearestScreen -- a refusal never points nowhere", () => {
  test("the chain's own module names the screen", () => {
    expect(nearestScreen(["Cedar Heights Villa - Phase 1", "Budget", "Budget vs actual"])).toEqual({
      label: "Budget",
      route: "/budgets",
    });
  });

  test("it reads from the most specific end of the chain backwards", () => {
    // "Permits" is later in the sentence than the project, so it wins.
    expect(nearestScreen(["Cedar Heights", "Permits", "Expiring soon"])?.route).toBe("/permits");
  });

  test("a chain that names no module we have gets no destination invented for it", () => {
    expect(nearestScreen(["Cedar Heights", "Payroll", "Run"])).toBeNull();
    expect(nearestScreen([])).toBeNull();
    expect(nearestScreen(["", "   "])).toBeNull();
  });

  test("every route it can return is a route a door already opens", () => {
    const routes = new Set(DOORS.map((d) => d.route));
    for (const door of DOORS) {
      const found = nearestScreen([door.steps[door.steps.length - 1].label]);
      expect(found).not.toBeNull();
      expect(routes.has(found!.route)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R67 WS-A (A-07) -- the role-ranked catalogue. UNCHANGED from main except
// that CARD_CATALOGUE here refers unambiguously to WS-A's own export -- see
// the merge note at the top of card-catalogue.ts.
// ═══════════════════════════════════════════════════════════════════════════
//
// Two things here are worth guarding mechanically, because both are the kind
// of thing a reader cannot check by eye:
//
//  1. EVERY CARD OPENS A REAL PAGE. A card carries a leafId, not a path, and
//     the leaf's path is already checked against the shipped-route registry --
//     so what is asserted here is that every card's leafId RESOLVES. A card
//     whose leaf was renamed would otherwise render, look correct and do
//     nothing.
//
//  2. THE RANKING IS DETERMINISTIC. The strip must not shuffle between two
//     renders with the same inputs, which is the flicker A-07 exists to kill.

describe("CARD_CATALOGUE", () => {
  test("every card id is unique -- the id is also its pill_usage key", () => {
    const ids = CARD_CATALOGUE.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every card resolves to a real leaf on a real module", () => {
    const broken = CARD_CATALOGUE.filter((c) => targetForCard(c) === null).map((c) => c.id);
    expect(broken).toEqual([]);
  });

  test("every card's destination is a shipped page", () => {
    const dead = CARD_CATALOGUE.map((c) => ({ id: c.id, href: cardHref(c, null) })).filter(
      (x) => !x.href || !isShippedRoute(x.href)
    );
    expect(dead).toEqual([]);
  });

  test("a card carrying a project produces the same URL as the module's own control", () => {
    const record = CARD_CATALOGUE.find((c) => c.id === "work-progress.entry")!;
    expect(cardHref(record, "p1")).toBe("/work-progress?tab=entry&focus=activity&projectId=p1");
    const permit = CARD_CATALOGUE.find((c) => c.id === "permits.new")!;
    expect(cardHref(permit, "p1")).toBe("/permits/new?projectId=p1");
  });

  test("every card reads as a verb and an object, and its label is both", () => {
    for (const card of CARD_CATALOGUE) {
      expect(card.verb.length).toBeGreaterThan(0);
      expect(card.object.length).toBeGreaterThan(0);
      expect(card.label.trim()).toBe(card.label);
      expect(card.label.length).toBeGreaterThan(0);
    }
  });

  test("every kind has a word AND a glyph -- colour never carries meaning alone", () => {
    for (const card of CARD_CATALOGUE) {
      expect(KIND_WORD[card.kind]).toBeTruthy();
      expect(KIND_GLYPH[card.kind]).toBeTruthy();
    }
    expect(Object.values(KIND_WORD)).toEqual(["Record", "Ask", "Run"]);
  });

  test("a project-scoped card declares the project precondition", () => {
    const missing = CARD_CATALOGUE.filter(
      (c) => c.needsProject && !c.requires?.some((r) => r.id === "project")
    ).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  test("every card belongs to a module that exists", () => {
    const orphan = CARD_CATALOGUE.filter((c) => !MODULE_CATALOGUE.some((m) => m.id === c.moduleId)).map((c) => c.id);
    expect(orphan).toEqual([]);
  });
});

describe("cardUnmetReason -- the reason is IN WORDS, on the card itself", () => {
  test("a card that can run has no reason", () => {
    const wpr = CARD_CATALOGUE.find((c) => c.id === "work-progress.report")!;
    expect(cardUnmetReason(wpr, NO_UNMET)).toBeNull();
  });

  test("Run WPR with no BOQ says exactly that", () => {
    const wpr = CARD_CATALOGUE.find((c) => c.id === "work-progress.report")!;
    expect(cardUnmetReason(wpr, new Set<CardPreconditionId>(["boq"]))).toBe(
      "Run WPR — no BOQ on this project yet"
    );
  });

  test("a missing project outranks a missing BOQ -- it is the earlier question", () => {
    const wpr = CARD_CATALOGUE.find((c) => c.id === "work-progress.report")!;
    expect(cardUnmetReason(wpr, new Set<CardPreconditionId>(["project", "boq"]))).toBe(
      "Run WPR — pick a project first"
    );
  });

  test("an org-wide card is never blocked for want of a project", () => {
    const reports = CARD_CATALOGUE.find((c) => c.id === "reports.open")!;
    expect(cardUnmetReason(reports, new Set<CardPreconditionId>(["project"]))).toBeNull();
  });
});

describe("cardsForRole -- the cold-start order", () => {
  test("a site engineer leads with recording progress (A-07 acceptance)", () => {
    expect(cardsForRole("site_engineer")[0].label).toBe("Record progress");
  });

  test("a PM does not lead with a site engineer's card", () => {
    const pm = cardsForRole("pm")[0];
    expect(pm.label).not.toBe("Mark attendance");
  });

  test("an unknown or absent role still gets a full, ordered strip", () => {
    expect(cardsForRole(null)).toHaveLength(CARD_CATALOGUE.length);
    expect(cardsForRole("something_else")).toHaveLength(CARD_CATALOGUE.length);
    expect(cardsForRole(undefined)[0].label).toBe("Record progress");
  });

  test("the order is total and stable -- two calls agree exactly", () => {
    expect(cardsForRole("pm").map((c) => c.id)).toEqual(cardsForRole("pm").map((c) => c.id));
  });

  test("a zero weight sinks a card without removing it", () => {
    const budgets = CARD_CATALOGUE.find((c) => c.id === "budgets.new")!;
    expect(weightFor(budgets, "site_engineer")).toBe(0);
    expect(cardsForRole("site_engineer").map((c) => c.id)).toContain("budgets.new");
  });
});

describe("rankCards -- the server's order wins, the role tops up", () => {
  test("with no ranking at all the role's own order fills the six", () => {
    const { cards } = rankCards({ ranked: [], role: "site_engineer" });
    expect(cards).toHaveLength(6);
    expect(cards[0].label).toBe("Record progress");
  });

  test("the server's order is applied verbatim, not re-sorted", () => {
    const { cards } = rankCards({
      ranked: [{ pillKey: "budgets.new" }, { pillKey: "permits.new" }],
      role: "site_engineer",
    });
    expect(cards.slice(0, 2).map((c) => c.id)).toEqual(["budgets.new", "permits.new"]);
  });

  test("a module name from the pipeline stands in for that module's best card", () => {
    // Every row R53's pipeline wrote used chain.steps[0], so the historical
    // keys in pill_usage are module names, not card ids.
    const { cards } = rankCards({ ranked: [{ pillKey: "Work Progress" }], role: "site_engineer" });
    expect(cards[0].id).toBe("work-progress.entry");
  });

  test("a key this build has no card for is reported, never rendered", () => {
    const { cards, unknownKeys } = rankCards({
      ranked: [{ pillKey: "policies" }, { pillKey: "work-progress.entry" }],
      role: "pm",
    });
    expect(unknownKeys).toEqual(["policies"]);
    expect(cards.map((c) => c.id)).toContain("work-progress.entry");
    expect(cards.some((c) => c.id === "policies")).toBe(false);
  });

  test("the current screen's own module is excluded from the six", () => {
    const { cards } = rankCards({
      ranked: [{ pillKey: "work-progress.entry" }],
      role: "site_engineer",
      excludeModuleId: "work-progress",
    });
    expect(cards.some((c) => c.moduleId === "work-progress")).toBe(false);
    // Excluding a module must not leave the strip short.
    expect(cards).toHaveLength(6);
  });

  test("a card is never listed twice, however many ways it was ranked", () => {
    const { cards } = rankCards({
      ranked: [{ pillKey: "work-progress.entry" }, { pillKey: "Work Progress" }],
      role: "pm",
    });
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
  });

  test("the same inputs produce the same strip -- this is the anti-flicker rule", () => {
    const input = { ranked: [{ pillKey: "Work Progress" }], role: "pm" as const };
    expect(rankCards(input).cards.map((c) => c.id)).toEqual(rankCards(input).cards.map((c) => c.id));
  });

  test("the limit is honoured", () => {
    expect(rankCards({ ranked: [], role: "pm", limit: 3 }).cards).toHaveLength(3);
  });
});

describe("allModulesEntries -- Sumeet's fixed order, then Other, then Platform", () => {
  const entries = allModulesEntries();

  test("Permits is first and Reports is eleventh (A-07 acceptance)", () => {
    expect(entries[0].label).toBe("Permits");
    expect(entries[10].label).toBe("Reports");
  });

  test("the eleven modules come in exactly Sumeet's order", () => {
    expect(entries.slice(0, 11).map((e) => e.moduleId)).toEqual([...SUMEET_MODULE_ORDER]);
  });

  test("'Other - type it' follows the modules", () => {
    expect(entries[11]).toMatchObject({ id: "other", label: OTHER_ENTRY_LABEL, kind: "other" });
  });

  test("the platform group holds the remaining universal pills, last", () => {
    const platform = entries.filter((e) => e.kind === "platform");
    expect(platform).toHaveLength(PLATFORM_PILLS.length);
    expect(entries.slice(12).every((e) => e.kind === "platform")).toBe(true);
    // D-10: the same name must still reach the same destination.
    expect(platform.find((e) => e.label === "Customers")?.moduleId).toBe("customers");
    expect(platform.find((e) => e.label === "Vendors")?.moduleId).toBe("vendors");
    expect(platform.find((e) => e.label === "Minutes of Meeting")?.moduleId).toBe("moms");
  });

  test("a platform pill with no PROJEXA screen says why, rather than dead-ending", () => {
    const email = allModulesEntries().find((e) => e.label === "Email")!;
    expect(email.moduleId).toBeNull();
    expect(email.unavailable).toBe("not part of PROJEXA");
    const projects = allModulesEntries().find((e) => e.id === "platform.projects")!;
    expect(projects.unavailable).toBe("pick one in the top rail");
  });

  test("every module id in the fixed order really exists", () => {
    const missing = SUMEET_MODULE_ORDER.filter((id) => !MODULE_CATALOGUE.some((m) => m.id === id));
    expect(missing).toEqual([]);
  });

  test("the expanded list never changes between calls -- it is not usage-ranked", () => {
    expect(allModulesEntries().map((e) => e.id)).toEqual(allModulesEntries().map((e) => e.id));
  });
});

describe("rankedKeyForCard -- keeping the pill path alive across the rename", () => {
  test("an exact card id in the ranking is returned", () => {
    const card = CARD_CATALOGUE.find((c) => c.id === "work-progress.entry")!;
    expect(rankedKeyForCard(card, [{ pillKey: "work-progress.entry" }])).toBe("work-progress.entry");
  });

  test("the pipeline's module-name key maps back to the card of that module", () => {
    // Every row R53's pipeline wrote used chain.steps[0], so the function_id a
    // click needs is filed under "Work Progress", not "work-progress.entry".
    const card = CARD_CATALOGUE.find((c) => c.id === "work-progress.entry")!;
    expect(rankedKeyForCard(card, [{ pillKey: "Work Progress" }])).toBe("Work Progress");
  });

  test("an exact id wins over a module match", () => {
    const card = CARD_CATALOGUE.find((c) => c.id === "work-progress.report")!;
    expect(
      rankedKeyForCard(card, [{ pillKey: "Work Progress" }, { pillKey: "work-progress.report" }])
    ).toBe("work-progress.report");
  });

  test("a card with nothing ranked for its module returns null", () => {
    const card = CARD_CATALOGUE.find((c) => c.id === "budgets.new")!;
    expect(rankedKeyForCard(card, [{ pillKey: "Permits" }])).toBeNull();
    expect(rankedKeyForCard(card, [])).toBeNull();
  });
});

// R67 WS-A -- REVIEW FIX. The shell used to record a pill_usage row for every
// entry in the expanded list, including four -- "Other - type it", "Projects"
// (the rail), Email and Teams -- that have no rankable card at all. The server
// stored them, labelForPillKey() humanised them to "Other" and "Platform
// Email", and on the next read rankCards() found neither a card id nor a module
// for them, pushed them to unknownKeys and the strip logged a warning and
// dropped them -- AFTER each had consumed one of the six slots the server
// returns, so the user's real sixth card never arrived.
//
// The rule is now isRankablePill(), and this is the assertion that keeps the
// two halves honest: everything the shell records resolves, and everything it
// declines to record really has nothing to resolve to.
describe("every key the shell records can be ranked back into a card", () => {
  /** The last step of the chain the shell sends, which is what
   *  compliance-tracker's labelForPillKey() returns for a row that carries one
   *  (projexa-pill-usage-service.ts:82-84) -- mirroring M24Shell's two arms. */
  function recordedLabel(entry: PillEntry): string {
    if (entry.destination === "module") {
      return MODULE_CATALOGUE.find((m) => m.id === entry.moduleId)?.label ?? entry.label;
    }
    return entry.label;
  }

  const recorded = PILL_CATALOGUE.filter(isRankablePill);

  test("the sweep is not vacuous", () => {
    expect(recorded.length).toBeGreaterThan(10);
    expect(recorded.some((e) => e.destination === "view")).toBe(true);
  });

  test("none of them lands in unknownKeys", () => {
    for (const entry of recorded) {
      const { unknownKeys } = rankCards({
        ranked: [{ pillKey: entry.id, label: recordedLabel(entry) }],
        role: null,
      });
      expect({ id: entry.id, unknownKeys }).toEqual({ id: entry.id, unknownKeys: [] });
    }
  });

  test("and each one really pulls its own module's card to the front", () => {
    // Stronger than "no warning": rankCards() always tops up from the role
    // order, so an ignored key would still return six cards.
    for (const entry of recorded) {
      const { cards } = rankCards({ ranked: [{ pillKey: entry.id, label: recordedLabel(entry) }], role: null });
      expect({ id: entry.id, module: cards[0]?.moduleId }).toEqual({ id: entry.id, module: entry.moduleId });
    }
  });

  test("what is NOT recorded is exactly what could not be ranked", () => {
    const declined = PILL_CATALOGUE.filter((e) => !isRankablePill(e));
    // The four the review named ("Other", the rail's Projects, Email, Teams),
    // the two real screens that belong to no module in this catalogue
    // (Policies -> /grc, Department -> /employees), and the two modules that
    // have no card in CARD_CATALOGUE for a ranking to stand in for.
    expect(declined.map((e) => e.id).sort()).toEqual(
      [
        "other",
        "platform.customers",
        "platform.department",
        "platform.email",
        "platform.policies",
        "platform.projects",
        "platform.teams",
        "platform.vendors",
      ].sort()
    );
  });

  test("...because ranking any of them would change nothing on screen", () => {
    // The precise cost, stated as an equality: a row for one of these produces
    // the SAME strip as no row at all, having spent one of the server's six
    // slots to do it. Four are rejected outright (unknownKeys) and two resolve
    // to a module with no card, which rankCards() then skips.
    const baseline = rankCards({ ranked: [], role: null }).cards.map((c) => c.id);
    for (const entry of PILL_CATALOGUE.filter((e) => !isRankablePill(e))) {
      const { cards } = rankCards({ ranked: [{ pillKey: entry.id, label: entry.label }], role: null });
      expect({ id: entry.id, cards: cards.map((c) => c.id) }).toEqual({ id: entry.id, cards: baseline });
    }
  });
});
