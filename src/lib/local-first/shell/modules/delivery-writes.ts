// LOCAL-FIRST shell, cluster "delivery": the WRITES a site person makes every day, kept on the laptop at once and sent through the
// outbox (outbox.ts) to the AI work link's registered functions when the laptop can reach the server.
//
//   markAttendanceOffline     record_attendance       {projectId, rosterId, date, status, hours?}
//   recordIssueOffline        record_material_issue   {projectId, materialId, quantity, issuedDate, boqLineItemId?, issuedTo?, note?}
//   recordReceiptOffline      record_material_receipt {projectId, materialId, quantity, receivedDate, reference?, notes?}  (NO unitCost)
//   recordProgressOffline     record_work_progress    {projectId, boqLineItemId, quantityDone | percent, entryDate, remarks?}
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

import { localDbNameFor, openLocalDb } from "../../local-db";
import type { Outbox } from "../../outbox";
import { MANIFEST_KEY, type StoredManifest } from "../../replica";
import type { ShellData } from "../context";
import { DELIVERY_KINDS, parseActivity, parseBoqLineRef, parseMaterial, parseWorker, readKind } from "./delivery-local";

/** Injected by tests; the screens pass nothing (the shared outbox of this person is used). */
export type DeliveryWriteAccess = { outbox?: Outbox; newId?: () => string };

export type WriteResult =
  | { queued: true; opId: string; tempId: string }
  | { queued: false; reason: WriteRefusal };

export type WriteRefusal =
  | "not_on_laptop" // the laptop's copy does not know this project (or this person, or this organisation)
  | "not_synced" // a list the check needs was never copied to the end
  | "unknown_record" // the worker / material / BOQ line is not in this project on this laptop
  | "invalid" // a value the server would refuse (empty, negative, not a date)
  | "several_activities" // see the header: record_work_progress cannot be told which activity
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
  if (activities.rows.length > 1) return refuse("several_activities");
  if (!lines.rows.some((l) => l.id === input.boqLineItemId)) return refuse("unknown_record");
  const remarks = optText(input.remarks);
  const value = byQuantity ? { quantityDone: input.quantityDone } : { percent: input.percent };
  return enqueueCreate(ctx, {
    functionId: "record_work_progress",
    projectId: input.projectId,
    kind: DELIVERY_KINDS.progress,
    label: "Progress entry",
    params: { projectId: input.projectId, boqLineItemId: input.boqLineItemId, entryDate: input.entryDate, ...value, ...(remarks ? { remarks } : {}) },
    row: (id) => ({
      id, activity_id: activities.rows[0]?.id ?? null, boq_line_item_id: input.boqLineItemId, entry_date: input.entryDate,
      // a quantity's percent is the server's to compute against the line's own quantity: null until it answers
      quantity_done: byQuantity ? input.quantityDone : null, percent_complete: byQuantity ? null : input.percent,
      remarks: remarks ?? null, entry_basis: "DELTA",
    }),
  });
}

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
    case "failed":
      return "This could not be kept on the laptop. Nothing was saved; please try again.";
  }
}
