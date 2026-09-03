// R67 D-07 -- the Design Studio timesheet's shape, and every string it shows.
//
// DECISION D-07, verbatim: "A day grid, one row per task, in Sumeet's exact
// columns Date | Project | Category | Task | Hours with status at row level
// (Draft / Submitted / Approved / Sent back); the week view is a filter over
// the same rows, not a second grid."
//
// The two halves of that sentence are the whole design: ONE row shape, ONE
// grid, and the week view is filterToWeek() over it. A second grid is how the
// two views drift apart and start disagreeing about the same hours.
//
// The data is the one that already exists: GET /api/timesheets?projectId=
// (compliance-tracker's pms-time-service.ts listTimeEntriesForProject), the
// same read /schedule's Timesheet tab uses. Nothing here invents a field --
// Category is the entry's own activityType, Status is its own approvalStatus
// (the draft -> submitted -> approved/rejected lifecycle that service already
// implements), and Project is the project the rows were read for.
//
// ── MERGE NOTE (D-11 addendum) ──────────────────────────────────────────────
// Two lanes wrote this module. Lane D0's version is CANONICAL because it is
// already on main; lane H's Design Studio module (the object page, the create
// route, the review queue, the cost analysis tab) is FOLDED IN here rather
// than replacing it. Nothing D0 shipped was deleted: TIMESHEET_STATUSES,
// TIMESHEET_STATUS_LABELS, toTimesheetRows, groupByDay, weekStartOf,
// weekDates and filterToWeek are D0's, unchanged in behaviour, and both
// lanes' tests are kept in design-studio-timesheet.test.ts.
//
// The one function the two lanes both defined is totalHours(): D0's rounding
// is kept (it is the one that cannot print "7.199999999999999") and lane H's
// wider parameter type is kept (the API hands hours back as a string), so
// both lanes' call sites compile against one implementation instead of two.
//
// Everything in this module is PURE -- no React, no fetch -- because the item
// specifies EXACT user-facing wording ("Total today: 7.50 h", "Submit today
// (4 rows, 7.50 h)", "No hours logged for 2 Sep 2026. Add a row below.",
// "Hours must be more than 0") and wording that only lives inside JSX drifts
// the first time somebody reformats a component.

import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";

/** The four states pms_time_entries.approval_status can hold. */
export const TIMESHEET_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

/**
 * Lane H's name for the same closed set. Kept as an ALIAS rather than a second
 * union, so there is exactly one definition of what a timesheet state is.
 */
export type TimesheetApprovalStatus = TimesheetStatus;

/** Sumeet's own words for each state -- "rejected" reads as "Sent back". */
export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Sent back",
};

/**
 * The fixed Category list item H-03 specifies, in its order. Deliberately a
 * constant in PROJEXA rather than a lookup: VERIDIAN stores
 * pms_time_entries.activity_type as free text ("admin-configurable, not a
 * fixed enum" -- its own schema comment), so there is no server list to read,
 * and inventing an endpoint to serve seven hardcoded words would be worse
 * than the constant.
 */
export const DESIGN_STUDIO_CATEGORIES = [
  "Concept",
  "Design development",
  "Drawings",
  "Site visit",
  "Client meeting",
  "Revisions",
  "Admin",
] as const;

/**
 * The row-level chip: D0's label plus the kit StatusBadge tone lane H needs, so
 * the state is never carried by colour alone (that component owns the
 * glyph+colour pairing). The LABEL is read from TIMESHEET_STATUS_LABELS above
 * rather than repeated, so the two cannot drift.
 *
 * "Sent back" rather than "Rejected" is deliberate and is D-07's own word: on
 * the designer's own grid the entry has come BACK to them to fix, which is the
 * action, whereas the object page header states the decision that was made --
 * see headerStatus below.
 */
const ROW_STATUS_TONE: Record<TimesheetStatus, StatusTone> = {
  draft: "neutral",
  submitted: "waiting",
  approved: "done",
  rejected: "needs-you",
};

const HEADER_STATUS_LABEL: Record<TimesheetStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

/**
 * The states a designer can still act on themselves: a draft they have not
 * sent yet, and one their manager sent back. Mirrors VERIDIAN's own
 * RESUBMITTABLE_STATUSES in pms-time-service.ts -- an APPROVED entry is
 * deliberately not in the set, because it has already been counted as cost.
 */
export const RESUBMITTABLE_STATUSES = ["draft", "rejected"] as const;

export function isResubmittable(status: string): boolean {
  return (RESUBMITTABLE_STATUSES as readonly string[]).includes(status);
}

export function rowStatus(status: string): { label: string; tone: StatusTone } {
  const known = TIMESHEET_STATUS_LABELS[status as TimesheetStatus];
  return known
    ? { label: known, tone: ROW_STATUS_TONE[status as TimesheetStatus] }
    : { label: status, tone: "neutral" };
}

export function headerStatus(status: string): { label: string; tone: StatusTone } {
  const known = HEADER_STATUS_LABEL[status as TimesheetStatus];
  return { label: known ?? status, tone: rowStatus(status).tone };
}

/** One row as GET /api/timesheets returns it. */
export type TimesheetApiEntry = {
  id: string;
  issueId: string;
  hours: string | number;
  spentOn: string;
  activityType?: string | null;
  comments?: string | null;
  approvalStatus?: string | null;
  issue?: { id: string; number: number; title: string } | null;
};

/** One row of the grid, in the column order the decision fixes. */
export type TimesheetRow = {
  id: string;
  /** ISO yyyy-mm-dd. Formatting is the screen's job, not this module's. */
  date: string;
  project: string;
  category: string;
  task: string;
  hours: number;
  status: TimesheetStatus;
  /** Where the Task cell links; never rendered as text. */
  issueId: string;
};

/** The en-dash this codebase renders for an empty value (kit EMPTY_VALUE_DISPLAY). */
const EMPTY = "–";

function readStatus(raw: string | null | undefined): TimesheetStatus {
  return (TIMESHEET_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as TimesheetStatus) : "draft";
}

function readTask(entry: TimesheetApiEntry): string {
  const issue = entry.issue;
  if (!issue) return "Untitled task";
  const title = issue.title?.trim();
  return title ? `#${issue.number} ${title}` : `#${issue.number}`;
}

/**
 * The API's entries as grid rows, newest day first and stable within a day.
 * `projectName` fills the Project column -- the rows were read for exactly one
 * project, so it is the same for all of them and is passed in rather than
 * guessed from an id.
 */
export function toTimesheetRows(entries: TimesheetApiEntry[], projectName: string): TimesheetRow[] {
  return entries
    .map((entry) => ({
      id: entry.id,
      date: entry.spentOn,
      project: projectName,
      category: entry.activityType?.trim() || EMPTY,
      task: readTask(entry),
      hours: Number(entry.hours) || 0,
      status: readStatus(entry.approvalStatus),
      issueId: entry.issueId,
    }))
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

export type TimesheetDay = { date: string; rows: TimesheetRow[]; totalHours: number };

/** The day grid: one group per date, each carrying its own hours total. */
export function groupByDay(rows: TimesheetRow[]): TimesheetDay[] {
  const byDate = new Map<string, TimesheetRow[]>();
  for (const row of rows) {
    const bucket = byDate.get(row.date);
    if (bucket) bucket.push(row);
    else byDate.set(row.date, [row]);
  }
  return [...byDate.entries()]
    .map(([date, dayRows]) => ({ date, rows: dayRows, totalHours: totalHours(dayRows) }))
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

/**
 * MERGED (D-11): D0's rounding, lane H's parameter type. The rounding matters
 * because a run of 0.1-style entries otherwise prints a float artefact in the
 * total ("7.199999999999999 hrs"); the wider type matters because
 * GET /api/timesheets returns hours as a STRING (a numeric column), so a caller
 * that has not mapped to TimesheetRow yet must still be able to total them.
 */
export function totalHours(rows: Array<{ hours: number | string }>): number {
  const sum = rows.reduce((acc, row) => {
    const n = Number(row.hours);
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
  return Math.round(sum * 100) / 100;
}

/** The Monday on or before `dateIso`, as yyyy-mm-dd. */
export function weekStartOf(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  // getUTCDay(): Sunday is 0, so Sunday belongs to the week that began six days
  // earlier, not to the one starting the next day.
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/** The seven ISO dates of the week beginning `weekStartIso`. */
export function weekDates(weekStartIso: string): string[] {
  const [year, month, day] = weekStartIso.split("-").map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
    date.setUTCDate(date.getUTCDate() + i);
    return date.toISOString().slice(0, 10);
  });
}

/**
 * The week view. A FILTER over the same rows the day grid renders -- not a
 * second grid, and not a second read.
 */
export function filterToWeek(rows: TimesheetRow[], weekStartIso: string): TimesheetRow[] {
  const week = new Set(weekDates(weekStartIso));
  return rows.filter((row) => week.has(row.date));
}

/** "7.50" -- always two decimals, so a 0.25-step grid never mixes 7.5 with 7.50. */
export function formatHours(hours: number | string): string {
  const n = Number(hours);
  return Number.isFinite(n) ? n.toFixed(2) : String(hours);
}

// Pinned month names rather than toLocaleDateString, for the same reason
// src/lib/format-date.ts pins its locale and time zone: a date rendered on
// the server and again on the client must be the same string, and an ISO
// date has no time zone to shift it by if it is never turned into a Date.
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-09-02" -> "2 Sep 2026". Returns the input unchanged if it is not an ISO date. */
export function formatDayLabel(spentOn: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(spentOn);
  if (!m) return spentOn;
  const month = SHORT_MONTHS[Number(m[2]) - 1];
  if (!month) return spentOn;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/**
 * Today as an ISO date, in the same UTC frame VERIDIAN stores spent_on in.
 *
 * MERGE NOTE (D-11): this is resolved on the SERVER and passed down as a prop
 * -- lane D0's rule, kept over lane H's client-side call. Calling it during a
 * client render makes the grid's day depend on the visitor's clock and drift
 * between the server-rendered and the hydrated markup, which is the same
 * hydration rule format-date.ts pins its locale and time zone for.
 */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** "Total today: 7.50 h" on today, "Total for 1 Sep 2026: 7.50 h" on any other day. */
export function dayTotalLabel(hours: number, spentOn: string, today: string): string {
  return spentOn === today
    ? `Total today: ${formatHours(hours)} h`
    : `Total for ${formatDayLabel(spentOn)}: ${formatHours(hours)} h`;
}

/** "Submit today (4 rows, 7.50 h)" / "Submit day (4 rows, 7.50 h)". */
export function submitDayLabel(rows: number, hours: number, spentOn: string, today: string): string {
  const verb = spentOn === today ? "Submit today" : "Submit day";
  return `${verb} (${rows} row${rows === 1 ? "" : "s"}, ${formatHours(hours)} h)`;
}

/** "No hours logged for 2 Sep 2026. Add a row below." */
export function emptyDayMessage(spentOn: string): string {
  return `No hours logged for ${formatDayLabel(spentOn)}. Add a row below.`;
}

export const HOURS_TOO_SMALL = "Hours must be more than 0";
export const HOURS_OVER_DAY = "Total for the day would exceed 24 hours";
export const HOURS_MAX = 24;

/**
 * Per-field validation for the Hours cell. Returns the message to show under
 * the field, or null. `otherHoursToday` lets the caller pass the rest of the
 * day so the 24-hour rule is about the DAY, not about one row.
 */
export function validateHours(raw: string, otherHoursToday = 0): string | null {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n) || n <= 0) return HOURS_TOO_SMALL;
  if (n > HOURS_MAX) return HOURS_OVER_DAY;
  if (otherHoursToday + n > HOURS_MAX) return HOURS_OVER_DAY;
  return null;
}

/**
 * The create screen's primary, disabled-with-reason and naming what is
 * missing: "Save (2 required: Task, Hours)" -- the /labour/new pattern
 * correction C-11 names as this product's good one.
 */
export function requiredReason(missing: string[]): string | undefined {
  if (missing.length === 0) return undefined;
  return `${missing.length} required: ${missing.join(", ")}`;
}

export function saveLabel(missing: string[]): string {
  const reason = requiredReason(missing);
  return reason ? `Save (${reason})` : "Save";
}

export type DeletableEntry = {
  ref: string;
  hours: number | string;
  spentOn: string;
  approvalStatus: string;
  issue?: { number: number | null; title: string } | null;
};

/**
 * The Delete confirmation, with the blast radius spelled out rather than
 * "Are you sure?":
 *
 *   "Delete entry TS-000123 - 3.00 h on #12 Joinery shop drawings, 2 Sep
 *    2026? It is Submitted; your manager will no longer see it."
 *
 * The second sentence changes with the state, because the consequence does:
 * a draft nobody has seen is not the same deletion as an approved entry that
 * has already been counted as cost.
 */
export function deleteConfirmation(entry: DeletableEntry): string {
  const task = entry.issue
    ? entry.issue.number !== null ? `#${entry.issue.number} ${entry.issue.title}` : entry.issue.title
    : "this task";
  const head = `Delete entry ${entry.ref} - ${formatHours(entry.hours)} h on ${task}, ${formatDayLabel(entry.spentOn)}?`;
  const status = headerStatus(entry.approvalStatus).label;
  switch (entry.approvalStatus) {
    case "submitted":
      return `${head} It is ${status}; your manager will no longer see it.`;
    case "approved":
      return `${head} It is ${status}; the hours will stop counting towards this project's cost.`;
    case "rejected":
      return `${head} It is ${status}; the reason your manager gave goes with it.`;
    default:
      return `${head} It is ${status}; nobody else has seen it yet.`;
  }
}

/** "Timesheet entry TS-000123 saved" -- the create route's landing receipt. */
export function savedMessage(ref: string): string {
  return `Timesheet entry ${ref} saved`;
}

/**
 * Budget | Actual | Variance | Variance % for the Cost analysis tab.
 *
 * Variance is budget - actual (positive = under budget). BOTH numbers are null
 * when there is no budget to compare against, and that is the NORMAL case, not
 * an edge case: VERIDIAN's designerTimesheetReport returns
 * projectScoped.byCategory[].budget as null by design -- "No per-category
 * budget dimension exists in pms_budget_line_items ... reported honestly as
 * null, not fabricated" (construction-reports-service.ts). Category is the
 * DEFAULT grouping of the Cost analysis screen, so this is the first thing it
 * shows.
 *
 * FIX PASS: the first cut typed budget as `number` and guarded only
 * `budget === 0`, which is false for null -- so `v / budget` divided by a
 * coerced 0 and the screen rendered "-Infinity%" on arrival. An unbudgeted
 * line has NO percentage: not 0%, not Infinity, and not a variance measured
 * against a zero that was never a real zero.
 */
export function variance(budget: number | null, actual: number): { variance: number | null; variancePercent: number | null } {
  if (budget === null || budget === undefined || !Number.isFinite(budget) || budget === 0) {
    return { variance: null, variancePercent: null };
  }
  const v = budget - actual;
  return { variance: v, variancePercent: (v / budget) * 100 };
}

export function formatVariancePercent(percent: number | null): string {
  if (percent === null) return "-";
  return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

/** The shape the grid, the object page and the review queue all read. */
export type TimesheetEntryLike = {
  id: string;
  spentOn: string;
  hours: number | string;
  approvalStatus: string;
  loggedBy?: { id: string; name: string } | null;
};

export type DesignerDayGroup<T extends TimesheetEntryLike> = {
  key: string;
  designerId: string;
  designerName: string;
  spentOn: string;
  entries: T[];
};

/**
 * The review queue's unit of decision: one designer's one day. A manager
 * approves a DAY, not thirteen rows, which is why the grouping happens
 * before anything is rendered rather than inside the JSX.
 *
 * Only SUBMITTED entries are grouped -- a draft is not the manager's to see
 * and an already-decided one is not theirs to decide again.
 */
export function groupSubmittedByDesignerDay<T extends TimesheetEntryLike>(entries: T[]): DesignerDayGroup<T>[] {
  const groups = new Map<string, DesignerDayGroup<T>>();
  for (const entry of entries) {
    if (entry.approvalStatus !== "submitted") continue;
    const designerId = entry.loggedBy?.id ?? "unknown";
    const key = `${designerId}|${entry.spentOn}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, designerId, designerName: entry.loggedBy?.name ?? "Unknown designer", spentOn: entry.spentOn, entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  // Newest day first, then designers alphabetically inside a day -- a stable
  // order, so a re-render after one approval does not reshuffle the queue
  // under the manager's cursor.
  return [...groups.values()].sort((a, b) => (a.spentOn === b.spentOn ? a.designerName.localeCompare(b.designerName) : b.spentOn.localeCompare(a.spentOn)));
}

/** `budget` is nullable because the ERP genuinely has no per-category budget. */
export type CostRow = { label: string; budget: number | null; actual: number };
export type CostGrouping = "category" | "designer" | "project";
export type DesignerTimesheetReportShape = {
  projectScoped?: { byCategory?: Array<{ category?: string; label?: string; budget: number | null; actual: number }> };
  orgWide?: {
    byDesigner?: Array<{ userName?: string; userId?: string; budget: number | null; actual: number }>;
    byProject?: Array<{ projectName?: string; projectId?: string; budget: number | null; actual: number }>;
  };
};

/**
 * Pulls the rows for one Cost analysis grouping out of VERIDIAN's existing
 * designerTimesheetReport WITHOUT re-deriving any figure -- the budget and
 * the actual are the report's own numbers, only relabelled. A bucket whose
 * name could not be resolved is named honestly rather than dropped: a
 * dropped row is money that stops adding up. A NULL budget is carried through
 * as null rather than coerced to 0, because a missing budget is not a zero
 * budget and printing "0" would assert a figure the ERP never stated.
 */
export function costRowsFor(report: DesignerTimesheetReportShape | null, grouping: CostGrouping): CostRow[] {
  if (!report) return [];
  if (grouping === "category") {
    return (report.projectScoped?.byCategory ?? []).map((r) => ({ label: r.category ?? r.label ?? "Uncategorized", budget: r.budget ?? null, actual: r.actual }));
  }
  if (grouping === "designer") {
    return (report.orgWide?.byDesigner ?? []).map((r) => ({ label: r.userName ?? r.userId ?? "Unknown designer", budget: r.budget ?? null, actual: r.actual }));
  }
  return (report.orgWide?.byProject ?? []).map((r) => ({ label: r.projectName ?? r.projectId ?? "Unknown project", budget: r.budget ?? null, actual: r.actual }));
}
