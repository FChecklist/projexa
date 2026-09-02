/// <reference types="bun-types" />
// R67 WS-A (A-20). The acceptance has a vitest half and a Playwright half; the
// vitest half is exactly this file (bun's runner, same assertions), and the
// Playwright half -- cropping the composer on seventeen tabs and diffing the
// md5s -- needs a dev server this lane may not start.
//
// What the md5 assertion is really testing, though, is a property of THIS
// table: that no two of the captured tabs resolve to the same set of cards. So
// that is asserted directly, over every route+tab the table names, which is a
// stronger statement than eight image hashes differing.
import { describe, test, expect } from "bun:test";
import { cardsFor, chainForScreenCard, hrefForScreenCard, screenCardKeys } from "./composer-cards";
import { MODULE_CATALOGUE } from "./module-catalogue";
import { isShippedRoute } from "./nav-routes";

describe("A-20's own acceptance", () => {
  test("cardsFor('/work-progress', 'report') returns two cards, verbs 'Run' and 'Export'", () => {
    const cards = cardsFor("/work-progress", "report");
    expect(cards.length).toBe(2);
    expect(cards.map((c) => c.verb)).toEqual(["Run", "Export"]);
    expect(cards[0].label).toBe("Run WPR (this month)");
    expect(cards[1].label).toBe("Export CSV");
  });

  test("cardsFor('/scope/abc') returns three cards", () => {
    expect(cardsFor("/scope/abc").length).toBe(3);
  });

  test("on /labour?tab=attendance the first card is the attendance verb", () => {
    const cards = cardsFor("/labour", "attendance");
    // DEVIATION, disclosed in the module header: the item's string is "Mark
    // attendance (all present today)". A batch attendance write does not exist
    // in either repo -- recordAttendance writes ONE row and there is no batch
    // endpoint -- so the parenthetical would be a promise nothing can keep.
    expect(cards[0].label).toBe("Mark attendance");
    expect(cards[0].verb).toBe("Mark");
    expect(cards[1].label).toBe("Who is absent?");
  });

  test("no card can execute: none carries a function id, and none is a write", () => {
    for (const key of screenCardKeys()) {
      const [path, tab] = key.split("|");
      for (const card of cardsFor(path, tab)) {
        // The shape itself is the guarantee -- there is nowhere on a ScreenCard
        // to put a functionId, so a click cannot arm the pill path and cannot
        // POST /api/tasks.
        expect(Object.keys(card)).not.toContain("functionId");
        expect(card.chain.every((s) => s.kind === "action" || s.kind === "step")).toBe(true);
      }
    }
  });
});

describe("a preset is a default the card STATES, not one it merely carries", () => {
  test("every preset's own words appear in the label the user reads", () => {
    for (const key of [...screenCardKeys(), "/scope/abc|", "/moms/abc|"]) {
      const [path, tab] = key.split("|");
      for (const card of cardsFor(path, tab)) {
        for (const preset of card.presets ?? []) {
          expect(card.label).toContain(preset.label);
        }
      }
    }
  });

  test("the two cards with defaults read as the item names them", () => {
    expect(cardsFor("/work-progress", "report")[0].label).toBe("Run WPR (this month)");
    expect(cardsFor("/schedule", "timesheet")[0].label).toBe("Log time (today)");
  });

  test("a card with no preset gets no parenthesis", () => {
    expect(cardsFor("/materials", "receipts")[0].label).toBe("Record receipt");
  });
});

describe("what a click loads into the strip", () => {
  test("the module is not named twice: on its own screen the module segment is dropped", () => {
    const runWpr = cardsFor("/work-progress", "report")[0];
    // The card's own sentence is the whole thing...
    expect(runWpr.chain.map((s) => s.label)).toEqual(["Work Progress", "Run WPR (this month)"]);
    // ...but the strip already reads "<project> > Work Progress" on this route,
    // so only the step is loaded.
    expect(chainForScreenCard(runWpr, "work-progress").map((s) => s.label)).toEqual(["Run WPR (this month)"]);
  });

  test("what remains has no 'action' segment, so the screen's own card row stands", () => {
    // M24Shell reads the picked module off the first "action" segment. If the
    // module segment survived on its own screen the shell would believe the
    // user had picked a module from the list, hide these very cards and put the
    // module's leaves in band 2 instead -- a click changing the controls it
    // came from.
    const loaded = chainForScreenCard(cardsFor("/work-progress", "report")[0], "work-progress");
    expect(loaded.every((s) => s.kind === "step")).toBe(true);
  });

  test("a card whose module is NOT the screen's keeps that module in the sentence", () => {
    // The rule is "drop the word the strip is already showing", not "drop the
    // first word". Standing somewhere else, the module IS new information.
    const revise = cardsFor("/scope/abc").find((c) => c.id === "scope.revise")!;
    expect(chainForScreenCard(revise, "work-progress").map((s) => s.label)).toEqual([
      "Scope of Work",
      "Create revision",
    ]);
  });

  test("an object page drops its own module too -- '<project> > Scope of Work > Create revision'", () => {
    const revise = cardsFor("/scope/abc").find((c) => c.id === "scope.revise")!;
    expect(chainForScreenCard(revise, "scope").map((s) => s.label)).toEqual(["Create revision"]);
  });

  test("off a module route (no screen module) the whole sentence loads", () => {
    const runWpr = cardsFor("/work-progress", "report")[0];
    expect(chainForScreenCard(runWpr, null)).toEqual(runWpr.chain);
  });

  test("no segment of a loaded chain is a root -- the project and the module are the strip's own", () => {
    for (const key of [...screenCardKeys(), "/scope/abc|", "/moms/abc|"]) {
      const [path, tab] = key.split("|");
      for (const card of cardsFor(path, tab)) {
        for (const segment of chainForScreenCard(card, card.moduleId)) {
          expect(segment.kind === "action" || segment.kind === "step").toBe(true);
        }
      }
    }
  });
});

describe("the eight identical composer crops: no two screens now offer the same cards", () => {
  test("every route+tab in the table has a distinct set of card ids", () => {
    const seen = new Map<string, string>();
    for (const key of screenCardKeys()) {
      const [path, tab] = key.split("|");
      const signature = cardsFor(path, tab)
        .map((c) => c.id)
        .join(",");
      expect(signature.length).toBeGreaterThan(0);
      const clash = seen.get(signature);
      if (clash) throw new Error(`${key} offers the same cards as ${clash}`);
      seen.set(signature, key);
    }
  });

  test("one module's tabs differ from each other, which is the whole point", () => {
    const entry = cardsFor("/work-progress", "entry").map((c) => c.id);
    const report = cardsFor("/work-progress", "report").map((c) => c.id);
    const analytics = cardsFor("/work-progress", "analytics").map((c) => c.id);
    expect(entry).not.toEqual(report);
    expect(entry).not.toEqual(analytics);
    expect(report).not.toEqual(analytics);
  });
});

describe("every destination is a page that really ships", () => {
  test("a leaf card resolves to a real leaf of a real module", () => {
    for (const key of [...screenCardKeys(), "/scope/abc|", "/moms/abc|"]) {
      const [path, tab] = key.split("|");
      for (const card of cardsFor(path, tab)) {
        if (card.open?.kind !== "leaf") continue;
        const leafId = card.open.leafId;
        const owner = MODULE_CATALOGUE.find((m) => m.leaves.some((l) => l.id === leafId));
        expect(owner).toBeDefined();
        const href = hrefForScreenCard(card, { pathname: path, projectId: "p1" });
        expect(href).not.toBeNull();
        expect(isShippedRoute(href!.split("?")[0])).toBe(true);
      }
    }
  });

  test("an object-page suffix card opens a route that exists as a dynamic page", () => {
    const cards = cardsFor("/scope/abc");
    const hrefs = cards
      .filter((c) => c.open?.kind === "suffix")
      .map((c) => hrefForScreenCard(c, { pathname: "/scope/abc", projectId: "p1" }));
    expect(hrefs).toEqual(["/scope/abc/revise", "/scope/abc/compare"]);
    // The registry stores the dynamic form of the same routes.
    expect(isShippedRoute("/scope/[id]/revise")).toBe(true);
    expect(isShippedRoute("/scope/[id]/compare")).toBe(true);
  });

  test("a card may borrow another module's leaf -- 'Record progress' on a BOQ", () => {
    const progress = cardsFor("/scope/abc").find((c) => c.id === "scope.progress")!;
    expect(hrefForScreenCard(progress, { pathname: "/scope/abc", projectId: "p1" })).toBe(
      "/work-progress?tab=entry&focus=activity&projectId=p1"
    );
  });

  test("a focus card opens THIS page with the control it names", () => {
    const share = cardsFor("/moms/abc").find((c) => c.id === "moms.share")!;
    expect(hrefForScreenCard(share, { pathname: "/moms/abc", projectId: "p1" })).toBe(
      "/moms/abc?focus=share&projectId=p1"
    );
  });

  test("a load-and-stop card has no href at all", () => {
    const explain = cardsFor("/work-progress", "analytics")[0];
    expect(explain.open).toBeUndefined();
    expect(hrefForScreenCard(explain, { pathname: "/work-progress", projectId: "p1" })).toBeNull();
  });
});

describe("the fallback, and what it protects", () => {
  test("a screen the table does not name still offers its module's leaves", () => {
    expect(cardsFor("/permits").map((c) => c.label)).toEqual(["New", "Expiring soon", "Open"]);
  });

  test("A-04 SURVIVES: /work-progress with no ?tab still leads with its two verbs", () => {
    // The page defaults to the entry tab, but resolving that default HERE would
    // reduce this to one card and break A-04's acceptance, which is that the
    // first two strip cards on /work-progress are "Record progress" and
    // "Run WPR". A tab is matched only when the URL actually carries one.
    const labels = cardsFor("/work-progress").map((c) => c.label);
    expect(labels[0]).toBe("Record progress");
    expect(labels[1]).toBe("Run WPR");
  });

  test("a create page shows its module's leaves, not a third set", () => {
    expect(cardsFor("/permits/new").map((c) => c.id)).toEqual(cardsFor("/permits").map((c) => c.id));
  });

  test("/scope/new is a create page, not an object page", () => {
    expect(cardsFor("/scope/new").map((c) => c.id)).toEqual(cardsFor("/scope").map((c) => c.id));
  });

  test("the Dashboard offers no verbs of its own -- it IS the module directory", () => {
    expect(cardsFor("/dashboard")).toEqual([]);
  });

  test("a route belonging to no module offers nothing rather than guessing", () => {
    expect(cardsFor("/settings")).toEqual([]);
  });

  test("a trailing slash and a query on the pathname change nothing", () => {
    expect(cardsFor("/work-progress/", "report").map((c) => c.id)).toEqual(
      cardsFor("/work-progress", "report").map((c) => c.id)
    );
  });
});
