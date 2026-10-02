// LOCAL-FIRST browser AI: WHO the AI is working for on this laptop -- the person, their role, their organisation, the
// names of their projects and their "let my AI act without asking" setting -- remembered in the person's own local
// database so the AI surface knows it with no internet and with our server down (R1, R2, R11).
//
// WHERE IT COMES FROM. The sync service's GET /manifest (CONTRACT.md section 1): {user:{id, name, role, org_id},
// projects:[{id, name}]}. The replica stores only the ids it needs (replica.ts StoredManifest has no role and no names),
// so this file keeps its own meta entry, `ai:identity`, refreshed whenever the app can reach the service and read
// back when it cannot. Nothing here is authority: the role only lets the laptop refuse early; the server decides.
//
// THE SETTING. "Let my AI act without asking" is read from the manifest when the service sends it (any of
// `settings.ai_act_without_asking`, `user.ai_act_without_asking`, `user.settings.ai_act_without_asking` equal to true).
// Absent means OFF: every AI delete is a draft the person confirms with one click. The laptop never turns it on by itself.

import type { SyncManifest } from "../sync-client";

export const AI_IDENTITY_KEY = "ai:identity";

export type AiIdentity = {
  userId: string;
  orgId: string;
  name: string | null;
  role: string | null;
  projects: { id: string; name: string | null }[];
  settings: { aiActWithoutAsking: boolean };
  /** ms since epoch when the service last told us this. */
  at: number;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function actWithoutAsking(manifest: unknown): boolean {
  if (!isObject(manifest)) return false;
  const user = isObject(manifest.user) ? manifest.user : {};
  const candidates = [
    isObject(manifest.settings) ? manifest.settings.ai_act_without_asking : undefined,
    user.ai_act_without_asking,
    isObject(user.settings) ? user.settings.ai_act_without_asking : undefined,
  ];
  return candidates.some((v) => v === true);
}

/** The identity a sync manifest describes. Pure. */
export function identityFromManifest(manifest: SyncManifest, at: number): AiIdentity {
  return {
    userId: manifest.user.id,
    orgId: manifest.user.org_id,
    name: typeof manifest.user.name === "string" ? manifest.user.name : null,
    role: typeof manifest.user.role === "string" && manifest.user.role ? manifest.user.role : null,
    projects: manifest.projects.map((p) => ({ id: p.id, name: typeof p.name === "string" ? p.name : null })),
    settings: { aiActWithoutAsking: actWithoutAsking(manifest) },
    at,
  };
}

type Meta = { getMeta<T = unknown>(key: string): Promise<T | undefined>; setMeta(key: string, value: unknown): Promise<void> };

/** Stores what the service said, unless it describes a different person or organisation than the laptop copy. */
export async function rememberIdentity(meta: Meta, manifest: SyncManifest, userId: string, at: number): Promise<AiIdentity | null> {
  if (manifest.user.id !== userId) return null;
  const previous = await meta.getMeta<AiIdentity>(AI_IDENTITY_KEY);
  if (previous && previous.orgId !== manifest.user.org_id) return null;
  const identity = identityFromManifest(manifest, at);
  await meta.setMeta(AI_IDENTITY_KEY, identity);
  return identity;
}

export async function readIdentity(meta: Meta, userId: string): Promise<AiIdentity | null> {
  const stored = await meta.getMeta<AiIdentity>(AI_IDENTITY_KEY);
  return stored && stored.userId === userId ? stored : null;
}
