// LOCAL-FIRST shell: adding a PERMIT, a DRAWING or a DOCUMENT (a record and its file) on the laptop (G-15).
//
// The person adds it; the file and the typed fields are kept as a job (shell/file-queue.ts); when the laptop is connected the bytes are uploaded
// and ONLY THEN is the record put in the outbox as the registry's create_permit / create_drawing / create_document, carrying the file's address
// as `externalUrl` (the registry takes a link, not a file). This file is the thin layer between the screens and that queue:
//
//   addFileRecordOffline(data, kind, input, queue)   validates in plain words, then queue.add(...)
//   enqueueFileRecord(data, job, deps)                the queue's step 2: job + externalUrl -> the outbox op
//
// Parameter names are the registry's (function-registry.generated.json), checked by ai/registry-contract.test.ts. create_document is
// ORGANISATION-wide: it has no projectId parameter, so none is sent (the op still belongs to the project it was made in, for routing).
// The server decides everything that matters: the role, the number, whether the address is acceptable.

import type { EnqueueInput } from "../../outbox";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, type StoredManifest } from "../../replica";
import type { ShellData } from "../context";
import type { FileJob, FileJobKind, FileQueue } from "../file-queue";
import { canProposeEdits, documentsWriteDeps, type OutboxPort } from "./documents-writes";

export type FileWriteResult = { ok: true; jobId: string } | { ok: false; message: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const text = (v: unknown, max = 200): string | undefined => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : undefined);

export type PermitFields = { name: string; permitNumber: string; permitAuthority: string; expiryDate: string; issueDate?: string | null };
export type DrawingFields = { name: string; drawingNo?: string | null; rev?: string | null; discipline?: string | null; kind?: string | null; status?: string | null };
export type DocumentFields = { name: string; category: string; expiryDate?: string | null };
export type FileRecordFields = { permit: PermitFields; drawing: DrawingFields; document: DocumentFields };

/** The words for the three kinds, for screens and messages. */
export const FILE_KIND_WORDS: Record<FileJobKind, { one: string; label: string }> = {
  permit: { one: "permit", label: "New permit" },
  drawing: { one: "drawing", label: "New drawing" },
  document: { one: "document", label: "New document" },
};

/** What the person typed, cleaned and checked: null and a sentence when something the server would refuse is wrong. */
export function checkFields<K extends FileJobKind>(kind: K, f: FileRecordFields[K]): { ok: true; fields: Record<string, unknown> } | { ok: false; message: string } {
  const name = text((f as { name?: unknown }).name, 200);
  if (!name) return { ok: false, message: `Give the ${kind} a name (up to 200 letters).` };
  if (kind === "permit") {
    const p = f as PermitFields;
    const permitNumber = text(p.permitNumber);
    const permitAuthority = text(p.permitAuthority);
    if (!permitNumber) return { ok: false, message: "Give the permit number." };
    if (!permitAuthority) return { ok: false, message: "Say who issued the permit." };
    if (!isDate(p.expiryDate)) return { ok: false, message: "Choose the date the permit expires." };
    const issue = typeof p.issueDate === "string" && p.issueDate.trim() ? p.issueDate.trim() : undefined;
    if (issue && (!isDate(issue) || issue > p.expiryDate)) return { ok: false, message: "The issue date must be a real date on or before the expiry date." };
    return { ok: true, fields: { name, permitNumber, permitAuthority, expiryDate: p.expiryDate, ...(issue ? { issueDate: issue } : {}) } };
  }
  if (kind === "drawing") {
    const d = f as DrawingFields;
    const extras: Record<string, string | null | undefined> = { drawingNo: d.drawingNo, rev: d.rev, discipline: d.discipline, kind: d.kind, status: d.status };
    const clean: Record<string, string> = {};
    for (const [key, raw] of Object.entries(extras)) {
      if (raw === undefined || raw === null || raw.trim() === "") continue;
      const v = text(raw);
      if (v === undefined) return { ok: false, message: "A drawing detail is too long (up to 200 letters)." };
      clean[key] = v;
    }
    return { ok: true, fields: { name, ...clean } };
  }
  const doc = f as DocumentFields;
  const category = text(doc.category, 100);
  if (!category) return { ok: false, message: "Choose a category for the document." };
  const expiry = typeof doc.expiryDate === "string" && doc.expiryDate.trim() ? doc.expiryDate.trim() : undefined;
  if (expiry && !isDate(expiry)) return { ok: false, message: "Choose a real expiry date, or leave it empty." };
  return { ok: true, fields: { name, category, ...(expiry ? { expiryDate: expiry } : {}) } };
}

const FUNCTION_FOR: Record<FileJobKind, string> = { permit: "create_permit", drawing: "create_drawing", document: "create_document" };

/** The op a finished job becomes. Exported for the contract test. */
export function recordOp(job: Pick<FileJob, "kind" | "projectId" | "fields"> & { externalUrl: string }): { functionId: string; params: Record<string, unknown>; label: string } {
  const withProject = job.kind === "document" ? {} : { projectId: job.projectId }; // create_document is organisation-wide: no projectId parameter
  return { functionId: FUNCTION_FOR[job.kind], params: { ...withProject, ...job.fields, externalUrl: job.externalUrl }, label: FILE_KIND_WORDS[job.kind].label };
}

/** The queue's step 2: the record goes into this person's outbox (kept on the laptop; pushed when connected). */
export async function enqueueFileRecord(data: ShellData, job: FileJob & { externalUrl: string }, deps: { outbox?: OutboxPort } = {}): Promise<void> {
  const op = recordOp(job);
  const outbox = deps.outbox ?? documentsWriteDeps.outbox ?? (await import("../../outbox-shared")).getSharedOutbox(data.userId);
  const input: EnqueueInput = { functionId: op.functionId, projectId: job.projectId, params: op.params, label: op.label };
  await outbox.enqueue(input);
}

/** Is this project on this laptop, for this person and organisation? (the same check every offline writer makes) */
async function onThisLaptop(data: ShellData, projectId: string): Promise<boolean> {
  const idb = data.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!idb || !data.orgId) return false;
  const db = await openLocalDb(idb, localDbNameFor(data.userId));
  try {
    const manifest = await db.getMeta<StoredManifest | null>(MANIFEST_KEY);
    return !!manifest && manifest.userId === data.userId && manifest.orgId === data.orgId && manifest.projectIds.includes(projectId);
  } finally {
    db.close();
  }
}

export async function addFileRecordOffline<K extends FileJobKind>(
  data: ShellData,
  kind: K,
  input: { projectId: string; fields: FileRecordFields[K]; file: Blob | null | undefined; fileName?: string },
  queue: Pick<FileQueue, "add">
): Promise<FileWriteResult> {
  const word = FILE_KIND_WORDS[kind].one;
  if (!canProposeEdits(data.role)) return { ok: false, message: `Your role can read these but not add a ${word}.` };
  const checked = checkFields(kind, input.fields);
  if (!checked.ok) return checked;
  if (!input.file || input.file.size <= 0) return { ok: false, message: `Choose the file for this ${word}.` };
  if (!(await onThisLaptop(data, input.projectId))) return { ok: false, message: "This project is not saved on this laptop, so nothing can be added here. Open it while you are online." };
  const fileName = (input.fileName ?? (input.file as File).name ?? "").trim();
  const job = await queue.add({ kind, projectId: input.projectId, fields: checked.fields, file: input.file, fileName });
  if (!job) return { ok: false, message: "This file is empty, has no name, or is larger than 25 MB, which is the most this laptop keeps to send later. Add it while you are online." };
  return { ok: true, jobId: job.id };
}
