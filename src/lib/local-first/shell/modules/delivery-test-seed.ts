// Test helper for the delivery cluster's adapter and screen tests: writes a person's laptop database the way the sync engine leaves
// it (a manifest, rows per (project, kind), a done marker per synced pair with its hidden fields). Not imported by production code.

import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, doneKey } from "../../replica";
import type { ShellData } from "../context";

export type SeedPair = { projectId: string; kind: string; rows: unknown[]; synced?: boolean; hidden?: string[]; dirtyIds?: string[] };

export async function seedDelivery(idb: IDBFactory, pairs: SeedPair[], opts: { userId?: string; orgId?: string; projectIds?: string[]; at?: number } = {}): Promise<void> {
  const userId = opts.userId ?? "u1";
  const orgId = opts.orgId ?? "orgA";
  const db = await openLocalDb(idb, localDbNameFor(userId));
  try {
    await db.setMeta(MANIFEST_KEY, { userId, orgId, projectIds: opts.projectIds ?? ["p1", "p2"], kinds: [...new Set(pairs.map((p) => p.kind))], at: 1 });
    for (const pair of pairs) {
      const records = pair.rows.map((data, i) => {
        const id = typeof data === "object" && data !== null && typeof (data as { id?: unknown }).id === "string" ? (data as { id: string }).id : `junk${i}`;
        return { id: `${pair.kind}:${id}`, type: pair.kind, orgId, projectId: pair.projectId, data, updatedAt: 1, ...(pair.dirtyIds?.includes(id) ? { dirty: "op-x" } : {}) };
      });
      if (records.length) await db.putRecords(records);
      if (pair.synced !== false) await db.setMeta(doneKey(pair.projectId, pair.kind), { at: opts.at ?? 1_760_000_000_000, redacted: Boolean(pair.hidden?.length), hiddenFields: pair.hidden ?? [] });
    }
  } finally {
    db.close();
  }
}

export const deliveryShellData = (idb: IDBFactory, over: Partial<ShellData> = {}): ShellData => ({
  userId: "u1", name: "Asha", email: null, role: "site_engineer", orgId: "orgA", idb,
  projects: [{ id: "p1", name: "Cedar Heights" }, { id: "p2", name: "Annexe" }], ...over,
});
