// LOCAL-FIRST shell, the first module: Scope of Work (BOQ), read from the laptop's own database.
//
// REUSE, not a rewrite. The reading goes through the same code the online BOQ screen uses when px-local-first is on
// (src/lib/local-first/local-reader.ts + boq-local.ts): loadLocalFirst() (rows only when that (project, kind) was pulled to the end),
// the `boq_lines` + `boqs` kinds, linesFromReplica() (replica rows are untrusted input until they map to a BOQ line; the sync service
// sends them in its own snake_case shape, review F09), and the screen's own row
// mapping and ordering (toBoqLineItemRow, orderLinesForBoq, boqTotal). What differs: this adapter is not gated by the px-local-first
// flag (the shell is only ever shown when it should be), it never falls back to the server (a screen that is not on the laptop says
// so), and it lays the person's waiting edits over the rows (pending-edits.ts).
//
// WHAT STAYS ON THE SERVER, as in boq-local.ts: submit/approve, revisions, and the money grid. Local rows are for reading, display and
// the person's own category edits; the server's role gate and rules decide every write when it is sent.

import type { Boq, BoqLineItemRow } from "@/lib/boq-helpers";
import { boqTotal } from "@/lib/boq-helpers";
import type { GatewayBoqLine } from "@/lib/boq-gateway-client";
import { orderLinesForBoq, toBoqLineItemRow } from "@/lib/boq-read-source";
import { BOQ_LINES_KIND, BOQS_KIND, linesFromReplica } from "../../boq-local";
import { loadLocalFirst } from "../../local-reader";
import type { ShellData } from "../context";
import { applyPendingEdits, type PendingEdit } from "../pending-edits";

export type BoqListRow = {
  id: string;
  title: string;
  version: number;
  status: string;
  lineCount: number;
  total: number;
};

export type ScopeListData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | { state: "local"; projectId: string; rows: BoqListRow[]; syncedAt: number | null };

export type ScopeObjectData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | {
      state: "local";
      boq: Boq;
      lines: BoqLineItemRow[];
      total: number;
      syncedAt: number | null;
      /** Ids of lines whose category edit is waiting to be sent. */
      waitingLineIds: string[];
      /** G-14: edits the server refused because someone else changed the same field meanwhile; the person chooses (mine / theirs). */
      conflicts?: { editId: string; lineId: string; mine: string | null; theirs: string | null }[];
    };

/**
 * A project's BOQ lines from the laptop, in the screen's shape. The sync service sends `boq_lines` in its own snake_case shape without the
 * BOQ's title/version/status, which are the `boqs` kind (review F09): both kinds are read and joined by linesFromReplica (boq-local.ts).
 * "Synced" means the lines were pulled to the end on this laptop; a line whose BOQ header row is not (yet) on the laptop is not drawn.
 */
async function readProjectLines(data: ShellData, projectId: string): Promise<{ lines: GatewayBoqLine[]; synced: boolean; syncedAt: number | null }> {
  const access = { userId: data.userId, idb: data.idb };
  const result = await loadLocalFirst<unknown>(BOQ_LINES_KIND, projectId, async () => [], access);
  if (result.state !== "local") return { lines: [], synced: false, syncedAt: null };
  const headers = await loadLocalFirst<unknown>(BOQS_KIND, projectId, async () => [], access);
  return { lines: linesFromReplica(result.rows, headers.state === "local" ? headers.rows : []), synced: true, syncedAt: result.syncedAt };
}

/** The BOQs of one project, derived from its lines (the replica holds lines, each carrying its BOQ's title, version and status). */
export function groupBoqs(lines: readonly GatewayBoqLine[]): BoqListRow[] {
  const byBoq = new Map<string, GatewayBoqLine[]>();
  for (const line of lines) {
    const list = byBoq.get(line.boqId) ?? [];
    list.push(line);
    byBoq.set(line.boqId, list);
  }
  const rows: BoqListRow[] = [];
  for (const [id, own] of byBoq) {
    const first = own[0]!;
    rows.push({ id, title: first.boqTitle, version: first.boqVersion, status: first.boqStatus, lineCount: own.length, total: boqTotal(own.map(toBoqLineItemRow)) });
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title) || b.version - a.version);
}

export async function loadScopeList(data: ShellData, projectId: string | null): Promise<ScopeListData> {
  if (!projectId) return { state: "no_project" };
  const { lines, synced, syncedAt } = await readProjectLines(data, projectId);
  if (!synced) return { state: "not_synced", projectId };
  return { state: "local", projectId, rows: groupBoqs(lines), syncedAt };
}

/**
 * One BOQ with its lines. `projectId` is where the URL said it lives (?projectId=); without it every project this person has on the
 * laptop is searched, in order, until one holds the BOQ.
 */
export async function loadScopeObject(
  data: ShellData,
  boqId: string,
  projectId: string | null,
  edits: readonly PendingEdit[] = []
): Promise<ScopeObjectData> {
  const candidates = projectId ? [projectId] : data.projects.map((p) => p.id);
  if (candidates.length === 0) return { state: "no_project" };

  let anySynced = false;
  for (const candidate of candidates) {
    const { lines, synced, syncedAt } = await readProjectLines(data, candidate);
    if (!synced) continue;
    anySynced = true;
    const own = lines.filter((l) => l.boqId === boqId);
    if (own.length === 0) continue;
    const first = own[0]!;
    const boq: Boq = {
      id: boqId,
      projectId: candidate,
      version: first.boqVersion,
      title: first.boqTitle,
      status: first.boqStatus,
      parentBoqId: null,
      createdAt: first.createdAt ?? "",
    };
    const mine = applyPendingEdits(orderLinesForBoq(own).map(toBoqLineItemRow), edits);
    return { state: "local", boq, lines: mine, total: boqTotal(mine), syncedAt, waitingLineIds: edits.filter((e) => e.boqId === boqId && !e.conflict).map((e) => e.lineId),
      conflicts: edits.filter((e) => e.boqId === boqId && e.conflict).map((e) => ({ editId: e.id, lineId: e.lineId, mine: e.patch.category, theirs: e.conflict!.theirs })) };
  }
  return anySynced ? { state: "not_found", projectId } : { state: "not_synced", projectId };
}
