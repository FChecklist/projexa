// R67 E-03 (R-072/R-073/R-076/R-077), implementing binding decision D-02:
// "the one WPR lives at /work-progress?tab=report with from, to, view and
// boqVersion in the URL and runs on arrival".
//
// The rules that decide WHICH range it runs on arrival live here, pure, for
// two reasons. First, correction C-04 records that today's screen shows "Pick
// a date range and click Run Report." over a range that is already filled --
// so the defaulting rule is the thing being fixed and it needs assertions, not
// a re-reading of JSX. Second, defaultFrom() as shipped gives a TWO-DAY window
// on the 2nd of a month, which looks like an empty report rather than a narrow
// one; the fallback chain below is what replaces it.

/** The report's own view tabs. Kept in the URL so a shared link opens the tab that was shared. */
export const REPORT_VIEWS = ["scope", "category", "manpower", "vendor"] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];

export type ThirdColumnMode = "total" | "balance";

export type ReportParams = {
  from: string;
  to: string;
  view: ReportView;
  /** The BOQ id chosen in the URL. Empty string = let the server auto-pick the latest non-superseded one. */
  boqVersion: string;
};

/** YYYY-MM-DD for a Date, in UTC -- never toLocaleDateString, which would shift the day for half the world. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A date input's value is only ever YYYY-MM-DD; anything else in the URL is someone's typo, not a range. */
export function isIsoDay(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isReportView(value: string | null | undefined): value is ReportView {
  return typeof value === "string" && (REPORT_VIEWS as readonly string[]).includes(value);
}

/**
 * The From date, when the URL does not carry one.
 *
 * The chain, in the item's own order: the earliest entry date actually
 * recorded against this project, then the project's start date, then 1 January
 * of the current year. Every step is a real date this project owns; none of
 * them is "the 1st of this month", which is what produced a two-day window on
 * the 2nd of a month and made a busy project look idle.
 *
 * `today` is passed in rather than read from the clock so this is testable and
 * so the caller's notion of "today" is the same one the To date uses.
 */
export function resolveDefaultFrom(input: {
  earliestEntryDate?: string | null;
  projectStartDate?: string | null;
  today: string;
}): string {
  if (isIsoDay(input.earliestEntryDate)) return input.earliestEntryDate;
  if (isIsoDay(input.projectStartDate)) return input.projectStartDate;
  return `${input.today.slice(0, 4)}-01-01`;
}

/**
 * Resolves the four parameters from the URL, filling in only what is missing.
 * A value the URL DOES carry is always honoured, including a From later than
 * the To -- narrowing to nothing is a legitimate thing to ask for, and
 * silently "correcting" a shared link would be worse than an empty report,
 * which the screen states in words anyway.
 */
export function resolveReportParams(
  search: { get(key: string): string | null },
  fallback: { earliestEntryDate?: string | null; projectStartDate?: string | null; today: string }
): ReportParams {
  const from = search.get("from");
  const to = search.get("to");
  const view = search.get("view");
  return {
    from: isIsoDay(from) ? from : resolveDefaultFrom(fallback),
    to: isIsoDay(to) ? to : fallback.today,
    view: isReportView(view) ? view : "scope",
    boqVersion: search.get("boqVersion") ?? "",
  };
}

/**
 * "1 Jan 2026" -- the caption's date shape.
 *
 * Written out rather than via Intl on purpose. `toLocaleDateString("en-GB",
 * { month: "short" })` returns "Sept" for September on a current ICU and "Sep"
 * on an older one, so the caption -- which is also the first line of the CSV
 * and the PDF -- would differ between the browser, the server render and a
 * colleague's machine. A fixed table has one answer everywhere, and the
 * arithmetic is a string slice: no Date object, so no timezone can move the
 * day (a local-time parse of "2026-01-01" renders 31 Dec anywhere west of
 * Greenwich).
 */
const CAPTION_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function captionDate(iso: string): string {
  if (!isIsoDay(iso)) return iso;
  const [year, month, day] = iso.split("-");
  const name = CAPTION_MONTHS[Number(month) - 1];
  if (!name) return iso;
  return `${Number(day)} ${name} ${year}`;
}

/**
 * The caption printed above the table, and the FIRST LINE of the CSV and the
 * PDF -- one sentence, three facts, so an exported file can never be mistaken
 * for a different range or a different BOQ revision than the one on screen.
 */
export function reportCaption(input: {
  from: string;
  to: string;
  boqTitle: string | null;
  boqVersionLabel: string | null;
  mode: ThirdColumnMode;
}): string {
  const boq = input.boqTitle
    ? `BOQ ${input.boqTitle}${input.boqVersionLabel ? ` ${input.boqVersionLabel}` : ""}`
    : "No BOQ selected";
  return `Showing ${captionDate(input.from)} – ${captionDate(input.to)} · ${boq} · Third column: ${input.mode === "balance" ? "Balance" : "Total"}`;
}

/** The 12px line under the caption. A sentence, not a tooltip -- a tooltip is not readable on a printout or a phone. */
export const THIRD_COLUMN_NOTE = "Total = to-date; Balance = contract less to-date";

/**
 * "0 %" and "nobody recorded anything" look identical on this table, and the
 * second one is not a performance figure. When no row in the report was
 * touched in any bucket, the screen says so above the still-visible table --
 * hiding the table would take away the line items a reader still needs to see.
 */
export function noProgressNotice(
  rows: readonly { touched: { prev: boolean; current: boolean; total: boolean } }[],
  from: string,
  to: string
): string | null {
  if (rows.length === 0) return null;
  const anyTouched = rows.some((r) => r.touched.prev || r.touched.current || r.touched.total);
  if (anyTouched) return null;
  return `No progress recorded between ${captionDate(from)} and ${captionDate(to)}`;
}

/** The WhatsApp message. One sentence, the project, the range and the link -- nothing a recipient has to decode. */
export function whatsappMessage(input: { projectName: string; from: string; to: string; url: string }): string {
  return `Work Progress Report – ${input.projectName}, ${captionDate(input.from)}–${captionDate(input.to)}: ${input.url}`;
}

export function whatsappHref(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
