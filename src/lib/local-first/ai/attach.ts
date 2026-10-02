// LOCAL-FIRST browser AI: AUTO-ATTACH with zero setup (requirement R11: "nothing for the user to set up"; R12: "the
// user does not have to think"). Called by AiAttach.tsx on every signed-in page of the app shell, as soon as the
// person is known. It:
//   1. refreshes who the person is (role, project names, the "let my AI act without asking" setting) from the sync
//      service's /manifest -- only when online and at most every IDENTITY_REFRESH_MS, best effort, never blocking: the
//      stored copy is what makes it work offline and with our server down;
//   2. builds the surface (api.ts) with the release check (integrity.ts) against the device database and Cache Storage;
//   3. publishes window.projexa.ai (publish.ts) and registers the WebMCP tools when the browser has them (webmcp.ts).
// detach() undoes 3 (sign-out, another person).
//
// Every browser object is injected, so the boot is tested without a browser.

import { LOCAL_DB_NAME, localDbNameFor, openLocalDb } from "../local-db";
import type { Outbox } from "../outbox";
import type { SyncManifest } from "../sync-client";
import { createAiSurface, type AiSurface } from "./api";
import { AI_IDENTITY_KEY, rememberIdentity, type AiIdentity } from "./identity";
import { verifyInstalledRelease, type CachesLike, type IntegrityReport } from "./integrity";
import { publishAiSurface } from "./publish";
import { registerWebMcp, type ModelContextLike } from "./webmcp";

export const IDENTITY_REFRESH_MS = 6 * 60 * 60 * 1000;

export type AttachDeps = {
  userId: string;
  win: Parameters<typeof publishAiSurface>[0];
  nav?: { modelContext?: ModelContextLike; onLine?: boolean } | null;
  idb: IDBFactory;
  caches?: CachesLike | null;
  /** The person's outbox (lazily: the outbox is only started when the AI actually writes). */
  outbox: Pick<Outbox, "enqueue">;
  /** GET /manifest of the sync service. Absent: no refresh (the stored identity is used). */
  fetchManifest?: () => Promise<SyncManifest>;
  onTamper?: (report: Extract<IntegrityReport, { status: "tampered" }>) => void;
  now?: () => number;
};

export type Attached = { surface: AiSurface; webmcp: string[]; detach: () => void; identityRefreshed: boolean };

async function refreshIdentity(deps: AttachDeps, now: number): Promise<boolean> {
  if (!deps.fetchManifest || deps.nav?.onLine === false) return false;
  const db = await openLocalDb(deps.idb, localDbNameFor(deps.userId));
  try {
    const stored = await db.getMeta<AiIdentity>(AI_IDENTITY_KEY);
    if (stored && stored.userId === deps.userId && now - stored.at < IDENTITY_REFRESH_MS) return false;
    const manifest = await deps.fetchManifest();
    return (await rememberIdentity(db, manifest, deps.userId, now)) !== null;
  } catch {
    return false; // offline, our server down, signed out: the stored identity stays
  } finally {
    db.close();
  }
}

export async function attachAi(deps: AttachDeps): Promise<Attached> {
  const now = deps.now ?? Date.now;
  const identityRefreshed = await refreshIdentity(deps, now());
  const surface = createAiSurface({
    userId: deps.userId,
    idb: deps.idb,
    outbox: deps.outbox,
    now,
    onTamper: deps.onTamper,
    integrity: async () => {
      const device = await openLocalDb(deps.idb, LOCAL_DB_NAME);
      try {
        return await verifyInstalledRelease({ meta: device, caches: deps.caches ?? null, now });
      } finally {
        device.close();
      }
    },
  });
  // Start the check now, so the first question an AI asks is not the one that waits for it.
  void surface.integrity();
  const unpublish = publishAiSurface(deps.win, surface.api);
  const mcp = registerWebMcp(deps.nav ?? null, surface.api);
  return {
    surface,
    webmcp: mcp.registered,
    identityRefreshed,
    detach: () => {
      mcp.unregister();
      unpublish();
    },
  };
}
