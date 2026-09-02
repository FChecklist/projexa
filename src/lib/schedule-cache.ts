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
import { cachedShellJson, invalidateShellCache, SHELL_CACHE_TTL_MS } from "@/lib/shell-cache";

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
