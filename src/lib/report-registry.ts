// R67 E-22 (R-199 / R-207 / R-224). The projexa-side truth about where each
// report actually runs.
//
// WHAT IT REPLACES. The Full Catalog rendered ONE sentence under every
// non-definition card: "Runs on VERIDIAN own dashboard (<route>) -- not yet
// renderable inside PROJEXA, shown for visibility only." That sentence was
// false for seventeen of those cards. Every entry whose id starts with
// "construction-" is one of the reports the Project Reports tab on the very
// same screen already runs, through
// GET /api/reports/<name>?projectId= -> VERIDIAN's REPORT_REGISTRY. The
// catalog was telling the reader they could not see a report that was one
// tab away.
//
// HOW THE MAPPING IS ESTABLISHED, not guessed: compliance-tracker's
// report-catalog-service.ts builds its construction entries as
// `CONSTRUCTION_REPORT_META.map(...)` with
// `reportName = id.replace(/^construction-/, "")` and
// `route = /api/construction/reports/<reportName>`. That reportName is the
// same key as REPORT_REGISTRY's, which is the same path segment PROJEXA's
// own /api/reports/[reportName] proxy forwards. So stripping the prefix is
// the documented inverse of how the id was built, not a naming coincidence.
//
// D-02: "Work Progress" is the one exception. There is ONE Work Progress
// Report and it lives at /work-progress?tab=report; the catalog row links
// there rather than running a second, slower copy inside /reports.

/** The report names PROJEXA's own Project Reports tab can run, i.e. the keys of VERIDIAN's REPORT_REGISTRY that this app proxies. */
export const PROJEXA_RUNNABLE_REPORTS = [
  "project-status",
  "project-completion",
  "work-progress",
  "category-progress",
  "weekly-project",
  "attendance",
  "manpower-cost",
  "site-picture",
  "scope",
  "budget-summary",
  "budget-vs-actual",
  "material-consumption",
  "vendor-cost",
  "designer-timesheet",
  "kpi",
  "revenue",
  "expense",
] as const;

export type ProjexaReportName = (typeof PROJEXA_RUNNABLE_REPORTS)[number];

const RUNNABLE = new Set<string>(PROJEXA_RUNNABLE_REPORTS);

/** D-02: the single Work Progress Report route. The Reports picker and the catalog both point here. */
export const WORK_PROGRESS_REPORT_ROUTE = "/work-progress?tab=report";

/**
 * R67 E-28 (R-244): the verb on a runnable catalog card. It names the
 * destination, because "Open" on its own left the reader guessing whether the
 * card would run in place, navigate, or do nothing -- the same uncertainty the
 * old "Not yet viewable here" created, only quieter.
 */
export const OPEN_IN_PROJECT_REPORTS = "Open in Project Reports";

// ---------------------------------------------------------------------------
// R67 E-31 (R-264): a catalog card that runs when you press Run
// ---------------------------------------------------------------------------
//
// WHAT WAS WRONG. "Run this report" expanded a panel of empty parameters and
// then waited. The reader pressed a button labelled Run and nothing ran; the
// From and To fields were blank, the project field was blank and captioned "only
// needed for some project-scoped reports", so the next move was a guess. Every
// one of those parameters has an obvious, correct default that this app already
// knows.

/**
 * Month to date -- the first of the current month through today, in the ISO form
 * every date input and query parameter here uses.
 *
 * Takes `today` so the boundary cases are testable rather than dependent on the
 * clock the suite happens to run at. Built from the LOCAL calendar date, because
 * "this month" is a thing the reader is in, not a UTC fact -- but the strings
 * are plain ISO dates, which is what a date input and the API both expect.
 */
export function monthToDateRange(today: Date = new Date()): { from: string; to: string } {
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, "0");
  const day = `${today.getDate()}`.padStart(2, "0");
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${day}` };
}

/**
 * The subject of a report, for the empty-result sentence: "No attendance
 * between 01-09-2026 and 02-09-2026".
 *
 * Derived from the catalog entry's own name rather than a second hand-kept
 * table -- a trailing "Report"/"Analysis" is noise inside the sentence ("No
 * attendance report between..." reads as if the REPORT is missing, not the
 * data), and the rest is lowercased so it sits inside a sentence. A name that
 * is nothing BUT that suffix keeps its own word rather than becoming "No
 * between ...".
 */
export function reportSubject(name: string): string {
  const trimmed = name.trim().replace(/\s+(report|analysis)$/i, "");
  const subject = trimmed === "" ? name.trim() : trimmed;
  return subject.toLowerCase();
}

export type ReportAvailability = "runs-here" | "runs-in-veridian" | "not-built";

/** The words on the card. Fixed, so the catalog and the picker cannot describe the same report differently. */
export const AVAILABILITY_LABEL: Record<ReportAvailability, string> = {
  "runs-here": "Runs here",
  "runs-in-veridian": "Runs in VERIDIAN - open there",
  "not-built": "Not built - data gap",
};

export type CatalogEntryLike = {
  id: string;
  name: string;
  route: string;
  source: "static" | "definition";
  status?: "built" | "data_gap" | "planned";
  definitionId?: string;
};

export type ReportPlacement = {
  availability: ReportAvailability;
  /** The badge text: one of AVAILABILITY_LABEL's three sentences. */
  label: string;
  /** The verb on the control the reader clicks. */
  action: string;
  /** Where the action goes, when it is a link. Absent when the card runs the report in place. */
  href?: string;
  /** True when the card runs the report inside its own body (the report_definitions runner). */
  runsInPlace: boolean;
  /** Why, in one sentence, when there is nothing to click. */
  note?: string;
};

/**
 * The report name behind a static catalog id, or null when the entry is not
 * one of the construction reports this app proxies.
 */
export function reportNameForCatalogId(id: string): ProjexaReportName | null {
  if (!id.startsWith("construction-")) return null;
  const name = id.slice("construction-".length);
  return RUNNABLE.has(name) ? (name as ProjexaReportName) : null;
}

/**
 * R67 E-31 (R-264): the context a card's link needs to arrive somewhere USEFUL
 * rather than merely somewhere. Optional throughout: the catalog renders before
 * a project has resolved, and a link with no project on it is still a real link
 * to a real screen.
 */
export type CatalogLinkContext = {
  projectId?: string | null;
  from?: string;
  to?: string;
};

function withParams(base: string, context: CatalogLinkContext, extra: Record<string, string> = {}): string {
  const [path, existing] = base.split("?");
  const params = new URLSearchParams(existing ?? "");
  if (context.projectId) params.set("projectId", context.projectId);
  if (context.from) params.set("from", context.from);
  if (context.to) params.set("to", context.to);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return `${path}?${params.toString()}`;
}

/**
 * Where one catalog row really runs. The three answers are exhaustive and
 * every one of them is actionable except the last, which says why.
 */
export function placeCatalogEntry(entry: CatalogEntryLike, context: CatalogLinkContext = {}): ReportPlacement {
  if (entry.source === "definition") {
    const status = entry.status ?? "built";
    if (status === "built" && entry.definitionId) {
      return {
        availability: "runs-here",
        label: AVAILABILITY_LABEL["runs-here"],
        action: "Run this report",
        runsInPlace: true,
      };
    }
    return {
      availability: "not-built",
      label: status === "planned" ? "Not built - planned" : AVAILABILITY_LABEL["not-built"],
      action: status === "planned" ? "Not built yet" : "No data behind it yet",
      runsInPlace: false,
      note:
        status === "planned"
          ? "This report is defined but has no engine behind it yet."
          : "This report is defined, but the data it needs is not recorded anywhere yet.",
    };
  }

  const reportName = reportNameForCatalogId(entry.id);
  if (reportName === "work-progress") {
    // D-02: one Work Progress Report, and it is not this screen's copy.
    //
    // R67 E-31: the link carries the project, the month-to-date range and the
    // view, so the destination ARRIVES RUN (E-34's run-on-arrival reads exactly
    // these parameters) instead of landing on an empty form the reader has to
    // fill in a second time.
    return {
      availability: "runs-here",
      label: AVAILABILITY_LABEL["runs-here"],
      action: "Open Work Progress Report",
      href: withParams(WORK_PROGRESS_REPORT_ROUTE, context, { view: "scope" }),
      runsInPlace: false,
    };
  }
  if (reportName) {
    return {
      availability: "runs-here",
      label: AVAILABILITY_LABEL["runs-here"],
      // R67 E-28: the verb names WHERE it opens. "Open" alone left the reader
      // guessing whether a card would run in place, navigate, or do nothing --
      // which is the same uncertainty the old "Not yet viewable here" created,
      // just quieter.
      action: OPEN_IN_PROJECT_REPORTS,
      // R67 E-31: with the project on it, so the Project Reports tab opens on
      // the same project the reader is looking at rather than re-resolving one.
      href: withParams(`/reports?report=${encodeURIComponent(reportName)}`, { projectId: context.projectId }),
      runsInPlace: false,
    };
  }

  return {
    availability: "runs-in-veridian",
    label: AVAILABILITY_LABEL["runs-in-veridian"],
    // R67 E-31's own word. "Open in VERIDIAN" reads like an action this app
    // will perform; "Opens in VERIDIAN" states where the reader ends up, which
    // is the honest thing to say about a different application they have no
    // session in.
    action: "Opens in VERIDIAN",
    href: entry.route,
    runsInPlace: false,
  };
}
