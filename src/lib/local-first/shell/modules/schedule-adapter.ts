// LOCAL-FIRST shell, Schedule, read from the laptop's own database.
//
// THE ONLINE SCREENS (src/app/(app)/schedule): /schedule with ?tab=timeline (the Gantt: Task, Start, Due, Duration, Planned %,
// % Complete, Slippage, Planned finish, Slip, Critical Path), milestones, board, sprints (phases), timesheet; /schedule/tasks/:id;
// /schedule/tasks/new, /schedule/sprints/new, /schedule/import, /schedule/log-time (a redirect).
//
// The schedule is PMS tasks (kind `tasks`: id, number, title, priority, status_id, start_date, due_date, completion_percentage,
// parent_issue_id, milestone_id, is_archived), not construction activities. Milestones are kind `milestones`; captured baselines are
// kind `schedule_baselines` (their names only).
//
// WHAT IS COMPUTED WHERE. Duration, Planned % and Slippage are arithmetic the ONLINE screen already does in the browser
// (src/lib/schedule-progress.ts); the same functions are reused here, on the stored dates. The CRITICAL PATH and FLOAT are the
// server's (it needs the dependency graph, which the laptop does not have): offline they are not shown, and the screen says
// "recalculated when online". Baseline slip needs the baseline's per-task snapshot, which is not synced either.
//
// GAPS: task dependencies (predecessor/successor/lag), the critical path and float, baseline per-task snapshots, status NAMES
// (status_id is an id; the status list is not a synced kind), sprints/phases, assignees.

import { durationDays, plannedPercentComplete, taskSlippage, type TaskSlippage } from "@/lib/schedule-progress";
import type { ShellData } from "../context";
import { DELIVERY_KINDS, parseBaseline, parseMilestone, parseTask, readKind, type Baseline, type Milestone, type ScheduleTask } from "./delivery-local";

export type TimelineRow = ScheduleTask & {
  duration: number | null;
  plannedPercent: number | null;
  slippage: TaskSlippage;
  /** Where the bar sits on the timeline, as percentages of its width; null when the task has no dates. */
  bar: { left: number; width: number } | null;
  milestone: boolean;
  depth: number;
};

export type ScheduleData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | {
      state: "local";
      projectId: string;
      rows: TimelineRow[];
      range: { start: string; end: string } | null;
      milestones: Milestone[] | null;
      baselines: Baseline[] | null;
      syncedAt: number;
    };

export type ScheduleTaskData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | { state: "local"; projectId: string; task: TimelineRow; parent: ScheduleTask | null; children: ScheduleTask[]; milestone: Milestone | null; syncedAt: number };

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Parents before their children (depth-first), each level by start date then number; a task whose parent is missing is a root. */
function orderTree(tasks: ScheduleTask[]): { task: ScheduleTask; depth: number }[] {
  const ids = new Set(tasks.map((t) => t.id));
  const kids = new Map<string | null, ScheduleTask[]>();
  for (const t of tasks) {
    const parent = t.parentIssueId && ids.has(t.parentIssueId) && t.parentIssueId !== t.id ? t.parentIssueId : null;
    const list = kids.get(parent) ?? [];
    list.push(t);
    kids.set(parent, list);
  }
  const cmp = (a: ScheduleTask, b: ScheduleTask) =>
    (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999") || (a.number ?? Infinity) - (b.number ?? Infinity) || a.id.localeCompare(b.id);
  const out: { task: ScheduleTask; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const t of [...(kids.get(parent) ?? [])].sort(cmp)) {
      if (seen.has(t.id)) continue; // a cycle in parent links is untrusted input: each task is listed once
      seen.add(t.id);
      out.push({ task: t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const t of [...tasks].sort(cmp)) if (!seen.has(t.id)) out.push({ task: t, depth: 0 }); // members of a parent cycle
  return out;
}

export function buildTimeline(tasks: ScheduleTask[], today: string): { rows: TimelineRow[]; range: { start: string; end: string } | null } {
  const dated = tasks.flatMap((t) => [t.startDate, t.dueDate].filter((d): d is string => d !== null)).map(ms).filter((n) => !Number.isNaN(n));
  const range = dated.length ? { start: Math.min(...dated), end: Math.max(...dated) } : null;
  const span = range ? Math.max(DAY, range.end - range.start + DAY) : 0;
  const rows = orderTree(tasks).map(({ task, depth }) => {
    const duration = durationDays(task.startDate, task.dueDate);
    const plannedPercent = plannedPercentComplete(task.startDate, task.dueDate, today);
    const from = task.startDate ?? task.dueDate;
    const to = task.dueDate ?? task.startDate;
    const bar = range && from && to && ms(to) >= ms(from)
      ? { left: ((ms(from) - range.start) / span) * 100, width: Math.max(0.5, ((ms(to) - ms(from) + DAY) / span) * 100) }
      : null;
    return {
      ...task, depth, duration, plannedPercent, bar,
      slippage: taskSlippage(plannedPercent, task.completionPercentage, duration),
      milestone: task.startDate !== null && task.startDate === task.dueDate,
    };
  });
  return { rows, range: range ? { start: iso(range.start), end: iso(range.end) } : null };
}

export async function loadSchedule(data: ShellData, projectId: string | null, today: string): Promise<ScheduleData> {
  if (!projectId) return { state: "no_project" };
  const [tasks, milestones, baselines] = await Promise.all([
    readKind(data, projectId, DELIVERY_KINDS.tasks, parseTask),
    readKind(data, projectId, DELIVERY_KINDS.milestones, parseMilestone),
    readKind(data, projectId, DELIVERY_KINDS.baselines, parseBaseline),
  ]);
  if (!tasks.synced) return { state: "not_synced", projectId };
  const { rows, range } = buildTimeline(tasks.rows, today);
  return {
    state: "local", projectId, rows, range,
    milestones: milestones.synced ? [...milestones.rows].sort((a, b) => (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999")) : null,
    baselines: baselines.synced ? [...baselines.rows].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")) : null,
    syncedAt: tasks.syncedAt,
  };
}

export async function loadScheduleTask(data: ShellData, taskId: string, projectId: string | null, today: string): Promise<ScheduleTaskData> {
  const candidates = projectId ? [projectId] : data.projects.map((p) => p.id);
  if (candidates.length === 0) return { state: "no_project" };
  let anySynced = false;
  for (const candidate of candidates) {
    const tasks = await readKind(data, candidate, DELIVERY_KINDS.tasks, parseTask);
    if (!tasks.synced) continue;
    anySynced = true;
    const own = tasks.rows.find((t) => t.id === taskId);
    if (!own) continue;
    const [row] = buildTimeline([own], today).rows;
    const milestones = own.milestoneId ? await readKind(data, candidate, DELIVERY_KINDS.milestones, parseMilestone) : null;
    return {
      state: "local", projectId: candidate, task: row!,
      parent: own.parentIssueId ? tasks.rows.find((t) => t.id === own.parentIssueId) ?? null : null,
      children: tasks.rows.filter((t) => t.parentIssueId === own.id),
      milestone: milestones?.synced ? milestones.rows.find((m) => m.id === own.milestoneId) ?? null : null,
      syncedAt: tasks.syncedAt,
    };
  }
  return anySynced ? { state: "not_found", projectId } : { state: "not_synced", projectId };
}
