// R67 D-02 -- ONE Work Progress Report.
//
// DECISION D-02, verbatim: "The WPR is /work-progress?tab=report with
// parameters in the URL (from, to, view, boqVersion) and it runs on arrival.
// The Reports module's 'Work Progress' picker entry and the Full Catalog row
// both navigate to that route."
//
// Correction C-04 is what makes "runs on arrival" a fix rather than a
// preference: today the range is ALREADY filled in when the tab opens, and the
// screen still says "Pick a date range and click Run Report" -- three clicks to
// see the current month that the screen could have shown on arrival.
//
// Everything here is pure and server-safe: the page reads searchParams through
// parseWprParams, the client writes them back through wprSearchParams, and the
// Reports module builds its link through workProgressReportHref. One place, so
// the picker, the catalog row and the tab itself cannot disagree about what
// the WPR's URL looks like.

export const WPR_VIEWS = ["scope", "category", "manpower", "vendor"] as const;
export type WprView = (typeof WPR_VIEWS)[number];

export type WprParams = {
  /** ISO yyyy-mm-dd, inclusive. */
  from: string;
  /** ISO yyyy-mm-dd, inclusive. */
  to: string;
  view: WprView;
  /** The BOQ version to report on; null lets the server pick the latest live one. */
  boqVersion: number | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Local-calendar yyyy-mm-dd. Deliberately NOT toISOString(), which shifts to UTC. */
export function isoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The range the report opens with: the first of the current month to today --
 * the same window the screen already pre-filled before D-02, now actually run
 * rather than described.
 */
export function defaultWprRange(today: Date): { from: string; to: string } {
  return {
    from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: isoDate(today),
  };
}

function readView(raw: string | undefined): WprView {
  return (WPR_VIEWS as readonly string[]).includes(raw ?? "") ? (raw as WprView) : "scope";
}

function readBoqVersion(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Reads the four report parameters off a URL. Anything absent or unusable
 * falls back to the default rather than blocking the run -- a bad bookmark
 * still shows the current month, which is the honest behaviour for a report
 * that has a real default.
 */
export function parseWprParams(
  search: { from?: string; to?: string; view?: string; boqVersion?: string },
  today: Date
): WprParams {
  const fallback = defaultWprRange(today);
  return {
    from: search.from && ISO_DATE.test(search.from) ? search.from : fallback.from,
    to: search.to && ISO_DATE.test(search.to) ? search.to : fallback.to,
    view: readView(search.view),
    boqVersion: readBoqVersion(search.boqVersion),
  };
}

/**
 * The report's own parameters as URL search params -- `tab=report` included,
 * because the report IS a tab of /work-progress and a link that omits it lands
 * the user on Daily Entry.
 */
export function wprSearchParams(params: WprParams, projectId?: string | null): URLSearchParams {
  const search = new URLSearchParams();
  if (projectId) search.set("projectId", projectId);
  search.set("tab", "report");
  search.set("from", params.from);
  search.set("to", params.to);
  search.set("view", params.view);
  if (params.boqVersion !== null) search.set("boqVersion", String(params.boqVersion));
  return search;
}

/**
 * The one URL every entry point to the Work Progress Report uses: the Report
 * tab itself, the Reports picker, and the Full Catalog row.
 */
export function workProgressReportHref(
  projectId: string | null,
  params?: Partial<WprParams>,
  today: Date = new Date()
): string {
  const base = parseWprParams({}, today);
  const merged: WprParams = { ...base, ...params };
  return `/work-progress?${wprSearchParams(merged, projectId).toString()}`;
}

/**
 * Reports-module entries that are really a module screen in disguise.
 *
 * D-02 retires /reports/work-progress from the UI: it is the SLOW path (24.3 s
 * measured, six fan-out calls) for a report the Work Progress module already
 * renders from /api/work-progress/report (2.7 s measured), with a BOQ selector,
 * a tie check and an export the Reports page has no way to offer. Rather than
 * two screens for one report, the Reports entry navigates to the real one.
 *
 * Matching is on the entry's own id/name normalised to a slug, so the fixed
 * 17-report picker (value "work-progress") and the Full Catalog row (name
 * "Work Progress ...") both resolve through the same table.
 */
const REPORT_ROUTE_OVERRIDES: Record<string, (projectId: string | null) => string> = {
  "work-progress": (projectId) => workProgressReportHref(projectId),
};

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
    // The picker stores the API path segment ("work-progress"); the catalog
    // stores the human name ("Work Progress Report"). Both name the same
    // report, so the trailing "-report" is dropped before the lookup rather
    // than duplicating every key in the table.
    const override = REPORT_ROUTE_OVERRIDES[slug] ?? REPORT_ROUTE_OVERRIDES[slug.replace(/-report$/, "")];
    if (override) return override(projectId);
  }
  return null;
}
