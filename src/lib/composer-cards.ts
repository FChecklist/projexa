// R67 WS-A (A-20) -- THE CARDS THAT BELONG TO THE SCREEN YOU ARE ON.
//
// THE DEFECT THIS CLOSES, in the audit's own measurement: the composer was
// cropped on seventeen captured tabs and eight of those crops were byte-for-byte
// identical. Eight different screens -- the attendance register, the timesheet,
// the material receipts, the schedule board -- offered the same row of controls,
// because the strip was computed from the MODULE and a module has one set of
// leaves however many tabs it has. A screen that offers the same thing as every
// other screen is a screen the composer is not helping with.
//
// SO THE KEY IS ROUTE **AND TAB**. /work-progress?tab=entry is a form you write
// into; ?tab=report is a report you run; ?tab=analytics is a number you ask
// about. They are three different jobs behind one module name, and each gets its
// own verbs.
//
// WHAT A CARD DOES WHEN IT IS CLICKED, and the one rule that governs all of it:
// *** IT NEVER EXECUTES. *** There are three honest outcomes and no fourth --
//
//   open.kind "leaf"    the card owns a real destination in the module
//                       catalogue and opens it. This is A-02/A-04's rule and it
//                       is why "Record progress" puts the cursor in the form's
//                       Activity field instead of dropping the user on a screen
//                       to find it.
//   open.kind "suffix"  the card opens a page BELOW the object you are looking
//                       at -- /scope/<id> + "/revise". Only an object page can
//                       produce these, which is exactly why they could never be
//                       module-level leaves (A-12 recorded that: /scope/[id]/
//                       revise and /compare need an id).
//   open.kind "query"   the card opens THIS page with a parameter that puts the
//                       cursor on the control it names (?focus=share).
//   open absent         load-and-stop: the chain is set in the strip, the box
//                       takes the rest, and the user finishes the sentence in
//                       words. It is what A-20's own title asks for ("loads its
//                       chain level and stops"), and the click that would
//                       COMPLETE such a sentence in one more click is WS-C's
//                       ConfirmCard and WS-B's executor registration -- this
//                       item's own declared dependencies (C-16, B-11).
//
// DEVIATIONS FROM THE ITEM'S TABLE, each because the thing it names does not
// exist in either repo and a card that promises it would fail after the click:
//
//   "Mark attendance (all present today)" ships as "Mark attendance". A batch
//   attendance write does not exist: compliance-tracker's recordAttendance
//   writes ONE row and there is no batch endpoint anywhere, so "all present"
//   is a promise nothing can keep. The card opens the real one-worker form.
//
//   "Submit for approval" on /scope/<id> ships as "Compare revisions". There is
//   no BOQ approval flow in either repo. /scope/<id>/compare IS shipped, is one
//   of the two things a person does to a BOQ besides revising it, and needs
//   precisely the object context this table has.
//
//   "Record progress on this BOQ" ships as "Record progress". The Work Progress
//   entry form takes a project, not a boqId -- only the REPORT takes one -- so
//   the two extra words would claim something the URL cannot carry.
//
//   "Export" on /materials?tab=cost-report is DROPPED. That tab renders a table
//   and has no export of any kind, client or server; a card offering one would
//   be the only thing on screen that says the file exists.
//
//   "Run <selected report>" on /reports ships as "Run report". Which report is
//   selected lives inside ReportsClient's own state and is not published to the
//   shell; naming a report the composer cannot see would be a guess.

import { MODULE_CATALOGUE, moduleHref, normalisePathname, type ModuleDef } from "./module-catalogue";

/** One segment of the chain a card loads. Never a root -- the project and the
 *  screen's own module are already the strip's first segments. */
export type CardChainSegment = { id: string; label: string; kind: "action" | "step" };

/**
 * A default the card carries, in the words the card shows.
 *
 * IT IS NOT DECORATION AND IT IS NOT A PROMISE. A preset names a value the
 * destination ALREADY defaults to -- the WPR's date range is the 1st of the
 * month to today (WorkProgressReportClient computes it), the time log's date is
 * today (ScheduleLogTimeClient's spentOn) -- and the card's LABEL IS BUILT FROM
 * IT (see card() below), so a card can never state a default it does not carry
 * or carry one it does not state. That is asserted in the test rather than
 * trusted: it is the whole reason the value is data here and not a hand-written
 * parenthesis in a string.
 */
export type CardPreset = { key: string; label: string };

export type CardOpen =
  /** A leaf of module-catalogue: its own route, its own query. */
  | { kind: "leaf"; leafId: string }
  /** The CURRENT path plus this suffix. Object pages only. */
  | { kind: "suffix"; suffix: string }
  /** The current path with this query, to put the cursor on a control. */
  | { kind: "query"; query: Readonly<Record<string, string>> };

export type ScreenCard = {
  id: string;
  /** The verb, on its own, because A-20's acceptance reads verbs. */
  verb: string;
  object: string;
  /** verb + object, as one phrase. This is what the user reads. */
  label: string;
  moduleId: string;
  /** The chain a click loads into the strip. */
  chain: readonly CardChainSegment[];
  open?: CardOpen;
  presets?: readonly CardPreset[];
};

function card(
  id: string,
  moduleId: string,
  verb: string,
  object: string,
  extra: Partial<Pick<ScreenCard, "open" | "presets">> = {},
  /** Only for a card whose phrase is not "<verb> <object>" -- "Who is absent?". */
  labelOverride?: string
): ScreenCard {
  const mod = MODULE_CATALOGUE.find((m) => m.id === moduleId);
  const presets = extra.presets ?? [];
  // The presets ARE the parenthesis: "Run WPR" + { range: "this month" } reads
  // "Run WPR (this month)". Writing that phrase by hand as well would be two
  // statements of one fact, and the pair drifts the first time one is edited.
  const label =
    labelOverride ??
    (presets.length ? `${verb} ${object} (${presets.map((p) => p.label).join(", ")})` : `${verb} ${object}`);
  return {
    id,
    verb,
    object,
    label,
    moduleId,
    chain: [
      { id: moduleId, label: mod?.label ?? moduleId, kind: "action" },
      { id, label, kind: "step" },
    ],
    ...extra,
  };
}

/**
 * KEYED BY "<path>|<tab>". The empty tab is a real key: /reports has no tabs of
 * its own, and a screen whose tab is not named here falls through to its
 * module's leaves rather than to nothing.
 */
const BY_ROUTE_AND_TAB: Readonly<Record<string, readonly ScreenCard[]>> = {
  "/work-progress|entry": [
    card("wp.entry", "work-progress", "Record", "progress", { open: { kind: "leaf", leafId: "work-progress.entry" } }),
  ],
  "/work-progress|analytics": [
    // No route of its own: the number is already on screen, and what the user
    // wants is a sentence about it. Load-and-stop, and the box takes the rest.
    card("wp.explain", "work-progress", "Explain", "this number"),
  ],
  "/work-progress|report": [
    // "(this month)" is not a preset invented here: it is the range this report
    // already defaults to (WorkProgressReportClient computes the 1st of the
    // month to today), and A-04 made ?run=1 run it on arrival. The label states
    // what will happen rather than adding a parameter nothing reads.
    card("wp.report", "work-progress", "Run", "WPR", {
      open: { kind: "leaf", leafId: "work-progress.report" },
      presets: [{ key: "range", label: "this month" }],
    }),
    card("wp.export", "work-progress", "Export", "CSV", {
      open: { kind: "leaf", leafId: "work-progress.export" },
    }),
  ],
  "/labour|attendance": [
    card("labour.attendance", "labour", "Mark", "attendance", {
      open: { kind: "leaf", leafId: "labour.attendance" },
    }),
    card("labour.absent", "labour", "Ask", "who is absent", {}, "Who is absent?"),
  ],
  "/materials|receipts": [
    card("materials.receipt", "materials", "Record", "receipt", {
      open: { kind: "leaf", leafId: "materials.receipt" },
    }),
  ],
  "/schedule|board": [
    // Moving a task IS the board -- the drag is the control. The card sets the
    // sentence so it can be said in words instead.
    card("schedule.move", "schedule", "Move", "task"),
    card("schedule.task", "schedule", "New", "task", { open: { kind: "leaf", leafId: "schedule.task" } }),
  ],
  "/schedule|timesheet": [
    // The form's own date field already defaults to today
    // (ScheduleLogTimeClient: spentOn = new Date()), so the label states a
    // default rather than promising a parameter.
    card("schedule.time", "schedule", "Log", "time", {
      open: { kind: "leaf", leafId: "schedule.time" },
      presets: [{ key: "spentOn", label: "today" }],
    }),
  ],
  "/reports|": [card("reports.run", "reports", "Run", "report", { open: { kind: "leaf", leafId: "reports.open" } })],
};

/** Object pages, matched by shape. "new" is excluded: it is a create page. */
const OBJECT_PAGES: readonly { test: RegExp; cards: readonly ScreenCard[] }[] = [
  {
    test: /^\/scope\/(?!new$)[^/]+$/,
    cards: [
      card("scope.revise", "scope", "Create", "revision", { open: { kind: "suffix", suffix: "/revise" } }),
      card("scope.compare", "scope", "Compare", "revisions", { open: { kind: "suffix", suffix: "/compare" } }),
      card("scope.progress", "scope", "Record", "progress", {
        open: { kind: "leaf", leafId: "work-progress.entry" },
      }),
    ],
  },
  {
    test: /^\/moms\/(?!new$)[^/]+$/,
    cards: [
      // Both controls are live on the object page itself; the card puts the
      // cursor on the one it names rather than doing it, because a card that
      // wrote a share link from one click would be executing.
      card("moms.minutes", "moms", "Save", "minutes", { open: { kind: "query", query: { focus: "minutes" } } }),
      card("moms.share", "moms", "Share", "via WhatsApp", { open: { kind: "query", query: { focus: "share" } } }),
    ],
  },
];

/** The module's own leaves, as cards, for a screen this table does not name. */
function leafCards(mod: ModuleDef): ScreenCard[] {
  return mod.leaves.map((leaf) => {
    const [verb, ...rest] = leaf.label.split(" ");
    return {
      id: leaf.id,
      verb,
      object: rest.join(" ") || mod.label,
      label: leaf.label,
      moduleId: mod.id,
      chain: [
        { id: mod.id, label: mod.label, kind: "action" as const },
        { id: leaf.id, label: leaf.label, kind: "step" as const },
      ],
      open: { kind: "leaf" as const, leafId: leaf.id },
    };
  });
}

/**
 * The cards for this screen.
 *
 * A TAB IS ONLY MATCHED WHEN IT IS ACTUALLY IN THE URL. /work-progress with no
 * ?tab= falls through to the module's leaves deliberately: A-04's acceptance is
 * that the first two cards there are "Record progress" and "Run WPR", and
 * resolving the page's default tab here would silently reduce that to one.
 */
export function cardsFor(pathname: string, tab?: string | null): ScreenCard[] {
  const path = normalisePathname(pathname);
  for (const page of OBJECT_PAGES) {
    if (page.test.test(path)) return [...page.cards];
  }
  const keyed = BY_ROUTE_AND_TAB[`${path}|${tab ?? ""}`];
  if (keyed) return [...keyed];
  const mod = MODULE_CATALOGUE.find((m) =>
    m.prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  );
  // The Dashboard is the grouped module directory, not a module you build a
  // task in (module-catalogue's chainModule: false), so it offers no verbs of
  // its own -- the ranked cards below are the whole answer there.
  return mod && mod.chainModule !== false ? leafCards(mod) : [];
}

/** The URL a card opens, or null when it loads its chain and stops. */
export function hrefForScreenCard(
  card: ScreenCard,
  context: { pathname: string; projectId: string | null }
): string | null {
  if (!card.open) return null;
  const path = normalisePathname(context.pathname);
  switch (card.open.kind) {
    case "leaf": {
      const mod = MODULE_CATALOGUE.find((m) => m.id === card.moduleId) ?? null;
      // A card may borrow another module's leaf -- "Record progress" on a BOQ
      // object page opens Work Progress -- so the leaf is looked up across the
      // catalogue rather than only inside the card's own module.
      const owner =
        mod?.leaves.some((l) => l.id === (card.open as { leafId: string }).leafId)
          ? mod
          : (MODULE_CATALOGUE.find((m) =>
              m.leaves.some((l) => l.id === (card.open as { leafId: string }).leafId)
            ) ?? null);
      const leaf = owner?.leaves.find((l) => l.id === (card.open as { leafId: string }).leafId);
      return leaf ? moduleHref(leaf, context.projectId) : null;
    }
    case "suffix":
      return `${path}${card.open.suffix}`;
    case "query": {
      const params = new URLSearchParams(card.open.query);
      if (context.projectId) params.set("projectId", context.projectId);
      return `${path}?${params.toString()}`;
    }
  }
}

/**
 * THE SEGMENTS A CLICK LOADS, GIVEN WHAT THE STRIP ALREADY SAYS.
 *
 * A card's `chain` is the whole sentence it means -- "Work Progress > Run WPR
 * (this month)". But on a module route the strip ALREADY carries that module as
 * a fixed segment (A-02/A-06: "<project> > Work Progress"), so loading the whole
 * sentence there would read "<project> > Work Progress > Work Progress > Run
 * WPR", which is the module named twice in one line.
 *
 * It also matters for what the composer thinks the user has PICKED: M24Shell
 * derives the selected module from the first "action" segment, so leaving a
 * module segment in place on its own screen would make the shell believe the
 * user had chosen a module from the list -- which stands the screen's own card
 * row down and puts that module's leaves in band 2 instead. Clicking a card on
 * this screen must not replace the controls the click came from.
 *
 * So the leading module segment is dropped when -- and only when -- it names the
 * module the strip is already showing. A card that borrows ANOTHER module's verb
 * ("Record progress" on a BOQ page) keeps it, because there the module really is
 * a new word in the sentence.
 */
export function chainForScreenCard(
  card: ScreenCard,
  screenModuleId: string | null
): readonly CardChainSegment[] {
  const [first, ...rest] = card.chain;
  if (!first) return card.chain;
  if (screenModuleId && first.id === screenModuleId && rest.length > 0) return rest;
  return card.chain;
}

/** Every route+tab key this table names (used by its test). */
export function screenCardKeys(): string[] {
  return Object.keys(BY_ROUTE_AND_TAB).sort();
}
