// R67 F-01 (R-006/R-011). The app shell (M24Shell) remounts on every
// navigation, and on every remount it re-fetched the same session-stable
// reads: GET /api/organization and GET /api/projects. Neither changes between
// two clicks -- an organisation's name and its project list are not per-page
// data -- yet they were on the critical path of every single page in PROJEXA,
// alongside the page's own fetches, competing for the browser's connections.
//
// This is the smallest thing that fixes it honestly: a module-level
// stale-while-revalidate store, alive for the life of the tab.
//
//  - A read inside the TTL resolves from memory, with no request at all.
//  - Concurrent readers of the same key share ONE in-flight request, so two
//    components mounting together cannot produce two identical calls.
//  - A failure is never cached. Caching "the org failed to load" for a minute
//    would turn one blip into a minute of a broken header.
//  - `force` bypasses everything, for the paths that genuinely must re-read
//    (see M24Shell's F_025 cross-tab identity fix, which must not be blunted
//    by a 60-second window).
//
// Deliberately NOT sessionStorage: this is identity-adjacent data, and it
// should die with the page, not linger in a store another sign-in could read.
export const SHELL_CACHE_TTL_MS = 60_000;

type Entry = { at: number; value: unknown };

const values = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();

export class ShellFetchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ShellFetchError";
    this.status = status;
  }
}

/**
 * Fetches `url` as JSON, memoised per `key` for `ttlMs`.
 *
 * Throws {@link ShellFetchError} carrying the backend's own `error` string on
 * a non-2xx response -- the shell shows that message rather than inventing
 * one, and rather than letting an error body parse as data (the
 * R48_HTTP_ERROR_SWALLOWED_AS_EMPTY_LIST_01 defect).
 */
export async function cachedShellJson<T>(
  key: string,
  url: string,
  options: { ttlMs?: number; force?: boolean } = {}
): Promise<T> {
  const ttlMs = options.ttlMs ?? SHELL_CACHE_TTL_MS;

  if (!options.force) {
    const hit = values.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const request = (async () => {
    const res = await fetch(url);
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const fromBody =
        body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error.trim()
          : "";
      throw new ShellFetchError(fromBody || `HTTP ${res.status}`, res.status);
    }
    values.set(key, { at: Date.now(), value: body });
    return body;
  })();

  inFlight.set(key, request);
  try {
    return (await request) as T;
  } finally {
    inFlight.delete(key);
  }
}

/** Drops one key (or everything) -- used on sign-out, and by tests. */
export function invalidateShellCache(key?: string): void {
  if (key) {
    values.delete(key);
    inFlight.delete(key);
    return;
  }
  values.clear();
  inFlight.clear();
}
