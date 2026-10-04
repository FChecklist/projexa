// Test fixtures of the documents cluster (imported by *.test.ts(x) only). The rows have EXACTLY the shapes the sync service sends
// (compliance-tracker drizzle/0643, ai_work_link__records_core): snake_case keys and, for documents, a curated `metadata` object.

import type { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, doneKey } from "../../replica";
import type { ShellData } from "../context";
import { DOCUMENTS_KIND } from "./documents-records";

export function docRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id, name: `Doc ${id}`, category: "contract", file_type: "application/pdf", file_size: 2048, expiry_date: null, version_number: 1,
    is_latest_version: true, created_at: `2026-03-0${id.slice(-1)}T08:00:00Z`, linked_entity_type: "project", linked_entity_id: "p1", metadata: null, ...over,
  };
}

/** A row of the `meeting_minutes` kind (a veri_meeting about a project). */
export function momRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id, title: `Meeting ${id}`, meeting_type: "team", scheduled_at: `2026-04-0${id.slice(-1)}T09:00:00Z`, status: "draft", published_at: null,
    agenda: "1. Progress\n2. Safety", minutes: "Agreed to pour slab on Monday.", attendee_count: 4, created_at: `2026-04-0${id.slice(-1)}T08:00:00Z`, ...over,
  };
}

export type SeedRow = { projectId: string; data: unknown; orgId?: string; dirty?: string; kind?: string };

/** Seeds one person's database: a manifest, rows (server version 3), and the "copied to the end" markers of the given projects. */
export async function seedPerson(
  idb: IDBFactory,
  userId: string,
  rows: SeedRow[],
  opts: { done?: string[]; hiddenFields?: string[]; orgId?: string; kinds?: string[] } = {}
) {
  const kinds = opts.kinds ?? [DOCUMENTS_KIND];
  const orgId = opts.orgId ?? "orgA";
  const db = await openLocalDb(idb as unknown as globalThis.IDBFactory, localDbNameFor(userId));
  await db.setMeta(MANIFEST_KEY, { userId, orgId, projectIds: ["p1", "p2"], kinds, at: 1 });
  const kindOf = (r: SeedRow) => r.kind ?? kinds[0]!;
  await db.putRecords(rows.map((r) => ({ id: `${kindOf(r)}:${(r.data as { id: string }).id}`, type: kindOf(r), orgId: r.orgId ?? orgId, projectId: r.projectId, data: r.data, updatedAt: 1, serverVersion: 3, ...(r.dirty ? { dirty: r.dirty } : {}) })));
  for (const kind of kinds) for (const p of opts.done ?? ["p1"]) await db.setMeta(doneKey(p, kind), { at: 1_760_000_000_000, redacted: false, hiddenFields: opts.hiddenFields ?? [] });
  db.close();
}

export const shellData = (idb: IDBFactory, userId = "u1", orgId = "orgA", role = "pm"): ShellData => ({
  userId, name: "Asha", email: "a@x.test", role, orgId, idb: idb as unknown as globalThis.IDBFactory,
  projects: [{ id: "p1", name: "Cedar Heights" }, { id: "p2", name: "Annexe Works" }],
});
