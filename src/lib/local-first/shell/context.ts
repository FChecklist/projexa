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
  /**
   * The same person's VERIDIAN id (compliance.users.id), when the cached manifest holds it: the id the server writes into a row's
   * user_id. A row is the person's own when its user_id is EITHER id (lf-e10b). Null/absent: not known on this laptop yet.
   */
  personId?: string | null;
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
  // The replica's names come from the manifest of its LAST sync (a project made or given today is named at once); the cached manifest's
  // (refreshed once a day) fill in for a replica record written by an older build.
  const nameOf = new Map<string, string | null>((namesMatch?.projects ?? []).map((p) => [p.id, p.name]));
  for (const [id, name] of Object.entries(replicaMatches?.projectNames ?? {})) if (name && name.trim()) nameOf.set(id, name);
  const ids = replicaMatches ? replicaMatches.projectIds : (namesMatch?.projects ?? []).map((p) => p.id);
  const orgId = replicaMatches?.orgId ?? namesMatch?.user.org_id ?? identity.orgId;
  return {
    userId: identity.userId,
    personId: namesMatch?.user.personId ?? null,
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

// ─── the project the shell SHOWS right now (AUDIT-100 B7/B28) ───────────────────────────────────
//
// WHY: the auto-sync server step (peer/server-step.ts, heads mode) reads a moved project's feed at once only when it is the project the
// person has OPEN; any other moved project is read at most once an hour (a cost rule). It used to learn "open" from the REMEMBERED choice
// alone (localStorage, written only when the person picks a project in the switcher). A person who never picked one -- a single-project
// laptop, the dashboard opened at /local/, a link with ?projectId= -- had NO open project in the step's eyes, so after the first catch-up
// every later change of the project on their screen waited up to an hour, and an `online` trigger could not shorten that. Measured against
// the real backend (e2e/audit37-real-b7-writeback.spec.ts): a colleague's laptop missed a later RFI and an answer for 4-10+ minutes.
// The shell now notes the project it actually shows (chooseProject's answer: URL, else remembered, else the first) here, in this tab's
// memory, and the step asks `activeProjectFor`.

const shownProjects = new Map<string, string>();

/** The shell shows `projectId` for this person now (LocalShell, on every change of the shown project). Null: none shown. */
export function noteShownProject(userId: string, projectId: string | null): void {
  if (projectId) shownProjects.set(userId, projectId);
  else shownProjects.delete(userId);
}

/** The project this person has open in this tab: the one the shell shows, else the one they last chose, else null. */
export function activeProjectFor(userId: string, storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): string | null {
  const shown = shownProjects.get(userId);
  if (shown) return shown;
  try {
    return storage?.getItem(selectedProjectKey(userId)) ?? null;
  } catch {
    return null;
  }
}
