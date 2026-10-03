// LOCAL-FIRST "Option C" (owner decision 2026-10-03): on a brand-new login and on the first login on a new machine, PROJEXA is INSTALLED into the
// browser (no .exe): the release in Cache Storage, a service worker controlling the page, persistent storage asked for, and (next step of the
// prepare screen) the person's data in IndexedDB.
//
// Before this file the prepare screen's "app" step only router.prefetch()ed ten routes (an HTTP-cache warm-up, nothing verified); the real,
// sha256-verified install ran separately in boot.ts and the screen did not wait for it. So a laptop could be told "100%, ready" with no release
// on it. This is the gate that makes the "app" step true: it finishes ONLY when
//   (a) the active release is installed in Cache Storage with every digest verified (installRelease -- reused, not re-implemented) and
//       recorded in the device meta (`app:release`);
//   (b) the service worker is active, points at that release, and controls this page;
//   (c) navigator.storage.persist() has been requested (asked, not necessarily granted: a browser may decline, the app still works).
// Anything else throws a VerifiedInstallError with a reason; the prepare screen stays up, reports the reason (prepare-report.ts) and retries
// every 15 seconds. (d), the IndexedDB replica, is the "projects" step that follows.

import { installRelease, installedCacheMissing, type CacheStorageLike, type InstallFailure, type InstallResult, type InstalledRelease, type MetaStore } from "./installer";
import { META_KEYS, releaseCacheName } from "./release-constants";
import type { SwClient } from "./sw-client";

export type VerifiedInstallReason =
  | "no_cache_storage"
  | "no_service_worker"
  | "release_not_installed"
  | "cache_incomplete"
  | "pointer_not_set"
  | "not_controlling"
  | InstallFailure;

export class VerifiedInstallError extends Error {
  readonly reason: VerifiedInstallReason;
  constructor(reason: VerifiedInstallReason, message: string) {
    super(message);
    this.name = "VerifiedInstallError";
    this.reason = reason;
  }
}

export type VerifiedInstallDeps = {
  caches: CacheStorageLike | null;
  meta: MetaStore;
  sw: SwClient;
  personId: string | null;
  localFirstOn: () => boolean;
  /** Registers /sw.js and waits for an active worker (sw-client.ts ensureServiceWorker). */
  ensureServiceWorker: () => Promise<boolean>;
  /** True once a service worker controls this page; waits a little for the claim after a first registration. */
  waitForControl: () => Promise<boolean>;
  /** Runs installRelease with the real fetch/registry wiring (browser) or a fake (tests). Must return installRelease's own result. */
  install: () => Promise<InstallResult>;
  /** navigator.storage.persist() (via ensurePersistence). Its answer is recorded, never required to be "granted". */
  requestPersistence: () => Promise<string>;
  onDetail?: (done: number, total: number) => void;
};

export type VerifiedInstallReport = {
  version: string;
  install: InstallResult["status"];
  persistence: string;
};

const TOTAL = 5;

/** The gate. Resolves only when (a), (b) and (c) above all hold; throws VerifiedInstallError otherwise. */
export async function verifiedInstall(deps: VerifiedInstallDeps): Promise<VerifiedInstallReport> {
  const detail = (n: number) => deps.onDetail?.(n, TOTAL);
  if (!deps.caches) throw new VerifiedInstallError("no_cache_storage", "This browser cannot keep PROJEXA on the laptop (no cache storage).");

  // The worker first: the release's switch is a message to it.
  if (!(await deps.ensureServiceWorker())) throw new VerifiedInstallError("no_service_worker", "The laptop worker did not start.");
  detail(1);

  // (a) the release, verified by installRelease itself (manifest digest, every file's sha256 and size, atomic switch).
  const result = await deps.install();
  if (result.status === "failed") {
    throw new VerifiedInstallError(result.reason, `PROJEXA could not be installed on this laptop (${result.reason}): ${result.error}`);
  }
  detail(2);

  // Do not trust the result alone: read back what is actually on the laptop.
  const installed = (await deps.meta.getMeta<InstalledRelease>(META_KEYS.release).catch(() => undefined)) ?? null;
  if (!installed || installed.version !== result.version) {
    throw new VerifiedInstallError("release_not_installed", "PROJEXA was downloaded but this laptop did not record it.");
  }
  if (!(await deps.caches.has(releaseCacheName(installed.version))) || (await installedCacheMissing({ caches: deps.caches, meta: deps.meta }))) {
    throw new VerifiedInstallError("cache_incomplete", `The installed copy of PROJEXA ${installed.version} is incomplete on this laptop.`);
  }
  detail(3);

  // (b) the worker names this release and controls the page.
  let status = await deps.sw.status();
  if (!status || status.version !== installed.version) {
    const reply = await deps.sw.useRelease(installed.version, deps.personId, deps.localFirstOn());
    status = reply?.ok ? await deps.sw.status() : null;
  }
  if (!status || status.version !== installed.version) {
    throw new VerifiedInstallError("pointer_not_set", "The laptop worker is not using the installed copy of PROJEXA yet.");
  }
  if (!(await deps.waitForControl())) {
    throw new VerifiedInstallError("not_controlling", "The laptop worker is not in charge of this page yet.");
  }
  detail(4);

  // (c) asked to keep the storage (a refusal is recorded by ensurePersistence, it does not stop the install).
  const persistence = await deps.requestPersistence().catch(() => "denied");
  detail(5);
  return { version: installed.version, install: result.status, persistence };
}
