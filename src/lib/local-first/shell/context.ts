// LOCAL-FIRST shell: the data the shell chrome and every screen share -- who the person is, which organisation, which projects,
// which one is selected. All of it comes from THIS LAPTOP: the durable identity, the replica's manifest meta, and the cached
// project names. Nothing here touches the network or Supabase.

import { localDbNameFor, openLocalDb } from "../local-db";
import { MANIFEST_KEY, type StoredManifest } from "../replica";
import type { DurableIdentity } from "../identity";
import type { MetaStore } from "../release/installer";
import { readShellManifest, type ShellManifest } from "./manifest-cache";

export type ShellProject = { id: string; name: string };

/** What every shell screen is handed. */
export type ShellData = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string | null;
  orgId: string | null;
  projects: ShellProject[];
  /** The browser's IndexedDB. Undefined = the real one; tests pass fake-indexeddb. */
  idb?: IDBFactory;
};

/** A project without a cached name is still shown, as something a person can tell apart. */
export function projectLabel(id: string, name: string | null | undefined): string {
  return name && name.trim() ? name.trim() : `Project ${id.slice(0, 8)}`;
}

/**
 * Combines the three things this laptop knows. The project list is the replica's (what was actually copied to this laptop); names
 * come from the cached manifest. A manifest of another person or organisation contributes nothing.
 */
export function buildShellData(input: {
  identity: DurableIdentity;
  replica: StoredManifest | null;
  names: ShellManifest | null;
  idb?: IDBFactory;
}): ShellData {
  const { identity, replica, names } = input;
  const replicaMatches = replica && replica.userId === identity.userId ? replica : null;
  const namesMatch = names && names.user.id === identity.userId ? names : null;
  const nameOf = new Map((namesMatch?.projects ?? []).map((p) => [p.id, p.name]));
  const ids = replicaMatches ? replicaMatches.projectIds : (namesMatch?.projects ?? []).map((p) => p.id);
  const orgId = replicaMatches?.orgId ?? namesMatch?.user.org_id ?? identity.orgId;
  return {
    userId: identity.userId,
    name: identity.name ?? namesMatch?.user.name ?? null,
    email: identity.email,
    role: identity.role ?? namesMatch?.user.role ?? null,
    orgId: orgId ?? null,
    projects: ids.map((id) => ({ id, name: projectLabel(id, nameOf.get(id)) })),
    idb: input.idb,
  };
}

/** Reads this person's replica manifest from THEIR database, the cached names from the device meta, and builds ShellData. */
export async function readShellData(deps: { identity: DurableIdentity; deviceMeta: MetaStore; idb?: IDBFactory }): Promise<ShellData> {
  let replica: StoredManifest | null = null;
  try {
    const idb = deps.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    if (idb) {
      const db = await openLocalDb(idb, localDbNameFor(deps.identity.userId));
      try {
        replica = (await db.getMeta<StoredManifest>(MANIFEST_KEY)) ?? null;
      } finally {
        db.close();
      }
    }
  } catch {
    replica = null;
  }
  const names = await readShellManifest(deps.deviceMeta, deps.identity.userId);
  return buildShellData({ identity: deps.identity, replica, names, idb: deps.idb });
}

// ─── the selected project ───────────────────────────────────────────────────────────────────────

export const selectedProjectKey = (userId: string) => `px-shell-project:${userId}`;

/** The project a screen works on: the one asked for in the URL, else the one this person last chose, else the first. Only a project they have. */
export function chooseProject(projects: readonly ShellProject[], requested: string | null, remembered: string | null): string | null {
  const has = (id: string | null) => (id && projects.some((p) => p.id === id) ? id : null);
  return has(requested) ?? has(remembered) ?? projects[0]?.id ?? null;
}
