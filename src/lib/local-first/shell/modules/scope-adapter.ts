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
import { loadLocalFirst, localSyncInfo } from "../../local-reader";
import type { ShellData } from "../context";
import { applyPendingEdits, type PendingEdit } from "../pending-edits";
import { parseProgress, readKind } from "./delivery-local";
import { DEFAULT_BUDGET_PERCENT, latestProgress } from "./scope-writes";
import { pendingView, readPendingOps } from "./design-change-rows";
import { vendorNames, type MasterState } from "./org-masters";

export type BoqListRow = {
  id: string;
  title: string;
  version: number;
  status: string;
  lineCount: number;
  total: number;
  /** A BOQ or revision made on this laptop that the server has not accepted yet (a temporary id). */
  waiting?: boolean;
};

/** A line of a BOQ made on this laptop, as its temporary `boqs` row keeps it (scope-writes.ts). */
export type LocalBoqLine = {
  id: string; itemCode: string | null; description: string; unit: string; quantity: number; rate: number; amount: number;
  parentItemCode: string | null; breakdownPercentage: number | null; category: string | null;
};
export type WaitingBoq = { id: string; projectId: string; title: string; version: number; parentBoqId: string | null; lines: LocalBoqLine[]; total: number };

export const isTempBoqId = (id: string) => id.startsWith("local-");

/** A temporary `boqs` row of this laptop as a WaitingBoq; null when it is anything else (replica rows are untrusted input). */
export function toWaitingBoq(raw: unknown): WaitingBoq | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !isTempBoqId(o.id) || typeof o.title !== "string" || !Array.isArray(o.local_lines)) return null;
  const lines: LocalBoqLine[] = [];
  for (const l of o.local_lines) {
    if (typeof l !== "object" || l === null) continue;
    const r = l as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.description !== "string") continue;
    lines.push({
      id: r.id, itemCode: typeof r.item_code === "string" ? r.item_code : null, description: r.description, unit: typeof r.unit === "string" ? r.unit : "",
      quantity: Number(r.quantity) || 0, rate: Number(r.rate) || 0, amount: Number(r.amount) || 0, parentItemCode: typeof r.parent_item_code === "string" ? r.parent_item_code : null,
      breakdownPercentage: r.breakdown_percentage == null ? null : Number(r.breakdown_percentage), category: typeof r.category === "string" ? r.category : null,
    });
  }
  return {
    id: o.id, projectId: typeof o.project_id === "string" ? o.project_id : "", title: o.title, version: Number(o.version) || 1,
    parentBoqId: typeof o.parent_boq_id === "string" ? o.parent_boq_id : null, lines, total: lines.filter((l) => !l.parentItemCode).reduce((s, l) => s + l.amount, 0),
  };
}

async function readWaiting(data: ShellData, projectId: string): Promise<WaitingBoq[]> {
  const read = await loadLocalFirst<unknown>(BOQS_KIND, projectId, async () => [], { userId: data.userId, idb: data.idb });
  return read.state === "local" ? read.rows.map(toWaitingBoq).filter((w): w is WaitingBoq => w !== null) : [];
}

export type ScopeListData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | { state: "local"; projectId: string; rows: BoqListRow[]; syncedAt: number | null };

export type ScopeNewData = { state: "no_project" } | { state: "not_synced"; projectId: string | null } | { state: "ready"; projectId: string };

export type ScopeReviseData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  /** The parent is itself waiting to be sent: it can be revised once the server has accepted it. */
  | { state: "parent_waiting"; projectId: string }
  /** This role's money is hidden by the sync service, so the lines to revise are not on the laptop. */
  | { state: "money_hidden"; projectId: string }
  | {
      state: "ready";
      projectId: string;
      boq: Boq;
      parent: BoqLineItemRow[];
      /** Percent complete per parent line id, from this laptop's progress entries; null when progress was never copied here. */
      progress: Record<string, number> | null;
    };

/** One line of the budget screen: the server's copy of its budget overlay, and what is waiting on it. */
export type BudgetLine = {
  id: string; itemCode: string | null; description: string; amount: number; isSub: boolean;
  budgetPercentage: string; vendorId: string | null; vendorAmount: string | null;
  waiting: boolean; trouble: "conflict" | "blocked" | null;
};

export type ScopeBudgetData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | { state: "parent_waiting"; projectId: string }
  | { state: "money_hidden"; projectId: string }
  | {
      state: "ready"; projectId: string; boq: Boq; lines: BudgetLine[];
      /** The organisation's vendors on this laptop (id -> name), or why there are none. */
      vendors: { state: "local"; options: { id: string; label: string }[] } | { state: MasterState };
    };

export type ScopeObjectData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  /** A BOQ or revision made on this laptop and not yet accepted by the server. */
  | { state: "waiting"; waiting: WaitingBoq }
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
  const waiting: BoqListRow[] = (await readWaiting(data, projectId)).map((w) => ({
    id: w.id, title: w.title, version: w.version, status: "waiting", lineCount: w.lines.length, total: w.total, waiting: true,
  }));
  return { state: "local", projectId, rows: [...groupBoqs(lines), ...waiting], syncedAt };
}

export async function loadScopeNew(data: ShellData, projectId: string | null): Promise<ScopeNewData> {
  if (data.projects.length === 0) return { state: "no_project" };
  if (!projectId || !data.projects.some((p) => p.id === projectId)) return { state: "not_synced", projectId };
  return { state: "ready", projectId };
}

/** One BOQ's lines with their budget overlay (budget %, vendor, vendor amount), from the laptop's own database. */
export async function loadScopeBudget(data: ShellData, boqId: string, projectId: string | null): Promise<ScopeBudgetData> {
  if (isTempBoqId(boqId)) return { state: "parent_waiting", projectId: projectId ?? "" };
  const candidates = projectId ? [projectId] : data.projects.map((p) => p.id);
  if (candidates.length === 0) return { state: "no_project" };
  let anySynced = false;
  for (const candidate of candidates) {
    const { lines, synced } = await readProjectLines(data, candidate);
    if (!synced) continue;
    anySynced = true;
    const own = lines.filter((l) => l.boqId === boqId);
    if (own.length === 0) continue;
    const info = await localSyncInfo(BOQ_LINES_KIND, candidate, { userId: data.userId, idb: data.idb });
    const hidden: unknown[] = Array.isArray(info?.hiddenFields) ? info.hiddenFields : [];
    if (hidden.some((f) => f === "budget_percentage" || f === "vendor_amount" || f === "amount")) return { state: "money_hidden", projectId: candidate };
    const first = own[0]!;
    const boq: Boq = { id: boqId, projectId: candidate, version: first.boqVersion, title: first.boqTitle, status: first.boqStatus, parentBoqId: null, createdAt: first.createdAt ?? "" };
    const view = pendingView(await readPendingOps(data, candidate), BOQ_LINES_KIND);
    const budgetLines: BudgetLine[] = orderLinesForBoq(own).map(toBoqLineItemRow).map((r) => ({
      id: r.id, itemCode: r.itemCode, description: r.description, amount: Number(r.amount) || 0, isSub: Boolean(r.parentLineItemId),
      budgetPercentage: r.budgetPercentage ?? DEFAULT_BUDGET_PERCENT, vendorId: r.vendorId ?? null, vendorAmount: r.vendorAmount ?? null,
      waiting: (view.waitingOn.get(r.id) ?? []).length > 0, trouble: view.troubled.get(r.id) ?? null,
    }));
    const names = await vendorNames({ userId: data.userId, idb: data.idb });
    const vendors = names.state === "local" ? { state: "local" as const, options: [...names.names].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)) } : { state: names.state };
    return { state: "ready", projectId: candidate, boq, lines: budgetLines, vendors };
  }
  return anySynced ? { state: "not_found", projectId } : { state: "not_synced", projectId };
}

/** The BOQ a revision is made from, its lines and the progress this laptop holds, all from the laptop's own database. */
export async function loadScopeRevise(data: ShellData, boqId: string, projectId: string | null): Promise<ScopeReviseData> {
  if (isTempBoqId(boqId)) return { state: "parent_waiting", projectId: projectId ?? "" };
  const candidates = projectId ? [projectId] : data.projects.map((p) => p.id);
  if (candidates.length === 0) return { state: "no_project" };
  let anySynced = false;
  for (const candidate of candidates) {
    const { lines, synced } = await readProjectLines(data, candidate);
    if (!synced) continue;
    anySynced = true;
    const own = lines.filter((l) => l.boqId === boqId);
    if (own.length === 0) continue;
    const info = await localSyncInfo(BOQ_LINES_KIND, candidate, { userId: data.userId, idb: data.idb });
    const hidden: unknown[] = Array.isArray(info?.hiddenFields) ? info.hiddenFields : [];
    if (hidden.some((f) => f === "quantity" || f === "rate" || f === "amount")) return { state: "money_hidden", projectId: candidate };
    const first = own[0]!;
    const boq: Boq = { id: boqId, projectId: candidate, version: first.boqVersion, title: first.boqTitle, status: first.boqStatus, parentBoqId: null, createdAt: first.createdAt ?? "" };
    const progressRead = await readKind(data, candidate, "progress", parseProgress);
    return {
      state: "ready", projectId: candidate, boq, parent: orderLinesForBoq(own).map(toBoqLineItemRow),
      progress: progressRead.synced ? Object.fromEntries(latestProgress(progressRead.rows)) : null,
    };
  }
  return anySynced ? { state: "not_found", projectId } : { state: "not_synced", projectId };
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

  if (isTempBoqId(boqId)) {
    for (const candidate of candidates) {
      const waiting = (await readWaiting(data, candidate)).find((w) => w.id === boqId);
      if (waiting) return { state: "waiting", waiting };
    }
    return { state: "not_found", projectId };
  }

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
