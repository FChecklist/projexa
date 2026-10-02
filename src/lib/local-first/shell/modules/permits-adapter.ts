// LOCAL-FIRST shell, Permits (/permits, /permits/:id): the project's permits, read from the laptop's own copy.
//
// A permit is a project document of category `permit`; its number, issuing authority and issue date live in the curated metadata the
// sync carries, its end date is the document's expiry_date (the server's own permit DTO does the same: endDate = documents.expiry_date).
// "Days to expiry" is computed exactly as the server computes it (ceil of the difference in days from now) and is display only; the
// status words reuse the online list's own permitStatus(). A permit has no status field of its own anywhere.
//
// NOT ON THE LAPTOP (GAPS): the permit's notes and tags (online object page), and whether a file is behind it (`hasDocument`: the sync
// does not carry the file's storage path). The file itself is handled by documents-file-cache.ts.

import type { ShellData } from "../context";
import { findDocument, isPermit, readProjectDocuments, type LocalDocument } from "./documents-records";

const DAY_MS = 1000 * 60 * 60 * 24;

export type LocalPermit = {
  id: string;
  projectId: string;
  name: string;
  permitNumber: string | null;
  permitAuthority: string | null;
  issueDate: string | null;
  endDate: string | null;
  daysToExpiry: number | null;
  isExternalLink: boolean;
  createdAt: string | null;
  waiting: boolean;
  doc: LocalDocument;
};

export type PermitsListData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | { state: "local"; projectId: string; syncedAt: number | null; rows: LocalPermit[]; withinDays: number | null };

export type PermitObjectData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | { state: "local"; projectId: string; syncedAt: number | null; permit: LocalPermit };

export function daysToExpiry(endDate: string | null, now: number): number | null {
  if (!endDate) return null;
  const end = new Date(endDate).getTime();
  return Number.isFinite(end) ? Math.ceil((end - now) / DAY_MS) : null;
}

export function toLocalPermit(d: LocalDocument, now: number): LocalPermit {
  return {
    id: d.id,
    projectId: d.projectId,
    name: d.name,
    permitNumber: d.meta.permitNumber,
    permitAuthority: d.meta.permitAuthority,
    issueDate: d.meta.issueDate,
    endDate: d.expiryDate,
    daysToExpiry: daysToExpiry(d.expiryDate, now),
    isExternalLink: d.isExternalLink,
    createdAt: d.createdAt,
    waiting: d.waiting,
    doc: d,
  };
}

/** Soonest end date first (the online list's order); permits without an end date last. */
export function byEndDate(a: LocalPermit, b: LocalPermit): number {
  if (a.daysToExpiry === null && b.daysToExpiry === null) return a.name.localeCompare(b.name);
  if (a.daysToExpiry === null) return 1;
  if (b.daysToExpiry === null) return -1;
  return a.daysToExpiry - b.daysToExpiry || a.name.localeCompare(b.name);
}

/** `withinDays` (the dashboard's "expiring" link, ?withinDays=30) keeps permits ending within that many days, expired ones included. */
export function parseWithinDays(raw: string | null): number | null {
  if (raw === null || !/^\d{1,4}$/.test(raw)) return null;
  return Number(raw);
}

export async function loadPermitsList(data: ShellData, projectId: string | null, withinDaysRaw: string | null = null, now: number = Date.now()): Promise<PermitsListData> {
  if (!projectId) return { state: "no_project" };
  const { synced, syncedAt, docs } = await readProjectDocuments(data, projectId);
  if (!synced) return { state: "not_synced", projectId };
  const withinDays = parseWithinDays(withinDaysRaw);
  let rows = docs.filter(isPermit).map((d) => toLocalPermit(d, now));
  if (withinDays !== null) rows = rows.filter((p) => p.daysToExpiry !== null && p.daysToExpiry <= withinDays);
  return { state: "local", projectId, syncedAt, rows: rows.sort(byEndDate), withinDays };
}

export async function loadPermitObject(data: ShellData, id: string, projectId: string | null, now: number = Date.now()): Promise<PermitObjectData> {
  const found = await findDocument(data, id, projectId, isPermit);
  if (found.state !== "found") return found;
  return { state: "local", projectId: found.projectId, syncedAt: found.syncedAt, permit: toLocalPermit(found.item, now) };
}
