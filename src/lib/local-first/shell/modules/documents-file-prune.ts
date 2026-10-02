// LOCAL-FIRST shell, documents cluster: drops kept files whose document is no longer on this laptop (deleted on the server, or no longer
// visible to this person's role: the replica removes such rows, see replica.ts reconcile). Run by the list screens after they open; it
// only ever REMOVES files, never fetches, and a project that has not finished copying is left alone (a partial copy proves nothing).

import type { ShellData } from "../context";
import { openFileCache } from "./documents-file-cache";
import { readProjectDocuments } from "./documents-records";

/** Returns how many kept files were dropped. Never throws. */
export async function pruneKeptFiles(data: ShellData, projectId: string): Promise<number> {
  if (!data.orgId) return 0;
  try {
    const { synced, docs } = await readProjectDocuments(data, projectId);
    if (!synced) return 0;
    const cache = await openFileCache(data.userId, { idb: data.idb });
    try {
      return await cache.prune(new Set(docs.map((d) => d.id)), { orgId: data.orgId, projectId });
    } finally {
      cache.close();
    }
  } catch {
    return 0;
  }
}
