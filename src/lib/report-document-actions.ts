// R67 E-12 (R-136). What the report document's header actions DO, as pure
// rules, so the Reports screen and its test agree about them without a browser.
//
// Export is server-side only: PROJEXA must not gain a PDF or an XLSX library,
// so every format is a URL into the relay, which VERIDIAN builds from the SAME
// schema the on-screen table is rendered from. Share mints a real signed link
// through compliance-tracker's own share service, and only for a report whose
// public page can render it -- a link that 404s for whoever received it is
// worse than no link, which is exactly why item E-09 shipped a copied in-app
// URL instead.

/** The formats the relay can return, in the order the header offers them. */
export const EXPORT_FORMATS = ["pdf", "xlsx", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * The reports whose document a public page can really render. Mirrors the
 * SHAREABLE map in src/app/api/reports/[reportName]/share/route.ts and
 * compliance-tracker's SHAREABLE_REPORT_TYPES; the route is the enforcement,
 * this is what the screen offers, and the two must name the same reports.
 */
export const SHAREABLE_REPORTS = ["work-progress", "project-status"] as const;

/**
 * A report whose own payload does not carry the rows its document prints, and
 * the report that does. Project Status is dashboard scalars; the table under it
 * -- Sumeet 6.png II's Subcontractor / Budget breakup -- is the BOQ's budget
 * line by line, which is the budget-variance report. Fetching it alongside is
 * what makes the document a document rather than a key/value grid.
 */
export const BREAKUP_SOURCE_REPORT: Record<string, string> = {
  "project-status": "budget-variance",
};

export type ExportParams = {
  projectId: string;
  category?: string | null;
  vendorId?: string | null;
};

/** The relay URL for one format of one report. Filters ride along, so the file matches the table. */
export function reportExportHref(reportName: string, format: ExportFormat, params: ExportParams): string {
  const qs = new URLSearchParams({ projectId: params.projectId, format });
  // Repeatable, for the same reason every other call site repeats it: a real
  // category name may contain a comma.
  if (params.category) qs.append("category", params.category);
  if (params.vendorId) qs.set("vendorId", params.vendorId);
  return `/api/reports/${encodeURIComponent(reportName)}/export?${qs.toString()}`;
}

/**
 * The WhatsApp share, the same pattern the MoM object page already ships: the
 * title and the link, in one message, through wa.me -- never the WhatsApp
 * Business API, which was ruled out.
 */
export function whatsappHref(title: string, link: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${title}\n${link}`)}`;
}

/**
 * Why Export cannot be pressed, in words, or null when it can. Order matters:
 * the reader is told the FIRST thing that stops them, and "the numbers
 * disagree" outranks "this report has no document" because it is the one that
 * would produce a wrong file rather than no file.
 */
export function exportDisabledReason(input: {
  hasResult: boolean;
  serverExport: boolean;
  tieMessage: string | null;
}): string | null {
  if (!input.hasResult) return "Run the report first";
  if (input.tieMessage) return input.tieMessage;
  if (!input.serverExport) return "This report has no document export yet";
  return null;
}

/** Why Share cannot be pressed, in words, or null when it can. */
export function shareDisabledReason(reportName: string, hasResult: boolean): string | null {
  if (!hasResult) return "Run the report first";
  if (!(SHAREABLE_REPORTS as readonly string[]).includes(reportName)) {
    return "This report has no public view yet — copy the link instead";
  }
  return null;
}
