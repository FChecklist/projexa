// UAT 2026-10-13 (live finding): the laptop's copy of a person belongs to ONE organisation (the stored manifest names it), and the replica refuses a manifest
// for another organisation so two organisations are never mixed in one copy ("org_mismatch", on purpose: replica.ts, replica.test.ts). But a person's
// organisation CAN change under the same sign-in (an account re-provisioned or moved), and then every later sync was refused for ever, silently: the demo
// laptop showed 15 projects of the OLD organisation for 17 hours, while the server had one project of the new one, and nothing said so.
//
// The refusal stays; what is added is the way out, decided by the caller (never by the replica): when a WHOLE run is refused for exactly that reason,
// drop this person's copy of the OLD organisation (every project the stored manifest names, and the organisation kinds, and every position kept for
// them) and run once more, so the copy is rebuilt from the new organisation. Rows with a pending edit are kept (db.deleteByProject skips them): the outbox
// and the server decide those. Nothing is ever sent by this file besides the one extra sync.

import { changeCursorKey, reconcileKey, type LocalDb } from "./local-db";
import { LAST_SYNC_KEY, MANIFEST_KEY, cursorKey, doneKey, type StoredManifest, type SyncReport } from "./replica";
import { ORG_PROJECT } from "./sync-client";

const HEADS_KEY = "sync:heads"; // peer/server-step.ts HEADS_KEY (not imported: that file imports this module's neighbours)

/** True for the manifest-level refusal of a whole run: another organisation than the copy's, with nothing stored by the run. */
export function isOrgChangeRefusal(report: Pick<SyncReport, "status" | "issues" | "itemsStored">): boolean {
  return report.status === "error"
    && report.itemsStored === 0
    && report.issues.some((i) => i.reason === "org_mismatch" && i.projectId === undefined && /different organisation/i.test(i.message));
}

/** Drops this person's copy of the organisation the stored manifest names. Returns how many rows left. */
export async function dropCopyOfOldOrganisation(db: Pick<LocalDb, "getMeta" | "setMeta" | "deleteByProject">): Promise<number> {
  const manifest = await db.getMeta<StoredManifest>(MANIFEST_KEY);
  if (!manifest || typeof manifest.orgId !== "string" || !Array.isArray(manifest.projectIds)) return 0;
  let removed = 0;
  for (const projectId of [...manifest.projectIds, ORG_PROJECT]) {
    removed += await db.deleteByProject(manifest.orgId, projectId);
    for (const kind of [...(manifest.kinds ?? []), ...(manifest.orgKinds ?? [])]) {
      await db.setMeta(cursorKey(projectId, kind), null);
      await db.setMeta(doneKey(projectId, kind), null);
      await db.setMeta(reconcileKey(projectId, kind), null);
    }
    await db.setMeta(changeCursorKey(projectId), null);
  }
  await db.setMeta(MANIFEST_KEY, null);
  await db.setMeta(LAST_SYNC_KEY, null);
  await db.setMeta(HEADS_KEY, null);
  return removed;
}

/** Runs `sync`; if the whole run was refused because the person's organisation changed, rebuilds the copy from the new organisation and runs once more. */
export async function syncRecoveringFromOrgChange(sync: () => Promise<SyncReport>, openDb: () => Promise<LocalDb>): Promise<SyncReport> {
  const report = await sync();
  if (!isOrgChangeRefusal(report)) return report;
  const db = await openDb();
  try {
    await dropCopyOfOldOrganisation(db);
  } finally {
    db.close();
  }
  return sync();
}
