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
