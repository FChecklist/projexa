// LOCAL-FIRST shell, cluster "design and change": the writes these screens can make with the network off.
//
// EVERY WRITE IS A PROPOSAL. Each function below puts ONE op in this person's outbox (outbox.ts: the op and its optimistic local
// row are stored in one IndexedDB transaction) and returns. The op is sent when the laptop can reach the server, with an op_id made
// once, now; the server runs it through the AI work link's real pipeline under the person's LIVE role and decides. The function ids
// and parameter names are the registry's (compliance-tracker supabase/functions/ai-work-link/function-registry.generated.json):
//
//   create_change_order               {projectId, title, reason?, description?, costImpact?, scheduleImpactDays?, trade?}  rank 2
//   submit_change_order_for_approval  {projectId, changeOrderId, signers}                                                 rank 3
//   record_timesheet                  {projectId, issueId, hours, spentOn?, activityType?}                                 rank 2
//   submit_timesheet                  {projectId, timeEntryId}                                                             rank 2
//   approve_timesheet                 {timeEntryId}                                                                        rank 3
//   reject_timesheet                  {timeEntryId, rejectionReason}                                                       rank 3
//
// MONEY AND APPROVALS ARE NEVER DECIDED HERE. A change order's cost impact is the number the person typed (their intent), sent as
// typed; the server stores and rounds it. Sending for approval, approving and sending back change NOTHING locally: the row keeps the
// status the server last said, and the screen says "waiting to be sent" until the server answers (it may refuse: a person below the
// role gets a plain-words notice from the outbox, and nothing changed). A new row made here carries no number and no status of its
// own invention: the server assigns both.
//
// WHEN A WRITE IS REFUSED BEFORE IT IS QUEUED (returns { queued: false, reason }): the laptop does not hold this person's copy of
// that project, or (for an edit) does not hold the row at a server version the edit can be based on. Nothing is stored.
//
// THE OUTBOX. Screens pass nothing and get this person's shared outbox (outbox-shared.ts, the one the rest of the app uses). Tests
// pass their own. Only `enqueue` is used: sending is the outbox's own business.

import { localDbNameFor, openLocalDb, type LocalRecord } from "../../local-db";
import { MANIFEST_KEY, type StoredManifest } from "../../replica";
import type { Outbox } from "../../outbox";
import { validateHours } from "@/lib/design-studio-timesheet";
import { CHANGE_ORDERS_KIND, TIMESHEETS_KIND } from "./design-change-rows";

export type DesignChangeWriteAccess = { userId: string; idb?: IDBFactory; outbox?: Pick<Outbox, "enqueue"> };

export type WriteResult = { queued: true; opId: string; tempId?: string } | { queued: false; reason: "no_copy" | "no_row" | "invalid" | "failed" };

type Ready = { userId: string; orgId: string; idb: IDBFactory; outbox: Pick<Outbox, "enqueue"> };

async function ready(projectId: string, access: DesignChangeWriteAccess): Promise<Ready | null> {
  const idb = access.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!idb || !access.userId || !projectId) return null;
  const db = await openLocalDb(idb, localDbNameFor(access.userId));
  let manifest: StoredManifest | null | undefined;
  try {
    manifest = await db.getMeta<StoredManifest | null>(MANIFEST_KEY);
  } finally {
    db.close();
  }
  if (!manifest || manifest.userId !== access.userId || !manifest.projectIds.includes(projectId)) return null;
  const outbox = access.outbox ?? (await import("../../outbox-shared")).getSharedOutbox(access.userId);
  return { userId: access.userId, orgId: manifest.orgId, idb, outbox };
}

/** The row the laptop holds, if it is this organisation's, of this project, and carries a server version (an edit is based on it). */
async function editableRow(ctx: Ready, kind: string, id: string, projectId: string): Promise<(LocalRecord & { serverVersion: number }) | null> {
  const db = await openLocalDb(ctx.idb, localDbNameFor(ctx.userId));
  try {
    const row = await db.getRecord(kind, id);
    if (!row || row.orgId !== ctx.orgId || row.projectId !== projectId || typeof row.serverVersion !== "number") return null;
    return row as LocalRecord & { serverVersion: number };
  } finally {
    db.close();
  }
}

const tempIdOf = () => `local-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/** A finite number from what the person typed, or undefined when they typed nothing. NaN means "not a number". */
function typedNumber(raw: string | number | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number") return raw;
  const t = raw.trim();
  return t === "" ? undefined : Number(t);
}

// ─── change orders ─────────────────────────────────────────────────────────────────────────────

export type NewChangeOrder = {
  projectId: string;
  title: string;
  reason?: string;
  /** As typed: "+/- amount". Empty = not given (the server's default applies). */
  costImpact?: string | number | null;
  /** As typed: "+/- days". */
  scheduleImpactDays?: string | number | null;
  /**
   * The sync service hid `cost_impact` from this person's role (the done marker's hiddenFields). Then NO costImpact is sent, not even
   * the online screen's 0 for an empty box: a person may not write a money field they may not see (lf-e10b). The server's default
   * applies; anything typed is ignored (the screen offers no such box).
   */
  costHidden?: boolean;
};

/** The same checks the online create screen makes, in its words. Empty object = fine. */
export function validateNewChangeOrder(input: NewChangeOrder): Partial<Record<"title" | "costImpact" | "scheduleImpactDays", string>> {
  const errors: Partial<Record<"title" | "costImpact" | "scheduleImpactDays", string>> = {};
  if (!input.title.trim()) errors.title = "Title is required.";
  const cost = input.costHidden ? undefined : typedNumber(input.costImpact);
  if (cost !== undefined && !Number.isFinite(cost)) errors.costImpact = "Cost impact must be a number.";
  const days = typedNumber(input.scheduleImpactDays);
  if (days !== undefined && !Number.isFinite(days)) errors.scheduleImpactDays = "Schedule impact must be a number of days.";
  return errors;
}

export async function createChangeOrderOffline(input: NewChangeOrder, access: DesignChangeWriteAccess): Promise<WriteResult> {
  if (Object.keys(validateNewChangeOrder(input)).length > 0) return { queued: false, reason: "invalid" };
  try {
    const ctx = await ready(input.projectId, access);
    if (!ctx) return { queued: false, reason: "no_copy" };
    const tempId = tempIdOf();
    const title = input.title.trim();
    const reason = input.reason?.trim() ? input.reason.trim() : undefined;
    const cost = input.costHidden ? undefined : typedNumber(input.costImpact);
    const days = typedNumber(input.scheduleImpactDays);
    const params: Record<string, unknown> = {
      projectId: input.projectId,
      title,
      ...(reason ? { reason } : {}),
      // As the online screen sends them: the person's own figures, or 0 when left empty. The server decides what they become. A role
      // that may not see the cost sends none at all (costHidden).
      ...(input.costHidden ? {} : { costImpact: cost ?? 0 }),
      scheduleImpactDays: days ?? 0,
    };
    const { opId } = await ctx.outbox.enqueue({
      functionId: "create_change_order",
      projectId: input.projectId,
      params,
      label: "New change order",
      creates: { kind: CHANGE_ORDERS_KIND, id: tempId },
      optimistic: async (tx) => {
        await tx.putRecord({
          id: `${CHANGE_ORDERS_KIND}:${tempId}`, type: CHANGE_ORDERS_KIND, orgId: ctx.orgId, projectId: input.projectId,
          // The server's column names (records_core). number and status are the server's to assign: none is invented here.
          data: {
            id: tempId, number: null, title, description: null, reason: reason ?? null,
            cost_impact: cost ?? null, schedule_impact_days: days ?? null, status: null, trade: null, boq_revision_id: null, created_at: null,
          },
        });
      },
    });
    return { queued: true, opId, tempId };
  } catch {
    return { queued: false, reason: "failed" };
  }
}

export type Signer = { name: string; email: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The online screen's checks for one signer, in its words. Null = fine. */
export function validateSigner(signer: Signer): string | null {
  if (!signer.name.trim() || !signer.email.trim()) return "Signer name and email are required";
  if (!EMAIL_RE.test(signer.email.trim())) return `"${signer.email.trim()}" is not a valid email address`;
  return null;
}

/**
 * Records the person's request to send a change order for e-signature approval. Changes nothing on the laptop: the status stays the
 * server's until it answers. Only a change order the server already holds (a version) can be sent: one made on this laptop is sent
 * for approval after the server has accepted it.
 */
export async function submitChangeOrderOffline(input: { projectId: string; changeOrderId: string; signers: Signer[] }, access: DesignChangeWriteAccess): Promise<WriteResult> {
  if (input.signers.length === 0 || input.signers.some((s) => validateSigner(s) !== null)) return { queued: false, reason: "invalid" };
  try {
    const ctx = await ready(input.projectId, access);
    if (!ctx) return { queued: false, reason: "no_copy" };
    const row = await editableRow(ctx, CHANGE_ORDERS_KIND, input.changeOrderId, input.projectId);
    if (!row) return { queued: false, reason: "no_row" };
    const { opId } = await ctx.outbox.enqueue({
      functionId: "submit_change_order_for_approval",
      projectId: input.projectId,
      params: { projectId: input.projectId, changeOrderId: input.changeOrderId, signers: input.signers.map((s) => ({ name: s.name.trim(), email: s.email.trim() })) },
      label: "Sending this change order for approval",
      record: { kind: CHANGE_ORDERS_KIND, id: input.changeOrderId, baseVersion: row.serverVersion },
    });
    return { queued: true, opId };
  } catch {
    return { queued: false, reason: "failed" };
  }
}

// ─── timesheets ────────────────────────────────────────────────────────────────────────────────

export type NewTimeEntry = {
  projectId: string;
  issueId: string;
  hours: string | number;
  spentOn: string;
  activityType?: string | null;
  /** The hours this person already has on that day (on this laptop), so the 24-hour rule is about the DAY, as online. */
  otherHoursThatDay?: number;
};

/** The online create screen's checks, in its words ("Hours must be more than 0"). Empty object = fine. */
export function validateNewTimeEntry(input: NewTimeEntry): Partial<Record<"issueId" | "hours" | "spentOn", string>> {
  const errors: Partial<Record<"issueId" | "hours" | "spentOn", string>> = {};
  if (!input.issueId) errors.issueId = "Choose a task";
  // The online module's own rule and words (design-studio-timesheet.ts validateHours), not a second copy of them.
  const hoursError = validateHours(String(input.hours ?? ""), input.otherHoursThatDay ?? 0);
  if (hoursError) errors.hours = hoursError;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.spentOn)) errors.spentOn = "Choose a date";
  return errors;
}

export async function recordTimeEntryOffline(input: NewTimeEntry, access: DesignChangeWriteAccess): Promise<WriteResult> {
  if (Object.keys(validateNewTimeEntry(input)).length > 0) return { queued: false, reason: "invalid" };
  try {
    const ctx = await ready(input.projectId, access);
    if (!ctx) return { queued: false, reason: "no_copy" };
    const tempId = tempIdOf();
    const hours = typedNumber(input.hours)!;
    const activityType = input.activityType?.trim() ? input.activityType.trim() : null;
    const { opId } = await ctx.outbox.enqueue({
      functionId: "record_timesheet",
      projectId: input.projectId,
      params: { projectId: input.projectId, issueId: input.issueId, hours, spentOn: input.spentOn, ...(activityType ? { activityType } : {}) },
      label: "Your time entry",
      creates: { kind: TIMESHEETS_KIND, id: tempId },
      optimistic: async (tx) => {
        await tx.putRecord({
          id: `${TIMESHEETS_KIND}:${tempId}`, type: TIMESHEETS_KIND, orgId: ctx.orgId, projectId: input.projectId,
          // approval_status is the server's: an entry it has not accepted yet has none.
          data: { id: tempId, issue_id: input.issueId, user_id: ctx.userId, hours, spent_on: input.spentOn, activity_type: activityType, comments: null, approval_status: null, created_at: null },
        });
      },
    });
    return { queued: true, opId, tempId };
  } catch {
    return { queued: false, reason: "failed" };
  }
}

type EntryDecision = "submit_timesheet" | "approve_timesheet" | "reject_timesheet";

const DECISION_LABEL: Record<EntryDecision, string> = {
  submit_timesheet: "Submitting this time entry",
  approve_timesheet: "Approving this time entry",
  reject_timesheet: "Sending this time entry back",
};

async function decideEntry(fn: EntryDecision, input: { projectId: string; timeEntryId: string; rejectionReason?: string }, access: DesignChangeWriteAccess): Promise<WriteResult> {
  if (fn === "reject_timesheet" && !input.rejectionReason?.trim()) return { queued: false, reason: "invalid" };
  try {
    const ctx = await ready(input.projectId, access);
    if (!ctx) return { queued: false, reason: "no_copy" };
    const row = await editableRow(ctx, TIMESHEETS_KIND, input.timeEntryId, input.projectId);
    if (!row) return { queued: false, reason: "no_row" };
    const params: Record<string, unknown> =
      fn === "submit_timesheet" ? { projectId: input.projectId, timeEntryId: input.timeEntryId }
        : fn === "approve_timesheet" ? { timeEntryId: input.timeEntryId }
          : { timeEntryId: input.timeEntryId, rejectionReason: input.rejectionReason!.trim() };
    const { opId } = await ctx.outbox.enqueue({
      functionId: fn,
      projectId: input.projectId,
      params,
      label: DECISION_LABEL[fn],
      record: { kind: TIMESHEETS_KIND, id: input.timeEntryId, baseVersion: row.serverVersion },
      // No optimistic change: whether it is submitted, approved or sent back is the server's answer, never this laptop's.
    });
    return { queued: true, opId };
  } catch {
    return { queued: false, reason: "failed" };
  }
}

export const submitTimeEntryOffline = (input: { projectId: string; timeEntryId: string }, access: DesignChangeWriteAccess) => decideEntry("submit_timesheet", input, access);
export const approveTimeEntryOffline = (input: { projectId: string; timeEntryId: string }, access: DesignChangeWriteAccess) => decideEntry("approve_timesheet", input, access);
export const rejectTimeEntryOffline = (input: { projectId: string; timeEntryId: string; rejectionReason: string }, access: DesignChangeWriteAccess) =>
  decideEntry("reject_timesheet", input, access);

/** Plain words for a write that was not queued. */
export function notQueuedMessage(reason: Exclude<WriteResult, { queued: true }>["reason"]): string {
  switch (reason) {
    case "no_copy":
      return "This project is not copied to this laptop yet, so this cannot be saved here. Please try again when you are online.";
    case "no_row":
      return "This laptop does not hold the server's copy of this item yet, so this cannot be saved here. Please try again when you are online.";
    case "invalid":
      return "Please check the highlighted fields.";
    default:
      return "This could not be saved on this laptop. Please try again.";
  }
}
