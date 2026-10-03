// LOCAL-FIRST release: one install at a time per browser. The "Preparing your workspace" screen (verified-install.ts) and the quiet boot
// (persistence.ts runLocalFirstBoot) can both decide to install the release at the same moment on a first login; installRelease throws away
// "a leftover of an earlier attempt at the same version", so two overlapping runs could delete each other's half-written cache. The Web Locks
// API serialises them across tabs too; where it does not exist the call just runs (the old behaviour).

export const INSTALL_LOCK_NAME = "px-release-install";

type LockManagerLike = { request<T>(name: string, callback: () => Promise<T>): Promise<T> };

export function withInstallLock<T>(fn: () => Promise<T>, locks?: LockManagerLike | null): Promise<T> {
  const manager = locks === undefined ? (typeof navigator !== "undefined" ? ((navigator as unknown as { locks?: LockManagerLike }).locks ?? null) : null) : locks;
  if (!manager || typeof manager.request !== "function") return fn();
  return manager.request(INSTALL_LOCK_NAME, fn);
}
