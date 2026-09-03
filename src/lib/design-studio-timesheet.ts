// R67 D-07 -- the Design Studio timesheet's shape.
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

/** The four states pms_time_entries.approval_status can hold. */
export const TIMESHEET_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

/** Sumeet's own words for each state -- "rejected" reads as "Sent back". */
export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Sent back",
};

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

export function totalHours(rows: TimesheetRow[]): number {
  // Rounded to two places so a run of 0.1-style entries cannot print a float
  // artefact in the total ("7.199999999999999 hrs").
  return Math.round(rows.reduce((sum, row) => sum + row.hours, 0) * 100) / 100;
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
