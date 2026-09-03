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
  /**
   * R67 E-11 (R-130): the parameter card's Category and Vendor choices. A
   * hosted report only receives the ones its own screen understands -- handing
   * /materials a `vendorId` it ignores would put a parameter in the URL that
   * describes nothing.
   */
  category?: string | null;
  vendorId?: string | null;
};

/**
 * Reports that live on their OWN screen rather than inside the Reports frame.
 * Each entry is the whole reason this file exists: it is the single place that
 * says where that name goes.
 */
const HOSTED_REPORTS: Record<string, (params: ReportParams) => string> = {
  // D-02: the WPR is /work-progress?tab=report, it reads its parameters from
  // the URL, and it runs on arrival (see WorkProgressReportClient).
  "work-progress": ({ projectId, from, to, category }) => {
    const qs = new URLSearchParams({ tab: "report", projectId });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    // The WPR screen's own Category multi-select reads repeatable `category`
    // params (R67 I-05), so one chosen on the Reports card arrives applied
    // rather than being silently dropped at the door.
    if (category) qs.append("category", category);
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
  // R67 E-16 (R-150): "Designer Timesheet" in the picker and Design Studio's
  // Cost Analysis tab are ONE report reached from two places. The report's four
  // Budget-vs-Actual breakdowns need the four stacked sections and the paired
  // bars that screen draws; rendering them inside the Reports frame would be a
  // second, poorer copy of the same report.
  // MERGE (2026-09-03): lane H gave Cost Analysis a REAL ROUTE of its own
  // rather than the ?tab= E-16 first wrote, so a manager can be sent straight
  // to it. This table now names that route -- one destination, and it is the
  // one src/lib/nav-routes.ts ships.
  "designer-timesheet": ({ projectId, from, to }) => {
    const qs = new URLSearchParams({ projectId });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return `/design-studio/cost-analysis?${qs.toString()}`;
  },
  "budget-summary": ({ projectId, category, vendorId }) => {
    const qs = new URLSearchParams({ tab: "variance", projectId });
    // The Cost Variance screen's filter drawer reads exactly these two, and
    // keeps them in its own URL -- so a filter chosen here survives the hop.
    if (category) qs.append("category", category);
    if (vendorId) qs.set("vendorId", vendorId);
    return `/scope?${qs.toString()}`;
  },
  // R67 D-31 (R-090), folded in at the merge. The Attendance Report and the
  // Manpower Cost Report both said "Not yet viewable here" while the SAME
  // numbers were live on the Manpower screen's trade-wise summary -- three
  // answers to "where is my attendance report". Lane D put these two in its
  // own override table inside work-progress-report-params.ts; they belong in
  // THIS table, which exists precisely so there is one of them.
  "construction-attendance": () => "/labour?tab=attendance",
  "construction-manpower-cost": () => "/labour?tab=attendance",
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
  // R67 E-11: forwarded, not applied here. The projexa proxy passes every param
  // through, so a handler that already filters (work-progress, budget-variance)
  // does the real thing; the ones that do not are filtered client-side, and the
  // screen says which of the two happened.
  if (params.category) qs.append("category", params.category);
  if (params.vendorId) qs.set("vendorId", params.vendorId);
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

/**
 * R67 E-16 (R-150). The route's last segment is only the report's name by
 * COINCIDENCE -- it happens to be true for "/api/construction/reports/attendance"
 * and for "/work-progress?tab=report", and it is false the moment a report's
 * screen is a tab on a module named after something else ("/design-studio?tab=
 * cost-analysis" would resolve to "design-studio", which is not a report).
 *
 * The catalog entry's OWN id is the reliable answer: compliance-tracker builds
 * every construction entry as `construction-<reportName>` from exactly the
 * REPORT_REGISTRY key the picker uses (report-catalog-service.ts's
 * `id.replace(/^construction-/, "")`). So the id decides for a construction
 * entry, and the route stays the fallback for everything else.
 */
export function catalogEntrySlug(entry: { id?: string | null; route?: string | null }): string | null {
  const id = entry.id ?? "";
  if (id.startsWith("construction-")) {
    const slug = id.slice("construction-".length);
    if (slug.length > 0) return slug;
  }
  return catalogSlug(entry.route);
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
  "designer-timesheet": "Runs here — Design Studio > Cost Analysis",
};

export function catalogDestination(
  entry: { id?: string | null; route?: string | null } | string | null | undefined,
  params: ReportParams
): CatalogDestination | null {
  // Accepts the whole entry (preferred -- see catalogEntrySlug) or, for the
  // callers that only hold a route, the route string.
  const slug = typeof entry === "string" || entry === null || entry === undefined
    ? catalogSlug(entry)
    : catalogEntrySlug(entry);
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

// ---------------------------------------------------------------------------
// R67 D-02's entry point, moved here at the merge (2026-09-03).
//
// Lane D shipped projexaReportDestination inside work-progress-report-params
// .ts with its own three-entry override table. Keeping both would have left
// the product with TWO tables answering "where does this report name go" --
// the exact condition R-079 measured. The table above is now the only one; the
// function keeps its name and its signature so lane D's callers and its tests
// are unchanged, and its two labour entries were folded in above.
//
// It answers for a CATALOG ENTRY (which carries an id and a human name) rather
// than a picker slug, which is why it slugifies both and tries each: the
// picker stores the API path segment ("work-progress"), the catalog stores the
// name ("Work Progress Report"), and both mean one report.
// ---------------------------------------------------------------------------

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * The PROJEXA route a report entry should navigate to instead of being run in
 * place, or null when the entry runs where it is.
 */
export function projexaReportDestination(
  entry: { id?: string; name?: string },
  projectId: string | null
): string | null {
  const candidates = [entry.id, entry.name].filter((v): v is string => typeof v === "string" && v.length > 0);
  for (const candidate of candidates) {
    const slug = slugify(candidate);
    // The trailing "-report" is dropped before the lookup rather than
    // duplicating every key in the table above.
    const hosted = HOSTED_REPORTS[slug] ?? HOSTED_REPORTS[slug.replace(/-report$/, "")];
    if (hosted) return hosted({ projectId: projectId ?? "" });
  }
  return null;
}
