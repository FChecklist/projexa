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
//
// R67 F-06: the same store now also backs the module-level reference lookups
// in src/lib/reference-lookups.ts (vendors today), which have exactly the same
// shape -- session-stable data that several screens each re-fetched on every
// mount. The mechanism is general; only the keys differ.
//
// R67 F-11 (R-146): the store also has to be WRITABLE, not only readable.
// Logging time acknowledges the write immediately by appending a pending row
// to the timesheet the user is being sent to, before the 201 comes back, and
// then replacing it with the server's own answer. That needs three things a
// read-through cache does not have: peek (what is cached right now), write
// (put this value in), and subscribe (tell the mounted panel it changed). They
// are here rather than in schedule-cache.ts because they are properties of the
// store, not of the schedule.
export const SHELL_CACHE_TTL_MS = 60_000;

// R67 F-13 (R-193/R-217). Two different kinds of shell read, two windows:
//
//  - SESSION-STABLE (the organisation, the project list): these change when a
//    human does something -- renames the org, creates a project -- and both of
//    those paths invalidate this store explicitly. Nothing else can change them
//    under the user, so re-asking every minute is pure cost. Ten minutes.
//  - EVERYTHING ELSE (the Task Master list, the pill ranking): these CAN change
//    without the user acting -- a pipeline task finishes server-side -- so they
//    keep the one-minute ceiling on staleness, and are force-refreshed on the
//    event that changes them (a Send). A ten-minute window on the task list
//    would show "needs you" for work that is already done.
export const SHELL_SESSION_TTL_MS = 600_000;

/** The shell's project-list key. Exported so the create-project path can drop
 *  it the moment a project is created, instead of the switcher being ten
 *  minutes behind the thing the user just made. */
export const SHELL_PROJECTS_KEY = "shell:projects";

type Entry = { at: number; value: unknown };

const values = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  // Copied before iterating: a listener is allowed to unsubscribe itself.
  for (const listener of Array.from(set)) listener();
}

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
    notify(key);
    return body;
  })();

  inFlight.set(key, request);
  try {
    return (await request) as T;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * What is cached for `key` right now, or undefined if nothing fresh is.
 *
 * TTL-aware on purpose: a caller that wants to show cached content instantly
 * must be shown the same value a read would have resolved to, never a stale one
 * the read itself would have discarded.
 */
export function peekShellCache<T>(key: string, ttlMs: number = SHELL_CACHE_TTL_MS): T | undefined {
  const hit = values.get(key);
  if (!hit || Date.now() - hit.at >= ttlMs) return undefined;
  return hit.value as T;
}

/**
 * Puts a value in directly, without a request, and tells subscribers.
 *
 * This is how an optimistic write reaches a panel that is already mounted. It
 * deliberately does NOT clear `inFlight`: a request that is already running is
 * still the truth in progress, and its result must be allowed to land on top.
 */
export function writeShellCache(key: string, value: unknown): void {
  values.set(key, { at: Date.now(), value });
  notify(key);
}

/** Subscribes to changes of one key. Returns the unsubscribe function. */
export function subscribeShellCache(key: string, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    const current = listeners.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(key);
  };
}

/** Drops one key (or everything) -- used on sign-out, and by tests. */
export function invalidateShellCache(key?: string): void {
  if (key) {
    values.delete(key);
    inFlight.delete(key);
    notify(key);
    return;
  }
  const known = Array.from(values.keys());
  values.clear();
  inFlight.clear();
  for (const k of known) notify(k);
}
