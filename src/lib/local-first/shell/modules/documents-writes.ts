// LOCAL-FIRST shell, documents cluster: the writes these screens can make on the laptop, through the OUTBOX (outbox.ts): kept on the
// laptop at once (the row is patched in the same transaction, so the screen shows it straight away and marks it "waiting"), pushed to the
// sync service when the laptop can reach it, and decided THERE by the real AI-work-link pipeline with the person's live role.
//
// ONLY functions of the AI work link registry (compliance-tracker supabase/functions/ai-work-link/function-registry.generated.json):
//   update_mom_minutes        {projectId, meetingId, minutes}                          "Amend the minutes"         record meeting_minutes
//   update_document_metadata  {projectId, documentId, name?, category?, expiryDate?}   "Edit a document's details" record documents
// update_document_metadata is used by three screens, each sending only the fields its online screen lets a person change AND the function
// takes: Documents (name, category, expiry), Permits (name, end date = expiry; never category, which would move it out of the permits),
// Drawings (name; the online "discipline" edit has no registered function, see GAPS).
//
// WHAT IS NOT WIRED (no registered function, or one that does not match the online screen): uploading a file, a new document version, a
// new permit / drawing / MoM with a file (create_permit and create_drawing take a LINK, not a file; create_document is org-wide, without a
// projectId), permit number / authority / issue date, drawing discipline / status / revision, MoM details (title, type, time, attendees,
// agenda), publish & lock, delete, dispose, action items (add_meeting_action_item needs an assignee picker fed by org people, which the
// laptop does not consume yet), share links, the AI summary. Those screens say plainly that the change needs a connection.
//
// This file does not reuse local-writes.ts because its `ready()` is private and gated by the px-local-first flag (the shell is never
// gated); it repeats the same checks: the person's own database, the manifest lists the project, the row is this organisation's, of this
// project, and carries a server version (so the server can tell a conflict from a plain update). Nothing is decided here: the server's
// role gate, the published-minutes lock and conflict detection all run on the server; the laptop only declines to OFFER what the online
// screen does not offer either.

import { localDbNameFor, openLocalDb, type LocalRecord } from "../../local-db";
import { MANIFEST_KEY, type StoredManifest } from "../../replica";
import type { EnqueueInput } from "../../outbox";
import type { ShellData } from "../context";
import { DOCUMENTS_KIND, asRecord } from "./documents-records";
import { MEETING_MINUTES_KIND, isPublished, toLocalMom } from "./moms-adapter";

/** The one outbox method these writes use (tests inject a real outbox or a recorder). */
export type OutboxPort = { enqueue(input: EnqueueInput): Promise<{ opId: string }> };

export type WriteResult = { ok: true; opId: string } | { ok: false; message: string };

/** Roles the AI work link ranks 1 (read only, ai_work_link__role_rank). For them the screens do not offer an edit; the server would refuse. */
const READ_ONLY_ROLES = new Set(["viewer", "client_viewer", "external_auditor", "stage_0"]);
export function canProposeEdits(role: string | null): boolean {
  return !(role !== null && READ_ONLY_ROLES.has(role));
}

/** Render tests set `outbox` here to run the screens against a test outbox; the app leaves it empty (the person's shared outbox). */
export const documentsWriteDeps: { outbox?: OutboxPort } = {};

async function defaultOutbox(userId: string): Promise<OutboxPort> {
  return documentsWriteDeps.outbox ?? (await import("../../outbox-shared")).getSharedOutbox(userId);
}

const NOT_HERE = "This is not saved on this laptop, so it cannot be changed here. Open it while you are online.";

/** The row the laptop holds when it may be edited here: this person's, this organisation's, this project's, with a server version. */
async function editableRow(data: ShellData, projectId: string, kind: string, id: string): Promise<(LocalRecord & { serverVersion: number }) | null> {
  const idb = data.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!idb) return null;
  const db = await openLocalDb(idb, localDbNameFor(data.userId));
  try {
    const manifest = await db.getMeta<StoredManifest | null>(MANIFEST_KEY);
    if (!manifest || manifest.userId !== data.userId || !manifest.projectIds.includes(projectId)) return null;
    if (data.orgId && manifest.orgId !== data.orgId) return null;
    const row = await db.getRecord(kind, id);
    if (!row || row.orgId !== manifest.orgId || row.projectId !== projectId || typeof row.serverVersion !== "number") return null;
    return row as LocalRecord & { serverVersion: number };
  } finally {
    db.close();
  }
}

// ─── update_mom_minutes ─────────────────────────────────────────────────────────────────────────────────────────

export async function amendMinutesOffline(
  data: ShellData,
  input: { projectId: string; meetingId: string; minutes: string },
  deps: { outbox?: OutboxPort } = {}
): Promise<WriteResult> {
  if (!canProposeEdits(data.role)) return { ok: false, message: "Your role can read these minutes but not change them." };
  try {
    const row = await editableRow(data, input.projectId, MEETING_MINUTES_KIND, input.meetingId);
    if (!row) return { ok: false, message: NOT_HERE };
    const mom = toLocalMom(row.data, input.projectId);
    if (!mom) return { ok: false, message: NOT_HERE };
    if (isPublished(mom)) return { ok: false, message: "These minutes are published and locked. They cannot be amended." };
    const outbox = deps.outbox ?? (await defaultOutbox(data.userId));
    const { opId } = await outbox.enqueue({
      functionId: "update_mom_minutes",
      projectId: input.projectId,
      params: { projectId: input.projectId, meetingId: input.meetingId, minutes: input.minutes },
      label: "Your amendment to these minutes",
      record: { kind: MEETING_MINUTES_KIND, id: input.meetingId, baseVersion: row.serverVersion },
      optimistic: async (tx) => {
        const current = await tx.getRecord(MEETING_MINUTES_KIND, input.meetingId);
        if (current) await tx.patchRecord(MEETING_MINUTES_KIND, input.meetingId, { data: { ...(asRecord(current.data) ?? {}), minutes: input.minutes } });
      },
    });
    return { ok: true, opId };
  } catch {
    return { ok: false, message: "This change could not be kept on this laptop. Nothing was lost on the server; try again." };
  }
}

// ─── update_document_metadata ───────────────────────────────────────────────────────────────────────────────────

/** Which details each screen may send (what its online screen edits, intersected with what the function takes). */
export const DETAIL_FIELDS = {
  documents: ["name", "category", "expiryDate"],
  permits: ["name", "expiryDate"],
  drawings: ["name"],
} as const satisfies Record<string, readonly ("name" | "category" | "expiryDate")[]>;

export type DetailsScreen = keyof typeof DETAIL_FIELDS;
export type DocumentDetails = { name?: string; category?: string; expiryDate?: string | null };

/** The registry's parameter -> the synced projection's column (for the optimistic copy on this laptop). */
const COLUMN: Record<"name" | "category" | "expiryDate", string> = { name: "name", category: "category", expiryDate: "expiry_date" };

export async function editDocumentDetailsOffline(
  data: ShellData,
  screen: DetailsScreen,
  input: { projectId: string; documentId: string; details: DocumentDetails },
  deps: { outbox?: OutboxPort } = {}
): Promise<WriteResult> {
  if (!canProposeEdits(data.role)) return { ok: false, message: "Your role can read this but not change it." };
  const allowed: readonly string[] = DETAIL_FIELDS[screen];
  const params: Record<string, unknown> = {};
  const columns: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.details) as [keyof DocumentDetails, unknown][]) {
    if (!allowed.includes(key) || value === undefined) continue;
    if (key === "name") {
      if (typeof value !== "string" || value.trim() === "") return { ok: false, message: "A name is needed." };
      params.name = value.trim();
    } else if (key === "category") {
      if (typeof value !== "string" || value.trim() === "") return { ok: false, message: "A category is needed." };
      params.category = value.trim();
    } else {
      if (value !== null && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value) || !Number.isFinite(Date.parse(value)))) return { ok: false, message: "That date is not a date." };
      params.expiryDate = value;
    }
    columns[COLUMN[key]] = params[key];
  }
  if (Object.keys(params).length === 0) return { ok: false, message: "Nothing to change." };
  try {
    const row = await editableRow(data, input.projectId, DOCUMENTS_KIND, input.documentId);
    if (!row) return { ok: false, message: NOT_HERE };
    const outbox = deps.outbox ?? (await defaultOutbox(data.userId));
    const { opId } = await outbox.enqueue({
      functionId: "update_document_metadata",
      projectId: input.projectId,
      params: { projectId: input.projectId, documentId: input.documentId, ...params },
      label: screen === "permits" ? "Your change to this permit" : screen === "drawings" ? "Your change to this drawing" : "Your change to this document",
      record: { kind: DOCUMENTS_KIND, id: input.documentId, baseVersion: row.serverVersion },
      optimistic: async (tx) => {
        const current = await tx.getRecord(DOCUMENTS_KIND, input.documentId);
        if (current) await tx.patchRecord(DOCUMENTS_KIND, input.documentId, { data: { ...(asRecord(current.data) ?? {}), ...columns } });
      },
    });
    return { ok: true, opId };
  } catch {
    return { ok: false, message: "This change could not be kept on this laptop. Nothing was lost on the server; try again." };
  }
}
