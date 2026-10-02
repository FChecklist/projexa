// LOCAL-FIRST shell, cluster "delivery" (work progress, labour, materials, schedule): the ONE place these screens read the laptop's
// own database, and the tolerant parsers that turn a replica row into what a screen shows.
//
// WHAT A REPLICA ROW IS. The sync service hands each kind as the AI work link's curated projection (compliance-tracker
// ai_work_link__records_core, drizzle/0643): the table's chosen columns under their SQL names (snake_case: `activity_id`,
// `entry_date`), money columns NULL below the role that may see them, the names of those columns in the pull's `hidden_fields`
// (kept on the laptop in the done marker, replica.ts DoneMarker). Older client code and the test fixtures spell the same fields in
// camelCase. Every reader below accepts BOTH spellings, so these screens are right whichever the integrator settles on.
//
// UNTRUSTED INPUT. A row is only used when it looks like what the screen expects (an id and the fields that make it that thing);
// anything else is skipped, never cast. A number may arrive as a JSON number or as Postgres numeric text: both are read, anything
// else is null (shown as "-", never as 0).
//
// HIDDEN IS NOT ZERO. A field the person's role may not see is reported in `hidden` and its value is null; the screens say "hidden
// for your role" and never compute a total from it.
//
// Nothing here calls the server. A (project, kind) that was not pulled to the end on this laptop is `synced: false`, never a partial
// list (local-reader.ts's rule).

import { localSyncInfo, readLocal } from "../../local-reader";
import type { ShellData } from "../context";

export type KindRead<T> =
  | { synced: false }
  | { synced: true; rows: T[]; syncedAt: number; hidden: readonly string[] };

/**
 * The rows of one kind of one project, parsed; `synced: false` when that pair was never copied to the end. Reads only this person's
 * database (`projexa-local:<userId>`) and only the organisation the person belongs to.
 */
export async function readKind<T>(data: ShellData, projectId: string, kind: string, parse: (raw: unknown) => T | null): Promise<KindRead<T>> {
  const access = { userId: data.userId, idb: data.idb };
  try {
    const info = await localSyncInfo(kind, projectId, access);
    if (!info) return { synced: false };
    const raw = await readLocal<unknown>(kind, { ...access, projectId, ...(data.orgId ? { orgId: data.orgId } : {}) });
    const rows: T[] = [];
    for (const r of raw) {
      const parsed = parse(r);
      if (parsed !== null) rows.push(parsed);
    }
    const hidden = Array.isArray(info.hiddenFields) ? info.hiddenFields.filter((f): f is string => typeof f === "string") : [];
    return { synced: true, rows, syncedAt: info.at, hidden };
  } catch {
    return { synced: false };
  }
}

// ─── field readers ─────────────────────────────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

const asObj = (v: unknown): Obj | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null);

function camel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** The value of a field under its SQL name or its camelCase name. */
export function field(o: Obj, snake: string): unknown {
  if (snake in o && o[snake] !== undefined) return o[snake];
  return o[camel(snake)];
}

export function str(o: Obj, snake: string): string | null {
  const v = field(o, snake);
  return typeof v === "string" ? v : null;
}

export function num(o: Obj, snake: string): number | null {
  const v = field(o, snake);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
}

export function bool(o: Obj, snake: string): boolean | null {
  const v = field(o, snake);
  return typeof v === "boolean" ? v : null;
}

/** A calendar date "YYYY-MM-DD" (a timestamp is cut to its date), or null. */
export function day(o: Obj, snake: string): string | null {
  const v = str(o, snake);
  return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/** A row that has a string id, as an object; null otherwise. */
function withId(raw: unknown): (Obj & { id: string }) | null {
  const o = asObj(raw);
  return o && typeof o.id === "string" && o.id.length > 0 ? (o as Obj & { id: string }) : null;
}

// ─── the kinds this cluster reads ───────────────────────────────────────────────────────────────────────────────

export const DELIVERY_KINDS = {
  activities: "activities",
  progress: "progress",
  boqLines: "boq_lines",
  roster: "roster",
  attendance: "attendance",
  materials: "materials",
  receipts: "material_receipts",
  issues: "material_issues",
  tasks: "tasks",
  milestones: "milestones",
  baselines: "schedule_baselines",
} as const;

export type Activity = { id: string; name: string; unit: string | null; plannedQuantity: number | null; categoryId: string | null };
export function parseActivity(raw: unknown): Activity | null {
  const o = withId(raw);
  const name = o && str(o, "name");
  if (!o || !name) return null;
  return { id: o.id, name, unit: str(o, "unit"), plannedQuantity: num(o, "planned_quantity"), categoryId: str(o, "category_id") };
}

export type ProgressEntry = {
  id: string;
  activityId: string | null;
  boqLineItemId: string | null;
  entryDate: string;
  quantityDone: number | null;
  percentComplete: number | null;
  remarks: string | null;
  entryBasis: string | null;
  createdAt: string | null;
};
export function parseProgress(raw: unknown): ProgressEntry | null {
  const o = withId(raw);
  const entryDate = o && day(o, "entry_date");
  if (!o || !entryDate) return null;
  return {
    id: o.id,
    activityId: str(o, "activity_id"),
    boqLineItemId: str(o, "boq_line_item_id"),
    entryDate,
    quantityDone: num(o, "quantity_done"),
    percentComplete: num(o, "percent_complete"),
    remarks: str(o, "remarks"),
    entryBasis: str(o, "entry_basis"),
    createdAt: str(o, "created_at"),
  };
}

export type BoqLineRef = { id: string; itemCode: string | null; description: string; unit: string | null; quantity: number | null; activityId: string | null };
export function parseBoqLineRef(raw: unknown): BoqLineRef | null {
  const o = withId(raw);
  const description = o && str(o, "description");
  if (!o || description === null) return null;
  return { id: o.id, itemCode: str(o, "item_code"), description, unit: str(o, "unit"), quantity: num(o, "quantity"), activityId: str(o, "activity_id") };
}

export type Worker = { id: string; name: string; trade: string | null; skillLevel: string | null; employeeCode: string | null; isActive: boolean; dailyRate: number | null };
export function parseWorker(raw: unknown): Worker | null {
  const o = withId(raw);
  const name = o && str(o, "name");
  if (!o || !name) return null;
  return {
    id: o.id, name, trade: str(o, "trade"), skillLevel: str(o, "skill_level"), employeeCode: str(o, "employee_code"),
    // a roster row without the flag is treated as active: the online list shows it under "active" too
    isActive: bool(o, "is_active") ?? true,
    dailyRate: num(o, "daily_rate"),
  };
}

export type AttendanceMark = { id: string; rosterId: string; date: string; status: string; hoursWorked: number | null; dailyCost: number | null };
export function parseAttendance(raw: unknown): AttendanceMark | null {
  const o = withId(raw);
  if (!o) return null;
  const rosterId = str(o, "roster_id");
  const date = day(o, "attendance_date");
  const status = str(o, "status");
  if (!rosterId || !date || !status) return null;
  return { id: o.id, rosterId, date, status, hoursWorked: num(o, "hours_worked"), dailyCost: num(o, "daily_cost") };
}

export type Material = { id: string; name: string; spec: string | null; unit: string | null; reorderLevel: number | null; isActive: boolean; unitCost: number | null };
export function parseMaterial(raw: unknown): Material | null {
  const o = withId(raw);
  const name = o && str(o, "name");
  if (!o || !name) return null;
  return { id: o.id, name, spec: str(o, "spec"), unit: str(o, "unit"), reorderLevel: num(o, "reorder_level"), isActive: bool(o, "is_active") ?? true, unitCost: num(o, "unit_cost") };
}

export type Receipt = {
  id: string; materialId: string; receivedDate: string; quantity: number; reference: string | null; notes: string | null;
  voided: boolean; voidReason: string | null; unitCost: number | null;
};
export function parseReceipt(raw: unknown): Receipt | null {
  const o = withId(raw);
  if (!o) return null;
  const materialId = str(o, "material_id");
  const receivedDate = day(o, "received_date");
  const quantity = num(o, "quantity");
  if (!materialId || !receivedDate || quantity === null) return null;
  return {
    id: o.id, materialId, receivedDate, quantity, reference: str(o, "reference"), notes: str(o, "notes"),
    voided: str(o, "voided_at") !== null, voidReason: str(o, "void_reason"), unitCost: num(o, "unit_cost"),
  };
}

export type Issue = { id: string; materialId: string; issuedDate: string; quantity: number; boqLineItemId: string | null; issuedTo: string | null; note: string | null };
export function parseIssue(raw: unknown): Issue | null {
  const o = withId(raw);
  if (!o) return null;
  const materialId = str(o, "material_id");
  const issuedDate = day(o, "issued_date");
  const quantity = num(o, "quantity");
  if (!materialId || !issuedDate || quantity === null) return null;
  return { id: o.id, materialId, issuedDate, quantity, boqLineItemId: str(o, "boq_line_item_id"), issuedTo: str(o, "issued_to"), note: str(o, "note") };
}

export type ScheduleTask = {
  id: string; number: number | null; title: string; priority: string | null; statusId: string | null; startDate: string | null; dueDate: string | null;
  completionPercentage: number | null; parentIssueId: string | null; milestoneId: string | null; description: string | null;
};
export function parseTask(raw: unknown): ScheduleTask | null {
  const o = withId(raw);
  const title = o && str(o, "title");
  if (!o || !title) return null;
  if (bool(o, "is_archived") === true) return null;
  return {
    id: o.id, number: num(o, "number"), title, priority: str(o, "priority"), statusId: str(o, "status_id"),
    startDate: day(o, "start_date"), dueDate: day(o, "due_date"), completionPercentage: num(o, "completion_percentage"),
    parentIssueId: str(o, "parent_issue_id"), milestoneId: str(o, "milestone_id"), description: str(o, "description"),
  };
}

export type Milestone = { id: string; name: string; status: string | null; targetDate: string | null };
export function parseMilestone(raw: unknown): Milestone | null {
  const o = withId(raw);
  const name = o && str(o, "name");
  if (!o || !name) return null;
  return { id: o.id, name, status: str(o, "status"), targetDate: day(o, "target_date") };
}

export type Baseline = { id: string; name: string; createdAt: string | null };
export function parseBaseline(raw: unknown): Baseline | null {
  const o = withId(raw);
  const name = o && str(o, "name");
  if (!o || !name) return null;
  return { id: o.id, name, createdAt: str(o, "created_at") };
}
