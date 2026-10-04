// LOCAL-FIRST shell, Drawings (/drawings, /drawings/:id): the project's drawing register, read from the laptop's own copy.
//
// A drawing is a project document of category `drawing` (an uploaded DWG/DXF/PDF, shown online as "DWG") or `drawing_3d` (a 3D
// walkthrough, shown online as "3D Walkthrough"); its register fields (drawingNo, rev, status, discipline, supersedesId) live in the
// curated metadata the sync carries (documents-records.ts). Status words come from the app's own vocabulary (src/lib/drawing-status.ts:
// a drawing with no status reads "For approval", never "Current", exactly as online).
//
// REVISION HISTORY. The online object page shows only the one revision a drawing supersedes. The laptop holds the whole register, so the
// object screen here also lists the drawing's revision chain: every drawing linked to it through supersedesId (either direction, any
// depth) or carrying the same drawing number. It is derived only from rows already on the laptop; nothing is invented.

import { normaliseDrawingStatus, type DrawingStatus } from "@/lib/drawing-status";
import type { ShellData } from "../context";
import { findDocument, isDrawing, readProjectDocuments, type LocalDocument } from "./documents-records";

export type LocalDrawing = LocalDocument & { kindLabel: "DWG" | "3D Walkthrough"; status: DrawingStatus };

export type DrawingsListData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | { state: "local"; projectId: string; syncedAt: number | null; rows: LocalDrawing[] };

export type DrawingObjectData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | {
      state: "local";
      projectId: string;
      syncedAt: number | null;
      drawing: LocalDrawing;
      /** The revision this one replaced, when it is on the laptop. */
      supersedes: LocalDrawing | null;
      /** The whole revision chain (this drawing included), newest first. */
      history: LocalDrawing[];
    };

export function toLocalDrawing(d: LocalDocument): LocalDrawing {
  return { ...d, kindLabel: d.category === "drawing_3d" ? "3D Walkthrough" : "DWG", status: normaliseDrawingStatus(d.meta.status) };
}

/** Register order: by drawing number (drawings without one last), then newest revision first, then name. */
export function registerOrder(a: LocalDrawing, b: LocalDrawing): number {
  const na = a.meta.drawingNo;
  const nb = b.meta.drawingNo;
  if (na !== nb) {
    if (na === null) return 1;
    if (nb === null) return -1;
    return na.localeCompare(nb, undefined, { numeric: true });
  }
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || a.name.localeCompare(b.name);
}

/** Every drawing connected to `start` by a supersedes link (either direction, any depth) or the same drawing number. */
export function revisionChain(start: LocalDrawing, all: readonly LocalDrawing[]): LocalDrawing[] {
  const seen = new Set<string>([start.id]);
  const queue: LocalDrawing[] = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const other of all) {
      if (seen.has(other.id)) continue;
      const linked =
        other.id === current.meta.supersedesId ||
        other.meta.supersedesId === current.id ||
        (current.meta.drawingNo !== null && other.meta.drawingNo === current.meta.drawingNo);
      if (linked) {
        seen.add(other.id);
        queue.push(other);
      }
    }
  }
  return all.filter((d) => seen.has(d.id)).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id.localeCompare(a.id));
}

export async function loadDrawingsList(data: ShellData, projectId: string | null): Promise<DrawingsListData> {
  if (!projectId) return { state: "no_project" };
  const { synced, syncedAt, docs } = await readProjectDocuments(data, projectId);
  if (!synced) return { state: "not_synced", projectId };
  return { state: "local", projectId, syncedAt, rows: docs.filter(isDrawing).map(toLocalDrawing).sort(registerOrder) };
}

export async function loadDrawingObject(data: ShellData, id: string, projectId: string | null): Promise<DrawingObjectData> {
  const found = await findDocument(data, id, projectId, isDrawing);
  if (found.state !== "found") return found;
  const drawings = found.all.filter(isDrawing).map(toLocalDrawing);
  const drawing = toLocalDrawing(found.item);
  const supersedes = drawing.meta.supersedesId ? drawings.find((d) => d.id === drawing.meta.supersedesId) ?? null : null;
  return { state: "local", projectId: found.projectId, syncedAt: found.syncedAt, drawing, supersedes, history: revisionChain(drawing, drawings) };
}
