"use client";

// R67 F-09 (R-122). /schedule has four tabs -- Timeline, Board, Sprints,
// Timesheet -- and each panel fetched its own data from a mount effect. Radix
// Tabs unmounts the inactive panel, so switching away and back REMOUNTED it
// and re-fetched: the user paid a fresh full-pane spinner every time they
// looked at something they had already looked at, on a screen whose data
// changes on the timescale of a working day.
//
// This is the session cache those four panels share. Each read is keyed by
// project, memoised for 60 s, and concurrent readers share one in-flight
// request -- so hovering a tab (which warms it) and then clicking it produce
// ONE call, not two.
//
// The store is src/lib/shell-cache.ts's: the same TTL + request coalescing the
// shell uses. It is not shell-specific; only the keys are.
//
// A WRITE MUST INVALIDATE. Moving a card, closing a sprint or logging time
// changes what these reads return, so every write path calls
// invalidateScheduleProject() -- a cache that can show a user their own write
// as not-yet-happened is worse than no cache.
import {
  cachedShellJson,
  invalidateShellCache,
  peekShellCache,
  subscribeShellCache,
  writeShellCache,
  SHELL_CACHE_TTL_MS,
} from "@/lib/shell-cache";

export const SCHEDULE_CACHE_TTL_MS = SHELL_CACHE_TTL_MS;

export type ScheduleResource = "board" | "sprints" | "timesheets" | "timesheetsMine" | "tasks" | "gantt";

// "timesheetsMine" is a SEPARATE resource, not a parameter: the Timesheet tab
// has a "mine only" toggle, and the two views return different rows. Folding
// them onto one key would let a flick of the toggle serve the other view's
// cached rows -- a cache that shows the wrong data is worse than no cache.
const PATHS: Record<ScheduleResource, (projectId: string) => string> = {
  board: (p) => `/api/board?projectId=${encodeURIComponent(p)}`,
  sprints: (p) => `/api/schedule/sprints?projectId=${encodeURIComponent(p)}`,
  timesheets: (p) => `/api/timesheets?projectId=${encodeURIComponent(p)}`,
  timesheetsMine: (p) => `/api/timesheets?projectId=${encodeURIComponent(p)}&mine=true`,
  tasks: (p) => `/api/schedule/tasks?projectId=${encodeURIComponent(p)}`,
  gantt: (p) => `/api/schedule/gantt?projectId=${encodeURIComponent(p)}`,
};

export function scheduleCacheKey(resource: ScheduleResource, projectId: string): string {
  return `schedule:${resource}:${projectId}`;
}

/**
 * Reads one schedule resource, memoised per project for 60 s.
 *
 * THROWS on a failed request, carrying the backend's own message -- unlike the
 * display-only vendor lookup, every one of these IS the panel's content, so a
 * failure must reach the panel's error card rather than be flattened to an
 * empty list (the R48_HTTP_ERROR_SWALLOWED_AS_EMPTY_LIST_01 defect).
 */
export function loadSchedule<T>(
  resource: ScheduleResource,
  projectId: string,
  options: { force?: boolean } = {}
): Promise<T> {
  return cachedShellJson<T>(scheduleCacheKey(resource, projectId), PATHS[resource](projectId), {
    ttlMs: SCHEDULE_CACHE_TTL_MS,
    force: options.force,
  });
}

/**
 * Warms one resource without caring about the result -- for onMouseEnter /
 * onFocus on a tab. A rejection here is deliberately swallowed: a hover must
 * never surface an error, and the real click that follows will fetch again and
 * report it properly (failures are not cached).
 */
export function warmSchedule(resource: ScheduleResource, projectId: string): void {
  void loadSchedule(resource, projectId).catch(() => {});
}

/** Drops every cached resource for one project -- call after any write. */
export function invalidateScheduleProject(projectId: string): void {
  for (const resource of Object.keys(PATHS) as ScheduleResource[]) {
    invalidateShellCache(scheduleCacheKey(resource, projectId));
  }
}

// ---------------------------------------------------------------------------
// R67 F-11 (R-146) -- the write half.
// ---------------------------------------------------------------------------

/** What is cached for one resource right now, or undefined. */
export function peekSchedule<T>(resource: ScheduleResource, projectId: string): T | undefined {
  return peekShellCache<T>(scheduleCacheKey(resource, projectId), SCHEDULE_CACHE_TTL_MS);
}

/** Puts a value in without a request (an optimistic write, or a seed). */
export function writeSchedule(resource: ScheduleResource, projectId: string, value: unknown): void {
  writeShellCache(scheduleCacheKey(resource, projectId), value);
}

/** Notifies a mounted panel that its resource changed underneath it. */
export function subscribeSchedule(resource: ScheduleResource, projectId: string, listener: () => void): () => void {
  return subscribeShellCache(scheduleCacheKey(resource, projectId), listener);
}

/**
 * Seeds the task list from a payload that already contains it.
 *
 * The Board's own columns carry exactly {id, number, title} per card, so a user
 * who has looked at the Board has already paid for the list Log Time needs --
 * seeding it here is free and it is the SAME data, not a lookalike.
 *
 * The Timeline deliberately does not do this: its gantt rows have no task
 * NUMBER (see ScheduleGanttClient's GanttTask), and inventing one so the shape
 * matched would put a fabricated "#" in front of a real task name.
 *
 * NEVER OVERWRITES. The board projection carries only {id, number, title} --
 * everything a task REFERENCE needs, but less than GET /api/schedule/tasks
 * returns. Filling the slot only when it is empty means a real payload is never
 * replaced by the smaller one; the seed is a fallback, not a substitute.
 */
export function seedScheduleTasks(projectId: string, tasks: ScheduleTaskRef[]): void {
  if (tasks.length === 0) return;
  if (peekSchedule("tasks", projectId) !== undefined) return;
  writeSchedule("tasks", projectId, { tasks });
}

export type ScheduleTaskRef = { id: string; number: number; title: string };

// A time entry as both the Timesheet panel and the Log Time form see it.
// `pending` is set ONLY on the optimistic row: the panel labels that row
// "Saving…" and leaves it out of the total, so an unconfirmed write is never
// displayed as a recorded one.
export type TimesheetEntry = {
  id: string;
  issueId: string;
  hours: string;
  spentOn: string;
  activityType: string | null;
  comments: string | null;
  issue?: { id: string; number: number; title: string } | null;
  pending?: boolean;
};

export type TimesheetPayload = { entries?: TimesheetEntry[] };

/** The two views a new entry of the current user's belongs to. */
const TIMESHEET_VIEWS: ScheduleResource[] = ["timesheets", "timesheetsMine"];

/** Pure: the list with `entry` appended, newest first, never duplicated. */
export function withPendingEntry(entries: TimesheetEntry[], entry: TimesheetEntry): TimesheetEntry[] {
  return [entry, ...entries.filter((e) => e.id !== entry.id)];
}

/** Pure: the list without the row `id`. */
export function withoutEntry(entries: TimesheetEntry[], id: string): TimesheetEntry[] {
  return entries.filter((e) => e.id !== id);
}

/**
 * Appends a pending entry to whichever timesheet views are cached, so the panel
 * the user is being navigated to shows their write immediately.
 *
 * A view that is NOT cached is left alone: writing a one-row list into an empty
 * cache would make the Timesheet tab show one entry and hide every real one
 * until the TTL expired.
 */
export function appendPendingTimeEntry(projectId: string, entry: TimesheetEntry): void {
  for (const view of TIMESHEET_VIEWS) {
    const cached = peekSchedule<TimesheetPayload>(view, projectId);
    if (!cached) continue;
    writeSchedule(view, projectId, { ...cached, entries: withPendingEntry(cached.entries ?? [], entry) });
  }
}

/** Removes a pending entry again -- the write failed, so the row must go. */
export function removePendingTimeEntry(projectId: string, entryId: string): void {
  for (const view of TIMESHEET_VIEWS) {
    const cached = peekSchedule<TimesheetPayload>(view, projectId);
    if (!cached) continue;
    writeSchedule(view, projectId, { ...cached, entries: withoutEntry(cached.entries ?? [], entryId) });
  }
}

/**
 * Replaces the optimistic row with the server's own answer, then drops the rest
 * of this project's schedule cache.
 *
 * Deliberately a re-read, not a local patch: the entry the server stored can
 * differ from what was typed (a resolved task title, a normalised date), and
 * the acknowledged state on screen must be the stored one. Failure leaves the
 * pending row alone rather than blanking the panel -- the write DID succeed, so
 * removing the row would be the wrong lie to tell; the next mount re-reads.
 *
 * ORDER MATTERS. Invalidating first would delete the very entry lists this has
 * to refresh, and the panel would then sit on a pending row with nothing coming
 * to replace it.
 */
export async function reconcileTimesheets(projectId: string): Promise<void> {
  const cachedViews = TIMESHEET_VIEWS.filter((view) => peekSchedule<TimesheetPayload>(view, projectId) !== undefined);
  for (const view of cachedViews) {
    try {
      await loadSchedule<TimesheetPayload>(view, projectId, { force: true });
    } catch {
      // Left as-is on purpose: see above.
    }
  }
  for (const resource of Object.keys(PATHS) as ScheduleResource[]) {
    if (TIMESHEET_VIEWS.includes(resource)) continue;
    invalidateShellCache(scheduleCacheKey(resource, projectId));
  }
}
