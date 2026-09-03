// R67 E-17 (R-175 / R-179). ONE INDEX OF WHAT PROJEXA CAN DO WITH A REPORT.
//
// R-179's complaint is that the Full Catalog decides whether a report "runs
// here" by a rule of its own, the picker decides it by another, and the two
// disagree about the same report. R-175 asks for a registry mapping each picker
// id to what renders it, what parameters it takes, and whether it exports.
//
// THIS FILE COMPOSES; IT DOES NOT RESTATE. Three modules already answer one
// question each, correctly, and each is the enforcement point for its own
// answer:
//
//   * src/lib/report-destinations.ts -- WHERE a report name goes (D-02's
//     "one destination per name"). It is what the picker's primary and the
//     catalog's Open link both call.
//   * src/lib/report-parameters.ts   -- WHAT a report really takes, every flag
//     read off compliance-tracker's own handler signature.
//   * src/lib/report-schema.ts       -- WHETHER it has a described document,
//     and therefore a server-rendered export.
//
// Copying any of those three into a fourth list is how they drift; that drift
// IS the defect. So every field below is derived, and the only facts this file
// owns are the two nothing else holds: the SCREEN a report is rendered by, in
// words a reader would recognise, and the DEFAULT PARAMETERS it opens with.

import { monthToDate, isHostedReport, reportDestination, type ReportParams } from "./report-destinations";
import { reportParameters } from "./report-parameters";
import { reportSchema } from "./report-schema";

/** How the Reports screen answers for this report. */
export type ReportRenderMode =
  /** It has a screen of its own; the Reports screen navigates and does not fetch (D-02). */
  | "navigate"
  /** It has a described document; the Reports frame renders ReportDocument. */
  | "document"
  /** No document described yet; the Reports frame renders the generic grid. */
  | "generic";

export type ReportRegistryEntry = {
  id: string;
  mode: ReportRenderMode;
  /**
   * The screen that renders it, named the way a reader would say it aloud --
   * "Work Progress > Report", not a route. Null when it renders inside the
   * Reports frame, which has no separate name.
   */
  screen: string | null;
  supports: { dateRange: boolean; weekStart: boolean; category: boolean; vendor: boolean };
  /** True when VERIDIAN can render this report as a PDF/XLSX/CSV document. */
  exportable: boolean;
  /** What the report opens with when the reader has chosen nothing. */
  defaultParams: (input: { projectId: string; today?: Date }) => ReportParams;
};

/**
 * The screens, by report id. The ONLY hand-written table here, because it is
 * the only fact none of the three composed modules carries -- and it is the
 * fact the Full Catalog badge and the picker's primary both need in words.
 */
const SCREEN_NAMES: Record<string, string> = {
  "work-progress": "Work Progress > Report",
  "material-consumption": "Materials > Cost Report",
  "budget-summary": "Scope > Cost Variance",
  "designer-timesheet": "Design Studio > Cost Analysis",
};

export function reportRegistryEntry(id: string): ReportRegistryEntry | null {
  const spec = reportParameters(id);
  // reportParameters() answers for every id in the picker and returns its
  // fallback shape for anything else; an id with no description is not a
  // report this screen knows.
  if (!spec.description) return null;

  const hosted = isHostedReport(id);
  const schema = reportSchema(id);
  return {
    id,
    mode: hosted ? "navigate" : schema ? "document" : "generic",
    screen: hosted ? (SCREEN_NAMES[id] ?? null) : null,
    supports: {
      dateRange: spec.needsDateRange,
      weekStart: spec.needsWeekStart,
      category: spec.supportsCategory,
      vendor: spec.supportsVendor,
    },
    exportable: schema?.serverExport === true,
    // Month-to-date, and ONLY for a report whose handler really reads a period.
    // Putting from/to on a report that ignores them writes parameters into a
    // link that describe nothing, which is what made the Reports card show two
    // date fields that quietly did nothing.
    defaultParams: ({ projectId, today }) => {
      if (!spec.needsDateRange) return { projectId };
      const period = monthToDate(today ?? new Date());
      return { projectId, from: period.from, to: period.to };
    },
  };
}

/**
 * True when this report is one PROJEXA can really answer for. R-179: the Full
 * Catalog's "Not yet viewable here" badge must be decided by THIS, and not by
 * the card's own guess about its route -- which is how it came to say that
 * about a report the sibling tab runs two clicks away.
 */
export function isInReportRegistry(id: string | null | undefined): boolean {
  return Boolean(id && reportRegistryEntry(id) !== null);
}

/**
 * Where a registry entry goes, with its own defaults filled in. One call for
 * "open this report, ready to run" -- the catalog card and the picker's primary
 * both use it, so a card and a picker entry can never open the same report in
 * two different states.
 */
export function registryDestination(id: string, input: { projectId: string; today?: Date }) {
  const entry = reportRegistryEntry(id);
  if (!entry) return null;
  return reportDestination(id, entry.defaultParams(input));
}
