// LOCAL-FIRST shell, cluster "design and change": what each screen of Change Orders and the Design Studio timesheet shows, read from the
// laptop's own database only (design-change-rows.ts readKind / readPendingOps). Never the server.
//
// THE SCREENS (online: src/app/(app)/change-orders/**, src/app/(app)/design-studio/**):
//   /change-orders                   list of the project's change orders           kind change_orders
//   /change-orders/:id               one change order (+ Send for approval)        kind change_orders
//   /change-orders/new               create                                        manifest only (the project must be on the laptop)
//   /design-studio                   MY timesheet: day grid, week filter, add row   kinds timesheets (+ tasks, to name and pick a task)
//   /design-studio/timesheets/:id    one entry (+ Submit)                          kinds timesheets, tasks
//   /design-studio/timesheets/new    log time                                      kinds timesheets (the day's hours), tasks
//   /design-studio/review            the manager's queue: submitted days per designer   kinds timesheets, tasks
//   /design-studio/cost-analysis     budget vs actual: SERVER ONLY (a money report the laptop does not hold; never computed here)
//
// WHAT THE SCREEN DATA SAYS. Every loader returns a tagged union: no_project (no project on this laptop), not_synced (this project's kind
// has not been copied to the end yet: a half copy is never shown as if whole), not_found (objects), local. A row carries, beside the
// server's own fields, what this person's OUTBOX holds for it: `localOnly` (made here, the server has not accepted it yet: no number,
// no status), `waitingOn` (the function ids of edits waiting to be sent) and `trouble` (the server refused an edit, or it is in conflict).
//
// ROLE. A column the server hid for this person's role (the done marker's hiddenFields: cost_impact for change orders,
// hourly_rate_snapshot / invoice_item_id for timesheets) is DROPPED here even if a row still carries it, so no screen can show it; the
// screen says "hidden for your role" instead of a number or a dash.
//
// GAPS (the sync does not carry them, so nothing here invents them): who logged an entry BY NAME (only user_id is synced; organisation
// people are not consumed on the laptop yet), the reason an entry was sent back (rejection_reason), an entry's TS-number, the change
// order's e-signature request and its signers, and the project's BOQ id (for "Create BOQ revision").

import { isResubmittable } from "@/lib/design-studio-timesheet";
import type { ShellData } from "../context";
import {
  CHANGE_ORDERS_KIND, TASKS_KIND, TIMESHEETS_KIND, orderChangeOrders, pendingView, readKind, readPendingOps, toChangeOrder, toTimeEntry,
  type ChangeOrderRow, type PendingView, type TimeEntryRow,
} from "./design-change-rows";

/** What the outbox holds for one row. */
export type Pending = { localOnly: boolean; waitingOn: string[]; trouble: "conflict" | "blocked" | null };

function pendingOf(view: PendingView, id: string): Pending {
  return { localOnly: view.created.has(id), waitingOn: view.waitingOn.get(id) ?? [], trouble: view.troubled.get(id) ?? null };
}

/** The project to read: the URL's, else (objects only) every project of this person on the laptop, in order. */
const candidatesOf = (data: ShellData, projectId: string | null) => (projectId ? [projectId] : data.projects.map((p) => p.id));

// ─── change orders ─────────────────────────────────────────────────────────────────────────────

export type ChangeOrderView = ChangeOrderRow & Pending;

export type ChangeOrdersListData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | { state: "local"; projectId: string; syncedAt: number; costHidden: boolean; rows: ChangeOrderView[] };

export type ChangeOrderObjectData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | { state: "local"; projectId: string; syncedAt: number; costHidden: boolean; co: ChangeOrderView };

export type ChangeOrderNewData = { state: "no_project" } | { state: "not_synced"; projectId: string } | { state: "ready"; projectId: string; costHidden: boolean };

async function readChangeOrders(data: ShellData, projectId: string) {
  const read = await readKind(data, CHANGE_ORDERS_KIND, projectId);
  if (!read.synced) return null;
  const costHidden = read.hiddenFields.includes("cost_impact");
  const view = pendingView(await readPendingOps(data, projectId), CHANGE_ORDERS_KIND, ["changeOrderId"]);
  const rows: ChangeOrderView[] = [];
  for (const raw of read.rows) {
    const co = toChangeOrder(raw);
    if (!co) continue;
    rows.push({ ...co, costImpact: costHidden ? null : co.costImpact, ...pendingOf(view, co.id) });
  }
  return { syncedAt: read.syncedAt, costHidden, rows: orderChangeOrders(rows) };
}

export async function loadChangeOrdersList(data: ShellData, projectId: string | null): Promise<ChangeOrdersListData> {
  if (!projectId) return { state: "no_project" };
  const read = await readChangeOrders(data, projectId);
  if (!read) return { state: "not_synced", projectId };
  return { state: "local", projectId, ...read };
}

export async function loadChangeOrderObject(data: ShellData, id: string, projectId: string | null): Promise<ChangeOrderObjectData> {
  const candidates = candidatesOf(data, projectId);
  if (candidates.length === 0) return { state: "no_project" };
  let anySynced = false;
  for (const candidate of candidates) {
    const read = await readChangeOrders(data, candidate);
    if (!read) continue;
    anySynced = true;
    const co = read.rows.find((r) => r.id === id);
    if (co) return { state: "local", projectId: candidate, syncedAt: read.syncedAt, costHidden: read.costHidden, co };
  }
  return anySynced ? { state: "not_found", projectId } : { state: "not_synced", projectId };
}

export async function loadChangeOrderNew(data: ShellData, projectId: string | null): Promise<ChangeOrderNewData> {
  if (!projectId) return { state: "no_project" };
  const read = await readKind(data, CHANGE_ORDERS_KIND, projectId);
  if (!read.synced) return { state: "not_synced", projectId };
  return { state: "ready", projectId, costHidden: read.hiddenFields.includes("cost_impact") };
}

/** What is waiting on a change order, in words; null when nothing is. The status itself stays the server's. */
export function changeOrderPendingWord(co: Pick<ChangeOrderView, "localOnly" | "waitingOn" | "trouble">): string | null {
  if (co.trouble === "blocked") return "Not accepted by the server";
  if (co.trouble === "conflict") return "Changed on the server too";
  if (co.localOnly) return "Waiting to be sent";
  if (co.waitingOn.includes("submit_change_order_for_approval")) return "Approval request waiting to be sent";
  return co.waitingOn.length > 0 ? "Waiting to be sent" : null;
}

/** The server's status in the online list's words ("pending approval"), or a dash for a change order the server has not accepted yet. */
export const changeOrderStatusText = (status: string | null): string => (status ? status.replace(/_/g, " ") : "—");

/** "+4d", "-2d", or the online screen's em dash for 0 / not set. */
export function scheduleImpactText(days: number | null): string {
  if (days === null || days === 0) return "—";
  return days > 0 ? `+${days}d` : `${days}d`;
}

// ─── timesheet entries ─────────────────────────────────────────────────────────────────────────

export type TaskOption = { id: string; number: number | null; title: string };

export type EntryView = TimeEntryRow & Pending & {
  /** "#12 Joinery shop drawings", or the online screen's "Untitled task" when the task is not on this laptop. */
  task: string;
  mine: boolean;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The project's tasks as options (id, number, title), archived ones left out, by number. Untrusted rows are skipped. */
export function toTaskOptions(rows: readonly unknown[]): TaskOption[] {
  const out: TaskOption[] = [];
  for (const raw of rows) {
    if (!isObj(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id : null;
    const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : null;
    if (!id || !title || raw.is_archived === true) continue;
    const n = typeof raw.number === "number" ? raw.number : typeof raw.number === "string" && raw.number.trim() !== "" ? Number(raw.number) : NaN;
    out.push({ id, title, number: Number.isFinite(n) ? n : null });
  }
  return out.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.title.localeCompare(b.title));
}

export const taskLabel = (t: TaskOption | undefined): string => (t ? (t.number !== null ? `#${t.number} ${t.title}` : t.title) : "Untitled task");

type TimesheetRead = { syncedAt: number; entries: EntryView[]; tasks: TaskOption[]; tasksSynced: boolean };

async function readTimesheet(data: ShellData, projectId: string, opts: { mineOnly: boolean }): Promise<TimesheetRead | null> {
  const read = await readKind(data, TIMESHEETS_KIND, projectId);
  if (!read.synced) return null;
  const taskRead = await readKind(data, TASKS_KIND, projectId);
  const tasks = taskRead.synced ? toTaskOptions(taskRead.rows) : [];
  // Archived tasks still name their old entries.
  const allTasks = new Map((taskRead.synced ? toTaskOptions(taskRead.rows.map((r) => (isObj(r) ? { ...r, is_archived: false } : r))) : []).map((t) => [t.id, t]));
  const view = pendingView(await readPendingOps(data, projectId), TIMESHEETS_KIND, ["timeEntryId"]);
  const entries: EntryView[] = [];
  for (const raw of read.rows) {
    const e = toTimeEntry(raw);
    if (!e) continue;
    // The server writes user_id as the VERIDIAN person id; a row made on this laptop carries the sign-in id. Either is this person.
    const mine = e.userId !== null && (e.userId === data.userId || (!!data.personId && e.userId === data.personId));
    if (opts.mineOnly && !mine) continue;
    entries.push({ ...e, ...pendingOf(view, e.id), task: taskLabel(e.issueId ? allTasks.get(e.issueId) : undefined), mine });
  }
  // Newest day first; inside a day, the order the entries were made (made-here ones, with no time yet, last).
  entries.sort((a, b) => (a.spentOn !== b.spentOn ? (a.spentOn < b.spentOn ? 1 : -1) : (a.createdAt ?? "￿").localeCompare(b.createdAt ?? "￿")));
  return { syncedAt: read.syncedAt, entries, tasks, tasksSynced: taskRead.synced };
}

export type TimesheetData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | ({ state: "local"; projectId: string; today: string } & TimesheetRead);

/** MY timesheet for the project (the online grid asks the server for `mine=true`). */
export async function loadTimesheet(data: ShellData, projectId: string | null, today: string): Promise<TimesheetData> {
  if (!projectId) return { state: "no_project" };
  const read = await readTimesheet(data, projectId, { mineOnly: true });
  if (!read) return { state: "not_synced", projectId };
  return { state: "local", projectId, today, ...read };
}

export type TimeEntryObjectData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | { state: "local"; projectId: string; syncedAt: number; entry: EntryView };

export async function loadTimeEntryObject(data: ShellData, id: string, projectId: string | null): Promise<TimeEntryObjectData> {
  const candidates = candidatesOf(data, projectId);
  if (candidates.length === 0) return { state: "no_project" };
  let anySynced = false;
  for (const candidate of candidates) {
    const read = await readTimesheet(data, candidate, { mineOnly: false });
    if (!read) continue;
    anySynced = true;
    const entry = read.entries.find((e) => e.id === id);
    if (entry) return { state: "local", projectId: candidate, syncedAt: read.syncedAt, entry };
  }
  return anySynced ? { state: "not_found", projectId } : { state: "not_synced", projectId };
}

export type TimeEntryNewData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | { state: "ready"; projectId: string; today: string; tasks: TaskOption[]; tasksSynced: boolean; preselectedTaskId: string | null; myHoursByDay: Record<string, number> };

export async function loadTimeEntryNew(data: ShellData, projectId: string | null, today: string, taskId: string | null): Promise<TimeEntryNewData> {
  if (!projectId) return { state: "no_project" };
  const read = await readTimesheet(data, projectId, { mineOnly: true });
  if (!read) return { state: "not_synced", projectId };
  const myHoursByDay: Record<string, number> = {};
  for (const e of read.entries) myHoursByDay[e.spentOn] = Math.round(((myHoursByDay[e.spentOn] ?? 0) + e.hours) * 100) / 100;
  const preselected = taskId && read.tasks.some((t) => t.id === taskId) ? taskId : null;
  return { state: "ready", projectId, today, tasks: read.tasks, tasksSynced: read.tasksSynced, preselectedTaskId: preselected, myHoursByDay };
}

/** The online grid's week: the seven days ENDING on the chosen day (DesignStudioTimesheetClient weekRange), not a calendar week. */
export function weekWindow(day: string): { from: string; to: string } {
  const end = new Date(`${day}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { from: start.toISOString().slice(0, 10), to: day };
}

export function entriesInView<E extends Pick<TimeEntryRow, "spentOn">>(entries: readonly E[], view: "day" | "week", day: string): E[] {
  if (view === "day") return entries.filter((e) => e.spentOn === day);
  const { from, to } = weekWindow(day);
  return entries.filter((e) => e.spentOn >= from && e.spentOn <= to);
}

/** "Submit" is offered for an entry the server holds, in a state the designer can still send, with no submit already waiting. */
export function canSubmitEntry(e: Pick<EntryView, "approvalStatus" | "localOnly" | "waitingOn">): boolean {
  return !e.localOnly && e.approvalStatus !== null && isResubmittable(e.approvalStatus) && !e.waitingOn.includes("submit_timesheet");
}

/** The entry's status in words: the server's, or what is waiting to be sent. Never a status the laptop decided. */
export function entryStatusWord(e: Pick<EntryView, "approvalStatus" | "localOnly" | "waitingOn" | "trouble">): string | null {
  if (e.trouble === "blocked") return "Not accepted by the server";
  if (e.trouble === "conflict") return "Changed on the server too";
  if (e.localOnly) return "Waiting to be sent";
  if (e.waitingOn.includes("approve_timesheet")) return "Approval waiting to be sent";
  if (e.waitingOn.includes("reject_timesheet")) return "Sending back, waiting to be sent";
  if (e.waitingOn.includes("submit_timesheet")) return "Submit waiting to be sent";
  return null;
}

// ─── the review queue ──────────────────────────────────────────────────────────────────────────

export type ReviewGroup = { key: string; userId: string; self: boolean; spentOn: string; hours: number; entries: EntryView[] };

export type ReviewData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | { state: "local"; projectId: string; syncedAt: number; groups: ReviewGroup[] };

/**
 * The submitted entries of the project, one group per designer per day (the manager approves a DAY), newest day first. Entries whose
 * designer is not synced are grouped as one unknown designer. A draft is not the manager's to see; a decided one is not theirs to
 * decide again: only "submitted" (as the server last said) is listed.
 */
export function reviewGroups(entries: readonly EntryView[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();
  for (const e of entries) {
    if (e.approvalStatus !== "submitted") continue;
    const userId = e.userId ?? "unknown";
    const key = `${userId}|${e.spentOn}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, userId, self: e.mine, spentOn: e.spentOn, hours: 0, entries: [] }));
    g.entries.push(e);
    g.hours = Math.round((g.hours + e.hours) * 100) / 100;
  }
  return [...groups.values()].sort((a, b) => (a.spentOn !== b.spentOn ? b.spentOn.localeCompare(a.spentOn) : a.userId.localeCompare(b.userId)));
}

export async function loadReview(data: ShellData, projectId: string | null): Promise<ReviewData> {
  if (!projectId) return { state: "no_project" };
  const read = await readTimesheet(data, projectId, { mineOnly: false });
  if (!read) return { state: "not_synced", projectId };
  return { state: "local", projectId, syncedAt: read.syncedAt, groups: reviewGroups(read.entries) };
}

/** Ops waiting for the given row ids (for "Approve day": only the entries no decision is waiting on yet). */
export const undecided = (entries: readonly EntryView[]) => entries.filter((e) => !e.waitingOn.some((f) => f === "approve_timesheet" || f === "reject_timesheet"));
