// LOCAL-FIRST slice 2: the one replica a signed-in browser tab uses, wired to the real sync service and to
// the person's own Supabase session. Kept apart from replica.ts so the engine itself stays free of the
// browser client (and so its tests need no environment variables).

import { createReplica, type Replica } from "./replica";
import { createSharedSyncClient } from "./shared-client";
import { setActiveLocalUser } from "./local-reader";

const replicas = new Map<string, Replica>();

/** The (memoised) replica for this person. Calling it also marks them as the laptop's active local user. */
export function getSharedReplica(userId: string): Replica {
  setActiveLocalUser(userId);
  let replica = replicas.get(userId);
  if (!replica) {
    replica = createReplica({ userId, client: createSharedSyncClient({ timeoutMs: 15_000, maxRetries: 2 }) });
    replicas.set(userId, replica);
  }
  return replica;
}

/** Background revalidation used by useLocalFirst by default: bring one project's one kind up to date. */
export async function revalidateViaSharedReplica(ctx: { kind: string; projectId: string; userId: string }): Promise<void> {
  await getSharedReplica(ctx.userId).syncProject(ctx.projectId, ctx.kind);
}
