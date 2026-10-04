// Test fixtures of the "platform and knowledge" group (imported by *.test.ts(x) only). The rows have EXACTLY the shapes the sync service
// sends (compliance-tracker drizzle/0643 + 0683/0684): snake_case keys, one `project` row per project, organisation kinds under "__org__".

import type { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, type StoredManifest } from "../../replica";
import { ORG_PROJECT } from "../../sync-client";
import { seedPerson, type SeedRow } from "./documents-test-fixtures";

export const wikiRow = (id: string, over: Record<string, unknown> = {}) => ({ id, parent_page_id: null, slug: `page-${id}`, title: `Page ${id}`, content: `Body of ${id}`, version: 2, created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-02T00:00:00Z", ...over });
export const meetingRow = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `Meeting ${id}`, scheduled_at: `2026-06-0${id.slice(-1)}T09:30:00Z`, duration_minutes: 45, recurrence_rule: null, created_at: "2026-05-01T00:00:00Z", ...over });
export const projectRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Project ${id}`, description: null, is_active: true, status: "active", access_level: "org", health_status: "on_track", lead_user_id: null,
  start_date: "2026-01-01", target_date: "2026-12-31", rollup_percentage: 41, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z",
  project_value: 1500000, vat_rate_percent: 18, retention_percent: 5, ...over,
});

export type OrgSeed = { orgKinds: string[]; rows: Array<{ kind: string; data: Record<string, unknown> }> };

/** seedPerson, plus the organisation kinds the role may read (manifest.orgKinds) with their rows, each marked as copied to the end. */
export async function seedPlatform(idb: IDBFactory, userId: string, rows: SeedRow[], kinds: string[], org?: OrgSeed, opts: { done?: string[]; hiddenFields?: string[] } = {}) {
  await seedPerson(idb, userId, rows, { kinds, ...opts });
  if (!org) return;
  const db = await openLocalDb(idb as unknown as globalThis.IDBFactory, localDbNameFor(userId));
  const manifest = (await db.getMeta<StoredManifest>(MANIFEST_KEY))!;
  await db.setMeta(MANIFEST_KEY, { ...manifest, orgKinds: org.orgKinds });
  await db.putRecords(org.rows.map((r) => ({ id: `${r.kind}:${r.data.id as string}`, type: r.kind, orgId: manifest.orgId, projectId: ORG_PROJECT, data: r.data, updatedAt: 1, serverVersion: 3 })));
  for (const kind of org.orgKinds) await db.setMeta(`sync:done:${ORG_PROJECT}:${kind}`, { at: 5, redacted: false, hiddenFields: [] });
  db.close();
}
