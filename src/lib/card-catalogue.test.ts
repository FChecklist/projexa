/// <reference types="bun-types" />
// R67 WS-A (A-07). Two things here are worth guarding mechanically, because
// both are the kind of thing a reader cannot check by eye:
//
//  1. EVERY CARD OPENS A REAL PAGE. A card carries a leafId, not a path, and
//     the leaf's path is already checked against the shipped-route registry --
//     so what is asserted here is that every card's leafId RESOLVES. A card
//     whose leaf was renamed would otherwise render, look correct and do
//     nothing.
//
//  2. THE RANKING IS DETERMINISTIC. The strip must not shuffle between two
//     renders with the same inputs, which is the flicker A-07 exists to kill.
import { describe, test, expect } from "bun:test";
import {
  CARD_CATALOGUE,
  KIND_GLYPH,
  KIND_WORD,
  OTHER_ENTRY_LABEL,
  PLATFORM_PILLS,
  SUMEET_MODULE_ORDER,
  allModulesEntries,
  cardHref,
  cardUnmetReason,
  cardsForRole,
  rankCards,
  rankedKeyForCard,
  targetForCard,
  weightFor,
  type CardPreconditionId,
} from "./card-catalogue";
import { MODULE_CATALOGUE } from "./module-catalogue";
import { PILL_CATALOGUE, isRankablePill, type PillEntry } from "./pill-catalogue";
import { isShippedRoute } from "./nav-routes";

const NO_UNMET = new Set<CardPreconditionId>();

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
