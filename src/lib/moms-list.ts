// R67 D-16 / D-20 -- everything the Minutes-of-Meeting LIST decides, with no
// React in it, so each decision is a unit test instead of a screenshot.
//
// The four things this file exists to keep honest:
//
//  1. A FAILED READ IS NOT AN EMPTY LIST. The list has four branches, not
//     two, and the sentence "No meetings recorded yet" may only be reached
//     from a 200. `momsListState()` is the one place that decides which
//     branch is live; a screen cannot accidentally fall through to the empty
//     one because there is nowhere to fall through to.
//
//  2. A FILTERED-EMPTY LIST IS NOT AN EMPTY LIST EITHER. The Filter defaults
//     to the last 90 days, so an org whose meetings are all older would have
//     been told it had never recorded one. That is its own branch with its
//     own sentence and a way out.
//
//  3. THE FILTER LIVES IN THE URL. Back, a reload and a pasted link all
//     restore the same view -- same rule D-02 applied to the Work Progress
//     Report. A malformed bookmark falls back to the default range rather
//     than refusing to render.
//
//  4. AN EXPORTED CELL IS DATA, NOT A FORMULA. `=cmd|...`, `+`, `-` and `@`
//     leading a CSV cell are executed by Excel on open; every exported cell
//     is neutralised, the same guard compliance-tracker's own
//     report-export-shared.ts applies server-side.

import { formatDateTimeOrg } from "@/lib/format-date";

export type MeetingListRow = {
  id: string;
  title: string;
  status: string;
  scheduledAt: string;
  /** The project this meeting belongs to (veri_meetings.context_entity_id). */
  contextEntityId?: string | null;
  attendees?: unknown;
  /** R67 D-16, computed by compliance-tracker's list DTO. */
  attendeesCount?: number | null;
  openActionItems?: number | null;
};

// ─── Filter state, held in the URL ───────────────────────────────────────

export type MomsFilter = {
  /** "" = every status. */
  status: string;
  /** yyyy-mm-dd, inclusive. */
  from: string;
  /** yyyy-mm-dd, inclusive. */
  to: string;
  /** Free text matched against the attendee names on the meeting. */
  attendee: string;
};

export const MOMS_DEFAULT_RANGE_DAYS = 90;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** yyyy-mm-dd for a Date, in UTC, with no dependency on the runtime's zone. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The Filter's default range: the last 90 days, ending today. `today` is a
 * parameter so this is testable and so a caller never disagrees with itself
 * across a midnight boundary mid-render.
 */
export function defaultMomsRange(today: Date): { from: string; to: string } {
  const to = new Date(today.getTime());
  const from = new Date(today.getTime() - MOMS_DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  return { from: isoDay(from), to: isoDay(to) };
}

/**
 * Reads the filter out of the URL. Deliberately forgiving: a hand-edited or
 * stale link with a nonsense date shows the DEFAULT range rather than an
 * error, because the user's intent ("show me this project's meetings") is
 * still perfectly clear.
 */
export function parseMomsFilter(
  params: { get(key: string): string | null } | null | undefined,
  today: Date
): MomsFilter {
  const fallback = defaultMomsRange(today);
  const raw = (key: string) => (params?.get(key) ?? "").trim();
  const day = (key: string, fb: string) => (ISO_DAY.test(raw(key)) ? raw(key) : fb);
  return {
    status: raw("status"),
    from: day("from", fallback.from),
    to: day("to", fallback.to),
    attendee: raw("attendee"),
  };
}

/**
 * Writes the filter back into the URL. The default range is still written
 * out in full -- the range is a real, visible constraint on what the screen
 * is showing, and a link that omitted it would mean something different
 * ninety-one days from now.
 */
export function momsSearchParams(filter: MomsFilter, projectId?: string | null): URLSearchParams {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (filter.status) params.set("status", filter.status);
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  if (filter.attendee) params.set("attendee", filter.attendee);
  return params;
}

export function momsHref(filter: MomsFilter, projectId?: string | null): string {
  const qs = momsSearchParams(filter, projectId).toString();
  return qs ? `/moms?${qs}` : "/moms";
}

/** True when the user has narrowed anything at all beyond the given default. */
export function isNarrowedAgainst(filter: MomsFilter, defaults: { from: string; to: string }): boolean {
  return (
    filter.status !== "" || filter.attendee !== "" || filter.from !== defaults.from || filter.to !== defaults.to
  );
}

/** True when the user has narrowed anything at all beyond the default range. */
export function isFilterNarrowed(filter: MomsFilter, today: Date): boolean {
  return isNarrowedAgainst(filter, defaultMomsRange(today));
}

// ─── Filtering the rows the server returned ──────────────────────────────

function attendeeNames(row: MeetingListRow): string[] {
  if (!Array.isArray(row.attendees)) return [];
  return row.attendees.filter((a): a is string => typeof a === "string");
}

/**
 * Applies the filter to the rows the server returned. The date comparison is
 * on the calendar day of `scheduledAt` in UTC so it matches the yyyy-mm-dd
 * the two date inputs produce; a row with an unparseable scheduledAt is KEPT
 * rather than dropped, because hiding a real meeting is worse than showing
 * one whose date we cannot place.
 */
export function filterMeetings(rows: MeetingListRow[], filter: MomsFilter): MeetingListRow[] {
  const attendee = filter.attendee.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.status && row.status !== filter.status) return false;

    const scheduled = new Date(row.scheduledAt);
    if (!Number.isNaN(scheduled.getTime())) {
      const day = isoDay(scheduled);
      if (filter.from && day < filter.from) return false;
      if (filter.to && day > filter.to) return false;
    }

    if (attendee) {
      const names = attendeeNames(row);
      if (!names.some((n) => n.toLowerCase().includes(attendee))) return false;
    }
    return true;
  });
}

// ─── The four (five) honest states ───────────────────────────────────────

export type MomsListState =
  | { kind: "no-project" }
  | { kind: "loading" }
  | { kind: "error"; message: string; footer: string }
  | { kind: "forbidden"; message: string }
  | { kind: "empty"; message: string }
  | { kind: "filtered-empty"; message: string }
  | { kind: "ready"; rows: MeetingListRow[] };

/** The exact sentences the item specifies. Nothing on this screen invents one. */
export const MOMS_TEXT = {
  noProject: "Choose a project in the top bar",
  noProjectOnCreate: "Choose a project in the top bar to see its meetings",
  forbidden: "You don't have access to this project's meetings",
  empty: "No meetings recorded yet - press + New Meeting to start one.",
  filteredEmpty: "No meetings match these filters.",
  retry: "Retry",
} as const;

/** "Couldn't load meetings for Cedar Heights Villa - Phase 1: ..." */
export function momsLoadErrorSentence(projectLabel: string): string {
  return `Couldn't load meetings for ${projectLabel}: the construction data service did not respond.`;
}

/**
 * The single decision every branch of the screen is drawn from.
 *
 * `rows` is only consulted when `status` is "ready", so there is no path on
 * which a failed read can reach the empty sentence -- the defect this whole
 * item exists to remove.
 */
export function momsListState(input: {
  hasProjectScope: boolean;
  status: "loading" | "error" | "ready";
  httpStatus?: number | null;
  errorMessage?: string | null;
  projectLabel: string;
  rows?: MeetingListRow[];
  visibleRows?: MeetingListRow[];
}): MomsListState {
  if (!input.hasProjectScope) return { kind: "no-project" };
  if (input.status === "loading") return { kind: "loading" };
  if (input.status === "error") {
    if (input.httpStatus === 401 || input.httpStatus === 403) {
      return { kind: "forbidden", message: MOMS_TEXT.forbidden };
    }
    return {
      kind: "error",
      message: momsLoadErrorSentence(input.projectLabel),
      footer: "1 error",
    };
  }
  const rows = input.rows ?? [];
  const visible = input.visibleRows ?? rows;
  if (rows.length === 0) return { kind: "empty", message: MOMS_TEXT.empty };
  if (visible.length === 0) return { kind: "filtered-empty", message: MOMS_TEXT.filteredEmpty };
  return { kind: "ready", rows: visible };
}

// ─── The two aggregate columns ───────────────────────────────────────────
//
// compliance-tracker's list DTO supplies both. The two repos ship in two
// PRs, so until the server half is deployed the fields are simply absent --
// and an absent count is NOT zero. "0 attendees" on a meeting with four is
// the same lie as "no permits" over a 500, so:
//
//   attendeesCount -- falls back to counting the row's own `attendees`
//     array, which the list has always carried, so this column is real
//     today either way.
//   openActionItems -- cannot be derived from anything the list carries, so
//     it renders an en-dash until the server half lands. An en-dash is the
//     truthful answer to "we have not been told".

export function displayAttendeesCount(row: MeetingListRow): number | null {
  if (typeof row.attendeesCount === "number" && Number.isFinite(row.attendeesCount)) return row.attendeesCount;
  if (Array.isArray(row.attendees)) {
    return row.attendees.filter((a) => (typeof a === "string" ? a.trim().length > 0 : a !== null && a !== undefined)).length;
  }
  return null;
}

export function displayOpenActions(row: MeetingListRow): number | null {
  return typeof row.openActionItems === "number" && Number.isFinite(row.openActionItems) ? row.openActionItems : null;
}

/** A count we were never given renders an en-dash, never a confident 0. */
export function countCell(value: number | null): string {
  return value === null ? "—" : String(value);
}

// ─── Status: a glyph AND a word, never colour alone ──────────────────────

export type MeetingStatusChip = { label: string; filled: boolean; tone: "done" | "neutral" };

/**
 * Sage filled circle for "published", grey hollow circle for "draft". Never
 * the saffron or destructive badge variant -- saffron is the single
 * primary-action colour on this product and rose is reserved for late/error,
 * so spending either on a routine status would make both unreadable.
 *
 * An unrecognised status renders its own word in the neutral tone rather
 * than being forced into one of the two known buckets.
 */
export function meetingStatusChip(status: string): MeetingStatusChip {
  if (status === "published") return { label: "published", filled: true, tone: "done" };
  if (status === "draft") return { label: "draft", filled: false, tone: "neutral" };
  return { label: status || "unknown", filled: false, tone: "neutral" };
}

// ─── Export CSV ──────────────────────────────────────────────────────────

/**
 * One CSV cell. Quotes anything containing a delimiter, a quote or a
 * newline, and neutralises the four characters Excel/Sheets treat as the
 * start of a formula -- an attendee literally named "=SUM(A1)" must land in
 * the sheet as text, not as an executed cell.
 */
export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export const MOMS_CSV_HEADER = ["Meeting", "Date & time", "Attendees", "Open actions", "Status"] as const;

/**
 * The VISIBLE rows, in the order they are on screen, with the same date form
 * the screen shows -- an export that disagreed with the table above it would
 * be a second source of truth.
 */
export function meetingsToCsv(
  rows: MeetingListRow[],
  options: { projectNameFor?: (row: MeetingListRow) => string | null; locale?: string; timeZone?: string } = {}
): string {
  const withProject = Boolean(options.projectNameFor);
  const header = withProject
    ? ["Meeting", "Project", ...MOMS_CSV_HEADER.slice(1)]
    : [...MOMS_CSV_HEADER];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    const cells: unknown[] = [row.title];
    if (options.projectNameFor) cells.push(options.projectNameFor(row) ?? "");
    cells.push(
      formatDateTimeOrg(row.scheduledAt, options.locale, options.timeZone),
      // An unknown count exports as an EMPTY cell, never as 0 -- the same
      // rule the on-screen en-dash follows. A spreadsheet that said 0 open
      // actions would be a claim nobody made.
      displayAttendeesCount(row) ?? "",
      displayOpenActions(row) ?? "",
      row.status
    );
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

/** The file a user ends up with in Downloads. */
export function momsCsvFilename(projectLabel: string, filter: MomsFilter): string {
  const slug = projectLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "all-projects";
  return `moms-${slug}-${filter.from}-to-${filter.to}.csv`;
}
