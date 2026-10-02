// LOCAL-FIRST (package FC, review cost:COST-03): "reset the copy" -- what the heads-mode server step (server-step.ts) does before the
// whole sync that rebuilds it, when GET /heads says the person's `view_class` or the server's `epoch` changed:
//   * view_class: the role (or cost visibility) the rows were redacted under is not the person's any more -- a promotion would leave
//     money hidden that may now be seen, a demotion would leave money on the laptop that may no longer be seen;
//   * epoch: the server's version tables were re-created (a rollback), so every stored version and feed position is meaningless.
//
// What it drops: every NON-DIRTY row of every project the stored manifest names, and every position the replica keeps for them
// (keyset cursor, pulled-to-the-end marker, id-repair stamp, change-feed position) plus the "last whole sync" mark, so the next
// replica.sync() copies them from scratch. What it keeps: rows with a pending edit (the outbox and the server decide those), the
// outbox itself, drafts, and the stored manifest (its organisation guards against a copy of another organisation being mixed in).
// Never sends anything.

import { changeCursorKey, reconcileKey, type LocalDb } from "../local-db";
import { LAST_SYNC_KEY, MANIFEST_KEY, cursorKey, doneKey, type StoredManifest } from "../replica";

export async function resetLocalCopy(db: Pick<LocalDb, "getMeta" | "setMeta" | "deleteByProject">): Promise<{ removed: number }> {
  const manifest = await db.getMeta<StoredManifest>(MANIFEST_KEY);
  if (!manifest || !Array.isArray(manifest.projectIds)) return { removed: 0 };
  let removed = 0;
  for (const projectId of manifest.projectIds) {
    removed += await db.deleteByProject(manifest.orgId, projectId); // dirty rows are skipped inside
    for (const kind of manifest.kinds ?? []) {
      await db.setMeta(cursorKey(projectId, kind), null);
      await db.setMeta(doneKey(projectId, kind), null);
      await db.setMeta(reconcileKey(projectId, kind), null);
    }
    await db.setMeta(changeCursorKey(projectId), null);
  }
  await db.setMeta(LAST_SYNC_KEY, null);
  return { removed };
}
