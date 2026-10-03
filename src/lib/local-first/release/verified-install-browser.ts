// LOCAL-FIRST: the real-browser wiring of the verified install (verified-install.ts) for the "Preparing your workspace" screen. Same wiring
// as boot.ts's runLocalFirstBoot uses for its quiet install (same installer, registry client, device meta, service worker client); the
// difference is only that this one is awaited by the screen and its failures are thrown, so the screen cannot reach 100% without it.

import { LOCAL_DB_VERSION } from "../local-db";
import { deviceMetaStore } from "../device-meta";
import { accessToken, getReleaseVersion } from "../shared-client";
import { ensurePersistence } from "../persistence";
import { flushPendingInstalls, getDeviceId, installRelease, type CacheStorageLike } from "./installer";
import { withInstallLock } from "./install-lock";
import { createReleaseClient } from "./release-client";
import { rememberRunningRelease } from "./running-release";
import { createSwClient, ensureServiceWorker } from "./sw-client";
import { verifiedInstall, type VerifiedInstallDeps, type VerifiedInstallReport } from "./verified-install";

/**
 * Waits for a service worker to control this page. A first registration claims clients a moment after it activates; but a page that
 * loaded WHILE the worker was activating (found by e2e/lf-lifecycle-install.spec.ts: a person who opens the login page, then signs in)
 * can be left with an active worker and no controller, and no controllerchange ever arrives. So after a short wait the worker is asked
 * to claim the page, and the wait continues.
 */
export async function waitForControl(claim: () => Promise<unknown> = async () => createSwClient().claim?.(), timeoutMs = 10_000, askAfterMs = 1_500): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  const sw = navigator.serviceWorker;
  if (sw.controller) return true;
  return new Promise<boolean>((resolve) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const done = (v: boolean) => { timers.forEach(clearTimeout); sw.removeEventListener("controllerchange", onChange); resolve(v); };
    const onChange = () => { if (sw.controller) done(true); };
    timers.push(setTimeout(() => { void claim().then(() => { if (sw.controller) done(true); }).catch(() => {}); }, askAfterMs));
    timers.push(setTimeout(() => done(Boolean(sw.controller)), timeoutMs));
    sw.addEventListener("controllerchange", onChange);
  });
}

export function browserVerifiedInstallDeps(personId: string | null, localFirstOn: () => boolean, onDetail?: (d: number, t: number) => void): VerifiedInstallDeps {
  const meta = deviceMetaStore();
  const sw = createSwClient();
  const caches = typeof globalThis.caches === "undefined" ? null : (globalThis.caches as unknown as CacheStorageLike);
  const registry = () => createReleaseClient({ getAccessToken: accessToken, clientVersion: getReleaseVersion, schema: LOCAL_DB_VERSION });
  return {
    caches,
    meta,
    sw,
    personId,
    localFirstOn,
    ensureServiceWorker: () => ensureServiceWorker(),
    waitForControl: () => waitForControl(async () => sw.claim?.()),
    install: () =>
      withInstallLock(async () => {
        const client = registry();
        const result = await installRelease({
          caches: caches!,
          meta,
          deviceId: await getDeviceId(meta),
          switchTo: async (version) => {
            const reply = await sw.useRelease(version, personId, localFirstOn());
            if (!reply || !reply.ok) throw new Error(reply ? String(reply.error ?? "refused") : "the worker did not answer");
          },
          registry: async (wanted) => (await client.ensureRegistered(undefined, wanted))?.current ?? null,
          recordInstall: (record) => client.recordInstall(record),
        });
        if (result.status !== "failed") {
          rememberRunningRelease(result.version);
          await flushPendingInstalls(meta, (r) => client.recordInstall(r)).catch(() => 0);
        }
        return result;
      }),
    requestPersistence: () => ensurePersistence({ storage: navigator.storage, meta }, "installed"),
    onDetail,
  };
}

export function runBrowserVerifiedInstall(personId: string | null, localFirstOn: () => boolean, onDetail?: (d: number, t: number) => void): Promise<VerifiedInstallReport> {
  return verifiedInstall(browserVerifiedInstallDeps(personId, localFirstOn, onDetail));
}
