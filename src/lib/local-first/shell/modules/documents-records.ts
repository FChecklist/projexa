// LOCAL-FIRST shell, documents cluster: the ONE reader of document-family rows on this laptop (documents, drawings, permits; the
// minutes of meetings use the same `readKind` with their own row check).
//
// WHAT THE LAPTOP HOLDS. The sync service sends the `documents` kind as the AI work link's curated projection
// (compliance-tracker drizzle/0643, ai_work_link__records_core, kind 'documents'): snake_case keys, exactly
//   id, name, category, file_type, file_size, expiry_date, version_number, is_latest_version, created_at,
//   linked_entity_type, linked_entity_id, metadata
// where `metadata` is a curated object of ONLY these keys of documents.metadata, each as text (nulls left out):
//   drawingNo, rev, status, discipline, supersedesId, permitNumber, permitAuthority, issueDate, isExternalLink.
// Drawings and permits are NOT separate synced kinds (drizzle/0683: "Documents already carry drawings and permits (the same rows, by
// category)"): a drawing is a document of category drawing / drawing_3d, a permit one of category permit.
//
// WHAT IT DOES NOT HOLD (never invented here, listed as GAPS in the package report): the file itself or any URL / storage path to it,
// who uploaded it, a description, tags, the previous-version link of an ordinary document (parent document id), and any permit field
// other than number / authority / issue date / expiry.
//
// The replica's rows are UNTRUSTED input until they look like a document: filter, never cast. A row that is not linked to the project it
// was filed under is skipped. Fields the sync service hid for this person's role (DoneMarker.hiddenFields) are dropped here even if a
// row still carries them, so a screen can never show them.

import { localDbNameFor, openLocalDb } from "../../local-db";
import { loadLocalFirst, localSyncInfo } from "../../local-reader";
import type { ShellData } from "../context";

/** The kind the sync service uses for project documents (drawings and permits included). */
export const DOCUMENTS_KIND = "documents";

export const DRAWING_CATEGORIES: readonly string[] = ["drawing", "drawing_3d"];
export const PERMIT_CATEGORY = "permit";

export type DocumentMeta = {
  drawingNo: string | null;
  rev: string | null;
  status: string | null;
  discipline: string | null;
  supersedesId: string | null;
  permitNumber: string | null;
  permitAuthority: string | null;
  issueDate: string | null;
};

export type LocalDocument = {
  id: string;
  projectId: string;
  name: string;
  category: string | null;
  fileType: string | null;
  /** Bytes; null when not carried or hidden for this role. */
  fileSize: number | null;
  expiryDate: string | null;
  versionNumber: number | null;
  isLatestVersion: boolean | null;
  createdAt: string | null;
  /** The document is a link to somewhere else (no file was uploaded). */
  isExternalLink: boolean;
  meta: DocumentMeta;
  /** A change made on this laptop is waiting to be sent. */
  waiting: boolean;
};

export type KindRead = {
  synced: boolean;
  syncedAt: number | null;
  rows: unknown[];
  hidden: ReadonlySet<string>;
  /** Ids of rows of this kind and project with an edit waiting to be sent. */
  waitingIds: ReadonlySet<string>;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : null);
export const asRecord = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * Rows of one kind of one project, only when that (project, kind) was copied to the end on this laptop. Reads the person's own database
 * (projexa-local:<userId>) and nothing else; never the server.
 */
export async function readKind(data: ShellData, projectId: string, kind: string): Promise<KindRead> {
  const access = { userId: data.userId, idb: data.idb };
  const result = await loadLocalFirst<unknown>(kind, projectId, async () => [], access);
  if (result.state !== "local") return { synced: false, syncedAt: null, rows: [], hidden: new Set(), waitingIds: new Set() };
  let hidden: string[] = [];
  try {
    hidden = (await localSyncInfo(kind, projectId, access))?.hiddenFields ?? [];
  } catch {
    hidden = [];
  }
  return { synced: true, syncedAt: result.syncedAt, rows: result.rows, hidden: new Set(hidden), waitingIds: await waitingIdsOf(data, projectId, kind) };
}

/** Ids of this person's rows of (project, kind) that hold an edit not yet sent. A failure reads as "none waiting", never as an error. */
async function waitingIdsOf(data: ShellData, projectId: string, kind: string): Promise<ReadonlySet<string>> {
  const idb = data.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!idb || !data.orgId) return new Set();
  try {
    const db = await openLocalDb(idb, localDbNameFor(data.userId));
    try {
      const dirty = await db.listDirty(data.orgId);
      return new Set(dirty.filter((r) => r.type === kind && r.projectId === projectId).map((r) => r.id.slice(kind.length + 1)));
    } finally {
      db.close();
    }
  } catch {
    return new Set();
  }
}

function toMeta(v: unknown, hidden: ReadonlySet<string>): DocumentMeta & { isExternalLink: boolean } {
  const m = hidden.has("metadata") ? null : asRecord(v);
  const pick = (k: string) => (m ? text(m[k]) : null);
  return {
    drawingNo: pick("drawingNo"),
    rev: pick("rev"),
    status: pick("status"),
    discipline: pick("discipline"),
    supersedesId: pick("supersedesId"),
    permitNumber: pick("permitNumber"),
    permitAuthority: pick("permitAuthority"),
    issueDate: pick("issueDate"),
    isExternalLink: pick("isExternalLink") === "true",
  };
}

/** A replica row as a document of `projectId`, or null when it does not look like one (or belongs to another project). */
export function toLocalDocument(v: unknown, projectId: string, hidden: ReadonlySet<string> = new Set(), waitingIds: ReadonlySet<string> = new Set()): LocalDocument | null {
  const o = asRecord(v);
  if (!o) return null;
  const id = text(o.id);
  const name = text(o.name);
  if (!id || !name) return null;
  // The projection always carries the link; a row that names another project (or none) is not this project's document.
  if (o.linked_entity_type !== "project" || o.linked_entity_id !== projectId) return null;
  const field = <T>(key: string, read: (x: unknown) => T): T | null => (hidden.has(key) ? null : read(o[key]));
  const { isExternalLink, ...meta } = toMeta(o.metadata, hidden);
  return {
    id,
    projectId,
    name,
    category: field("category", text),
    fileType: field("file_type", text),
    fileSize: field("file_size", num),
    expiryDate: field("expiry_date", text),
    versionNumber: field("version_number", num),
    isLatestVersion: field("is_latest_version", bool),
    createdAt: field("created_at", text),
    isExternalLink,
    meta,
    waiting: waitingIds.has(id),
  };
}

/** Every document of one project on this laptop, untrusted rows skipped. */
export async function readProjectDocuments(data: ShellData, projectId: string): Promise<{ synced: boolean; syncedAt: number | null; docs: LocalDocument[] }> {
  const read = await readKind(data, projectId, DOCUMENTS_KIND);
  if (!read.synced) return { synced: false, syncedAt: null, docs: [] };
  const docs: LocalDocument[] = [];
  for (const row of read.rows) {
    const doc = toLocalDocument(row, projectId, read.hidden, read.waitingIds);
    if (doc) docs.push(doc);
  }
  return { synced: true, syncedAt: read.syncedAt, docs };
}

export const isDrawing = (d: LocalDocument): boolean => d.category !== null && DRAWING_CATEGORIES.includes(d.category);
export const isPermit = (d: LocalDocument): boolean => d.category === PERMIT_CATEGORY;

/** Newest first; ties by name, so the order never depends on how IndexedDB happened to return the rows. */
export function byNewest(a: { createdAt: string | null; name?: string; title?: string }, b: { createdAt: string | null; name?: string; title?: string }): number {
  const ta = a.createdAt ?? "";
  const tb = b.createdAt ?? "";
  if (ta !== tb) return ta < tb ? 1 : -1;
  return (a.name ?? a.title ?? "").localeCompare(b.name ?? b.title ?? "");
}

export type FindResult<T> =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | { state: "found"; projectId: string; syncedAt: number | null; item: T; all: LocalDocument[] };

/**
 * One document by id. `projectId` is where the URL said it lives (?projectId=); without it every project this person has on the laptop
 * is searched, in order, until one holds it (the same rule as the BOQ screen).
 */
export async function findDocument(data: ShellData, id: string, projectId: string | null, accept: (d: LocalDocument) => boolean): Promise<FindResult<LocalDocument>> {
  const candidates = projectId ? [projectId] : data.projects.map((p) => p.id);
  if (candidates.length === 0) return { state: "no_project" };
  let anySynced = false;
  for (const candidate of candidates) {
    const { synced, syncedAt, docs } = await readProjectDocuments(data, candidate);
    if (!synced) continue;
    anySynced = true;
    const item = docs.find((d) => d.id === id && accept(d));
    if (item) return { state: "found", projectId: candidate, syncedAt, item, all: docs };
  }
  return anySynced ? { state: "not_found", projectId } : { state: "not_synced", projectId };
}
