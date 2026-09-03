// R67 -- PROJEXA'S CARD CATALOGUES.
//
// R67 MERGE NOTE (decision D-11): this file carries TWO INDEPENDENT card
// systems that were each built, under this same filename, by a different
// lane of the same programme -- and turned out, on inspection, not to be the
// same concept wearing different field names. They are kept SEPARATE rather
// than forced into one shape:
//
//  - WS-A's (A-07) CardDef / CARD_CATALOGUE is a ROLE-RANKED "verb + object"
//    card model: what a person can start, ordered by their role and the
//    server's own usage ranking, rendered beside the kit's pill strip. THIS
//    IS THE CANONICAL ONE per D-11 -- it is what shipped to main first, and
//    every symbol in this half keeps its original name unchanged.
//  - WS-C's (C-02 .. C-16) card system is the COMPOSER'S OWN: what a card's
//    chain asks in band 2, the six report leaves, the DOORS table (one
//    sentence, one destination, three ways in), attachment policy, and the
//    timesheet card's own fuzzy task match. Its own `CardDef` and
//    `CARD_CATALOGUE` are renamed here to `ComposerCardDef` and
//    `COMPOSER_CARD_CATALOGUE` so they no longer collide with WS-A's -- every
//    OTHER symbol in this half (DOORS, ReportLeaf, ChainOptionsLevel, and so
//    on) was already uniquely named and is unchanged. Nothing WS-C built was
//    discarded; only the two names that collided were renamed, and every one
//    of WS-C's own tests moved with it (see card-catalogue.test.ts).
//
// WHY BOTH LIVE HERE, AND WHY NEITHER IS A SUBSET OF THE OTHER: WS-A answers
// "what six things does this role usually do, ranked by the server" for the
// strip beside the pills; WS-C answers "given the card the user already
// picked (or the screen they are standing in), what does band 2 ask next" --
// a chain-walk question, not a ranking. A future pass MAY want to unify them
// properly (a role-ranked entry that also carries a chain), but that is a
// real design decision for its own item, not a rename this merge should make
// unilaterally.
//
// WHERE THIS LIVES AND WHY (correction C-12, decision D-09/D-10, owner
// approval): the catalogue of what a PROJEXA user can start from lives in the
// PROJEXA repo, in code. platform.mode_pills has no reader anywhere in either
// codebase, so a row there is governance documentation, not a source of
// truth.

import type { OrgRole } from "@/lib/authz/roles";
import { MB, type AttachPolicy } from "./attachments";
import {
  MODULE_CATALOGUE,
  moduleForPill,
  moduleHref,
  normalisePillKey,
  type ModuleDef,
  type ModuleLeaf,
} from "./module-catalogue";

// ═══════════════════════════════════════════════════════════════════════════
// WS-C -- THE COMPOSER'S OWN CARD, CHAIN, REPORT AND DOOR MODEL
// ═══════════════════════════════════════════════════════════════════════════
//
// PURE. No React, no fetch, no Date.now() of its own -- `now` is passed in --
// so every sentence and every date range below is asserted in
// card-catalogue.test.ts rather than eyeballed in a screenshot.

// ---------------------------------------------------------------------------
// A LEVEL OF THE OPTION CHAIN
// ---------------------------------------------------------------------------

/** One chip. Mirrors the kit's OptionChain `ChainOption`, which renders it. */
export type ChainOptionDto = {
  id: string;
  label: string;
  /** R67 C-08: a second string the grid search matches -- the worker's trade. */
  keywords?: string;
  /** A leaf is the last step -- the thing that would actually be done. */
  isLeaf?: boolean;
  /** Shown, in words, on a chip that cannot be picked. Never a dead end. */
  unavailableReason?: string;
};

/** A sub-heading over part of a level's chips: R67 C-08's trades. */
export type ChainOptionGroup = { label: string; optionIds: readonly string[] };

/** One question the composer asks in band 2. */
export type ChainOptionsLevel = {
  /** The question this level answers: "Which report?", "Which BOQ line?" */
  legend: string;
  /** What kind of segment picking one of these produces (the kit's SegmentKind). */
  kind: "action" | "step";
  options: ChainOptionDto[];
  /** What to say -- and where to send the user -- when there is nothing to choose. */
  emptyPrompt?: { text: string; actionLabel?: string; route?: string };
  /**
   * R67 C-08: this level is answered by picking MANY, not one -- the whole
   * crew at once. `preselectedIds` is what arrives already ticked, because a
   * roster is present by default and the exceptions are what a foreman marks.
   */
  multi?: boolean;
  preselectedIds?: readonly string[];
  /** Trade sub-headings over the chip grid. */
  groups?: readonly ChainOptionGroup[];
  /** The word a search box offers to filter by ("name or trade"). */
  searchBy?: string;
};

// ---------------------------------------------------------------------------
// REPORTS
// ---------------------------------------------------------------------------

export type ReportLeaf = {
  /** The API path segment /api/reports/[reportName] actually runs against. */
  id: string;
  /** How it reads in the chain sentence. */
  label: string;
  /**
   * Where the right pane lands. Per D-02 the Work Progress Report is ONE
   * screen -- /work-progress?tab=report -- and the Reports picker entry and
   * the composer leaf must both reach it, so the same name reaches the same
   * destination whichever path the user took.
   */
  route: "work-progress-report" | "reports-picker";
};

/**
 * The six project reports the composer offers as leaves. Every id is a real
 * /api/reports/[reportName] segment, copied from ReportsClient's own
 * DEFAULT_REPORT_COLUMNS -- the list that page has always run against -- so
 * the composer and the picker cannot offer different reports.
 */
export const REPORT_LEAVES: readonly ReportLeaf[] = [
  { id: "work-progress", label: "Work Progress Report", route: "work-progress-report" },
  { id: "project-status", label: "Project Status Report", route: "reports-picker" },
  { id: "category-progress", label: "Category Progress Report", route: "reports-picker" },
  { id: "budget-vs-actual", label: "Budget vs Actual Report", route: "reports-picker" },
  { id: "attendance", label: "Attendance Report", route: "reports-picker" },
  { id: "manpower-cost", label: "Manpower Cost Report", route: "reports-picker" },
];

export function reportLeafById(id: string): ReportLeaf | null {
  return REPORT_LEAVES.find((r) => r.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// THE PERIOD STEP
// ---------------------------------------------------------------------------

export type PeriodId = "this-month" | "last-month" | "this-quarter" | "this-year";

export type PeriodOption = { id: PeriodId; label: string };

/** C-02: the chain "appends a period step defaulting to 'this month'". */
export const DEFAULT_PERIOD: PeriodId = "this-month";

export const PERIOD_OPTIONS: readonly PeriodOption[] = [
  { id: "this-month", label: "this month" },
  { id: "last-month", label: "last month" },
  { id: "this-quarter", label: "this quarter" },
  { id: "this-year", label: "this year" },
];

export function periodLabel(id: PeriodId): string {
  return PERIOD_OPTIONS.find((p) => p.id === id)?.label ?? DEFAULT_PERIOD;
}

/** ISO yyyy-mm-dd in UTC -- the shape every /api/reports handler expects. */
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The real date range a period means, resolved against `now` in UTC.
 *
 * UTC, not the visitor's zone, for the same reason src/lib/format-date.ts
 * pins it: every date this app sends or stores is an ISO UTC date, and a
 * range that shifts by a day depending on who is looking is a report that
 * cannot be reconciled.
 *
 * An OPEN period ends today, not on the last day of the month -- asking for
 * "this month" and getting rows dated in the future is how a report stops
 * matching the site.
 */
export function resolvePeriod(id: PeriodId, now: Date): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = iso(now);
  switch (id) {
    case "last-month": {
      const first = new Date(Date.UTC(y, m - 1, 1));
      const last = new Date(Date.UTC(y, m, 0));
      return { from: iso(first), to: iso(last) };
    }
    case "this-quarter": {
      const firstMonth = Math.floor(m / 3) * 3;
      return { from: iso(new Date(Date.UTC(y, firstMonth, 1))), to: today };
    }
    case "this-year":
      return { from: iso(new Date(Date.UTC(y, 0, 1))), to: today };
    case "this-month":
    default:
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: today };
  }
}

// ---------------------------------------------------------------------------
// WHERE A LEAF LANDS, AND WHAT THE RECEIPT SAYS
// ---------------------------------------------------------------------------

export type ReportRunParams = {
  report: string;
  projectId: string | null;
  from: string;
  to: string;
};

/**
 * The URL the right pane opens -- THE SAME URL THE PAGE'S OWN BUTTON USES.
 * The Work Progress Report is /work-progress?tab=report (D-02); every other
 * report is the Reports screen with its picker already set and told to run,
 * so arriving from the composer and arriving from the picker end identically.
 */
export function reportRoute(params: ReportRunParams): string {
  const leaf = reportLeafById(params.report);
  const qs = new URLSearchParams();
  if (params.projectId) qs.set("projectId", params.projectId);
  if (leaf?.route === "work-progress-report") {
    qs.set("tab", "report");
    qs.set("from", params.from);
    qs.set("to", params.to);
    return `/work-progress?${qs.toString()}`;
  }
  qs.set("report", params.report);
  qs.set("run", "1");
  return `/reports?${qs.toString()}`;
}

// Built from a fixed table rather than toLocaleDateString, deliberately.
// "en-GB" renders September as "Sept" and "en-US" puts the month first, so
// neither produces "02 Sep 2026" -- and an ICU build difference between the
// server and the browser would make a receipt line hydrate differently. This
// is three lines and cannot drift.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "01 Jan" / "02 Sep 2026". UTC, like every other date this app prints. */
function dayMonth(isoDate: string, withYear: boolean): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return isoDate;
  return `${m[3]} ${month}${withYear ? ` ${m[1]}` : ""}`;
}

/** "01 Jan to 02 Sep 2026". The year is printed once, on the end that has it. */
export function formatReportRange(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${dayMonth(from, !sameYear)} to ${dayMonth(to, true)}`;
}

/**
 * C-02's receipt line, verbatim:
 * "Ran Work Progress Report for Cedar Heights Villa - Phase 1, 01 Jan to 02 Sep 2026"
 *
 * With no project selected it says so rather than printing a blank, because a
 * receipt that omits WHICH project is a receipt nobody can check.
 */
export function reportReceiptLine(input: {
  reportLabel: string;
  projectName: string | null;
  from: string;
  to: string;
}): string {
  const where = input.projectName?.trim() || "all projects";
  return `Ran ${input.reportLabel} for ${where}, ${formatReportRange(input.from, input.to)}`;
}

// ---------------------------------------------------------------------------
// THE LEVELS THE REPORTS SCREEN OFFERS
// ---------------------------------------------------------------------------

/** The entity segment the strip is seeded with on /reports. */
export const REPORTS_ENTITY_SEGMENT = { id: "reports", label: "Reports", kind: "action" as const };

/** The pill this route pins, so the strip's own module is never buried.
 *  Narrowed to the literal because the kit's PillUsage.pillKey is a closed
 *  union -- a widened `string` here would silently stop matching it. */
export const REPORTS_PILL_KEY = "reports" as const;

/** "Which report?" -- level 1 of the Reports chain. */
export function reportOptionsLevel(): ChainOptionsLevel {
  return {
    legend: "Which report?",
    kind: "step",
    options: REPORT_LEAVES.map((r) => ({ id: r.id, label: r.label, isLeaf: true })),
  };
}

/** "Over what period?" -- level 2, offered once a report is chosen. */
export function periodOptionsLevel(): ChainOptionsLevel {
  return {
    legend: "Over what period?",
    kind: "step",
    options: PERIOD_OPTIONS.map((p) => ({ id: p.id, label: p.label, isLeaf: true })),
  };
}

// ---------------------------------------------------------------------------
// THE COMPOSER'S OWN CARDS (R67 C-03) -- WHAT A USER CAN START FROM
// ---------------------------------------------------------------------------

/** One thing a card can start. R67 C-04: band 2's ACTION level. */
export type CardAction = {
  id: string;
  /** The verb the user reads: "Record progress". */
  label: string;
  /** The pipeline function this action ends in, when it has one. */
  functionId: string | null;
};

/**
 * R67 MERGE (D-11): renamed from `CardDef` -- see the file-level merge note.
 * Every field here is WS-C's own; nothing was dropped or altered.
 */
export type ComposerCardDef = {
  /** Stable key. Not a kit PillKey: the kit's union is closed at 14 and this
   *  catalogue is PROJEXA's own (C-12), so these render beside the kit strip. */
  id: string;
  /** The words on the card. A noun a person would say out loud. */
  label: string;
  kind: "action";
  /** The pipeline function this card's work ends in, when it has one. */
  functionId: string | null;
  /** The screen the card opens. Opening a screen is a read. */
  route: string;
  /** The segment a card click puts on the strip, after the project. */
  entitySegment: { id: string; label: string; kind: "action" };
  /**
   * The routes on which this card's chain is seeded automatically, because
   * the user is already standing in it.
   */
  routes: readonly string[];
  /** The composer's placeholder while this card's chain is loaded. */
  placeholder: string;
  /**
   * Roles for which this card is in the cold-start top six.
   *
   * HONEST LIMIT, WORTH KNOWING: VERIDIAN's own role vocabulary today is
   * owner/admin/manager/member (ROLE_RANK in auth-guard.ts) -- there is no
   * "designer" role in the data yet, so this list only starts ranking anything
   * once one exists. The card is therefore ALSO offered on its own routes
   * (see routes above), which is what makes it reachable today rather than a
   * setting nobody can turn on.
   */
  coldStartRoles: readonly string[];
  /**
   * R67 C-04: the actions band 2 offers once this card's chain is loaded. A
   * card with actions asks its question IN BAND 2 rather than sitting as a
   * chip beside the pills, which is why chipInPillsBand exists.
   */
  actions?: readonly CardAction[];
  /** Whether this card renders as a chip beside the kit's ranked pill strip. */
  chipInPillsBand: boolean;
  /**
   * R67 C-07: what this module will accept as an attachment, and what its
   * word-button says. The accept list comes from HERE, so the input's filter,
   * the browser-side refusal and the button's own label are one fact.
   * Absent means this module takes no attachments from the composer.
   */
  attach?: AttachPolicy;
  /**
   * R67 C-07: where an attachment goes when the tasks pipeline cannot take
   * it. The label says so plainly rather than implying the composer will save
   * the file itself -- "Upload — opens the Documents form".
   */
  uploadAction?: { label: string; route: string };
  /**
   * R67 C-07: the module whose attachment the composer CAN finish itself,
   * because a shipped endpoint accepts it. Scope's BOQ importer is the one.
   */
  uploadEndpoint?: { label: string; url: string; busyLabel: string };
};

export const DESIGN_STUDIO_CARD: ComposerCardDef = {
  id: "design_studio",
  label: "Design Studio",
  kind: "action",
  functionId: "record_timesheet",
  route: "/schedule/log-time",
  entitySegment: { id: "timesheet", label: "Timesheet", kind: "action" },
  // /design-studio is D-07's own screen and does not exist in this repo yet;
  // the prefix is matched so the chain seeds the moment that route ships,
  // and /schedule/log-time is the real screen this reaches today.
  routes: ["/design-studio", "/schedule/log-time"],
  placeholder: "e.g. 3 hours on #12 joinery shop drawings today",
  coldStartRoles: ["designer", "architect", "interior_designer"],
  chipInPillsBand: true,
};

// R67 C-04. The card whose ACTION and STEP levels band 2 walks: on
// /work-progress the composer asks "What do you want to do?", then "Which BOQ
// line?", then "How much?" -- the strip filling in as the user clicks. Its
// own chip is NOT repeated beside the pills, because the user is already
// standing in it and band 2 is already asking.
export const WORK_PROGRESS_CARD: ComposerCardDef = {
  id: "work_progress",
  label: "Work Progress",
  kind: "action",
  functionId: null,
  route: "/work-progress",
  entitySegment: { id: "work_progress", label: "Work Progress", kind: "action" },
  routes: ["/work-progress"],
  placeholder: "e.g. record 50% on EX-01 excavation today",
  coldStartRoles: [],
  actions: [
    { id: "record_progress", label: "Record progress", functionId: "record_work_progress" },
    // R67 C-08. There is no photo endpoint in either repo, so this action
    // ends at the Documents form and its button says so -- see uploadAction
    // below and the label the shell builds from it.
    { id: "upload_photos", label: "Upload site photos", functionId: null },
  ],
  chipInPillsBand: false,
  // R67 C-07, verbatim.
  attach: {
    label: "Attach photos, JPG/PNG, up to 10",
    accept: [".jpg", ".jpeg", ".png"],
    acceptWords: "a JPG or PNG",
    maxBytes: 10 * MB,
    maxFiles: 10,
  },
  uploadAction: { label: "Upload — opens the Documents form", route: "/documents/upload" },
};

// ---------------------------------------------------------------------------
// R67 C-07 -- THE MODULES THAT TAKE A FILE
// ---------------------------------------------------------------------------
//
// Each card carries its OWN limits, in its OWN button label, and the honest
// destination for the file. Only Scope can be finished by the composer: its
// importer is already shipped end to end (service + POST
// /api/v1/projexa/scope/import + the projexa proxy /api/scope/import), so its
// leaf really does post the spreadsheet. Permits, Documents and Drawings have
// no upload the tasks pipeline accepts, so their action says exactly that --
// "Upload — opens the Permits form" -- and hands the user to the module's own
// create route with the project already filled in. Promising a save the
// product cannot make is the defect this programme exists to remove.

export const PERMITS_CARD: ComposerCardDef = {
  id: "permits",
  label: "Permits",
  kind: "action",
  functionId: null,
  route: "/permits",
  entitySegment: { id: "permits", label: "Permits", kind: "action" },
  routes: ["/permits"],
  placeholder: "e.g. attach the DEWA permit renewal",
  coldStartRoles: [],
  chipInPillsBand: false,
  attach: {
    label: "Attach PDF, up to 25 MB",
    accept: [".pdf"],
    acceptWords: "a PDF",
    maxBytes: 25 * MB,
    maxFiles: 5,
  },
  uploadAction: { label: "Upload — opens the Permits form", route: "/permits/new" },
};

export const DOCUMENTS_CARD: ComposerCardDef = {
  id: "documents",
  label: "Documents",
  kind: "action",
  functionId: null,
  route: "/documents",
  entitySegment: { id: "documents", label: "Documents", kind: "action" },
  routes: ["/documents"],
  placeholder: "e.g. attach the signed contract",
  coldStartRoles: [],
  chipInPillsBand: false,
  attach: {
    label: "Attach PDF, up to 25 MB",
    accept: [".pdf"],
    acceptWords: "a PDF",
    maxBytes: 25 * MB,
    maxFiles: 5,
  },
  uploadAction: { label: "Upload — opens the Documents form", route: "/documents/upload" },
};

export const DRAWINGS_CARD: ComposerCardDef = {
  id: "drawings",
  label: "Drawings",
  kind: "action",
  functionId: null,
  route: "/drawings",
  entitySegment: { id: "drawings", label: "Drawings", kind: "action" },
  routes: ["/drawings"],
  placeholder: "e.g. attach revision C of the ground-floor plan",
  coldStartRoles: [],
  chipInPillsBand: false,
  attach: {
    label: "Attach DWG, DXF, PDF or GLB",
    accept: [".dwg", ".dxf", ".pdf", ".glb"],
    acceptWords: "a DWG, DXF, PDF or GLB file",
    maxBytes: 50 * MB,
    maxFiles: 5,
  },
  uploadAction: { label: "Upload — opens the Drawings form", route: "/drawings/new" },
};

export const SCOPE_CARD: ComposerCardDef = {
  id: "scope",
  label: "Scope",
  kind: "action",
  functionId: null,
  route: "/scope",
  entitySegment: { id: "scope", label: "Scope", kind: "action" },
  routes: ["/scope"],
  placeholder: "e.g. import the September BOQ",
  coldStartRoles: [],
  chipInPillsBand: false,
  actions: [{ id: "import_boq", label: "Import BOQ from Excel", functionId: null }],
  attach: {
    label: "Attach Excel (.xlsx)",
    accept: [".xlsx"],
    acceptWords: "an Excel (.xlsx) file",
    // THE IMPORTER'S OWN LIMIT, not one we chose: VERIDIAN's
    // v1/projexa/scope/import route refuses anything over 10 MB
    // (MAX_FILE_SIZE there). A larger number in this label would be a promise
    // the server breaks after the upload.
    maxBytes: 10 * MB,
    maxFiles: 1,
  },
  uploadEndpoint: { label: "Import BOQ from Excel", url: "/api/scope/import", busyLabel: "Importing…" },
};

export const MANPOWER_CARD: ComposerCardDef = {
  id: "manpower",
  label: "Manpower",
  kind: "action",
  functionId: null,
  route: "/labour",
  entitySegment: { id: "manpower", label: "Manpower", kind: "action" },
  routes: ["/labour"],
  placeholder: "e.g. everyone present today except Rakesh",
  coldStartRoles: [],
  // R67 C-08: the composer's own path to a day's attendance -- the whole crew
  // in one write. The module's "+ Mark Attendance" button still opens
  // /labour/attendance/new, which is the right screen for one worker with
  // hours; this is the right one for twelve without.
  actions: [{ id: "mark_attendance", label: "Mark attendance", functionId: null }],
  chipInPillsBand: false,
};

/** R67 MERGE (D-11): renamed from `CARD_CATALOGUE` -- see the file-level merge note. */
export const COMPOSER_CARD_CATALOGUE: readonly ComposerCardDef[] = [
  MANPOWER_CARD,
  DESIGN_STUDIO_CARD,
  WORK_PROGRESS_CARD,
  PERMITS_CARD,
  DOCUMENTS_CARD,
  DRAWINGS_CARD,
  SCOPE_CARD,
];

/** "What do you want to do?" -- band 2's ACTION level for a card. */
export function actionLevelFor(card: ComposerCardDef): ChainOptionsLevel | null {
  if (!card.actions || card.actions.length === 0) return null;
  return {
    legend: "What do you want to do?",
    kind: "action",
    options: card.actions.map((a) => ({ id: a.id, label: a.label })),
  };
}

export function cardActionById(card: ComposerCardDef, id: string): CardAction | null {
  return card.actions?.find((a) => a.id === id) ?? null;
}

/** True when `pathname` is inside one of the card's own routes. */
export function cardOwnsRoute(card: ComposerCardDef, pathname: string): boolean {
  return card.routes.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/** The card whose chain this route should seed, if any. */
export function cardForRoute(pathname: string): ComposerCardDef | null {
  return COMPOSER_CARD_CATALOGUE.find((c) => cardOwnsRoute(c, pathname)) ?? null;
}

/**
 * The cards to show beside the ranked pill strip: everything this role is
 * cold-started with, plus the card the user is currently standing in.
 */
export function coldStartCards(role: string | null | undefined, pathname: string): ComposerCardDef[] {
  const normalised = (role ?? "").trim().toLowerCase();
  return COMPOSER_CARD_CATALOGUE.filter(
    (c) => c.chipInPillsBand && (c.coldStartRoles.includes(normalised) || cardOwnsRoute(c, pathname))
  );
}

// ---------------------------------------------------------------------------
// DOORS (R67 C-06) -- ONE SENTENCE, ONE DESTINATION, THREE WAYS IN
// ---------------------------------------------------------------------------
//
// R-170's finding is that the same piece of work is reachable three ways -- a
// module's own header button, a KPI number on a dashboard, and a pill or card
// in the composer -- and that the three disagreed: the button navigated and
// left the strip reading "Select a module to begin", the KPI tiles on
// /dashboard were not links at all, and one tile on /dashboard/project
// navigated somewhere that does not exist (correction C-14: "one tile
// navigates, to the wrong destination and two do not navigate at all").
//
// A DOOR IS THE FIX: the sentence and the destination are written ONCE, here,
// and every control that opens that door reads both from this table. A button
// whose label and a tile whose label come from the same string cannot drift,
// and a destination that is wrong is wrong in one place.
//
// *** OPENING A DOOR NEVER EXECUTES. *** It fills the control strip and opens
// a screen. Opening a screen is a read; the write is still a deliberate Save
// on the screen's own form, or a deliberate Send in the composer.

export type DoorStep = { id: string; label: string; kind: "action" | "step" };

export type DoorDef = {
  id: string;
  /** The words on the control. The header button, the KPI tile and the
   *  composer chip that open this door all read this one string. */
  label: string;
  /** The chain sentence AFTER the project root. */
  steps: readonly DoorStep[];
  /** The screen the door opens. */
  route: string;
  /** Whether the destination is scoped by ?projectId=. */
  carriesProject: boolean;
  /** Extra query the destination needs: { tab: "report" }, { withinDays: "30" }. */
  query?: Readonly<Record<string, string>>;
};

/** Segment ids are namespaced so a door's steps are recognisable on the strip. */
export const DOOR_SEGMENT_PREFIX = "door:";

const step = (id: string, label: string, kind: "action" | "step" = "step"): DoorStep => ({ id, label, kind });

export const DOORS: readonly DoorDef[] = [
  // --- module header buttons -------------------------------------------------
  {
    id: "labour.mark_attendance",
    label: "Mark Attendance",
    steps: [step("manpower", "Manpower", "action"), step("mark_attendance", "Mark attendance"), step("today", "Today")],
    route: "/labour/attendance/new",
    carriesProject: true,
  },
  {
    id: "materials.record_receipt",
    label: "Record Receipt",
    steps: [step("materials", "Materials", "action"), step("record_receipt", "Record receipt")],
    route: "/materials/receipts/new",
    carriesProject: true,
  },
  {
    id: "scope.new_boq",
    label: "New BOQ",
    steps: [step("scope", "Scope", "action"), step("new_boq", "New BOQ")],
    route: "/scope/new",
    carriesProject: true,
  },
  {
    id: "moms.new_meeting",
    label: "New Meeting",
    steps: [step("minutes_of_meeting", "Minutes of Meeting", "action"), step("new_meeting", "New meeting")],
    route: "/moms/new",
    carriesProject: true,
  },
  {
    id: "work_progress.run_report",
    label: "Run Report",
    // D-02: the Work Progress Report is ONE screen, /work-progress?tab=report.
    steps: [step("work_progress", "Work Progress", "action"), step("report", "Report")],
    route: "/work-progress",
    carriesProject: true,
    query: { tab: "report" },
  },

  // --- the org dashboard's four KPI tiles (today: not links at all) ----------
  {
    id: "dashboard.active_projects",
    label: "Active Projects",
    steps: [step("projects", "Projects", "action"), step("active", "Active")],
    route: "/dashboard/overview",
    carriesProject: false,
  },
  {
    id: "dashboard.total_budget",
    label: "Total Budget",
    steps: [step("budget", "Budget", "action"), step("all_budgets", "All budgets")],
    route: "/budgets",
    carriesProject: false,
  },
  {
    id: "dashboard.total_revenue",
    label: "Total Revenue",
    steps: [step("invoices", "Invoices", "action"), step("revenue", "Revenue")],
    route: "/invoices",
    carriesProject: false,
  },
  {
    id: "dashboard.total_expenses",
    label: "Total Expenses",
    steps: [step("expenses", "Expenses", "action"), step("all_expenses", "All expenses")],
    route: "/expenses",
    carriesProject: false,
  },
  /** A project row in the org dashboard's own table. */
  {
    id: "dashboard.project",
    label: "Open project",
    steps: [step("dashboard", "Dashboard", "action"), step("project", "Project")],
    route: "/dashboard/project",
    carriesProject: true,
  },

  // --- the project dashboard's five KPI tiles --------------------------------
  {
    id: "project.percent_by_value",
    label: "% Complete by BOQ Value",
    steps: [step("work_progress", "Work Progress", "action"), step("analytics", "Analytics")],
    route: "/work-progress",
    carriesProject: true,
    query: { tab: "analytics" },
  },
  {
    id: "project.contract_value",
    label: "Contract Value",
    steps: [step("scope", "Scope", "action"), step("boq", "BOQ")],
    route: "/scope",
    carriesProject: true,
  },
  {
    id: "project.project_value",
    label: "Project Value",
    steps: [step("scope", "Scope", "action"), step("boq", "BOQ")],
    route: "/scope",
    carriesProject: true,
  },
  {
    // CORRECTION C-14, THE TILE THAT NAVIGATED SOMEWHERE THAT DOES NOT EXIST.
    // It pointed at /scope?tab=variance; ScopeClient renders no tabs at all,
    // so the parameter was ignored and "Budget vs Actual" landed on the same
    // BOQ list as "Contract Value" one tile to its left. It now opens the
    // Budget module, which is the screen that answers the question. That
    // screen is org-wide today (BudgetsClient takes no project filter), which
    // is why the chain says "Budget > Budget vs actual" and not the project.
    id: "project.budget_vs_actual",
    label: "Budget vs Actual",
    steps: [step("budget", "Budget", "action"), step("budget_vs_actual", "Budget vs actual")],
    route: "/budgets",
    carriesProject: false,
  },
  {
    // C-06, verbatim: this tile "must load 'Cedar Heights > Permits >
    // Expiring soon' and open /permits?withinDays=30".
    id: "project.permits_expiring",
    label: "Permits Expiring",
    steps: [step("permits", "Permits", "action"), step("expiring_soon", "Expiring soon")],
    route: "/permits",
    carriesProject: true,
    query: { withinDays: "30" },
  },
];

export function doorById(id: string): DoorDef | null {
  return DOORS.find((d) => d.id === id) ?? null;
}

/**
 * R67 C-12 -- THE SCREEN NEAREST TO SOMETHING THE COMPOSER CANNOT RUN.
 *
 * Every refusal C-12 specifies ends in a destination ("here is the Budget
 * screen →"), and the destinations are already written down once, in DOORS.
 * Matching the chain's own step labels against them means a refusal can never
 * point somewhere the product does not have -- and never needs a second table
 * of module-to-route mappings to drift from this one.
 *
 * Searched from the MOST SPECIFIC end of the chain backwards, so
 * "Cedar Heights > Budget > Variance" finds Budget rather than the project.
 */
export function nearestScreen(steps: readonly string[]): { label: string; route: string } | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const key = steps[i]?.trim().toLowerCase();
    if (!key) continue;
    const door = DOORS.find((d) => d.steps.some((s) => s.label.toLowerCase() === key));
    // The MODULE is what the sentence names ("the Budget screen"), which is
    // the door's first step -- not the leaf, which is a filter on it.
    if (door) return { label: door.steps[0].label, route: door.route };
  }
  return null;
}

/** The URL a door opens, with the project and the door's own filters carried. */
export function doorRoute(door: DoorDef, projectId: string | null): string {
  const qs = new URLSearchParams();
  if (door.carriesProject && projectId) qs.set("projectId", projectId);
  for (const [k, v] of Object.entries(door.query ?? {})) qs.set(k, v);
  const query = qs.toString();
  return query ? `${door.route}?${query}` : door.route;
}

/** The chain segments a door puts on the strip, after the project root. */
export function doorSegments(door: DoorDef): { id: string; label: string; kind: "action" | "step" }[] {
  return door.steps.map((s) => ({ id: `${DOOR_SEGMENT_PREFIX}${door.id}:${s.id}`, label: s.label, kind: s.kind }));
}

/**
 * The whole sentence a door produces, root included:
 * "Cedar Heights Villa - Phase 1 > Manpower > Mark attendance > Today".
 *
 * This is the string the acceptance reads off the control strip, so it is
 * built here rather than assembled again in the component.
 */
export function doorSentence(door: DoorDef, projectName: string | null): string {
  return [projectName?.trim() || null, ...door.steps.map((s) => s.label)].filter(Boolean).join(" > ");
}

// ---------------------------------------------------------------------------
// THE TIMESHEET CARD'S OWN FACTS
// ---------------------------------------------------------------------------

export type ProjectTask = { id: string; number: number; title: string };

/**
 * The client-side mirror of the executor's own fuzzy match, so the card
 * arrives with the right task PRE-SELECTED instead of asking a question the
 * sentence already answered.
 *
 * Same tiers, same order, same refusal to break a tie: an ambiguous needle
 * returns every match and the caller leaves the field unset rather than
 * choosing for the user. Logging real hours against the wrong task is not
 * recoverable by an undo that does not exist.
 */
export function matchTaskTitles(tasks: readonly ProjectTask[], wanted: string): ProjectTask[] {
  const needle = wanted.trim().toLowerCase();
  if (!needle) return [];

  if (/^#?\d+$/.test(needle)) {
    const n = Number(needle.replace(/^#/, ""));
    return tasks.filter((t) => t.number === n);
  }

  const exact = tasks.filter((t) => t.title.toLowerCase() === needle);
  if (exact.length > 0) return exact;

  const contains = tasks.filter((t) => t.title.toLowerCase().includes(needle));
  if (contains.length > 0) return contains;

  const words = needle.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return [];
  return tasks.filter((t) => {
    const title = t.title.toLowerCase();
    return words.every((w) => title.includes(w));
  });
}

/** The one task a needle unambiguously means, or null. */
export function resolveTaskTitle(tasks: readonly ProjectTask[], wanted: string): ProjectTask | null {
  const matches = matchTaskTitles(tasks, wanted);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * C-03's receipt line: "Logged 3.00 h on #12 Joinery shop drawings".
 *
 * DEVIATION, DELIBERATE AND DISCLOSED: C-03's example ends "(TS-000123)".
 * pms_time_entries has no human-readable number column -- its id is a cuid --
 * so printing a "TS-" number would be inventing an identifier that does not
 * exist. The line names the task and the hours, both real, and the caller
 * renders the link to the entry beside it.
 */
export function timesheetReceiptLine(input: { hours: number | string; task: ProjectTask | null }): string {
  const hours = Number(input.hours);
  const amount = Number.isFinite(hours) ? hours.toFixed(2) : String(input.hours);
  const task = input.task ? `#${input.task.number} ${input.task.title}` : "this task";
  return `Logged ${amount} h on ${task}`;
}

/** Where the right pane lands after a time entry is saved. */
export function timesheetRoute(projectId: string | null): string {
  const qs = new URLSearchParams();
  if (projectId) qs.set("projectId", projectId);
  qs.set("tab", "timesheet");
  return `/schedule?${qs.toString()}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// WS-A (A-07) -- THE ROLE-RANKED CARD CATALOGUE. Verb + object, role-ranked.
// CANONICAL per D-11: every symbol below is unchanged from main.
// ═══════════════════════════════════════════════════════════════════════════
//
// D-10, VERBATIM CONSEQUENCE: the owner has approved reversing the 2026-08-26
// "ALL 14 UNIVERSAL PILLS STAY" ruling FOR PROJEXA ONLY. PROJEXA's first level
// is now role-ranked verb+object cards plus "All modules", which lists Sumeet's
// eleven modules in HIS order, then "Other - type it", then a Platform group
// that still holds the fourteen universal pills so the same name still reaches
// the same destination. The platform-wide default for other products is
// unchanged, and nothing here is a kit change.
//
// TWO RULES THIS FILE EXISTS TO KEEP:
//
//  1. A CARD IS A VERB AND AN OBJECT. "Permits" is a place; "Add permit" is a
//     thing you can do. The kind word (Record / Ask / Run) is rendered BESIDE
//     the glyph, never encoded in colour alone -- a strip whose meaning is
//     carried by hue is unreadable to a third of the site engineers using it
//     on a phone in daylight.
//
//  2. EVERY CARD'S DESTINATION IS A REAL ROUTE, and it is the SAME route the
//     screen's own header control produces. That is enforced structurally:
//     a card does not carry a path, it carries a leafId into
//     module-catalogue.ts, whose every path is checked against the shipped
//     route registry by module-catalogue.test.ts and nav-routes.test.ts. A
//     card cannot point at a page that does not exist.

/** What a card DOES, in the closed set the composer's Send button also uses. */
export type CardKind = "write" | "ask" | "run";

/** The word rendered beside the glyph. Colour never carries meaning alone. */
export const KIND_WORD: Readonly<Record<CardKind, string>> = {
  write: "Record",
  ask: "Ask",
  run: "Run",
};

/** Supplementary to the word above, never a substitute for it. */
export const KIND_GLYPH: Readonly<Record<CardKind, string>> = {
  write: "✎",
  ask: "?",
  run: "▶",
};

/**
 * A condition that must hold before a card can do anything. A card whose
 * precondition is unmet STAYS VISIBLE AND DISABLED with the reason in words --
 * hiding it would make the strip's contents depend on invisible state, and the
 * user would have no way to learn the control exists.
 */
export type CardPreconditionId = "project" | "boq";

export type CardPrecondition = {
  id: CardPreconditionId;
  /** The clause after the card's own name: "Run WPR - no BOQ on this project yet". */
  because: string;
};

export type CardDef = {
  /** Stable id. Also the compliance.pill_usage.pillKey this card records. */
  id: string;
  /** The card's own verb. May be narrower than the kind word ("Add", "Mark"). */
  verb: string;
  /** What the verb acts on. */
  object: string;
  /** verb + object, as one readable phrase. This is what the user reads. */
  label: string;
  kind: CardKind;
  /** The module this card belongs to, so the current screen's own cards can be
   *  excluded from the ranked six (they are already band 2). */
  moduleId: string;
  /** The leaf in module-catalogue.ts that owns this card's real route. */
  leafId?: string;
  /** Set only where a card arms an executable function rather than navigating. */
  functionId?: string;
  needsProject: boolean;
  requires?: readonly CardPrecondition[];
  /**
   * Cold-start ordering, per PROJEXA-native membership role (see
   * src/lib/authz/roles.ts). Higher wins. `default` is used for a role this
   * table does not name and for a signed-in user whose role has not loaded --
   * it must never leave the strip empty.
   */
  roleWeights: Readonly<Partial<Record<OrgRole | "default", number>>>;
};

const NEEDS_PROJECT: CardPrecondition = { id: "project", because: "pick a project first" };
const NEEDS_BOQ: CardPrecondition = { id: "boq", because: "no BOQ on this project yet" };

/**
 * THE CARDS. Ordered here only for readability -- what the user sees is
 * decided by rankCards() below (role weights, then the server's own ranking),
 * and the expanded "All modules" list is decided by SUMEET_MODULE_ORDER.
 */
export const CARD_CATALOGUE: readonly CardDef[] = [
  {
    id: "permits.new",
    verb: "Add",
    object: "permit",
    label: "Add permit",
    kind: "write",
    moduleId: "permits",
    leafId: "permits.new",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { pm: 7, admin: 6, owner: 6, site_engineer: 3, member: 3, default: 4 },
  },
  {
    id: "permits.expiring",
    verb: "Ask",
    object: "which permits expire",
    label: "Expiring permits",
    kind: "ask",
    moduleId: "permits",
    leafId: "permits.expiring",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { pm: 6, owner: 6, admin: 5, client_viewer: 4, site_engineer: 2, default: 4 },
  },
  {
    id: "drawings.new",
    verb: "Add",
    object: "drawing",
    label: "Add drawing",
    kind: "write",
    moduleId: "drawings",
    leafId: "drawings.new",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { pm: 5, site_engineer: 4, admin: 4, owner: 3, default: 3 },
  },
  {
    id: "documents.upload",
    verb: "Upload",
    object: "document",
    label: "Upload document",
    kind: "write",
    moduleId: "documents",
    leafId: "documents.upload",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { admin: 5, pm: 5, owner: 4, site_engineer: 3, member: 3, default: 3 },
  },
  {
    id: "moms.new",
    verb: "File",
    object: "minutes",
    label: "File minutes",
    kind: "write",
    moduleId: "moms",
    leafId: "moms.new",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { pm: 8, owner: 6, admin: 5, site_engineer: 3, default: 4 },
  },
  {
    id: "scope.new",
    verb: "Create",
    object: "BOQ",
    label: "New BOQ",
    kind: "write",
    moduleId: "scope",
    leafId: "scope.new",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { pm: 7, admin: 5, owner: 5, site_engineer: 1, default: 3 },
  },
  {
    id: "work-progress.entry",
    verb: "Record",
    object: "progress",
    label: "Record progress",
    kind: "write",
    moduleId: "work-progress",
    leafId: "work-progress.entry",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    // The single most common thing a site engineer does, every day, and the
    // reason this whole card model exists.
    roleWeights: { site_engineer: 10, pm: 8, owner: 5, admin: 5, member: 5, default: 7 },
  },
  {
    id: "work-progress.report",
    verb: "Run",
    object: "WPR",
    label: "Run WPR",
    kind: "run",
    moduleId: "work-progress",
    leafId: "work-progress.report",
    needsProject: true,
    // The WPR is computed off the BOQ: with no BOQ there is nothing to report
    // against, and the card says so rather than running to an empty table.
    requires: [NEEDS_PROJECT, NEEDS_BOQ],
    roleWeights: { pm: 9, owner: 8, admin: 6, client_viewer: 5, site_engineer: 4, default: 6 },
  },
  {
    id: "work-progress.analytics",
    verb: "Ask",
    object: "how far along we are",
    label: "Progress analytics",
    kind: "ask",
    moduleId: "work-progress",
    leafId: "work-progress.analytics",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { owner: 6, pm: 5, client_viewer: 5, admin: 4, default: 4 },
  },
  {
    id: "labour.attendance",
    verb: "Mark",
    object: "attendance",
    label: "Mark attendance",
    kind: "write",
    moduleId: "labour",
    leafId: "labour.attendance",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { site_engineer: 9, pm: 6, member: 5, admin: 3, owner: 3, default: 5 },
  },
  {
    id: "labour.new",
    verb: "Add",
    object: "worker",
    label: "Add worker",
    kind: "write",
    moduleId: "labour",
    leafId: "labour.new",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { site_engineer: 5, pm: 5, admin: 4, owner: 3, default: 4 },
  },
  {
    id: "materials.receipt",
    verb: "Record",
    object: "receipt",
    label: "Record receipt",
    kind: "write",
    moduleId: "materials",
    leafId: "materials.receipt",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { site_engineer: 8, pm: 6, member: 5, admin: 4, owner: 3, default: 5 },
  },
  {
    id: "materials.new",
    verb: "Add",
    object: "material",
    label: "Add material",
    kind: "write",
    moduleId: "materials",
    leafId: "materials.new",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { site_engineer: 4, pm: 4, admin: 4, owner: 3, default: 3 },
  },
  {
    id: "budgets.new",
    verb: "Create",
    // R67 lane D22 (item D-41): the object is the ERP fiscal-year budget, which
    // now lives under Finance. /budgets is the project's own BOQ budget and has
    // nothing to create. The leaf it points at carries the new destination.
    object: "finance budget",
    label: "New finance budget",
    kind: "write",
    moduleId: "budgets",
    leafId: "budgets.new",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { owner: 7, admin: 6, pm: 6, site_engineer: 0, client_viewer: 0, default: 3 },
  },
  {
    id: "schedule.task",
    verb: "Add",
    object: "task",
    label: "Add task",
    kind: "write",
    moduleId: "schedule",
    leafId: "schedule.task",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { pm: 7, owner: 5, admin: 5, site_engineer: 3, default: 4 },
  },
  {
    id: "schedule.time",
    verb: "Log",
    object: "time",
    label: "Log time",
    kind: "write",
    moduleId: "schedule",
    leafId: "schedule.time",
    needsProject: true,
    requires: [NEEDS_PROJECT],
    roleWeights: { site_engineer: 6, member: 6, pm: 5, admin: 3, owner: 3, default: 5 },
  },
  {
    id: "reports.open",
    verb: "Run",
    object: "report",
    label: "Run report",
    kind: "run",
    moduleId: "reports",
    leafId: "reports.open",
    // The report catalogue is org-wide; a project only narrows it.
    needsProject: false,
    roleWeights: { owner: 7, admin: 6, pm: 6, client_viewer: 5, site_engineer: 2, default: 5 },
  },
] as const;

/**
 * SUMEET'S ORDER, fixed, for the expanded "All modules" list. It is NOT the
 * ranked order and must never be re-sorted by usage: the ranked six answer
 * "what do you do most", the expanded list answers "where is everything", and
 * a list that moves is a list you have to read every time.
 */
export const SUMEET_MODULE_ORDER: readonly string[] = [
  "permits",
  "drawings",
  "documents",
  "moms",
  "scope",
  "work-progress",
  "labour",
  "materials",
  "budgets",
  "schedule",
  "reports",
] as const;

/** The literal words for the free-text escape hatch, per D-10. */
export const OTHER_ENTRY_LABEL = "Other — type it";

/**
 * The universal pills, kept as a PLATFORM GROUP under "All modules" (D-10) so
 * that demoting them from the first level does not make any of them
 * unreachable, and so the same name still reaches the same destination.
 * `other` is excluded: it is the free-text entry above, and listing it twice
 * would be the duplicate vocabulary this programme is removing. Task Master and
 * To Do appear once, as the kit's own merged "Tasks" (see below).
 *
 * WHERE EACH ONE ACTUALLY GOES is src/lib/pill-routes.ts (A-17), not here: this
 * list is the NAMES the platform group carries, the table is the destinations.
 */
export const PLATFORM_PILLS: readonly { key: string; label: string }[] = [
  { key: "customers", label: "Customers" },
  { key: "vendors", label: "Vendors" },
  { key: "projects", label: "Projects" },
  { key: "minutes_of_meeting", label: "Minutes of Meeting" },
  { key: "reports", label: "Reports" },
  { key: "analysis", label: "Analysis" },
  { key: "email", label: "Email" },
  { key: "policies", label: "Policies" },
  { key: "department", label: "Department" },
  { key: "teams", label: "Teams" },
  { key: "calendar", label: "Calendar" },
  // R67 A-17: ONE "Tasks" pill, not "Task Master" and "To Do". That is the
  // kit's OWN rendered set -- pillConfig.ts ships TASKS_PILL_MERGED = true and
  // MERGED_TASKS_PILL { key: "task_master", label: "Tasks" }, because MP-RISK-2
  // records Task Master vs To Do as "the confusable pair". A-17's route table
  // names "Tasks", so listing the two unmerged names here would have put a pair
  // the kit deliberately merged back on screen, both pointing at one board.
  { key: "task_master", label: "Tasks" },
] as const;

export type AllModulesEntry = {
  id: string;
  label: string;
  /** "module" | "other" | "platform" -- what a click on it means. */
  kind: "module" | "other" | "platform";
  /** The module this entry opens, when it has one in PROJEXA. */
  moduleId: string | null;
  /** Words explaining why it cannot be opened, when it cannot. */
  unavailable?: string;
};

/**
 * A-07's expanded list, flat and in one fixed order: Sumeet's eleven modules,
 * then "Other - type it", then the platform group.
 */
export function allModulesEntries(): AllModulesEntry[] {
  const modules: AllModulesEntry[] = SUMEET_MODULE_ORDER.map((id) => {
    const mod = MODULE_CATALOGUE.find((m) => m.id === id);
    // A module id with no catalogue entry is a programming error, not a
    // runtime condition -- allModulesEntries.test asserts it cannot happen.
    return { id, label: mod?.label ?? id, kind: "module" as const, moduleId: mod ? mod.id : null };
  });

  const platform: AllModulesEntry[] = PLATFORM_PILLS.map((pill) => {
    const mod = moduleForPill(pill.key, pill.label);
    return {
      id: `platform.${pill.key}`,
      label: pill.label,
      kind: "platform" as const,
      moduleId: mod?.id ?? null,
      unavailable: mod
        ? undefined
        : pill.key === "projects"
          ? "pick one in the top rail"
          : "not part of PROJEXA",
    };
  });

  return [...modules, { id: "other", label: OTHER_ENTRY_LABEL, kind: "other", moduleId: null }, ...platform];
}

/** The leaf a card navigates to, and the module that owns it. */
export function targetForCard(card: CardDef): { module: ModuleDef; leaf: ModuleLeaf } | null {
  const mod = MODULE_CATALOGUE.find((m) => m.id === card.moduleId);
  if (!mod) return null;
  const leaf = card.leafId ? mod.leaves.find((l) => l.id === card.leafId) : undefined;
  return leaf ? { module: mod, leaf } : null;
}

/** The real URL a card opens, carrying the project where it means something. */
export function cardHref(card: CardDef, projectId: string | null): string | null {
  const target = targetForCard(card);
  if (!target) return null;
  return moduleHref(target.leaf, projectId);
}

/**
 * The card's own name plus the reason it cannot run, in words:
 * "Run WPR - no BOQ on this project yet". Returns null when it can run.
 */
export function cardUnmetReason(card: CardDef, unmet: ReadonlySet<CardPreconditionId>): string | null {
  const blocked = card.requires?.find((r) => unmet.has(r.id));
  return blocked ? `${card.label} — ${blocked.because}` : null;
}

/** The cold-start weight this role gives a card. */
export function weightFor(card: CardDef, role: string | null | undefined): number {
  const byRole = role ? card.roleWeights[role as OrgRole] : undefined;
  return byRole ?? card.roleWeights.default ?? 0;
}

/**
 * The role's own ordering of the whole catalogue, highest weight first and
 * catalogue order as the tiebreak, so it is total and deterministic -- two
 * users with the same role see the same strip.
 */
export function cardsForRole(role: string | null | undefined): CardDef[] {
  return [...CARD_CATALOGUE]
    .map((card, index) => ({ card, index }))
    .sort((a, b) => weightFor(b.card, role) - weightFor(a.card, role) || a.index - b.index)
    .map((x) => x.card);
}

/** One entry of the server's ranking, as PROJEXA's proxy returns it. */
export type RankedEntry = { pillKey: string; label?: string | null; pinned?: boolean };

/**
 * The SERVER'S key for a card, when this user's ranking contains one.
 *
 * WHY THIS EXISTS. compliance.pill_usage carries a function_id per key, and
 * that is what lets a click take R53's PILL PATH -- the server already knows
 * the function, so the submission costs no classifier call and no model call
 * at all. But the server's key for a row the PIPELINE wrote is the chain's
 * first step ("Work Progress"), while a card's id is "work-progress.entry".
 * Looking the function up by card id alone would silently miss every one of
 * those rows and quietly demote every click to the typed path. This maps back.
 */
export function rankedKeyForCard(card: CardDef, ranked: readonly RankedEntry[]): string | null {
  for (const entry of ranked) {
    if (entry.pillKey === card.id) return entry.pillKey;
  }
  for (const entry of ranked) {
    const mod = moduleForPill(entry.pillKey, entry.label ?? undefined);
    if (mod && mod.id === card.moduleId) return entry.pillKey;
  }
  return null;
}

export type RankCardsInput = {
  /** The server's ranking, in the server's order. Empty when it has not
   *  answered, or when this user has earned no ranking yet. */
  ranked: readonly RankedEntry[];
  role: string | null | undefined;
  /** The module the user is standing in. Its cards are already band 2. */
  excludeModuleId?: string | null;
  limit?: number;
};

export type RankCardsResult = {
  cards: CardDef[];
  /** Ranked keys this build has no card for. The caller warns; it does NOT
   *  render them, because a raw key on a strip is worse than a shorter strip. */
  unknownKeys: string[];
};

/**
 * A-07's ranking. The server's order WINS and is applied verbatim; the role's
 * cold-start order only TOPS UP the remaining slots, so a user who has earned
 * a ranking never sees it silently re-sorted by a table checked into this repo.
 *
 * A ranked key is resolved as a CARD first (leaf ids are what A-07 records),
 * then as a MODULE (every row R53's pipeline wrote is a module name), in which
 * case that module's highest-weighted card stands in for it -- "Work Progress"
 * ranked highly means this user records progress, and the card says so.
 */
export function rankCards({ ranked, role, excludeModuleId, limit = 6 }: RankCardsInput): RankCardsResult {
  const byId = new Map(CARD_CATALOGUE.map((c) => [c.id, c]));
  const roleOrder = cardsForRole(role);
  const chosen: CardDef[] = [];
  const unknownKeys: string[] = [];
  const taken = new Set<string>();

  const take = (card: CardDef | undefined) => {
    if (!card || taken.has(card.id)) return false;
    if (excludeModuleId && card.moduleId === excludeModuleId) return false;
    taken.add(card.id);
    chosen.push(card);
    return true;
  };

  for (const entry of ranked) {
    if (chosen.length >= limit) break;
    const key = entry.pillKey;
    const direct = byId.get(key);
    if (direct) {
      take(direct);
      continue;
    }
    const mod = moduleForPill(key, entry.label ?? undefined);
    if (mod) {
      // The module's own best card for this role stands in for the module.
      const stand = roleOrder.find((c) => c.moduleId === mod.id && !taken.has(c.id));
      if (stand) {
        take(stand);
        continue;
      }
      // Every card of that module is already chosen or excluded: not unknown.
      continue;
    }
    // Not a card, not a module this build knows. The caller warns and drops it.
    if (normalisePillKey(key)) unknownKeys.push(key);
  }

  for (const card of roleOrder) {
    if (chosen.length >= limit) break;
    take(card);
  }

  return { cards: chosen.slice(0, limit), unknownKeys };
}
