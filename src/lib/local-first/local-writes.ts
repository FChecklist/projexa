// LOCAL-FIRST: the three real writes wired through the outbox (the screens call these, and carry on with their
// normal online request whenever one returns null).
//
//   createRfiLocally   create_rfi    RfiCreateClient        a new RFI
//   answerRfiLocally   answer_rfi    RfiObjectClient        the answer to an RFI
//   updateTaskLocally  update_task   ScheduleTaskObjectClient  a task's title, status, dates, priority, % complete
//
// WHEN THE LOCAL PATH IS TAKEN. All of: the `px-local-first` flag is "1" (local-reader.ts); somebody is signed in; and
// this laptop's copy of that person's workspace knows the project (its stored manifest lists it). For an edit of an
// existing row there is one more: the laptop holds that row at a server version (the edit is based on it, so the server
// can tell a conflict from a plain update). When any of that is missing the function returns null and the caller does
// exactly what it always did -- a failure here must never cost a person their input.
//
// The function ids and parameter names are the AI work link registry's (compliance-tracker
// src/lib/pipeline/function-registry.ts): create_rfi {projectId, subject, question, dueDate?}, answer_rfi {projectId,
// rfiId, answer}, update_task {projectId, issueId, title?, description?, statusId?, priority?, startDate?, dueDate?,
// completionPercentage?}. The laptop only PROPOSES these; the server runs them through the real pipeline with the
// person's live role and decides.
//
// WHAT WORK PROGRESS DOES NOT HAVE (the "record_work_progress" write was asked for and is deliberately NOT wired): that
// function takes {projectId, itemCode | boqLineItemId, percent | quantityDone, entryDate?, remarks?} and the server picks
// the project's FIRST activity itself, and has no entry basis (delta / snapshot). The Daily Entry form collects an
// activity and a basis the person chose; sending its entry through this function would silently record it against a
// different activity. It needs the backend to accept activityId and entryBasis first.

import { localDbNameFor, openLocalDb, type LocalRecord } from "./local-db";
import { isLocalFirstEnabled, resolveLocalUserId } from "./local-reader";
import { MANIFEST_KEY, type StoredManifest } from "./replica";
import type { Outbox } from "./outbox";

/** Injected by tests; the screens pass nothing. */
export type LocalWriteAccess = { userId?: string; idb?: IDBFactory; outbox?: Outbox };

type Ready = { userId: string; orgId: string; idb: IDBFactory; outbox: Outbox };

async function ready(projectId: string, access: LocalWriteAccess): Promise<Ready | null> {
  if (!isLocalFirstEnabled()) return null;
  try {
    const userId = access.userId ?? (await resolveLocalUserId());
    if (!userId) return null;
    const idb = access.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    if (!idb) return null;
    const db = await openLocalDb(idb, localDbNameFor(userId));
    let manifest: StoredManifest | undefined;
    try {
      manifest = await db.getMeta<StoredManifest>(MANIFEST_KEY);
    } finally {
      db.close();
    }
    if (!manifest || manifest.userId !== userId || !manifest.projectIds.includes(projectId)) return null;
    const outbox = access.outbox ?? (await import("./outbox-shared")).getSharedOutbox(userId);
    return { userId, orgId: manifest.orgId, idb, outbox };
  } catch {
    return null;
  }
}

async function readRow(ctx: Ready, kind: string, id: string): Promise<LocalRecord | undefined> {
  const db = await openLocalDb(ctx.idb, localDbNameFor(ctx.userId));
  try {
    return await db.getRecord(kind, id);
  } finally {
    db.close();
  }
}

/** The row the laptop holds, if it is this organisation's, belongs to this project and carries a server version. */
async function editableRow(ctx: Ready, kind: string, id: string, projectId: string): Promise<(LocalRecord & { serverVersion: number }) | null> {
  const row = await readRow(ctx, kind, id);
  if (!row || row.orgId !== ctx.orgId || row.projectId !== projectId || typeof row.serverVersion !== "number") return null;
  return row as LocalRecord & { serverVersion: number };
}

const asObject = (data: unknown): Record<string, unknown> => (typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {});

// ─── create_rfi ───────────────────────────────────────────────────────────────────────────────────────────────

export type NewRfi = { projectId: string; subject: string; question: string; dueDate?: string };

/** Queues a new RFI. The row appears in the RFI list at once (with a temporary id) and is replaced by the real one when applied. */
export async function createRfiLocally(input: NewRfi, access: LocalWriteAccess = {}): Promise<{ queued: true; opId: string; tempId: string } | null> {
  const ctx = await ready(input.projectId, access);
  if (!ctx) return null;
  const tempId = `local-${crypto.randomUUID()}`;
  try {
    const { opId } = await ctx.outbox.enqueue({
      functionId: "create_rfi",
      projectId: input.projectId,
      params: { projectId: input.projectId, subject: input.subject, question: input.question, ...(input.dueDate ? { dueDate: input.dueDate } : {}) },
      label: "New RFI",
      creates: { kind: "rfis", id: tempId },
      optimistic: async (tx) => {
        await tx.putRecord({
          id: `rfis:${tempId}`, type: "rfis", orgId: ctx.orgId, projectId: input.projectId,
          // The shape RfisClient reads. The number is the server's to assign.
          data: { id: tempId, projectId: input.projectId, number: null, subject: input.subject, question: input.question, status: "open", ballInCourt: "", answer: null, dueDate: input.dueDate ?? null },
        });
      },
    });
    return { queued: true, opId, tempId };
  } catch {
    return null;
  }
}

// ─── answer_rfi ───────────────────────────────────────────────────────────────────────────────────────────────

/** Queues the answer to an RFI the laptop holds. Null when it does not hold it (then the normal online answer is used). */
export async function answerRfiLocally(input: { projectId: string; rfiId: string; answer: string }, access: LocalWriteAccess = {}): Promise<{ queued: true; opId: string } | null> {
  const ctx = await ready(input.projectId, access);
  if (!ctx) return null;
  try {
    const row = await editableRow(ctx, "rfis", input.rfiId, input.projectId);
    if (!row) return null;
    const { opId } = await ctx.outbox.enqueue({
      functionId: "answer_rfi",
      projectId: input.projectId,
      params: { projectId: input.projectId, rfiId: input.rfiId, answer: input.answer },
      label: "Your answer to this RFI",
      record: { kind: "rfis", id: input.rfiId, baseVersion: row.serverVersion },
      optimistic: async (tx) => {
        const current = await tx.getRecord("rfis", input.rfiId);
        if (current) await tx.patchRecord("rfis", input.rfiId, { data: { ...asObject(current.data), answer: input.answer, status: "answered" } });
      },
    });
    return { queued: true, opId };
  } catch {
    return null;
  }
}

// ─── update_task ──────────────────────────────────────────────────────────────────────────────────────────────

/** The fields of a task the Object Page edits (the registry's update_task parameter names). */
export type TaskPatch = {
  title?: string;
  description?: string | null;
  priority?: string;
  statusId?: string;
  startDate?: string | null;
  dueDate?: string | null;
  completionPercentage?: number;
};

/** Queues a task edit based on the version the laptop holds. Null when it holds no such task (then the normal online save is used). */
export async function updateTaskLocally(input: { projectId: string; taskId: string; patch: TaskPatch }, access: LocalWriteAccess = {}): Promise<{ queued: true; opId: string } | null> {
  const ctx = await ready(input.projectId, access);
  if (!ctx) return null;
  try {
    const row = await editableRow(ctx, "tasks", input.taskId, input.projectId);
    if (!row) return null;
    const { opId } = await ctx.outbox.enqueue({
      functionId: "update_task",
      projectId: input.projectId,
      params: { projectId: input.projectId, issueId: input.taskId, ...input.patch },
      label: "Your change to this task",
      record: { kind: "tasks", id: input.taskId, baseVersion: row.serverVersion },
      optimistic: async (tx) => {
        const current = await tx.getRecord("tasks", input.taskId);
        if (current) await tx.patchRecord("tasks", input.taskId, { data: { ...asObject(current.data), ...input.patch } });
      },
    });
    return { queued: true, opId };
  } catch {
    return null;
  }
}
