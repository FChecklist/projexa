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

// ---------------------------------------------------------------------------
// MERGE NOTE (2026-09-03). Items D-02 and E-03/E-17/E-20 both landed a module
// at this path, for the same decision D-02. This file is the union, converged
// on ONE set of names:
//
//   * D-02's WPR_VIEWS / WprParams / parseWprParams / wprSearchParams /
//     workProgressReportHref above are the canon for what the URL looks like.
//     They are what the server page reads, so they stay exactly as they are.
//   * E-03/E-17/E-20's caption, period-chip, WhatsApp and run-state helpers
//     below are what the SCREEN owes the reader. D-02 has no equivalent.
//
// D-02's projexaReportDestination moved OUT of this file to
// report-destinations.ts. Two modules answering "where does this report name
// go" is the defect R-079 records; there is now one table, and it is the one
// the picker, the Full Catalog and the timeout card all resolve through.
// ---------------------------------------------------------------------------

/** True for a real YYYY-MM-DD. */
export function isIsoDay(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** D-02's isoDate under E-03's name, so both halves of this file read alike. */
export const isoDay = isoDate;

/**
 * R67 E-03 (R-024). WHERE THE REPORT STARTS WHEN NOBODY SAID.
 *
 * D-02's defaultWprRange opens on the first of the current month, which is the
 * window the screen used to pre-fill. E-03 replaces it for the ARRIVAL case
 * specifically, and the reason is a real one: a fit-out job that logged its
 * last progress in July shows an EMPTY report on 2 September, and an empty
 * report reads as "nothing was ever done here" rather than "you are looking at
 * the wrong fortnight".
 *
 * So: the earliest entry actually recorded, else the project's start date,
 * else 1 January of the current year. defaultWprRange is untouched and is
 * still what a caller with no project context (workProgressReportHref) uses.
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
 * parseWprParams with E-03's arrival default: a value the URL DOES carry is
 * always honoured (including a From later than the To -- narrowing to nothing
 * is a legitimate thing to ask for, and silently "correcting" a shared link
 * would be worse than the empty report the screen states in words anyway).
 * Only a MISSING From falls back to the project's own history.
 */
export function resolveWprParams(
  search: { from?: string; to?: string; view?: string; boqVersion?: string },
  fallback: { earliestEntryDate?: string | null; projectStartDate?: string | null; today: string }
): WprParams {
  const parsed = parseWprParams(search, utcDayFromIso(fallback.today));
  return {
    ...parsed,
    from: isIsoDay(search.from) ? search.from : resolveDefaultFrom(fallback),
    to: isIsoDay(search.to) ? search.to : fallback.today,
  };
}

/** A YYYY-MM-DD read as a LOCAL calendar day, so parseWprParams's own local-time defaults line up with it. */
function utcDayFromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** E-03's third-column mode. Not a URL parameter -- a display toggle the caption states. */
export type ThirdColumnMode = "total" | "balance";

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

// R67 E-17 (R-175) / E-20 (R-194). THE PERIOD, AS CHIPS.
//
// The screen carried two bare date inputs and the sentence "Pick a date range
// and click Run Report." over a range that was already filled (correction
// C-04). E-03 deleted the sentence and made the report run on arrival; this is
// the other half -- the period is a row of named chips with one preselected, so
// a reader can see WHICH window they are looking at without reading two dates
// and doing the arithmetic, and can change it in one click.
//
// "Custom..." is not a preset: it is the absence of one, which is why
// matchPeriodPreset returns null rather than a fifth value. A range that
// matches no preset is a real, legitimate state (a shared link, a hand-typed
// window) and the chips must show that honestly instead of highlighting the
// nearest one.

export const PERIOD_PRESETS = ["all", "this-month", "last-month", "this-year"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  all: "Since first entry",
  "this-month": "This month",
  "last-month": "Last month",
  "this-year": "This year",
};

/** The label for the chip row's escape hatch, and for a range that matches no preset. */
export const CUSTOM_PERIOD_LABEL = "Custom...";

/** UTC month arithmetic on YYYY-MM-DD, so no local time zone can move a boundary day. */
function utcDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * What a preset means, in dates.
 *
 * `earliestFrom` is the From the screen already resolved on arrival -- the
 * earliest recorded entry date, or the project start, or 1 January (see
 * resolveDefaultFrom). "Since first entry" is that same date rather than a
 * second opinion about where this project's history begins.
 */
export function periodPresetRange(
  preset: PeriodPreset,
  ctx: { today: string; earliestFrom: string }
): { from: string; to: string } {
  const today = utcDay(ctx.today);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  switch (preset) {
    case "all":
      return { from: ctx.earliestFrom, to: ctx.today };
    case "this-month":
      return { from: isoDay(new Date(Date.UTC(year, month, 1))), to: ctx.today };
    case "last-month":
      return {
        from: isoDay(new Date(Date.UTC(year, month - 1, 1))),
        // Day 0 of this month IS the last day of the previous one.
        to: isoDay(new Date(Date.UTC(year, month, 0))),
      };
    case "this-year":
      return { from: `${year}-01-01`, to: ctx.today };
  }
}

/** Which chip is lit, or null when the range is genuinely a custom one. */
export function matchPeriodPreset(
  range: { from: string; to: string },
  ctx: { today: string; earliestFrom: string }
): PeriodPreset | null {
  for (const preset of PERIOD_PRESETS) {
    const candidate = periodPresetRange(preset, ctx);
    if (candidate.from === range.from && candidate.to === range.to) return preset;
  }
  return null;
}

/**
 * R67 E-20 (R-194): the grey line that replaced the idle prompt -- the window
 * in words, with the preset it corresponds to named in brackets, so a reader
 * never has to work out that "01 Sep - 03 Sep" means "month to date".
 */
export function periodLine(
  range: { from: string; to: string },
  ctx: { today: string; earliestFrom: string }
): string {
  const preset = matchPeriodPreset(range, ctx);
  const named = preset ? ` (${PERIOD_PRESET_LABELS[preset].toLowerCase()})` : "";
  return `Showing ${captionDate(range.from)} – ${captionDate(range.to)}${named}`;
}

// R67 E-17 (R-175). THE RUN'S OWN STATE, in words.
//
// A spinner cannot tell a slow report from a hung one. A second count can, and
// after twenty seconds the screen stops leaving the reader to guess and says
// what it thinks is happening -- without ABORTING, which is the difference
// between this screen and the Reports panel: there the reader has a faster
// alternative to be sent to, here this IS the fast path.

/** "Running Work Progress Report - 3 s" */
export function wprRunningLine(seconds: number): string {
  return `Running Work Progress Report – ${seconds} s`;
}

/** After this long, the screen says what it thinks is happening rather than spinning silently. */
export const WPR_STILL_RUNNING_MS = 20_000;

export const WPR_STILL_RUNNING_NOTE =
  "Still running – the data service is slow; you can keep waiting or cancel";
