// LOCAL-FIRST shell: what the shell needs to introduce a person to their own laptop copy -- their name, their role, their
// organisation, and the NAMES of their projects -- kept in the device meta store so the shell opens with none of it fetched.
//
// The replica already stores which projects it copied (`sync:manifest`: user, organisation, project ids, kinds), but not their names.
// The sync service's GET /manifest has them, so once a day while the laptop is online one request refreshes this small record
// (`shell:manifest:<userId>`). Cost: one cheap Edge call a day; value: a project switcher that reads "Cedar Heights Villa", not an id.

import type { MetaStore } from "../release/installer";
import { manifestSignInId, type SyncClient, type SyncManifest } from "../sync-client";

export const shellManifestKey = (userId: string) => `shell:manifest:${userId}`;

export type ShellManifest = {
  /** ms since epoch this was fetched. */
  at: number;
  /**
   * `id` is the SIGN-IN id (what the shell is keyed by). `personId` is the VERIDIAN person id (compliance.users.id, the manifest's
   * user.id): what the server writes into a row's user_id (a time entry's, for one). Absent in a record cached by an older build.
   */
  user: { id: string; personId?: string | null; name: string | null; role: string | null; org_id: string };
  projects: { id: string; name: string | null; status: string | null }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function toShellManifest(manifest: SyncManifest, at: number): ShellManifest {
  return {
    at,
    // the person's SIGN-IN id (what the shell and its key are named by), not the VERIDIAN id: see manifestSignInId
    user: { id: manifestSignInId(manifest), personId: manifest.user.id || null, name: manifest.user.name ?? null, role: manifest.user.role ?? null, org_id: manifest.user.org_id },
    projects: manifest.projects.map((p) => ({ id: p.id, name: p.name ?? null, status: p.status ?? null })),
  };
}

export async function readShellManifest(meta: MetaStore, userId: string): Promise<ShellManifest | null> {
  try {
    const value = await meta.getMeta<ShellManifest>(shellManifestKey(userId));
    if (value && typeof value.at === "number" && value.user?.id === userId && Array.isArray(value.projects)) return value;
  } catch {
    /* unreadable: treated as absent */
  }
  return null;
}

export type RefreshResult = "fresh" | "refreshed" | "failed";

/** Fetches the manifest when the stored one is older than a day (or `force`). Never throws; a failure keeps the old record. */
export async function refreshShellManifest(deps: {
  client: Pick<SyncClient, "manifest">;
  meta: MetaStore;
  userId: string;
  now?: () => number;
  maxAgeMs?: number;
  force?: boolean;
  signal?: AbortSignal;
}): Promise<{ result: RefreshResult; manifest: ShellManifest | null }> {
  const now = (deps.now ?? (() => Date.now()))();
  const current = await readShellManifest(deps.meta, deps.userId);
  if (current && !deps.force && now - current.at < (deps.maxAgeMs ?? DAY_MS)) return { result: "fresh", manifest: current };
  try {
    const manifest = toShellManifest(await deps.client.manifest(deps.signal), now);
    if (manifest.user.id !== deps.userId) return { result: "failed", manifest: current }; // a manifest for someone else is never stored here
    await deps.meta.setMeta(shellManifestKey(deps.userId), manifest);
    return { result: "refreshed", manifest };
  } catch {
    return { result: "failed", manifest: current };
  }
}
