// LOCAL-FIRST PEERS: the browser wiring of auto-sync for one signed-in person -- the real sync service, PROJEXA's own Supabase
// client for Realtime, BroadcastChannel, ntfy.sh, real WebRTC, navigator.locks, document visibility and the online event.
// Kept apart from auto-sync.ts so that file (and its tests) stays free of browser globals and environment variables.
//
// Only ONE tab per browser runs it: startPeerSync waits for the Web Lock `px-peer-leader:<user>` and holds it for the life of
// the tab; when that tab closes, the next one takes over. Two tabs share one IndexedDB, so a second peer here would be pointless.

import { createClient } from "@/lib/supabase/client";
import { reportClientError } from "../client-error-report";
import { LOCAL_DB_VERSION, localDbNameFor, openLocalDb } from "../local-db";
import { getDeviceId } from "../outbox-shared";
import { foreignOrg } from "../replica";
import { getSharedReplica } from "../replica-shared";
import { selectedProjectKey } from "../shell/context";
import { accessToken, createSharedSyncClient, getReleaseVersion, sharedPacer } from "../shared-client";
import { resetLocalCopy } from "./reset-copy";
import { SYNC_BASE_URL, SYNC_PROTOCOL } from "../sync-client";
import { createAutoSync, type AutoSync } from "./auto-sync";
import type { RealtimeClientLike } from "./signalling";
import { broadcastChannelProvider, remoteSignalProviders } from "./signalling";
import { createServerStep } from "./server-step";
import { createRtcLink } from "./transport";
import { createIceSource } from "./ice";

/**
 * AUDIT-100 B22: the owner's relay-credential endpoint (build time, NOT a secret: it hands short-lived TURN credentials only to a
 * signed-in person). Unset: STUN only, no extra request. See ice.ts and ai-os/audit37/PEER_DIFFERENT_NETWORKS_OWNER_SCRIPT.md.
 */
const PEER_ICE_URL = process.env.NEXT_PUBLIC_PEER_ICE_URL ?? "";

const running = new Map<string, { stop: () => void }>();

async function fetchAttest(): Promise<unknown> {
  // offline: no request at all (the offline shell promises "not one request"; the cached attestation, if any, is used)
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("offline");
  const token = await accessToken();
  if (!token) throw new Error("signed out");
  const res = await fetch(`${SYNC_BASE_URL}/attest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Px-Client": `${getReleaseVersion()}; protocol=${SYNC_PROTOCOL}; schema=${LOCAL_DB_VERSION}`,
    },
    body: "{}",
  });
  if (!res.ok) throw new Error(`attest ${res.status}`);
  return res.json();
}

/** Starts automatic server + peer sync for this person in this browser (one leader tab). Safe to call again. */
export function startPeerSync(userId: string): void {
  if (typeof window === "undefined" || running.has(userId)) return;
  let auto: AutoSync | null = null;
  let stopped = false;
  let releaseLock: (() => void) | null = null;
  const onOnline = () => { void auto?.scheduler.trigger("online"); };
  const onVisibility = () => auto?.scheduler.visibilityChanged();

  const begin = async () => {
    if (stopped) return;
    const db = await openLocalDb(globalThis.indexedDB, localDbNameFor(userId));
    const client = createSharedSyncClient({ timeoutMs: 15_000, maxRetries: 1 });
    const replica = getSharedReplica(userId);
    const ice = createIceSource({ url: PEER_ICE_URL, token: accessToken, isOnline: () => navigator.onLine !== false });
    // the first links get the relay too when one is configured; never held up longer than 5 s by a slow endpoint
    await Promise.race([ice.refresh(), new Promise((r) => setTimeout(r, 5000))]);
    auto = createAutoSync({
      userId,
      selfId: `${getDeviceId()}:${userId.slice(0, 8)}`.slice(0, 64),
      db,
      fetchAttest,
      remoteProviders: remoteSignalProviders(() => createClient() as unknown as RealtimeClientLike),
      localProviders: [broadcastChannelProvider()],
      openLink: ({ initiator, sendSignal }) => {
        void ice.refresh(); // no-op while the held credentials are fresh
        return createRtcLink({ initiator, sendSignal, iceServers: ice.peek() });
      },
      // heads mode (FC cost:COST-03): ONE GET /heads per run, a project's feed only when its head moved, a reset when the view class
      // or epoch changed; an older service without /heads falls back to lf-e6's project mode (the open project every run, others hourly)
      serverStep: createServerStep({
        meta: db, changes: (r) => client.changes(r), sync: () => replica.sync(),
        syncProject: (projectId, opts) => replica.syncProject(projectId, undefined, undefined, opts),
        heads: async () => { await sharedPacer().take(); return client.heads!(); },
        resetCopy: async () => { await resetLocalCopy(db); },
        feedCurrent: (projectId) => replica.noteFeedCurrent?.(projectId),
        activeProject: () => {
          try {
            return localStorage.getItem(selectedProjectKey(userId));
          } catch {
            return null;
          }
        },
      }),
      isVisible: () => document.visibilityState === "visible",
      isOnline: () => navigator.onLine !== false,
      foreignOrg,
    });
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
  };

  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks?.request) {
    void locks.request(`px-peer-leader:${userId}`, () => new Promise<void>((resolve) => {
      releaseLock = resolve;
      void begin().catch((e) => reportClientError("peer_sync_start", e));
    }));
  } else {
    void begin().catch((e) => reportClientError("peer_sync_start", e));
  }

  running.set(userId, {
    stop() {
      stopped = true;
      auto?.stop();
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      releaseLock?.();
    },
  });
}

/** Stops it (sign-out). The local database is untouched. */
export function stopPeerSync(userId: string): void {
  running.get(userId)?.stop();
  running.delete(userId);
}
