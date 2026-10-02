// LOCAL-FIRST release: which release this laptop RUNS, for the X-Px-Client header of every sync call (CONTRACT.md "Every call").
//
// WHY (package lf-e12, found in a real browser): the sync client named its release as NEXT_PUBLIC_PX_RELEASE, which nothing sets (the
// release is made by scripts/make-release.mjs AFTER `next build`, so no build can know its own release number), falling back to the
// commit sha on a deployment and "dev" elsewhere. The service's release floor (handler.ts updateRequired) only applies to a header whose
// release matches YYYY.MM.DD-NNN, so NO laptop could ever be held below min_compatible: an old laptop would keep pushing with an old
// protocol of its data. The release a laptop runs is the one it INSTALLED (device meta `app:release`), the same one the release client
// already names; the boot remembers it here (localStorage: the header is built synchronously, and every tab of the laptop shares it).
//
// Pure apart from the default storage; a value that is not a release number is never returned.

export const RUNNING_RELEASE_KEY = "px-release-running";
const RELEASE_RE = /^\d{4}\.\d{2}\.\d{2}-\d{3}$/;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Remembers the installed release (null forgets it). Never throws. */
export function rememberRunningRelease(version: string | null, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (version && RELEASE_RE.test(version)) storage.setItem(RUNNING_RELEASE_KEY, version);
    else if (version === null) storage.removeItem(RUNNING_RELEASE_KEY);
  } catch {
    /* storage refused: the header falls back to the build's name */
  }
}

/** The installed release, or null when none is known on this laptop. */
export function runningRelease(storage: StorageLike | null = defaultStorage()): string | null {
  if (!storage) return null;
  try {
    const v = storage.getItem(RUNNING_RELEASE_KEY);
    return v && RELEASE_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** What X-Px-Client names: the installed release; without one, the build's own name (a deployment's commit, or "dev"). */
export function clientRelease(deps: { storage?: StorageLike | null; buildName?: string | null } = {}): string {
  return runningRelease(deps.storage === undefined ? defaultStorage() : deps.storage) ?? (deps.buildName || "dev");
}
