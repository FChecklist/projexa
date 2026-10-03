// Test helper for the finance / sales / HR group: adds ORGANISATION kinds (stored under project "__org__", listed in the manifest's
// orgKinds, one done marker per kind with its hidden fields) to a person's laptop database that seedDelivery already wrote.
// Not imported by production code.

import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, doneKey, type StoredManifest } from "../../replica";
import { ORG_PROJECT } from "../../sync-client";

export type OrgSeed = { kind: string; rows: unknown[]; hidden?: string[]; synced?: boolean };

export async function seedOrgKinds(idb: IDBFactory, kinds: OrgSeed[], opts: { userId?: string; orgId?: string; at?: number; listed?: string[] } = {}): Promise<void> {
  const userId = opts.userId ?? "u1";
  const orgId = opts.orgId ?? "orgA";
  const db = await openLocalDb(idb, localDbNameFor(userId));
  try {
    const manifest = (await db.getMeta<StoredManifest>(MANIFEST_KEY)) ?? { userId, orgId, projectIds: [], kinds: [], at: 1 };
    await db.setMeta(MANIFEST_KEY, { ...manifest, orgKinds: opts.listed ?? kinds.map((k) => k.kind) });
    for (const k of kinds) {
      const records = k.rows.map((data, i) => {
        const id = typeof data === "object" && data !== null && typeof (data as { id?: unknown }).id === "string" ? (data as { id: string }).id : `junk${i}`;
        return { id: `${k.kind}:${id}`, type: k.kind, orgId, projectId: ORG_PROJECT, data, updatedAt: 1 };
      });
      if (records.length) await db.putRecords(records);
      if (k.synced !== false) await db.setMeta(doneKey(ORG_PROJECT, k.kind), { at: opts.at ?? 1_760_000_000_000, redacted: Boolean(k.hidden?.length), hiddenFields: k.hidden ?? [] });
    }
  } finally {
    db.close();
  }
}
