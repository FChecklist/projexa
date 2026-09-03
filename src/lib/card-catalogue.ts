// R67 WS-C (C-02, extended by C-04/C-06) -- PROJEXA'S OWN CARD AND LEAF
// CATALOGUE.
//
// WHERE THIS LIVES AND WHY (correction C-12, decision D-10): the catalogue of
// what a PROJEXA user can start from -- the cards, their leaves, and the
// sentence each one puts on the control strip -- lives in the PROJEXA repo,
// in code. platform.mode_pills has no reader anywhere in either codebase, so
// a row there is governance documentation, not a source of truth, and
// building a reader for it would be inventing a dependency.
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
  /** A leaf is the last step -- the thing that would actually be done. */
  isLeaf?: boolean;
  /** Shown, in words, on a chip that cannot be picked. Never a dead end. */
  unavailableReason?: string;
};

/** One question the composer asks in band 2. */
export type ChainOptionsLevel = {
  /** The question this level answers: "Which report?", "Which BOQ line?" */
  legend: string;
  /** What kind of segment picking one of these produces (the kit's SegmentKind). */
  kind: "action" | "step";
  options: ChainOptionDto[];
  /** What to say -- and where to send the user -- when there is nothing to choose. */
  emptyPrompt?: { text: string; actionLabel?: string; route?: string };
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
// CARDS (R67 C-03) -- WHAT A USER CAN START FROM
// ---------------------------------------------------------------------------

/** One thing a card can start. R67 C-04: band 2's ACTION level. */
export type CardAction = {
  id: string;
  /** The verb the user reads: "Record progress". */
  label: string;
  /** The pipeline function this action ends in, when it has one. */
  functionId: string | null;
};

export type CardDef = {
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
};

export const DESIGN_STUDIO_CARD: CardDef = {
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
export const WORK_PROGRESS_CARD: CardDef = {
  id: "work_progress",
  label: "Work Progress",
  kind: "action",
  functionId: null,
  route: "/work-progress",
  entitySegment: { id: "work_progress", label: "Work Progress", kind: "action" },
  routes: ["/work-progress"],
  placeholder: "e.g. record 50% on EX-01 excavation today",
  coldStartRoles: [],
  actions: [{ id: "record_progress", label: "Record progress", functionId: "record_work_progress" }],
  chipInPillsBand: false,
};

export const CARD_CATALOGUE: readonly CardDef[] = [DESIGN_STUDIO_CARD, WORK_PROGRESS_CARD];

/** "What do you want to do?" -- band 2's ACTION level for a card. */
export function actionLevelFor(card: CardDef): ChainOptionsLevel | null {
  if (!card.actions || card.actions.length === 0) return null;
  return {
    legend: "What do you want to do?",
    kind: "action",
    options: card.actions.map((a) => ({ id: a.id, label: a.label })),
  };
}

export function cardActionById(card: CardDef, id: string): CardAction | null {
  return card.actions?.find((a) => a.id === id) ?? null;
}

/** True when `pathname` is inside one of the card's own routes. */
export function cardOwnsRoute(card: CardDef, pathname: string): boolean {
  return card.routes.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/** The card whose chain this route should seed, if any. */
export function cardForRoute(pathname: string): CardDef | null {
  return CARD_CATALOGUE.find((c) => cardOwnsRoute(c, pathname)) ?? null;
}

/**
 * The cards to show beside the ranked pill strip: everything this role is
 * cold-started with, plus the card the user is currently standing in.
 */
export function coldStartCards(role: string | null | undefined, pathname: string): CardDef[] {
  const normalised = (role ?? "").trim().toLowerCase();
  return CARD_CATALOGUE.filter(
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
