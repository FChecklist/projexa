// LOCAL-FIRST shell, overview cluster: the NON-MONEY facts the laptop may work out by itself from the replica's rows.
//
// THE LINE (owner rule, lf-e5 brief): counts the replica can answer EXACTLY may be computed here -- tasks not finished, tasks due this
// week, RFIs / punch items / submittals by status, activities by state, milestones due this week. Anything involving money, budgets,
// valuation, approvals or the critical path is NOT computed here: it is the server's snapshot (snapshot-cache.ts) or "recalculated when
// online". Nothing in this file reads a money field, and nothing here decides an approval.
//
// The replica's rows are untrusted input: every function filters, never casts, and skips a row it cannot read. The server sends the
// curated projection's column names (snake_case, `status_id`); older fixtures and the AI-link reader use camelCase (`statusId`). Both are
// accepted, so a naming change on either side cannot silently turn every count into zero.

export type StatusCount = { status: string; count: number };

type Row = Record<string, unknown>;

export function isRow(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as Row).id === "string";
}

/** The first of the given names the row carries (snake_case or camelCase). */
export function field(row: Row, ...names: string[]): unknown {
  for (const name of names) if (name in row && row[name] !== undefined) return row[name];
  return undefined;
}

function text(row: Row, ...names: string[]): string | null {
  const v = field(row, ...names);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(row: Row, ...names: string[]): number | null {
  const v = field(row, ...names);
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** "YYYY-MM-DD" of a date value (a date column or a timestamp), or null. */
function day(row: Row, ...names: string[]): string | null {
  const v = text(row, ...names);
  return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/** Today and the last day of "this week" (today + 6) on this laptop's own calendar, as "YYYY-MM-DD". */
export function weekWindow(now: number): { today: string; weekEnd: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const d = new Date(now);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6);
  return { today: iso(d), weekEnd: iso(end) };
}

export type TaskFacts = {
  /** Not archived and below 100% complete. (The laptop does not hold task status NAMES, so "open" is read from completion.) */
  notFinished: number;
  /** Of those, due between today and six days from today. */
  dueThisWeek: number;
  /** Of those, due before today. */
  overdue: number;
};

export function taskFacts(rows: readonly unknown[], now: number): TaskFacts {
  const { today, weekEnd } = weekWindow(now);
  const out: TaskFacts = { notFinished: 0, dueThisWeek: 0, overdue: 0 };
  for (const row of rows) {
    if (!isRow(row)) continue;
    if (field(row, "is_archived", "isArchived") === true) continue;
    const pct = num(row, "completion_percentage", "completionPercentage");
    if (pct !== null && pct >= 100) continue;
    out.notFinished += 1;
    const due = day(row, "due_date", "dueDate");
    if (!due) continue;
    if (due < today) out.overdue += 1;
    else if (due <= weekEnd) out.dueThisWeek += 1;
  }
  return out;
}

/** Rows grouped by their own status word, most first (ties by name). A row without a status is counted as "unknown". */
export function countByStatus(rows: readonly unknown[]): StatusCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!isRow(row)) continue;
    const status = text(row, "status") ?? "unknown";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}

export type ActivityFacts = { notStarted: number; inProgress: number; complete: number };

/**
 * Each activity's state from its LATEST progress entry (by entry date, then when it was recorded) -- the same "latest logged percent"
 * the server's progress figure reads. No entry: not started; below 100: in progress; 100 or more: complete. Entries of an activity that is
 * not in the activity list are ignored (it is not this project's, or not on the laptop).
 */
export function activityFacts(activities: readonly unknown[], progress: readonly unknown[]): ActivityFacts {
  const ids = new Set(activities.filter(isRow).map((a) => a.id as string));
  const latest = new Map<string, { at: string; pct: number }>();
  for (const entry of progress) {
    if (!isRow(entry)) continue;
    const activityId = text(entry, "activity_id", "activityId");
    const pct = num(entry, "percent_complete", "percentComplete");
    if (!activityId || pct === null || !ids.has(activityId)) continue;
    const at = `${day(entry, "entry_date", "entryDate") ?? ""}|${text(entry, "created_at", "createdAt") ?? ""}`;
    const seen = latest.get(activityId);
    if (!seen || at > seen.at) latest.set(activityId, { at, pct });
  }
  const out: ActivityFacts = { notStarted: 0, inProgress: 0, complete: 0 };
  for (const id of ids) {
    const l = latest.get(id);
    if (!l) out.notStarted += 1;
    else if (l.pct >= 100) out.complete += 1;
    else out.inProgress += 1;
  }
  return out;
}

const DONE_MILESTONE = /^(done|complete|completed|achieved|closed|cancelled|canceled)$/i;

/** Milestones with a target date from today to six days from today, not marked done. */
export function milestonesDueThisWeek(rows: readonly unknown[], now: number): number {
  const { today, weekEnd } = weekWindow(now);
  let n = 0;
  for (const row of rows) {
    if (!isRow(row)) continue;
    const status = text(row, "status");
    if (status && DONE_MILESTONE.test(status)) continue;
    const target = day(row, "target_date", "targetDate");
    if (target && target >= today && target <= weekEnd) n += 1;
  }
  return n;
}
