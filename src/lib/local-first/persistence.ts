// LOCAL-FIRST R10 (owner order 2026-10-02): "the app cannot be deleted from the browser until the user chooses." A browser can never be
// PROMISED not to evict a site's storage; these are the strongest tools there are, used quietly:
//
//   1. navigator.storage.persist() -- asked ONCE per laptop, the outcome kept in the device meta (persist:state);
//   2. the install-as-an-app prompt (beforeinstallprompt) is captured and offered as ONE small, calm action, never a popup; an
//      installed app is also the thing Safari does not discard after 7 days;
//   3. every start, if the active release's cache is MISSING (evicted, or the user cleared site data) and the laptop is online, the
//      release is silently installed again;
//   4. every start, if the person's workspace data is MISSING from IndexedDB but they were prepared here before and the laptop is
//      online, the existing workspace re-download runs again (wrapping prepareWorkspace(), not editing it).
//
// The user's own "clear site data" always wins; that is the user's choice. Everything is injectable and tested with fakes; the
// browser wiring is src/components/local-first/LocalFirstBoot.tsx.

import { useSyncExternalStore } from "react";
import { prepareWorkspace, readyKey, type PrepareStep } from "./prepare-workspace";
import {
  applyRegistryNumbers,
  flushPendingInstalls,
  getDeviceId,
  installRelease,
  installedCacheMissing,
  type CacheStorageLike,
  type InstalledRelease,
  type InstallResult,
  type MetaStore,
} from "./release/installer";
import { META_KEYS, releaseCacheName } from "./release/release-constants";
import { withInstallLock } from "./release/install-lock";
import type { ReleaseClient } from "./release/release-client";
import { dropReleaseKeptForAnother, type SwClient } from "./release/sw-client";

// ─── 1. persistent storage ──────────────────────────────────────────────────────────────────────

export type PersistState = {
  requestedAt: number;
  /** The answer of persist(); null while only persisted() was consulted. */
  granted: boolean | null;
  /** Why the last request was made. */
  reason: "start" | "installed";
  /** persist() is asked again once after the app is installed, because installed apps are usually granted. */
  reRequestedAfterInstall: boolean;
};

export type StorageManagerLike = { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> };

export type PersistResult = "unsupported" | "already_persistent" | "already_requested" | "granted" | "denied";

export async function ensurePersistence(
  deps: { storage: StorageManagerLike | undefined; meta: MetaStore; now?: () => number },
  reason: "start" | "installed" = "start"
): Promise<PersistResult> {
  const now = deps.now ?? (() => Date.now());
  const storage = deps.storage;
  if (!storage || typeof storage.persist !== "function") return "unsupported";
  const state = (await deps.meta.getMeta<PersistState>(META_KEYS.persistence).catch(() => undefined)) ?? null;

  let already = false;
  try {
    already = typeof storage.persisted === "function" ? await storage.persisted() : false;
  } catch {
    already = false;
  }
  if (already) {
    if (!state || state.granted !== true) {
      await deps.meta.setMeta(META_KEYS.persistence, { requestedAt: state?.requestedAt ?? now(), granted: true, reason, reRequestedAfterInstall: state?.reRequestedAfterInstall ?? false } satisfies PersistState).catch(() => {});
    }
    return "already_persistent";
  }

  // Asked once per laptop: Firefox shows the person a permission prompt for persist(), so it is never repeated at every start.
  // The single exception is right after the app was installed.
  if (state && (reason === "start" || state.reRequestedAfterInstall)) return "already_requested";

  let granted = false;
  try {
    granted = await storage.persist();
  } catch {
    granted = false;
  }
  await deps.meta
    .setMeta(META_KEYS.persistence, { requestedAt: state?.requestedAt ?? now(), granted, reason, reRequestedAfterInstall: reason === "installed" || (state?.reRequestedAfterInstall ?? false) } satisfies PersistState)
    .catch(() => {});
  return granted ? "granted" : "denied";
}

// ─── 2. the install-as-an-app prompt ────────────────────────────────────────────────────────────

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export type EventTargetLike = {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
};

export type InstallPromptState = { canInstall: boolean; installed: boolean };

export type InstallPromptController = {
  get(): InstallPromptState;
  subscribe(listener: () => void): () => void;
  /** Takes over a beforeinstallprompt event that fired before this controller existed (see LocalFirstBoot.tsx's early listener). */
  adopt(event: Event): void;
  /** Shows the browser's own install dialog (the person clicked the one calm action). */
  install(): Promise<"accepted" | "dismissed" | "unavailable">;
  /** Starts capturing the browser's events. Idempotent per target. */
  attach(target: EventTargetLike): () => void;
};

export function createInstallPrompt(deps: {
  meta?: MetaStore;
  now?: () => number;
  /** True when the page already runs as an installed app. */
  isStandalone?: () => boolean;
  /** Called after the browser says the app was installed (used to ask for persistent storage once more). */
  onInstalled?: () => void;
} = {}): InstallPromptController {
  const now = deps.now ?? (() => Date.now());
  let deferred: InstallEvent | null = null;
  let installed = deps.isStandalone?.() ?? false;
  const listeners = new Set<() => void>();
  let snapshot: InstallPromptState = { canInstall: false, installed };

  const notify = () => {
    const next = { canInstall: deferred !== null && !installed, installed };
    if (next.canInstall !== snapshot.canInstall || next.installed !== snapshot.installed) {
      snapshot = next; // a new object only when something changed, so useSyncExternalStore does not loop
      for (const l of [...listeners]) l();
    }
  };
  const record = (outcome: string) => deps.meta?.setMeta("install:prompt", { outcome, at: now() }).catch(() => {});

  return {
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async install() {
      const event = deferred;
      if (!event) return "unavailable";
      deferred = null; // a deferred prompt can be used once
      try {
        await event.prompt();
        const choice = await event.userChoice;
        void record(choice.outcome);
        notify();
        return choice.outcome;
      } catch {
        notify();
        return "unavailable";
      }
    },
    adopt(event) {
      event.preventDefault();
      deferred = event as InstallEvent;
      notify();
    },
    attach(target) {
      const onPrompt = (event: Event) => {
        event.preventDefault(); // keep the browser's own mini-infobar quiet; the offer is ours, and it is one small action
        deferred = event as InstallEvent;
        notify();
      };
      const onInstalled = () => {
        deferred = null;
        installed = true;
        void record("installed");
        notify();
        deps.onInstalled?.();
      };
      target.addEventListener("beforeinstallprompt", onPrompt);
      target.addEventListener("appinstalled", onInstalled);
      return () => {
        target.removeEventListener("beforeinstallprompt", onPrompt);
        target.removeEventListener("appinstalled", onInstalled);
      };
    },
  };
}

let sharedPrompt: InstallPromptController | null = null;

/** The tab's install prompt. Created, and attached to `window`, on first use in the browser. Call it early: the event fires once. */
export function sharedInstallPrompt(deps: Parameters<typeof createInstallPrompt>[0] = {}): InstallPromptController {
  if (!sharedPrompt) {
    sharedPrompt = createInstallPrompt({
      isStandalone: () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches,
      ...deps,
    });
    if (typeof window !== "undefined") {
      sharedPrompt.attach(window);
      // The browser fires beforeinstallprompt once, early. The root layout's tiny listener keeps it until this controller exists.
      const early = (window as unknown as { __pxInstallEvent?: Event }).__pxInstallEvent;
      if (early) sharedPrompt.adopt(early);
    }
  }
  return sharedPrompt;
}

const SERVER_INSTALL_SNAPSHOT: InstallPromptState = { canInstall: false, installed: false };

/** The one calm "Install PROJEXA on this laptop" action. canInstall is false (so nothing is shown) unless the browser offered it. */
export function useInstallPrompt(controller?: Pick<InstallPromptController, "get" | "subscribe" | "install">): InstallPromptState & { install: () => Promise<"accepted" | "dismissed" | "unavailable"> } {
  const source = controller ?? sharedInstallPrompt();
  const state = useSyncExternalStore(
    (onChange) => source.subscribe(onChange),
    () => source.get(),
    () => SERVER_INSTALL_SNAPSHOT
  );
  return { ...state, install: () => source.install() };
}

// ─── 3. the release is back if its cache went missing ──────────────────────────────────────────

export type BootReport = {
  skipped: "development" | "no_cache_storage" | "no_service_worker" | null;
  release: InstallResult | null;
  /** The worker was told which release is active (it had no pointer, or a different one). */
  pointerFixed: boolean;
  modeSynced: boolean;
  installsFlushed: number;
};

export type BootDeps = {
  isDevelopment: boolean;
  isOnline: () => boolean;
  meta: MetaStore;
  caches: CacheStorageLike | null;
  sw: SwClient;
  ensureServiceWorker: () => Promise<boolean>;
  /** The signed-in person's id (from the durable identity), or null when nobody is. */
  personId: string | null;
  /** The state of the px-local-first flag. */
  localFirstOn: () => boolean;
  registry?: ReleaseClient | null;
  fetchImpl?: typeof fetch;
  gunzip?: Parameters<typeof installRelease>[0]["gunzip"];
  now?: () => number;
  /** How long a "nothing changed" answer is trusted before the manifest is looked at again. */
  checkEveryMs?: number;
  random?: () => string;
};

const SIX_HOURS = 6 * 60 * 60 * 1000;
const LAST_CHECK_KEY = "app:last-check";

/**
 * Brings this laptop's installed release and the service worker into agreement, quietly:
 *   - offline: only the worker's pointer is repaired (needs no network);
 *   - online: the release is installed when none is, when its cache is missing, or when it is time to look for a newer one
 *     (at most every six hours, one small manifest request); the registry is told; a pending install record is delivered.
 */
export async function runLocalFirstBoot(deps: BootDeps): Promise<BootReport> {
  const report: BootReport = { skipped: null, release: null, pointerFixed: false, modeSynced: false, installsFlushed: 0 };
  if (deps.isDevelopment) return { ...report, skipped: "development" };
  if (!deps.caches) return { ...report, skipped: "no_cache_storage" };
  const now = deps.now ?? (() => Date.now());
  const caches = deps.caches;

  const swReady = await deps.ensureServiceWorker();
  if (!swReady) return { ...report, skipped: "no_service_worker" };

  // A release another person kept on this laptop at their sign-out is dropped first (sw-client.ts dropReleaseKeptForAnother).
  await dropReleaseKeptForAnother(deps.sw, deps.personId).catch(() => false);
  const online = deps.isOnline();
  if (online) {
    const missing = await installedCacheMissing({ caches, meta: deps.meta });
    const installed = (await deps.meta.getMeta<InstalledRelease>(META_KEYS.release).catch(() => undefined)) ?? null;
    const lastCheck = (await deps.meta.getMeta<number>(LAST_CHECK_KEY).catch(() => undefined)) ?? 0;
    const due = !installed || missing || now() - lastCheck >= (deps.checkEveryMs ?? SIX_HOURS);
    if (due) {
      const deviceId = await getDeviceId(deps.meta, deps.random);
      const registry = deps.registry ?? null;
      report.release = await withInstallLock(() => installRelease({
        fetchImpl: deps.fetchImpl,
        caches,
        meta: deps.meta,
        now,
        gunzip: deps.gunzip,
        deviceId,
        switchTo: async (version) => {
          const reply = await deps.sw.useRelease(version, deps.personId, deps.localFirstOn());
          if (!reply || !reply.ok) throw new Error(reply ? String(reply.error ?? "refused") : "the worker did not answer");
        },
        registry: registry ? async (wanted) => (await registry.ensureRegistered(undefined, wanted))?.current ?? null : undefined,
        recordInstall: registry ? (record) => registry.recordInstall(record) : undefined,
      }));
      if (report.release.status !== "failed") await deps.meta.setMeta(LAST_CHECK_KEY, now()).catch(() => {});
      if (registry) {
        report.installsFlushed = await flushPendingInstalls(deps.meta, (r) => registry.recordInstall(r)).catch(() => 0);
        if (report.release.status === "current") await applyRegistryNumbers(deps.meta, (await registry.current())?.current ?? null).catch(() => false);
      }
    }
  }

  // The worker's pointer must name the installed release, belong to this person, and carry the current mode.
  const installedNow = (await deps.meta.getMeta<InstalledRelease>(META_KEYS.release).catch(() => undefined)) ?? null;
  if (installedNow && (await caches.has(releaseCacheName(installedNow.version)))) {
    const status = await deps.sw.status();
    if (status) {
      const pointerVersion = status.version as string | null;
      const pointerPerson = (status.personId as string | null | undefined) ?? null;
      const wrongRelease = pointerVersion !== installedNow.version;
      const wrongPerson = deps.personId !== null && pointerPerson !== null && pointerPerson !== deps.personId;
      if (status.signedOut === true && deps.personId === null) {
        // a release kept by a signed-out person stays signed out until a person is known (nothing to point it at)
      } else if (wrongRelease || wrongPerson) {
        // The worker has no pointer (it was cleared or evicted), or it names another release or person: point it at ours.
        report.pointerFixed = Boolean((await deps.sw.useRelease(installedNow.version, deps.personId, deps.localFirstOn()))?.ok);
      } else if (deps.personId !== null && pointerPerson === null) {
        report.pointerFixed = Boolean((await deps.sw.setPerson(deps.personId))?.ok);
      }
      if (!wrongRelease && status.localFirst !== deps.localFirstOn()) {
        report.modeSynced = Boolean((await deps.sw.setMode(deps.localFirstOn()))?.ok);
      }
    }
  }
  return report;
}

// ─── 4. the person's data is back if IndexedDB lost it ─────────────────────────────────────────

export type WorkspaceDataDeps = {
  isOnline: () => boolean;
  /** localStorage.getItem(readyKey(userId)): was this laptop prepared for this person before? */
  wasPrepared: () => boolean;
  /** Does this person's local database still hold its sync marker? */
  hasData: () => Promise<boolean>;
  /** The replica's sync of every readable project (it resumes and only pulls what is missing). */
  redownload: (signal: AbortSignal, onDetail: (done: number, total: number) => void) => Promise<{ status: string }>;
  budgetMs?: number;
};

export type WorkspaceDataResult = "not_online" | "never_prepared" | "present" | "redownloaded" | "failed";

/** Silently re-runs the workspace download when the data was prepared before but IndexedDB no longer has it. */
export async function ensureWorkspaceData(deps: WorkspaceDataDeps): Promise<WorkspaceDataResult> {
  if (!deps.isOnline()) return "not_online";
  if (!deps.wasPrepared()) return "never_prepared"; // the first-run "Preparing your workspace" screen handles a laptop never prepared
  let present = true;
  try {
    present = await deps.hasData();
  } catch {
    present = true; // cannot tell: do not start a large download on a guess
  }
  if (present) return "present";
  const step: PrepareStep = {
    id: "projects",
    label: "Copy your projects to this laptop",
    weight: 100,
    run: async ({ signal, onDetail }) => {
      const report = await deps.redownload(signal, onDetail);
      if (report.status !== "done") throw new Error(`The workspace re-download ended as ${report.status}.`);
    },
  };
  const result = await prepareWorkspace({ steps: [step], budgetMs: deps.budgetMs, onProgress: () => {} });
  return result.ready ? "redownloaded" : "failed";
}

export { readyKey };
