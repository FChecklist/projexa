// R67 D-44 / D-45 -- the Timeline's arithmetic, kept out of the component so it
// can be exercised directly.
//
// WHY THIS FILE EXISTS. Two of the three numbers this module is supposed to
// show a project manager -- how far behind an activity is, and how far behind
// the programme is -- did not exist anywhere in the product. The backend has
// written baseline snapshots since Wave 140 (schedule-service.ts's
// captureBaseline) and both GET routes have shipped with ZERO UI callers, so
// nothing has ever compared a planned date to an actual one. Everything here
// is that comparison, and nothing here invents a value: a missing baseline, a
// missing date or an unparseable one produces null, and null renders as the
// en-dash. Zero is a real answer and never renders as the en-dash.
//
// All dates are the plain ISO 'YYYY-MM-DD' strings pms_issues.start_date /
// due_date and pms_baseline_issue_snapshots store. They are compared at UTC
// midnight for the same reason src/lib/format-date.ts pins its time zone: a
// date-only value read in a local zone can land on a different calendar day.

/** What an unknown value renders as -- the same en-dash the rest of the product uses. */
export const EMPTY_SCHEDULE_CELL = "—";

/** Parses 'YYYY-MM-DD' (or any Date-parseable string) to UTC-midnight ms, or null. */
export function toUtcMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to`. Null when either date is missing or unparseable. */
export function daysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = toUtcMs(from);
  const b = toUtcMs(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / DAY_MS);
}

/**
 * D-44's Duration column: "due minus start, en dash when either is unset".
 * Deliberately the literal difference, not difference+1 -- an activity that
 * starts and finishes on the same day has a duration of 0 days here, which is
 * what a milestone is, and inventing a "+1 inclusive day" convention would put
 * a second, silently different definition of duration into a product that will
 * also import durations from MS Project.
 */
export function durationDays(startDate: string | null | undefined, dueDate: string | null | undefined): number | null {
  return daysBetween(startDate, dueDate);
}

/** "4 d" / "0 d" / the en-dash. */
export function formatDurationDays(days: number | null): string {
  return days === null ? EMPTY_SCHEDULE_CELL : `${days} d`;
}

/**
 * Slip against the baseline: actual due minus PLANNED due. Positive = late.
 * Null when this activity has no baseline snapshot, or either side has no due
 * date -- which is a different fact from "on time" and must not collapse into 0.
 */
export function slipDays(dueDate: string | null | undefined, plannedDueDate: string | null | undefined): number | null {
  return daysBetween(plannedDueDate, dueDate);
}

export type SlipDisplay = { glyph: string; text: string; tone: "late" | "early" | "on-time" | "unknown" };

/**
 * D-45: "glyph plus word plus number: '+3 d late', '2 d early' or an en dash".
 * The glyph is never the only carrier of the meaning -- the word is always
 * there too, because colour and shape alone fail for a colour-blind reader and
 * in a printed WPR.
 */
export function formatSlip(slip: number | null): SlipDisplay {
  if (slip === null) return { glyph: "", text: EMPTY_SCHEDULE_CELL, tone: "unknown" };
  if (slip > 0) return { glyph: "▲", text: `+${slip} d late`, tone: "late" };
  if (slip < 0) return { glyph: "▼", text: `${Math.abs(slip)} d early`, tone: "early" };
  return { glyph: "", text: "0 d on time", tone: "on-time" };
}

/**
 * How complete an activity SHOULD be today, from its baseline window alone.
 * clamp((today - plannedStart) / (plannedDue - plannedStart)) as a percentage.
 *
 * A zero-length or inverted window is not an error and not a division: the
 * activity is either wholly due (today has reached the planned finish) or
 * wholly not.
 */
export function plannedPercentComplete(
  plannedStartDate: string | null | undefined,
  plannedDueDate: string | null | undefined,
  today: string
): number | null {
  const start = toUtcMs(plannedStartDate);
  const due = toUtcMs(plannedDueDate);
  const now = toUtcMs(today);
  if (start === null || due === null || now === null) return null;
  if (due <= start) return now >= due ? 100 : 0;
  if (now <= start) return 0;
  if (now >= due) return 100;
  return Math.round(((now - start) / (due - start)) * 100);
}

export type BaselineWindow = { plannedStartDate: string | null; plannedDueDate: string | null };

export type ScheduleActivity = {
  id: string;
  startDate: string | null;
  dueDate: string | null;
  completionPercentage: number;
};

export type ScheduleProgress = {
  /** Rounded mean of the activities' own completion. Null only when there are no activities. */
  actualPercent: number | null;
  /** Rounded mean of the per-activity planned completion, over the activities that HAVE a baseline window. Null when none do. */
  plannedPercent: number | null;
  /** The worst (largest) slip across the activities that have one. Positive = behind. Null when nothing can be compared. */
  worstSlipDays: number | null;
  /** How many activities could actually be compared -- so the tile can say "over N activities" rather than implying it covers all of them. */
  comparedCount: number;
};

/**
 * The 'Schedule progress' tile's three numbers.
 *
 * worstSlipDays is the WORST activity, not an average: an average slip is a
 * number no site meeting has ever asked for, and averaging a 30-day slip with
 * twenty on-time activities reports "1 day behind" for a programme that is a
 * month late. It is the same reading D-56's own header tile uses ("worst M
 * days").
 */
export function summariseScheduleProgress(
  activities: readonly ScheduleActivity[],
  baselineByIssueId: ReadonlyMap<string, BaselineWindow>,
  today: string
): ScheduleProgress {
  if (activities.length === 0) {
    return { actualPercent: null, plannedPercent: null, worstSlipDays: null, comparedCount: 0 };
  }

  const actualPercent = Math.round(
    activities.reduce((sum, a) => sum + (Number.isFinite(a.completionPercentage) ? a.completionPercentage : 0), 0) /
      activities.length
  );

  const plannedValues: number[] = [];
  const slips: number[] = [];
  for (const activity of activities) {
    const window = baselineByIssueId.get(activity.id);
    if (!window) continue;
    const planned = plannedPercentComplete(window.plannedStartDate, window.plannedDueDate, today);
    if (planned !== null) plannedValues.push(planned);
    const slip = slipDays(activity.dueDate, window.plannedDueDate);
    if (slip !== null) slips.push(slip);
  }

  return {
    actualPercent,
    plannedPercent: plannedValues.length
      ? Math.round(plannedValues.reduce((sum, v) => sum + v, 0) / plannedValues.length)
      : null,
    worstSlipDays: slips.length ? Math.max(...slips) : null,
    comparedCount: slips.length,
  };
}

/**
 * D-45's tile sentence: "42 % complete — planned 55 % — 4 days behind".
 *
 * The em-dash separator matches the one this product's other R67 receipt lines
 * already use (see AttendanceSheetClient's "…saved — N rows"); the brief's own
 * transliteration writes it as a hyphen. A percentage of 0 prints "0 %" -- an
 * absent one prints the en-dash, and the two never collapse into each other.
 */
export function formatScheduleProgress(progress: ScheduleProgress): string {
  const actual = progress.actualPercent === null ? EMPTY_SCHEDULE_CELL : `${progress.actualPercent} %`;
  const planned = progress.plannedPercent === null ? EMPTY_SCHEDULE_CELL : `${progress.plannedPercent} %`;
  const slip = progress.worstSlipDays;
  const behind =
    slip === null
      ? EMPTY_SCHEDULE_CELL
      : slip > 0
        ? `${slip} days behind`
        : slip < 0
          ? `${Math.abs(slip)} days ahead`
          : "on schedule";
  return `${actual} complete — planned ${planned} — ${behind}`;
}

/** Shown in place of the tile's sub-line when the project has no baseline at all. */
export const NO_BASELINE_NOTE = "No baseline recorded yet — record one to track slip";

export type MiniBarGeometry = { offsetPercent: number; widthPercent: number } | null;

/**
 * The inline planned/actual mini-bar D-45 asks for on each table row.
 *
 * SVAR's Gantt cannot draw a second (baseline) bar per row -- that is one of
 * its PRO-only features, as this module's consumer already documents -- so the
 * table is where planned and actual are drawn against each other, and the table
 * is the authoritative list either way.
 *
 * Returns the bar's position within the window [windowStart, windowEnd] as
 * percentages, or null when the span cannot be placed. A zero-length span still
 * returns a visible sliver rather than a 0-width invisible one.
 */
export function barGeometry(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined
): MiniBarGeometry {
  const s = toUtcMs(startDate);
  const e = toUtcMs(endDate);
  const ws = toUtcMs(windowStart);
  const we = toUtcMs(windowEnd);
  if (s === null || e === null || ws === null || we === null) return null;
  const span = we - ws;
  if (span <= 0) return { offsetPercent: 0, widthPercent: 100 };
  const from = Math.min(Math.max(s, ws), we);
  const to = Math.min(Math.max(e, ws), we);
  const offsetPercent = ((from - ws) / span) * 100;
  const widthPercent = Math.max(((to - from) / span) * 100, 1.5);
  return { offsetPercent, widthPercent: Math.min(widthPercent, 100 - offsetPercent) };
}

/** The earliest and latest dates across the activities AND their baselines, so both bars share one scale. */
export function scheduleWindow(
  activities: readonly ScheduleActivity[],
  baselineByIssueId: ReadonlyMap<string, BaselineWindow>
): { start: string | null; end: string | null } {
  let min: number | null = null;
  let max: number | null = null;
  const consider = (value: string | null | undefined) => {
    const ms = toUtcMs(value);
    if (ms === null) return;
    if (min === null || ms < min) min = ms;
    if (max === null || ms > max) max = ms;
  };
  for (const activity of activities) {
    consider(activity.startDate);
    consider(activity.dueDate);
    const window = baselineByIssueId.get(activity.id);
    if (window) {
      consider(window.plannedStartDate);
      consider(window.plannedDueDate);
    }
  }
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString().slice(0, 10));
  return { start: iso(min), end: iso(max) };
}
