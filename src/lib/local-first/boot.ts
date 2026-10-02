// LOCAL-FIRST boot: what runs, once per page load and quietly, so that "the user never has to think" (R12) while the app stays on the
// laptop (R1, R2), the login lasts (R9) and the app is hard to lose (R10). Loaded after hydration by components/local-first/LocalFirstBoot.tsx,
// as its own chunk, so no public page pays for it.
//
//   always            keep the identity mirror in step with the Supabase session; rebuild a lost session from the mirror
//   signed in         ask for persistent storage (once), capture the install prompt, make sure the release is installed (silently
//                     re-installed when its cache went missing), keep the worker's person/mode right, refresh the cached project
//                     names and the person's role once a day, bring the data back if IndexedDB lost it
//   laptop back online  the same checks again (at most once a minute)
//
// Nothing here shows anything. The only visible results are the calm connectivity marker and the one optional "Install" action.
// Everything with a side effect is injected (BootWiring), so the order of events is tested with fakes.

import { browserIsOffline } from "@/lib/supabase/durable-auth";
import { sharedConnectivity, withConnectivityReporting, type ConnectivityController } from "./connectivity";
import { deviceMetaStore, openDeviceMeta } from "./device-meta";
import {
  createIdentityStore,
  getDurableIdentity,
  restoreSessionIfMissing,
  startIdentityMirror,
  updateIdentityProfile,
  type AuthLike,
  type IdentityStore,
} from "./identity";
import { isLocalFirstEnabled, LOCAL_FIRST_FLAG } from "./mode";
import { MANIFEST_KEY } from "./replica";
import { localDbNameFor, openLocalDb, LOCAL_DB_VERSION } from "./local-db";
import { readyKey } from "./prepare-workspace";
import {
  ensurePersistence,
  ensureWorkspaceData,
  runLocalFirstBoot,
  sharedInstallPrompt,
  type StorageManagerLike,
  type WorkspaceDataDeps,
} from "./persistence";
import { createReleaseClient, type ReleaseClient } from "./release/release-client";
import type { CacheStorageLike, InstalledRelease, MetaStore } from "./release/installer";
import { META_KEYS } from "./release/release-constants";
import { createSwClient, ensureServiceWorker as registerWorker, type SwClient } from "./release/sw-client";
import { refreshShellManifest } from "./shell/manifest-cache";
import { createSyncClient, type SyncClient } from "./sync-client";

export type BootWiring = {
  isDevelopment: boolean;
  isOnline: () => boolean;
  /** The Supabase auth client (browser). */
  auth: AuthLike;
  identityStore: IdentityStore;
  deviceMeta: MetaStore;
  caches: CacheStorageLike | null;
  storage: StorageManagerLike | undefined;
  sw: SwClient;
  ensureServiceWorker: () => Promise<boolean>;
  localFirstOn: () => boolean;
  syncClient: () => Pick<SyncClient, "manifest">;
  /** The registry client; `clientVersion` is the release this laptop runs now (for X-Px-Client). */
  releaseClient: (clientVersion: string | null) => ReleaseClient;
  workspace: (userId: string) => WorkspaceDataDeps;
  /** For the release install's network and unpacking (tests pass fakes; the browser uses its own). */
  fetchImpl?: typeof fetch;
  gunzip?: Parameters<typeof runLocalFirstBoot>[0]["gunzip"];
  /** Subscribes to browser events; returns the unsubscribe. */
  listen: (type: "online" | "storage", fn: (event: any) => void) => () => void;
  now?: () => number;
};

export type BootHandle = { stop(): void; /** Resolves when the current pass is finished (tests). */ settled(): Promise<void> };

const MIN_RERUN_MS = 60_000;

/** One pass: everything that needs a known person. Safe to run again; each part checks whether it has anything to do. */
export async function runBootPass(wiring: BootWiring): Promise<{ personId: string | null }> {
  const identity = await getDurableIdentity(wiring.identityStore);
  if (!identity) return { personId: null };
  const personId = identity.userId;
  const online = wiring.isOnline();

  // R10: persistent storage, asked once; the release and the data are put back if the browser evicted them.
  void ensurePersistence({ storage: wiring.storage, meta: wiring.deviceMeta }).catch(() => {});

  // The release and the worker (offline repairs happen too: they need no network).
  const installed = (await wiring.deviceMeta.getMeta<InstalledRelease>(META_KEYS.release).catch(() => undefined)) ?? null;
  const releaseClient = wiring.releaseClient(installed?.version ?? null);
  await runLocalFirstBoot({
    isDevelopment: wiring.isDevelopment,
    isOnline: wiring.isOnline,
    meta: wiring.deviceMeta,
    caches: wiring.caches,
    sw: wiring.sw,
    ensureServiceWorker: wiring.ensureServiceWorker,
    personId,
    localFirstOn: wiring.localFirstOn,
    registry: online ? releaseClient : null,
    fetchImpl: wiring.fetchImpl,
    gunzip: wiring.gunzip,
    now: wiring.now,
  }).catch(() => null);

  if (!online) return { personId };

  // The cached project names and the person's role/organisation, once a day.
  const refreshed = await refreshShellManifest({ client: wiring.syncClient(), meta: wiring.deviceMeta, userId: personId, now: wiring.now }).catch(() => null);
  if (refreshed?.result === "refreshed" && refreshed.manifest) {
    await updateIdentityProfile(wiring.identityStore, { orgId: refreshed.manifest.user.org_id, role: refreshed.manifest.user.role ?? undefined, name: refreshed.manifest.user.name ?? undefined }).catch(() => null);
  }

  // R10: the person's data is back if IndexedDB lost it.
  await ensureWorkspaceData(wiring.workspace(personId)).catch(() => null);
  return { personId };
}

/** Starts the boot: the always-on parts at once, then a pass, then again whenever the laptop comes back online. */
export function startBoot(wiring: BootWiring): BootHandle {
  const stopMirror = startIdentityMirror(wiring.auth, wiring.identityStore, { isOffline: () => !wiring.isOnline(), now: wiring.now });
  let stopped = false;
  let current: Promise<unknown> = Promise.resolve();
  let lastPassAt = Number.NEGATIVE_INFINITY;
  const clock = wiring.now ?? (() => Date.now());

  const pass = () => {
    lastPassAt = clock();
    current = (async () => {
      // A lost cookie is rebuilt from the mirror before anything needs the session.
      await restoreSessionIfMissing(wiring.auth, wiring.identityStore, { isOffline: () => !wiring.isOnline() }).catch(() => null);
      if (!stopped) await runBootPass(wiring).catch(() => null);
    })();
  };
  pass();

  const stopOnline = wiring.listen("online", () => {
    if (stopped || clock() - lastPassAt < MIN_RERUN_MS) return;
    pass();
  });
  // Another tab turned local-first mode on or off: tell the worker.
  const stopStorage = wiring.listen("storage", (event: { key?: string | null }) => {
    if (stopped || event?.key !== LOCAL_FIRST_FLAG) return;
    void wiring.sw.setMode(wiring.localFirstOn()).catch(() => null);
  });

  return {
    stop() {
      stopped = true;
      stopMirror();
      stopOnline();
      stopStorage();
    },
    settled: () => current.then(() => undefined),
  };
}

// ─── the real wiring ────────────────────────────────────────────────────────────────────────────

/** Builds the browser wiring and starts the boot. Called once, after hydration. */
export async function startLocalFirstBoot(): Promise<BootHandle> {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const connectivity: ConnectivityController = sharedConnectivity();
  const reporting = withConnectivityReporting((input, init) => fetch(input, init), connectivity);
  const accessToken = async () => (await supabase.auth.getSession()).data.session?.access_token ?? null;
  const deviceMeta = deviceMetaStore();
  const sw = createSwClient();
  // Starts capturing the install prompt (and adopts the one the root layout's early listener kept); a later install asks for
  // persistent storage once more.
  sharedInstallPrompt({ meta: deviceMeta, onInstalled: () => void ensurePersistence({ storage: navigator.storage, meta: deviceMeta }, "installed").catch(() => {}) });

  const wiring: BootWiring = {
    isDevelopment: process.env.NODE_ENV === "development",
    isOnline: () => !browserIsOffline(),
    auth: supabase.auth as unknown as AuthLike,
    identityStore: createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta() }),
    deviceMeta,
    caches: typeof caches === "undefined" ? null : (caches as unknown as CacheStorageLike),
    storage: typeof navigator === "undefined" ? undefined : navigator.storage,
    sw,
    ensureServiceWorker: () => registerWorker(),
    localFirstOn: isLocalFirstEnabled,
    syncClient: () => createSyncClient({ getAccessToken: accessToken, fetchImpl: reporting, timeoutMs: 15_000, maxRetries: 1 }),
    releaseClient: (clientVersion) => createReleaseClient({ getAccessToken: accessToken, clientVersion: () => clientVersion, schema: LOCAL_DB_VERSION, fetchImpl: reporting }),
    workspace: (userId) => ({
      isOnline: () => !browserIsOffline(),
      wasPrepared: () => {
        try {
          return localStorage.getItem(readyKey(userId)) !== null;
        } catch {
          return false;
        }
      },
      hasData: async () => {
        const db = await openLocalDb(undefined, localDbNameFor(userId));
        try {
          return (await db.getMeta(MANIFEST_KEY)) !== undefined;
        } finally {
          db.close();
        }
      },
      redownload: async (signal, onDetail) => {
        const { getSharedReplica } = await import("./replica-shared");
        return getSharedReplica(userId).sync(signal, (p) => onDetail(p.projectsDone, p.projectsTotal));
      },
    }),
    listen: (type, fn) => {
      window.addEventListener(type, fn);
      return () => window.removeEventListener(type, fn);
    },
  };
  return startBoot(wiring);
}
