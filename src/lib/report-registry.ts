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
 * Where one catalog row really runs. The three answers are exhaustive and
 * every one of them is actionable except the last, which says why.
 */
export function placeCatalogEntry(entry: CatalogEntryLike): ReportPlacement {
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
    return {
      availability: "runs-here",
      label: AVAILABILITY_LABEL["runs-here"],
      action: "Open Work Progress Report",
      href: WORK_PROGRESS_REPORT_ROUTE,
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
      href: `/reports?report=${encodeURIComponent(reportName)}`,
      runsInPlace: false,
    };
  }

  return {
    availability: "runs-in-veridian",
    label: AVAILABILITY_LABEL["runs-in-veridian"],
    action: "Open in VERIDIAN",
    href: entry.route,
    runsInPlace: false,
  };
}
