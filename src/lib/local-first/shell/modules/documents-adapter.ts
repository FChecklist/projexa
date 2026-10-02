// LOCAL-FIRST shell, Documents (/documents, /documents/:id): the project's documents, read from the laptop's own copy.
//
// The online list (DocumentsClient, DOCUMENTS_LIST_COLUMNS) shows Name, Category, Type, Size, Expiry, Added: every one of those is in
// the synced `documents` projection (documents-records.ts), so the offline list shows the same columns. Drawings and permits are
// documents too (by category) and the online Documents list shows them as well, so this list does not hide them.
//
// The file itself is NOT on the laptop unless the person kept it (documents-file-cache.ts); the object screen says so plainly.

import type { ShellData } from "../context";
import { byNewest, findDocument, readProjectDocuments, type LocalDocument } from "./documents-records";

export type DocumentsListData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | { state: "local"; projectId: string; syncedAt: number | null; rows: LocalDocument[] };

export type DocumentObjectData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | {
      state: "local";
      projectId: string;
      syncedAt: number | null;
      doc: LocalDocument;
      /** Other documents of the project with the same name: the closest the laptop can come to a version list (see GAPS). */
      sameName: LocalDocument[];
    };

export async function loadDocumentsList(data: ShellData, projectId: string | null): Promise<DocumentsListData> {
  if (!projectId) return { state: "no_project" };
  const { synced, syncedAt, docs } = await readProjectDocuments(data, projectId);
  if (!synced) return { state: "not_synced", projectId };
  return { state: "local", projectId, syncedAt, rows: [...docs].sort(byNewest) };
}

export async function loadDocumentObject(data: ShellData, id: string, projectId: string | null): Promise<DocumentObjectData> {
  const found = await findDocument(data, id, projectId, () => true);
  if (found.state !== "found") return found;
  const sameName = found.all
    .filter((d) => d.id !== found.item.id && d.name === found.item.name)
    .sort((a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0) || byNewest(a, b));
  return { state: "local", projectId: found.projectId, syncedAt: found.syncedAt, doc: found.item, sameName };
}
