// LOCAL-FIRST shell, cluster "design and change": the replica rows these screens read, checked before use.
//
// WHAT A ROW LOOKS LIKE ON THE LAPTOP. The sync service sends, for every row, exactly what the AI work link's
// ai_work_link__records_core returns for it (compliance-tracker drizzle/0643 + 0677): the curated columns in the database's own
// snake_case names, with money columns set to NULL below the role that may see them and the hidden column names recorded in the
// (project, kind) done marker (replica.ts DoneMarker.hiddenFields). Nothing on the laptop renames them. The columns per kind:
//
//   change_orders  id, number, title, description, reason, cost_impact (money), schedule_impact_days, status, requested_by_id,
//                  approved_by_id, approved_at, trade, boq_revision_id, created_at
//   timesheets     id, issue_id, user_id, hours, spent_on, activity_type, comments, billable, approval_status, created_at,
//                  hourly_rate_snapshot (money), invoice_item_id (money)
//   tasks          id, number, title, ... (only id and title are used here, to name a timesheet row's task)
//
// UNTRUSTED INPUT. A replica row is a proposal until it looks like what the screen expects: every parser below returns null for
// a row it cannot read, never a cast. The camelCase spelling of each field is accepted too (a row this laptop wrote itself before a
// server answer, or a future projection that renames), so one spelling change never blanks a screen.
//
// NOTHING HERE DECIDES. Money is shown as the server sent it (or as hidden); a status is the server's word; nothing is summed into a
// figure that means money.

import { localDbNameFor, openLocalDb, type OutboxOp } from "../../local-db";
import { MANIFEST_KEY, doneKey, type DoneMarker, type StoredManifest } from "../../replica";
import type { ShellData } from "../context";

export const CHANGE_ORDERS_KIND = "change_orders";
export const TIMESHEETS_KIND = "timesheets";
export const TASKS_KIND = "tasks";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The first of the given spellings that is present (not undefined). */
function pick(o: Obj, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** A number the server sent as a number or a numeric string (Postgres numerics arrive as text). Anything else is null. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

// ─── change orders ─────────────────────────────────────────────────────────────────────────────

export type ChangeOrderRow = {
  id: string;
  /** The server's number (CO-<n>); null for one made on this laptop that the server has not numbered yet. */
  number: number | null;
  title: string;
  description: string | null;
  reason: string | null;
  /** As the server sent it; null when hidden for this person's role or not set. See `costHidden` on the screen data. */
  costImpact: number | null;
  scheduleImpactDays: number | null;
  /** The server's status word; null for a row made on this laptop that the server has not accepted yet. */
  status: string | null;
  trade: string | null;
  boqRevisionId: string | null;
  createdAt: string | null;
};

export function toChangeOrder(raw: unknown): ChangeOrderRow | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const title = text(raw.title);
  if (!id || !title) return null;
  const status = pick(raw, "status");
  if (status !== undefined && status !== null && typeof status !== "string") return null;
  return {
    id,
    number: num(pick(raw, "number")),
    title,
    description: str(pick(raw, "description")),
    reason: str(pick(raw, "reason")),
    costImpact: num(pick(raw, "cost_impact", "costImpact")),
    scheduleImpactDays: num(pick(raw, "schedule_impact_days", "scheduleImpactDays")),
    status: (status as string | null | undefined) ?? null,
    trade: str(pick(raw, "trade")),
    boqRevisionId: str(pick(raw, "boq_revision_id", "boqRevisionId")),
    createdAt: str(pick(raw, "created_at", "createdAt")),
  };
}

/** Newest number first, as the online list reads; rows the server has not numbered yet (made here) at the top. */
export function orderChangeOrders<T extends ChangeOrderRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.number === null && b.number === null) return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    if (a.number === null) return -1;
    if (b.number === null) return 1;
    return b.number - a.number;
  });
}

// ─── timesheet entries ─────────────────────────────────────────────────────────────────────────

export type TimeEntryRow = {
  id: string;
  issueId: string | null;
  userId: string | null;
  hours: number;
  /** YYYY-MM-DD */
  spentOn: string;
  activityType: string | null;
  comments: string | null;
  /** draft / submitted / approved / rejected as the server says; null for an entry made here and not accepted yet. */
  approvalStatus: string | null;
  createdAt: string | null;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}/;

export function toTimeEntry(raw: unknown): TimeEntryRow | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const hours = num(pick(raw, "hours"));
  const spentOn = str(pick(raw, "spent_on", "spentOn"));
  if (!id || hours === null || !spentOn || !DAY_RE.test(spentOn)) return null;
  const status = pick(raw, "approval_status", "approvalStatus");
  if (status !== undefined && status !== null && typeof status !== "string") return null;
  return {
    id,
    issueId: str(pick(raw, "issue_id", "issueId")),
    userId: str(pick(raw, "user_id", "userId")),
    hours,
    spentOn: spentOn.slice(0, 10),
    activityType: str(pick(raw, "activity_type", "activityType")),
    comments: str(pick(raw, "comments")),
    approvalStatus: (status as string | null | undefined) ?? null,
    createdAt: str(pick(raw, "created_at", "createdAt")),
  };
}

/** Task id -> its title, from the `tasks` rows (pms_issues). Rows without both are skipped. */
export function taskTitles(rows: readonly unknown[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of rows) {
    if (!isObj(raw)) continue;
    const id = str(raw.id);
    const title = text(raw.title);
    if (id && title) out.set(id, title);
  }
  return out;
}

/** Hours added for DISPLAY ("7.50 h"), rounded so a sum never prints 7.199999999999999. Hours are not money. */
export function sumHours(rows: readonly Pick<TimeEntryRow, "hours">[]): number {
  return Math.round(rows.reduce((s, r) => s + r.hours, 0) * 100) / 100;
}

// ─── the laptop's own database, read for one person ────────────────────────────────────────────

export type KindRead = { synced: false } | { synced: true; rows: unknown[]; syncedAt: number; hiddenFields: string[] };

/**
 * The rows of one kind of one project, when that (project, kind) was pulled to the end at least once (a half-copied kind is never
 * shown as if it were whole), with the columns the server hid for this person's role. Reads ONLY `projexa-local:<userId>`; a
 * replica whose manifest names another person or organisation contributes nothing. Never calls the server.
 */
export async function readKind(data: ShellData, kind: string, projectId: string): Promise<KindRead> {
  const idb = data.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!idb) return { synced: false };
  const db = await openLocalDb(idb, localDbNameFor(data.userId));
  try {
    const manifest = await db.getMeta<StoredManifest | null>(MANIFEST_KEY);
    if (!manifest || manifest.userId !== data.userId) return { synced: false };
    if (data.orgId && manifest.orgId !== data.orgId) return { synced: false };
    const marker = await db.getMeta<DoneMarker | null>(doneKey(projectId, kind));
    if (!marker) return { synced: false };
    const records = await db.listByProject(manifest.orgId, kind, projectId);
    const hiddenFields = Array.isArray(marker.hiddenFields) ? marker.hiddenFields.filter((f): f is string => typeof f === "string") : [];
    return { synced: true, rows: records.map((r) => r.data), syncedAt: marker.at, hiddenFields };
  } finally {
    db.close();
  }
}

/** This person's edits that are still on their way to the server (the outbox store), for one project. Read-only; never sends. */
export async function readPendingOps(data: ShellData, projectId: string | null): Promise<OutboxOp[]> {
  const idb = data.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!idb) return [];
  const db = await openLocalDb(idb, localDbNameFor(data.userId));
  try {
    const ops = await db.listOps();
    return projectId ? ops.filter((op) => op.projectId === projectId) : ops;
  } finally {
    db.close();
  }
}

/** What a waiting op means for a screen: the rows it created here, and the rows it is about to change (by function). */
export type PendingView = {
  /** ids of rows that exist only on this laptop until the server accepts them */
  created: Set<string>;
  /** row id -> the function ids waiting on it ("submit_change_order_for_approval", ...) */
  waitingOn: Map<string, string[]>;
  /** ops that were refused or are in conflict stay visible as such, never silently as "waiting" */
  troubled: Map<string, "conflict" | "blocked">;
};

/** `idParams`: the parameter names that point at the row an op acts on, for ops that carry no `record` (e.g. timeEntryId). */
export function pendingView(ops: readonly OutboxOp[], kind: string, idParams: readonly string[] = []): PendingView {
  const view: PendingView = { created: new Set(), waitingOn: new Map(), troubled: new Map() };
  for (const op of ops) {
    let rowId: string | null = null;
    if (op.creates?.kind === kind) {
      view.created.add(op.creates.id);
      rowId = op.creates.id;
    } else if (op.record?.kind === kind) {
      rowId = op.record.id;
    } else {
      for (const p of idParams) {
        const v = op.params?.[p];
        if (typeof v === "string") {
          rowId = v;
          break;
        }
      }
    }
    if (!rowId) continue;
    view.waitingOn.set(rowId, [...(view.waitingOn.get(rowId) ?? []), op.functionId]);
    if (op.status === "conflict" || op.status === "blocked") view.troubled.set(rowId, op.status);
  }
  return view;
}
