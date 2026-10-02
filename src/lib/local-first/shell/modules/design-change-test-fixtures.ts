// Test fixtures of the design-and-change cluster (imported by *.test.ts(x) only). Rows have EXACTLY the shapes the sync service sends
// (compliance-tracker drizzle/0643 ai_work_link__records_core): snake_case keys, numerics often as text.

import type { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, doneKey } from "../../replica";
import type { ShellData } from "../context";
import { CHANGE_ORDERS_KIND, TASKS_KIND, TIMESHEETS_KIND } from "./design-change-rows";

export function coRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id, number: Number(id.replace(/\D/g, "")) || 1, title: `Change ${id}`, description: null, reason: "Client asked", cost_impact: "12500.00",
    schedule_impact_days: 3, status: "draft", requested_by_id: "u1", approved_by_id: null, approved_at: null, trade: null, boq_revision_id: null,
    created_at: "2026-09-01T08:00:00Z", ...over,
  };
}

export function entryRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id, issue_id: "i1", user_id: "u1", hours: "2.50", spent_on: "2026-10-02", activity_type: "Drawings", comments: null, billable: true,
    approval_status: "draft", created_at: "2026-10-02T09:00:00Z", hourly_rate_snapshot: "40.00", invoice_item_id: null, ...over,
  };
}

export function taskRow(id: string, number: number, title: string, over: Record<string, unknown> = {}) {
  return { id, number, title, is_archived: false, created_at: "2026-08-01T00:00:00Z", ...over };
}

export type SeedRow = { kind: string; projectId: string; data: { id: string } & Record<string, unknown>; orgId?: string; serverVersion?: number };

/** Seeds one person's database: a manifest (projects p1, p2), rows, and the "copied to the end" markers of `done` (kind -> projects). */
export async function seedDesignChange(
  idb: IDBFactory,
  userId: string,
  rows: SeedRow[],
  opts: { done?: Record<string, string[]>; hiddenFields?: Record<string, string[]>; orgId?: string } = {}
) {
  const orgId = opts.orgId ?? "orgA";
  const done = opts.done ?? { [CHANGE_ORDERS_KIND]: ["p1"], [TIMESHEETS_KIND]: ["p1"], [TASKS_KIND]: ["p1"] };
  const db = await openLocalDb(idb as unknown as globalThis.IDBFactory, localDbNameFor(userId));
  await db.setMeta(MANIFEST_KEY, { userId, orgId, projectIds: ["p1", "p2"], kinds: Object.keys(done), at: 1 });
  await db.putRecords(rows.map((r) => ({ id: `${r.kind}:${r.data.id}`, type: r.kind, orgId: r.orgId ?? orgId, projectId: r.projectId, data: r.data, updatedAt: 1, serverVersion: r.serverVersion ?? 3 })));
  for (const [kind, projects] of Object.entries(done)) {
    for (const p of projects) await db.setMeta(doneKey(p, kind), { at: 1_760_000_000_000, redacted: false, hiddenFields: opts.hiddenFields?.[kind] ?? [] });
  }
  db.close();
}

export const dcShellData = (idb: IDBFactory, userId = "u1", role: string | null = "manager", orgId = "orgA"): ShellData => ({
  userId, name: "Asha", email: "a@x.test", role, orgId, idb: idb as unknown as globalThis.IDBFactory,
  projects: [{ id: "p1", name: "Cedar Heights" }, { id: "p2", name: "Annexe Works" }],
});
