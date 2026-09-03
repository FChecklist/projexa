// R67 E-04 (R-079) and E-05 (R-103): the same-name-same-destination rule.
//
// R-079 records three answers to "where is my Work Progress Report?" -- Work
// Progress > Report renders it in 2.7 s with exports, Reports > Work Progress
// spins for 24.3 s and renders nothing, and the Full Catalog says it is "not
// yet viewable here" about a report the reader has just run. Binding decision
// D-02 says there is ONE.
//
// This module is that one answer, in one place, so the picker and the catalog
// cannot drift apart again. A report named here NAVIGATES; every other report
// is fetched and rendered inside the Reports screen exactly as before.

export type ReportDestination =
  | { kind: "navigate"; href: string }
  | { kind: "fetch"; path: string };

export type ReportParams = {
  projectId: string;
  /** YYYY-MM-DD. Optional: a destination that takes a period gets month-to-date when none is given. */
  from?: string;
  to?: string;
  /** Only the weekly report needs it; carried through so one signature serves every entry. */
  weekStart?: string;
};

/**
 * Reports that live on their OWN screen rather than inside the Reports frame.
 * Each entry is the whole reason this file exists: it is the single place that
 * says where that name goes.
 */
const HOSTED_REPORTS: Record<string, (params: ReportParams) => string> = {
  // D-02: the WPR is /work-progress?tab=report, it reads its parameters from
  // the URL, and it runs on arrival (see WorkProgressReportClient).
  "work-progress": ({ projectId, from, to }) => {
    const qs = new URLSearchParams({ tab: "report", projectId });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return `/work-progress?${qs.toString()}`;
  },
  // R67 E-05 (R-103): "Material Consumption" in the picker and the Materials
  // screen's Cost Report tab are ONE report reached from two places -- the
  // same rule, applied to the same problem.
  "material-consumption": ({ projectId, from, to }) => {
    const qs = new URLSearchParams({ tab: "cost-report", projectId });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return `/materials?${qs.toString()}`;
  },
  // R67 E-07 (R-114): "Budget Summary" in the picker and the Cost Variance tab
  // are ONE report reached from two places -- the same rule again. The picker
  // used to fetch compliance-tracker's ERP-ledger budgetSummary and render it
  // as a key/value grid; that is the ANNUAL LEDGER budget, a different concept
  // from the BOQ budget this name means to a QS (see E-06), and rendering the
  // ledger one under this name is what let three screens disagree. The ledger
  // report stays available to API callers under its own name; the SCREEN named
  // "Budget Summary" is the one that shows Sumeet 6.png II(iii)'s columns.
  "budget-summary": ({ projectId }) => `/scope?tab=variance&projectId=${encodeURIComponent(projectId)}`,
};

/** True when this report has a screen of its own. */
export function isHostedReport(reportName: string): boolean {
  return reportName in HOSTED_REPORTS;
}

/**
 * Where a picker selection goes. `navigate` means the Reports screen must
 * router.push and must NOT fetch: fetching a report the user is about to leave
 * is the 24.3 s spinner R-079 measured.
 */
export function reportDestination(reportName: string, params: ReportParams): ReportDestination {
  const hosted = HOSTED_REPORTS[reportName];
  if (hosted) return { kind: "navigate", href: hosted(params) };

  const qs = new URLSearchParams({ projectId: params.projectId });
  if (reportName === "weekly-project" && params.weekStart) qs.set("weekStart", params.weekStart);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  return { kind: "fetch", path: `/api/reports/${encodeURIComponent(reportName)}?${qs.toString()}` };
}

/**
 * The catalog stores a route, not a slug: "/api/construction/reports/work-progress"
 * for an API-only entry, and now "/work-progress?tab=report" for the one that
 * has a real screen. Both resolve to the same picker slug, which is what lets
 * a catalog card and a picker entry agree about one report.
 */
export function catalogSlug(route: string | null | undefined): string | null {
  if (!route) return null;
  const path = route.split("?")[0].split("#")[0].replace(/\/+$/, "");
  const last = path.split("/").pop();
  return last && last.length > 0 ? last : null;
}

/** What the Full Catalog card says and where its button goes, for a report that runs in PROJEXA. */
export type CatalogDestination = { label: string; href: string };

/**
 * R-079: the badge said "Not yet viewable here" about the WPR. It now names
 * the screen that renders it and offers a way in. Returns null for a report
 * that genuinely has no PROJEXA screen -- claiming one for those would be the
 * same lie facing the other way.
 */
export const CATALOG_RUNS_HERE_LABELS: Record<string, string> = {
  "work-progress": "Runs here — Work Progress > Report",
  "material-consumption": "Runs here — Materials > Cost Report",
  "budget-summary": "Runs here — Scope > Cost Variance",
};

export function catalogDestination(route: string | null | undefined, params: ReportParams): CatalogDestination | null {
  const slug = catalogSlug(route);
  if (!slug || !isHostedReport(slug)) return null;
  const destination = reportDestination(slug, params);
  if (destination.kind !== "navigate") return null;
  return { label: CATALOG_RUNS_HERE_LABELS[slug] ?? "Runs here", href: destination.href };
}

/** Month-to-date, the default period a report runs with when the reader has chosen none. */
export function monthToDate(today: Date = new Date()): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return { from: iso(first), to: iso(today) };
}
