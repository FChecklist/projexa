// LOCAL-FIRST slice 2: the one replica a signed-in browser tab uses, wired to the real sync service and to
// the person's own Supabase session. Kept apart from replica.ts so the engine itself stays free of the
// browser client (and so its tests need no environment variables).
//
// COST (package lf-fc, review cost:COST-02 / FLAG-16): EVERY caller of the shared replica -- WorkspacePrepare's first copy,
// boot.ts's re-download, the auto-sync server step, a screen's background revalidation -- goes through gateByFlag() below:
// with the local-first flag (`px-local-first`) OFF, sync / syncProject / reconcileDeletes send NOTHING and touch no database
// (they answer an "idle" report at once). Nothing reads the laptop copy with the flag off, so filling it would be pure cost.

import { createReplica, type Replica, type SyncReport } from "./replica";
import { createSharedSyncClient } from "./shared-client";
import { isLocalFirstEnabled, setActiveLocalUser } from "./local-reader";

const replicas = new Map<string, Replica>();

/** The report a gated call answers with: nothing was asked, nothing was stored. */
export function flagOffReport(): SyncReport {
  return { status: "idle", projectsTotal: 0, projectsSynced: 0, itemsStored: 0, itemsRemoved: 0, changesApplied: 0, reconciledRemoved: 0, issues: [], syncedAt: null };
}

/** Wraps a replica so that with the flag off no call reaches it (no request, no IndexedDB). Pure wiring; exported for its test. */
export function gateByFlag(replica: Replica, flagOn: () => boolean = isLocalFirstEnabled): Replica {
  return {
    sync: (signal, onProgress) => (flagOn() ? replica.sync(signal, onProgress) : Promise.resolve(flagOffReport())),
    syncProject: (projectId, kind, signal) => (flagOn() ? replica.syncProject(projectId, kind, signal) : Promise.resolve(flagOffReport())),
    reconcileDeletes: (projectId, kind, o) => (flagOn() ? replica.reconcileDeletes(projectId, kind, o) : Promise.resolve({ removed: 0, skipped: true })),
    resume: () => replica.resume(),
    getStatus: () => replica.getStatus(),
  };
}

/** The (memoised) replica for this person. Calling it also marks them as the laptop's active local user. */
export function getSharedReplica(userId: string): Replica {
  setActiveLocalUser(userId);
  let replica = replicas.get(userId);
  if (!replica) {
    replica = gateByFlag(createReplica({ userId, client: createSharedSyncClient({ timeoutMs: 15_000, maxRetries: 2 }) }));
    replicas.set(userId, replica);
  }
  return replica;
}

/** Background revalidation used by useLocalFirst by default: bring one project's one kind up to date. */
export async function revalidateViaSharedReplica(ctx: { kind: string; projectId: string; userId: string }): Promise<void> {
  await getSharedReplica(ctx.userId).syncProject(ctx.projectId, ctx.kind);
}
