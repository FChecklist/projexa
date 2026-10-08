// LOCAL-FIRST shell, cluster "delivery": the WRITES a site person makes every day, kept on the laptop at once and sent through the
// outbox (outbox.ts) to the AI work link's registered functions when the laptop can reach the server.
//
//   markAttendanceOffline     record_attendance       {projectId, rosterId, date, status, hours?}
//   recordIssueOffline        record_material_issue   {projectId, materialId, quantity, issuedDate, boqLineItemId?, issuedTo?, note?}
//   recordReceiptOffline      record_material_receipt {projectId, materialId, quantity, receivedDate, reference?, notes?}  (NO unitCost)
//   recordProgressOffline     record_work_progress    {projectId, boqLineItemId, quantityDone | percent, entryDate, remarks?, activityId?*}
//                                                     * only once the registry DECLARES activityId for it (see "honest limit" below)
//
// Function ids and parameter names are the registry's (compliance-tracker supabase/functions/ai-work-link/
// function-registry.generated.json). The laptop only PROPOSES: the server runs each function under the person's live role and decides.
//
// WHY THIS FILE AND NOT local-writes.ts. local-writes.ts belongs to the client engine (another engineer's file) and is gated by the
// px-local-first flag, because the ONLINE screens call it and must fall back to their normal request. The shell is only ever shown
// when the laptop is meant to work on its own, so these writers are not flag-gated; everything else follows local-writes.ts exactly:
// the manifest must name the project, the outbox stores the op and the optimistic row in ONE transaction, a temporary id
// (`local-<uuid>`) marks a row that exists only here until the server answers.
//
// MONEY IS NEVER DECIDED HERE. A receipt's unit cost is not sent (the server keeps the material's own cost); an attendance mark has
// no cost (daily_cost is the server's, from the worker's rate); a progress entry sent as a quantity carries no percent (the server
// converts it against the BOQ line's own quantity). The optimistic rows say null for all of those.
//
// THE PROGRESS ENTRY'S HONEST LIMIT. record_work_progress (compliance-tracker src/lib/pipeline/executor.ts
// executeRecordWorkProgress) takes no activityId and no entryBasis: the server records the entry against the project's FIRST
// activity it finds (or a default one it makes) as a DELTA. With two or more activities on the project that "first" is not a choice
// the person made, so the entry would silently land on an activity they did not pick. This writer therefore REFUSES when the project
// holds more than one activity (`several_activities`), and the screen says that the entry needs the server today. It accepts when the
// project has exactly one activity (the server's choice is that one) or none (the server makes the default one, as online).
//
// P2 (2026-10-08): THE PICKER IS READY, THE SERVER IS NOT. The writer takes the activity the person chose (`activityId`) and
// checks it against the project's activities on this laptop. It SENDS it, and stops refusing a project with several activities,
// only when the registry copy (ai/function-registry.json) lists `activityId` among record_work_progress's declared_params. Today
// it does not, and the AI work link DROPS an undeclared parameter without a word (reads.ts / the pipeline's coverage tests), so
// sending it now would put the entry on the server's "first" activity while the laptop showed the chosen one -- the very silent
// misfiling this refusal exists to prevent. When compliance-tracker's record_work_progress gains an `activityId` and the registry
// copy is refreshed, the picker and the param switch on with no change here.

import { findFunction, rankOf } from "../../ai/registry";
import { localDbNameFor, openLocalDb } from "../../local-db";
import type { Outbox } from "../../outbox";
import { MANIFEST_KEY, type StoredManifest } from "../../replica";
import type { ShellData } from "../context";
import { DELIVERY_KINDS, parseActivity, parseBoqLineRef, parseMaterial, parseWorker, readKind } from "./delivery-local";

/** Injected by tests; the screens pass nothing (the shared outbox of this person is used). */
export type DeliveryWriteAccess = {
  outbox?: Outbox;
  newId?: () => string;
  /** Whether the registry declares `param` for `functionId`. Tests inject it; the screens use the registry copy. */
  declaresParam?: (functionId: string, param: string) => boolean;
};

/** The registry copy's answer: does the server's function take this parameter? */
export function registryDeclares(functionId: string, param: string): boolean {
  return findFunction(functionId)?.declared_params.includes(param) ?? false;
}

/** Whether a progress entry kept on the laptop can say WHICH activity it is for (see the header's P2 note). */
export function progressCanNameActivity(declares: (functionId: string, param: string) => boolean = registryDeclares): boolean {
  return declares("record_work_progress", "activityId");
}

export type WriteResult =
  | { queued: true; opId: string; tempId: string }
  | { queued: false; reason: WriteRefusal };

export type WriteRefusal =
  | "not_on_laptop" // the laptop's copy does not know this project (or this person, or this organisation)
  | "not_synced" // a list the check needs was never copied to the end
  | "unknown_record" // the worker / material / BOQ line is not in this project on this laptop
  | "invalid" // a value the server would refuse (empty, negative, not a date)
  | "several_activities" // see the header: record_work_progress cannot be told which activity
  | "no_activity_chosen" // several activities, and the person has not picked one
  | "failed"; // the outbox could not store it (nothing was kept)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const optText = (v: string | null | undefined): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** The attendance statuses the online form offers (AttendanceCreateClient: present | half_day | absent). */
export const ATTENDANCE_STATUSES = ["present", "half_day", "absent"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

type Ctx = { orgId: string; outbox: Outbox; newId: () => string };

async function context(data: ShellData, projectId: string, access: DeliveryWriteAccess): Promise<Ctx | null> {
  if (!data.orgId) return null;
  try {
    const db = await openLocalDb(data.idb ?? indexedDB, localDbNameFor(data.userId));
    let manifest: StoredManifest | undefined;
    try {
      manifest = await db.getMeta<StoredManifest>(MANIFEST_KEY);
    } finally {
      db.close();
    }
    if (!manifest || manifest.userId !== data.userId || manifest.orgId !== data.orgId || !manifest.projectIds.includes(projectId)) return null;
    const outbox = access.outbox ?? (await import("../../outbox-shared")).getSharedOutbox(data.userId);
    return { orgId: data.orgId, outbox, newId: access.newId ?? (() => crypto.randomUUID()) };
  } catch {
    return null;
  }
}

async function enqueueCreate(
  ctx: Ctx,
  input: { functionId: string; projectId: string; kind: string; params: Record<string, unknown>; label: string; row: (tempId: string) => Record<string, unknown> }
): Promise<WriteResult> {
  const tempId = `local-${ctx.newId()}`;
  try {
    const { opId } = await ctx.outbox.enqueue({
      functionId: input.functionId,
      projectId: input.projectId,
      params: input.params,
      label: input.label,
      creates: { kind: input.kind, id: tempId },
      optimistic: async (tx) => {
        await tx.putRecord({ id: `${input.kind}:${tempId}`, type: input.kind, orgId: ctx.orgId, projectId: input.projectId, data: input.row(tempId) });
      },
    });
    return { queued: true, opId, tempId };
  } catch {
    return { queued: false, reason: "failed" };
  }
}

const refuse = (reason: WriteRefusal): WriteResult => ({ queued: false, reason });

// ─── record_attendance ──────────────────────────────────────────────────────────────────────────────────────────

export type AttendanceInput = { projectId: string; rosterId: string; date: string; status: AttendanceStatus; hours?: number | null };

export async function markAttendanceOffline(data: ShellData, input: AttendanceInput, access: DeliveryWriteAccess = {}): Promise<WriteResult> {
  if (!input.rosterId || !isDate(input.date) || !(ATTENDANCE_STATUSES as readonly string[]).includes(input.status)) return refuse("invalid");
  if (input.hours !== undefined && input.hours !== null && !(Number.isFinite(input.hours) && input.hours >= 0 && input.hours <= 24)) return refuse("invalid");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const roster = await readKind(data, input.projectId, DELIVERY_KINDS.roster, parseWorker);
  if (!roster.synced) return refuse("not_synced");
  if (!roster.rows.some((w) => w.id === input.rosterId)) return refuse("unknown_record");
  const hours = typeof input.hours === "number" ? input.hours : undefined;
  return enqueueCreate(ctx, {
    functionId: "record_attendance",
    projectId: input.projectId,
    kind: DELIVERY_KINDS.attendance,
    label: "Attendance",
    params: { projectId: input.projectId, rosterId: input.rosterId, date: input.date, status: input.status, ...(hours !== undefined ? { hours } : {}) },
    row: (id) => ({ id, roster_id: input.rosterId, attendance_date: input.date, status: input.status, hours_worked: hours ?? null, daily_cost: null }),
  });
}

// ─── record_material_issue ──────────────────────────────────────────────────────────────────────────────────────

export type IssueInput = { projectId: string; materialId: string; quantity: number; issuedDate: string; boqLineItemId?: string | null; issuedTo?: string | null; note?: string | null };

export async function recordIssueOffline(data: ShellData, input: IssueInput, access: DeliveryWriteAccess = {}): Promise<WriteResult> {
  if (!input.materialId || !positive(input.quantity) || !isDate(input.issuedDate)) return refuse("invalid");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const materials = await readKind(data, input.projectId, DELIVERY_KINDS.materials, parseMaterial);
  if (!materials.synced) return refuse("not_synced");
  if (!materials.rows.some((m) => m.id === input.materialId)) return refuse("unknown_record");
  const boqLineItemId = optText(input.boqLineItemId);
  if (boqLineItemId) {
    const lines = await readKind(data, input.projectId, DELIVERY_KINDS.boqLines, parseBoqLineRef);
    if (!lines.synced) return refuse("not_synced");
    if (!lines.rows.some((l) => l.id === boqLineItemId)) return refuse("unknown_record");
  }
  const issuedTo = optText(input.issuedTo);
  const note = optText(input.note);
  return enqueueCreate(ctx, {
    functionId: "record_material_issue",
    projectId: input.projectId,
    kind: DELIVERY_KINDS.issues,
    label: "Material issue",
    params: {
      projectId: input.projectId, materialId: input.materialId, quantity: input.quantity, issuedDate: input.issuedDate,
      ...(boqLineItemId ? { boqLineItemId } : {}), ...(issuedTo ? { issuedTo } : {}), ...(note ? { note } : {}),
    },
    row: (id) => ({ id, material_id: input.materialId, issued_date: input.issuedDate, quantity: input.quantity, boq_line_item_id: boqLineItemId ?? null, issued_to: issuedTo ?? null, note: note ?? null }),
  });
}

// ─── record_material_receipt (no cost) ──────────────────────────────────────────────────────────────────────────

export type ReceiptInput = { projectId: string; materialId: string; quantity: number; receivedDate: string; reference?: string | null; notes?: string | null };

export async function recordReceiptOffline(data: ShellData, input: ReceiptInput, access: DeliveryWriteAccess = {}): Promise<WriteResult> {
  if (!input.materialId || !positive(input.quantity) || !isDate(input.receivedDate)) return refuse("invalid");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const materials = await readKind(data, input.projectId, DELIVERY_KINDS.materials, parseMaterial);
  if (!materials.synced) return refuse("not_synced");
  if (!materials.rows.some((m) => m.id === input.materialId)) return refuse("unknown_record");
  const reference = optText(input.reference);
  const notes = optText(input.notes);
  return enqueueCreate(ctx, {
    functionId: "record_material_receipt",
    projectId: input.projectId,
    kind: DELIVERY_KINDS.receipts,
    label: "Material receipt",
    // unitCost is deliberately absent: a cost is money, and money is the server's (see the header)
    params: { projectId: input.projectId, materialId: input.materialId, quantity: input.quantity, receivedDate: input.receivedDate,...(reference ? { reference } : {}), ...(notes ? { notes } : {}) },
    row: (id) => ({ id, material_id: input.materialId, received_date: input.receivedDate, quantity: input.quantity, reference: reference ?? null, notes: notes ?? null, voided_at: null, unit_cost: null }),
  });
}

// ─── record_work_progress ───────────────────────────────────────────────────────────────────────────────────────

export type ProgressInput = {
  projectId: string;
  boqLineItemId: string;
  entryDate: string;
  remarks?: string | null;
  /** The activity the person chose. Needed when the project has more than one; checked against this laptop's list. */
  activityId?: string | null;
} & ({ quantityDone: number; percent?: undefined } | { percent: number; quantityDone?: undefined });

export async function recordProgressOffline(data: ShellData, input: ProgressInput, access: DeliveryWriteAccess = {}): Promise<WriteResult> {
  if (!input.boqLineItemId || !isDate(input.entryDate)) return refuse("invalid");
  const byQuantity = typeof input.quantityDone === "number";
  if (byQuantity ? !positive(input.quantityDone) : !(typeof input.percent === "number" && Number.isFinite(input.percent) && input.percent > 0 && input.percent <= 100)) {
    return refuse("invalid");
  }
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const [activities, lines] = await Promise.all([
    readKind(data, input.projectId, DELIVERY_KINDS.activities, parseActivity),
    readKind(data, input.projectId, DELIVERY_KINDS.boqLines, parseBoqLineRef),
  ]);
  if (!activities.synced || !lines.synced) return refuse("not_synced");
  const canName = progressCanNameActivity(access.declaresParam);
  const chosen = optText(input.activityId);
  if (activities.rows.length > 1) {
    if (!canName) return refuse("several_activities");
    if (!chosen) return refuse("no_activity_chosen");
  }
  if (chosen && !activities.rows.some((a) => a.id === chosen)) return refuse("unknown_record");
  if (!lines.rows.some((l) => l.id === input.boqLineItemId)) return refuse("unknown_record");
  // sent only when the server takes it; with one activity (or none) the server's own choice is the same one
  const activityParam = canName && chosen ? { activityId: chosen } : {};
  const activityId = chosen ?? activities.rows[0]?.id ?? null;
  const remarks = optText(input.remarks);
  const value = byQuantity ? { quantityDone: input.quantityDone } : { percent: input.percent };
  return enqueueCreate(ctx, {
    functionId: "record_work_progress",
    projectId: input.projectId,
    kind: DELIVERY_KINDS.progress,
    label: "Progress entry",
    params: { projectId: input.projectId, boqLineItemId: input.boqLineItemId, entryDate: input.entryDate, ...value, ...activityParam, ...(remarks ? { remarks } : {}) },
    row: (id) => ({
      id, activity_id: activityId, boq_line_item_id: input.boqLineItemId, entry_date: input.entryDate,
      // a quantity's percent is the server's to compute against the line's own quantity: null until it answers
      quantity_done: byQuantity ? input.quantityDone : null, percent_complete: byQuantity ? null : input.percent,
      remarks: remarks ?? null, entry_basis: "DELTA",
    }),
  });
}

/**
 * Whether the delivery screens OFFER a write to this role. Every write here needs rank 2 in the AI work link (registry min_role_rank;
 * compliance-tracker ai_work_link__role_rank); the roles of rank 1 (viewer, client_viewer, external_auditor, stage_0) are read-only, so
 * no form, link or mark button is shown to them (lf-e10a found every one offered to a viewer). This only DECLINES to offer: it never
 * grants anything, and the server decides every op again under the person's live role. A role the laptop does not know (or none yet)
 * is offered the screen as before -- the server's answer then reaches the person through the outbox card.
 */
export function canOfferWrites(role: string | null): boolean {
  return rankOf(role) !== READ_ONLY_RANK;
}
const READ_ONLY_RANK = 1;

/** The person-facing sentence for a refusal (the screens show it under the form; never a dialog). */
export function refusalText(reason: WriteRefusal): string {
  switch (reason) {
    case "not_on_laptop":
      return "This project is not on this laptop, so this cannot be kept here. Open it once while you are online.";
    case "not_synced":
      return "This project has not finished copying to this laptop yet. Try again once it has, while you are online.";
    case "unknown_record":
      return "That item is not in this project on this laptop. Choose one from the list.";
    case "invalid":
      return "Please check the values: a date, and an amount above zero.";
    case "several_activities":
      return "This project has more than one activity, and an entry saved on the laptop cannot say which one yet. Save it while you are online, from the full screen.";
    case "no_activity_chosen":
      return "Choose which activity this work is for.";
    case "failed":
      return "This could not be kept on the laptop. Nothing was saved; please try again.";
  }
}

// ─── add_roster_entry (a new worker) ─────────────────────────────────────────

export type AddWorkerInput = { projectId: string; name: string; trade?: string | null; dailyRate: number; employeeCode?: string | null };

/** A worker is added on the laptop at once and sent through add_roster_entry when connected (the server may refuse, e.g. a duplicate code). */
export async function addWorkerOffline(data: ShellData, input: AddWorkerInput, access: DeliveryWriteAccess = {}): Promise<WriteResult> {
  const name = optText(input.name);
  if (!name || name.length > 200) return refuse("invalid");
  if (typeof input.dailyRate !== "number" || !Number.isFinite(input.dailyRate) || input.dailyRate < 0) return refuse("invalid");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const trade = optText(input.trade);
  const employeeCode = optText(input.employeeCode);
  return enqueueCreate(ctx, {
    functionId: "add_roster_entry",
    projectId: input.projectId,
    kind: DELIVERY_KINDS.roster,
    label: "New worker",
    params: { projectId: input.projectId, name, dailyRate: input.dailyRate, ...(trade ? { trade } : {}), ...(employeeCode ? { employeeCode } : {}) },
    row: (id) => ({ id, name, trade: trade ?? null, employee_code: employeeCode ?? null, daily_rate: input.dailyRate, is_active: true }),
  });
}

// ─── create_material (a new material) ────────────────────────────────────────

export type CreateMaterialInput = { projectId: string; name: string; unit: string; spec?: string | null; unitCost?: number | null; reorderLevel?: number | null };

export async function createMaterialOffline(data: ShellData, input: CreateMaterialInput, access: DeliveryWriteAccess = {}): Promise<WriteResult> {
  const name = optText(input.name);
  const unit = optText(input.unit);
  if (!name || name.length > 200 || !unit || unit.length > 30) return refuse("invalid");
  const nonNegative = (v: number | null | undefined) => v === undefined || v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
  if (!nonNegative(input.unitCost) || !nonNegative(input.reorderLevel)) return refuse("invalid");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const spec = optText(input.spec);
  const unitCost = typeof input.unitCost === "number" ? input.unitCost : undefined;
  const reorderLevel = typeof input.reorderLevel === "number" ? input.reorderLevel : undefined;
  return enqueueCreate(ctx, {
    functionId: "create_material",
    projectId: input.projectId,
    kind: DELIVERY_KINDS.materials,
    label: "New material",
    params: { projectId: input.projectId, name, unit, ...(spec ? { spec } : {}), ...(unitCost !== undefined ? { unitCost } : {}), ...(reorderLevel !== undefined ? { reorderLevel } : {}) },
    row: (id) => ({ id, name, unit, spec: spec ?? null, unit_cost: unitCost ?? null, reorder_level: reorderLevel ?? null, is_active: true }),
  });
}

// ─── create_schedule_task (a new task) ───────────────────────────────────────

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type CreateTaskInput = { projectId: string; title: string; startDate: string; dueDate?: string | null; durationDays?: number | null; description?: string | null; priority?: string | null };

export async function createTaskOffline(data: ShellData, input: CreateTaskInput, access: DeliveryWriteAccess = {}): Promise<WriteResult> {
  const title = optText(input.title);
  if (!title || title.length > 300 || !isDate(input.startDate)) return refuse("invalid");
  const dueDate = optText(input.dueDate);
  if (dueDate && (!isDate(dueDate) || dueDate < input.startDate)) return refuse("invalid");
  if (input.durationDays !== undefined && input.durationDays !== null && !(Number.isInteger(input.durationDays) && input.durationDays > 0 && input.durationDays <= 3650)) return refuse("invalid");
  const priority = optText(input.priority);
  if (priority && !(TASK_PRIORITIES as readonly string[]).includes(priority)) return refuse("invalid");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const description = optText(input.description);
  const durationDays = typeof input.durationDays === "number" ? input.durationDays : undefined;
  return enqueueCreate(ctx, {
    functionId: "create_schedule_task",
    projectId: input.projectId,
    kind: DELIVERY_KINDS.tasks,
    label: "New task",
    params: {
      projectId: input.projectId, title, startDate: input.startDate,
      ...(dueDate ? { dueDate } : {}), ...(durationDays !== undefined ? { durationDays } : {}), ...(description ? { description } : {}), ...(priority ? { priority } : {}),
    },
    // number, status and completion are the server's: the optimistic row says null, as for the other writers
    row: (id) => ({ id, number: null, title, priority: priority ?? null, status_id: null, start_date: input.startDate, due_date: dueDate ?? null, completion_percentage: null, description: description ?? null }),
  });
}
