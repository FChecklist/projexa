// LOCAL-FIRST shell, cluster "site": the writes a site person makes, kept on the laptop at once and sent through the OUTBOX (outbox.ts)
// to the AI work link's registered functions when the laptop can reach the server. Function ids and parameter names are the registry's
// (compliance-tracker supabase/functions/ai-work-link/function-registry.generated.json; src/lib/local-first/ai/function-registry.json).
//
//   createRfiOffline            create_rfi                {projectId, subject, question, dueDate?}
//   createSubmittalOffline      create_submittal          {projectId, title, specSection?, type?, dueDate?}
//   createPunchItemOffline      create_punch_list_item    {projectId, description, location?, trade?, priority?}
//   createSiteDiaryOffline      create_site_diary         {projectId, diaryDate, weather?, workDone?, visitors?, labourCount?, issues?, instructions?, materialReceived?, remarks?}
//   answerRfiOffline            answer_rfi                {projectId, rfiId, answer}                  (rank 2)
//   closeRfiOffline             close_rfi                 {projectId, rfiId}                          (rank 2)
//   markPunchReadyOffline       mark_punch_item_ready     {projectId, itemId}                         (rank 2)
//   verifyPunchClosedOffline    verify_punch_item_closed  {projectId, itemId}                         (rank 3)
//   reviewSubmittalOffline      review_submittal          {projectId, submittalId, status, comments?} (rank 3)
//   advanceFfeOffline           update_ffe_status         {projectId, itemId, status}                 (rank 3, money sensitive)
//
// THE LAPTOP ONLY PROPOSES. Approvals (a submittal review, a punch item's verification, closing an RFI) and the FF&E status (which the
// server treats as money sensitive) are decided by the server under the person's LIVE role, and with its own checks (nobody reviews their
// own submittal, a status only moves forward). What the laptop does is keep the person's request and show it as "Waiting to sync"; if the
// server refuses, the outbox puts the row back as it was and says so on its own card. Nothing here computes an amount, a number (RFI-12 is
// the server's) or a total: a new row on the laptop carries `number: null` until the server answers.
//
// WHAT IS NOT WIRED (the screens say plainly that it needs a connection): a new FF&E item (it carries cost and price: money), a new vendor,
// assigning people (the people master is not offered here yet), and attachments.
//
// Like delivery-writes.ts, this file does not reuse local-writes.ts (flag-gated for the online screens; the shell is never gated) and
// repeats its checks: the person's own database, the manifest lists the project and this organisation, an edited row is this
// organisation's, of this project, and carries a server version (so the server can tell a conflict from a plain update).

import { rankOf } from "../../ai/registry";
import { localDbNameFor, openLocalDb, type LocalRecord } from "../../local-db";
import { OutboxRefusal, type Outbox } from "../../outbox";
import { MANIFEST_KEY, type StoredManifest } from "../../replica";
import type { ShellData } from "../context";
import { asRecord } from "./documents-records";
import { FFE_STATUSES, SITE_KINDS, toLocalFfeItem } from "./site-records";

/** Injected by tests; the screens pass nothing (the shared outbox of this person is used). */
export type SiteWriteAccess = { outbox?: Outbox; newId?: () => string };

/** Render tests set `outbox` here to run the screens against a test outbox; the app leaves it empty (the person's shared outbox). */
export const siteWriteDeps: { outbox?: Outbox } = {};

export type SiteWriteRefusal =
  | "not_on_laptop" // this project / person / organisation is not what the laptop holds
  | "unknown_record" // the row is not on the laptop with a server version (a row made here and not yet confirmed cannot be edited)
  | "invalid" // a value the server would refuse (empty, not a date, not a choice)
  | "too_long" // longer than the server accepts (the person's text stays in the form)
  | "wrong_state" // the row is not in a state this change applies to (already answered, already closed ...)
  | "not_allowed" // the role is known and below the function's rank
  | "cost_hidden" // FF&E status is money sensitive and this role does not see cost
  | "failed"; // the outbox could not store it (nothing was kept)

export type SiteWriteResult = { queued: true; opId: string; tempId?: string } | { queued: false; reason: SiteWriteRefusal };

const refuse = (reason: SiteWriteRefusal): SiteWriteResult => ({ queued: false, reason });

/** The person-facing sentence for a refusal (shown under the form; never a dialog). */
export function siteRefusalText(reason: SiteWriteRefusal): string {
  switch (reason) {
    case "not_on_laptop":
      return "This project is not on this laptop, so this cannot be kept here. Open it once while you are online.";
    case "unknown_record":
      return "This is not confirmed by the server yet, so it cannot be changed from this laptop. Try again once it has been sent.";
    case "invalid":
      return "Please check the values: what is required is filled in, and dates are dates.";
    case "too_long":
      return "That text is longer than the server accepts. Please shorten it; what you typed is still here.";
    case "wrong_state":
      return "This item has already moved on, so that change does not apply any more.";
    case "not_allowed":
      return "Your role can see this but not make that change.";
    case "cost_hidden":
      return "This change is only for roles that see cost. It can be made by them, or by you from the full screen while you are online.";
    case "failed":
      return "This could not be kept on the laptop. Nothing was saved; please try again.";
  }
}

/** Ranks of the AI work link (ai/registry.ts rankOf). A role the laptop does not know is offered the control (the server then decides). */
export function canOffer(role: string | null, minRank: 2 | 3): boolean {
  const rank = rankOf(role);
  return rank === 0 || rank >= minRank;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const required = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const optText = (v: string | null | undefined): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

type Ctx = { orgId: string; outbox: Outbox; newId: () => string; manifest: StoredManifest };

async function context(data: ShellData, projectId: string, access: SiteWriteAccess): Promise<Ctx | null> {
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
    const outbox = access.outbox ?? siteWriteDeps.outbox ?? (await import("../../outbox-shared")).getSharedOutbox(data.userId);
    return { orgId: data.orgId, outbox, newId: access.newId ?? (() => crypto.randomUUID()), manifest };
  } catch {
    return null;
  }
}

/** The row of this person's laptop when it may be edited here: this organisation's, this project's, with a server version. */
async function editableRow(data: ShellData, ctx: Ctx, projectId: string, kind: string, id: string): Promise<(LocalRecord & { serverVersion: number }) | null> {
  try {
    const db = await openLocalDb(data.idb ?? indexedDB, localDbNameFor(data.userId));
    try {
      const row = await db.getRecord(kind, id);
      if (!row || row.orgId !== ctx.manifest.orgId || row.projectId !== projectId || typeof row.serverVersion !== "number") return null;
      return row as LocalRecord & { serverVersion: number };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function enqueueCreate(
  ctx: Ctx,
  input: { functionId: string; projectId: string; kind: string; params: Record<string, unknown>; label: string; row: (tempId: string) => Record<string, unknown> }
): Promise<SiteWriteResult> {
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
  } catch (e) {
    return refuse(e instanceof OutboxRefusal ? "too_long" : "failed");
  }
}

async function enqueueEdit(
  data: ShellData,
  ctx: Ctx,
  input: { functionId: string; projectId: string; kind: string; id: string; params: Record<string, unknown>; label: string; columns: Record<string, unknown>; guard: (current: unknown) => boolean }
): Promise<SiteWriteResult> {
  const row = await editableRow(data, ctx, input.projectId, input.kind, input.id);
  if (!row) return refuse("unknown_record");
  if (!input.guard(row.data)) return refuse("wrong_state");
  try {
    const { opId } = await ctx.outbox.enqueue({
      functionId: input.functionId,
      projectId: input.projectId,
      params: input.params,
      label: input.label,
      record: { kind: input.kind, id: input.id, baseVersion: row.serverVersion },
      optimistic: async (tx) => {
        const current = await tx.getRecord(input.kind, input.id);
        if (current) await tx.patchRecord(input.kind, input.id, { data: { ...(asRecord(current.data) ?? {}), ...input.columns } });
      },
    });
    return { queued: true, opId };
  } catch (e) {
    return refuse(e instanceof OutboxRefusal ? "too_long" : "failed");
  }
}

const NO_HIDDEN: ReadonlySet<string> = new Set();
const ctxOf = { hidden: NO_HIDDEN, waiting: NO_HIDDEN };

// ─── creates ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function createRfiOffline(
  data: ShellData,
  input: { projectId: string; subject: string; question: string; dueDate?: string | null },
  access: SiteWriteAccess = {}
): Promise<SiteWriteResult> {
  if (!canOffer(data.role, 2)) return refuse("not_allowed");
  if (!required(input.subject) || !required(input.question)) return refuse("invalid");
  if (input.dueDate && !isDate(input.dueDate)) return refuse("invalid");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const subject = input.subject.trim();
  const question = input.question.trim();
  const dueDate = input.dueDate || undefined;
  return enqueueCreate(ctx, {
    functionId: "create_rfi", projectId: input.projectId, kind: SITE_KINDS.rfis, label: "New RFI",
    params: { projectId: input.projectId, subject, question, ...(dueDate ? { dueDate } : {}) },
    // the number (RFI-12) is the server's: null until it answers
    row: (id) => ({ id, number: null, subject, question, status: "open", ball_in_court: null, due_date: dueDate ?? null, answer: null }),
  });
}

export const SUBMITTAL_TYPES = ["shop_drawing", "product_data", "sample", "other"] as const;

export async function createSubmittalOffline(
  data: ShellData,
  input: { projectId: string; title: string; specSection?: string | null; type?: string; dueDate?: string | null },
  access: SiteWriteAccess = {}
): Promise<SiteWriteResult> {
  if (!canOffer(data.role, 2)) return refuse("not_allowed");
  if (!required(input.title)) return refuse("invalid");
  if (input.type !== undefined && !(SUBMITTAL_TYPES as readonly string[]).includes(input.type)) return refuse("invalid");
  if (input.dueDate && !isDate(input.dueDate)) return refuse("invalid");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const title = input.title.trim();
  const specSection = optText(input.specSection);
  const type = input.type ?? "shop_drawing";
  const dueDate = input.dueDate || undefined;
  return enqueueCreate(ctx, {
    functionId: "create_submittal", projectId: input.projectId, kind: SITE_KINDS.submittals, label: "New submittal",
    params: { projectId: input.projectId, title, type, ...(specSection ? { specSection } : {}), ...(dueDate ? { dueDate } : {}) },
    row: (id) => ({ id, number: null, title, spec_section: specSection ?? null, type, status: "pending", due_date: dueDate ?? null, review_comments: null }),
  });
}

export const PUNCH_PRIORITIES = ["high", "medium", "low"] as const;

export async function createPunchItemOffline(
  data: ShellData,
  input: { projectId: string; description: string; location?: string | null; trade?: string | null; priority?: string },
  access: SiteWriteAccess = {}
): Promise<SiteWriteResult> {
  if (!canOffer(data.role, 2)) return refuse("not_allowed");
  if (!required(input.description)) return refuse("invalid");
  if (input.priority !== undefined && !(PUNCH_PRIORITIES as readonly string[]).includes(input.priority)) return refuse("invalid");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const description = input.description.trim();
  const location = optText(input.location);
  const trade = optText(input.trade);
  const priority = input.priority ?? "medium";
  return enqueueCreate(ctx, {
    functionId: "create_punch_list_item", projectId: input.projectId, kind: SITE_KINDS.punch, label: "New punch list item",
    params: { projectId: input.projectId, description, priority, ...(location ? { location } : {}), ...(trade ? { trade } : {}) },
    row: (id) => ({ id, number: null, description, location: location ?? null, trade: trade ?? null, priority, status: "open", due_date: null }),
  });
}

export type DiaryInput = {
  projectId: string; diaryDate: string; weather?: string | null; workDone?: string | null; visitors?: string | null; labourCount?: number | null;
  issues?: string | null; instructions?: string | null; materialReceived?: string | null; remarks?: string | null;
};

export async function createSiteDiaryOffline(data: ShellData, input: DiaryInput, access: SiteWriteAccess = {}): Promise<SiteWriteResult> {
  if (!canOffer(data.role, 2)) return refuse("not_allowed");
  if (!isDate(input.diaryDate)) return refuse("invalid");
  const count = input.labourCount;
  if (count !== undefined && count !== null && !(Number.isInteger(count) && count >= 0 && count <= 100000)) return refuse("invalid");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const text = {
    weather: optText(input.weather), workDone: optText(input.workDone), visitors: optText(input.visitors), issues: optText(input.issues),
    instructions: optText(input.instructions), materialReceived: optText(input.materialReceived), remarks: optText(input.remarks),
  };
  const labourCount = typeof count === "number" ? count : undefined;
  const params: Record<string, unknown> = { projectId: input.projectId, diaryDate: input.diaryDate, ...(labourCount !== undefined ? { labourCount } : {}) };
  for (const [k, v] of Object.entries(text)) if (v !== undefined) params[k] = v;
  return enqueueCreate(ctx, {
    functionId: "create_site_diary", projectId: input.projectId, kind: SITE_KINDS.diaries, label: "New site diary entry", params,
    row: (id) => ({
      id, diary_date: input.diaryDate, weather: text.weather ?? null, work_done: text.workDone ?? null, visitors: text.visitors ?? null, issues: text.issues ?? null,
      instructions: text.instructions ?? null, material_received: text.materialReceived ?? null, labour_count: labourCount ?? null, remarks: text.remarks ?? null,
    }),
  });
}

// ─── changes to a row that is already on the laptop ─────────────────────────────────────────────────────────────

const statusOf = (current: unknown): string | null => {
  const s = asRecord(current)?.status;
  return typeof s === "string" ? s : null;
};

export async function answerRfiOffline(data: ShellData, input: { projectId: string; rfiId: string; answer: string }, access: SiteWriteAccess = {}): Promise<SiteWriteResult> {
  if (!canOffer(data.role, 2)) return refuse("not_allowed");
  if (!required(input.answer)) return refuse("invalid");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const answer = input.answer.trim();
  return enqueueEdit(data, ctx, {
    functionId: "answer_rfi", projectId: input.projectId, kind: SITE_KINDS.rfis, id: input.rfiId, label: "Your answer to this RFI",
    params: { projectId: input.projectId, rfiId: input.rfiId, answer }, columns: { answer, status: "answered" },
    guard: (cur) => statusOf(cur) === "open",
  });
}

export async function closeRfiOffline(data: ShellData, input: { projectId: string; rfiId: string }, access: SiteWriteAccess = {}): Promise<SiteWriteResult> {
  if (!canOffer(data.role, 2)) return refuse("not_allowed");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  return enqueueEdit(data, ctx, {
    functionId: "close_rfi", projectId: input.projectId, kind: SITE_KINDS.rfis, id: input.rfiId, label: "Closing this RFI",
    params: { projectId: input.projectId, rfiId: input.rfiId }, columns: { status: "closed" }, guard: (cur) => statusOf(cur) === "answered",
  });
}

export async function markPunchReadyOffline(data: ShellData, input: { projectId: string; itemId: string }, access: SiteWriteAccess = {}): Promise<SiteWriteResult> {
  if (!canOffer(data.role, 2)) return refuse("not_allowed");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  return enqueueEdit(data, ctx, {
    functionId: "mark_punch_item_ready", projectId: input.projectId, kind: SITE_KINDS.punch, id: input.itemId, label: "Marking this item done",
    params: { projectId: input.projectId, itemId: input.itemId }, columns: { status: "ready_for_review" }, guard: (cur) => statusOf(cur) === "open",
  });
}

export async function verifyPunchClosedOffline(data: ShellData, input: { projectId: string; itemId: string }, access: SiteWriteAccess = {}): Promise<SiteWriteResult> {
  if (!canOffer(data.role, 3)) return refuse("not_allowed");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  return enqueueEdit(data, ctx, {
    functionId: "verify_punch_item_closed", projectId: input.projectId, kind: SITE_KINDS.punch, id: input.itemId, label: "Verifying this item closed",
    params: { projectId: input.projectId, itemId: input.itemId }, columns: { status: "verified_closed" }, guard: (cur) => statusOf(cur) === "ready_for_review",
  });
}

export const SUBMITTAL_DECISIONS = ["approved", "approved_as_noted", "revise_resubmit", "rejected"] as const;

export async function reviewSubmittalOffline(
  data: ShellData,
  input: { projectId: string; submittalId: string; status: string; comments?: string | null },
  access: SiteWriteAccess = {}
): Promise<SiteWriteResult> {
  if (!canOffer(data.role, 3)) return refuse("not_allowed");
  if (!(SUBMITTAL_DECISIONS as readonly string[]).includes(input.status)) return refuse("invalid");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const comments = optText(input.comments);
  return enqueueEdit(data, ctx, {
    functionId: "review_submittal", projectId: input.projectId, kind: SITE_KINDS.submittals, id: input.submittalId, label: "Your review of this submittal",
    params: { projectId: input.projectId, submittalId: input.submittalId, status: input.status, ...(comments ? { comments } : {}) },
    columns: { status: input.status, ...(comments ? { review_comments: comments } : {}) }, guard: (cur) => statusOf(cur) === "pending",
  });
}

/** The status after `current` in the FF&E order, or null at the end / for an unknown one. */
export function nextFfeStatus(current: string | null): string | null {
  const i = current === null ? -1 : (FFE_STATUSES as readonly string[]).indexOf(current);
  return i >= 0 && i < FFE_STATUSES.length - 1 ? FFE_STATUSES[i + 1]! : null;
}

export async function advanceFfeOffline(data: ShellData, input: { projectId: string; itemId: string; status: string }, access: SiteWriteAccess = {}): Promise<SiteWriteResult> {
  if (!canOffer(data.role, 3)) return refuse("not_allowed");
  if (!(FFE_STATUSES as readonly string[]).includes(input.status)) return refuse("invalid");
  const ctx = await context(data, input.projectId, access);
  if (!ctx) return refuse("not_on_laptop");
  const row = await editableRow(data, ctx, input.projectId, SITE_KINDS.ffe, input.itemId);
  if (!row) return refuse("unknown_record");
  const item = toLocalFfeItem(row.data, ctxOf);
  // This function is money sensitive on the server: a role that does not receive cost does not get the control either.
  const hiddenForRole = (await hiddenFieldsOf(data, input.projectId)).some((f) => f === "unit_cost" || f === "unit_price");
  if (hiddenForRole) return refuse("cost_hidden");
  if (!item || nextFfeStatus(item.status) !== input.status) return refuse("wrong_state");
  return enqueueEdit(data, ctx, {
    functionId: "update_ffe_status", projectId: input.projectId, kind: SITE_KINDS.ffe, id: input.itemId, label: "Changing this item's status",
    params: { projectId: input.projectId, itemId: input.itemId, status: input.status }, columns: { status: input.status }, guard: () => true,
  });
}

async function hiddenFieldsOf(data: ShellData, projectId: string): Promise<string[]> {
  const { localSyncInfo } = await import("../../local-reader");
  try {
    return (await localSyncInfo(SITE_KINDS.ffe, projectId, { userId: data.userId, idb: data.idb }))?.hiddenFields ?? [];
  } catch {
    return [];
  }
}
