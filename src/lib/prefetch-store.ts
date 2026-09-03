"use client";

// R67 F-22 (audit recommendation R-247) -- speculative prefetch, bounded.
//
// WHY. Scope and Work Progress are the two screens a site engineer opens most
// and the two slowest lists, and both are one click from the dashboard. The
// five seconds a user spends reading the dashboard are five seconds the
// network is idle. This spends them.
//
// SPECULATION HAS TO BE CHEAP OR IT IS A REGRESSION, so it is bounded four
// ways and every bound is enforced here rather than trusted to call sites:
//
//   TTL 60 s          -- an entry older than that is a stale answer pretending
//                        to be a fast one, and is dropped rather than shown.
//   AT MOST 5 ENTRIES -- oldest evicted first, so a user hovering across a
//                        directory of forty modules cannot fill memory.
//   CONCURRENCY 2     -- speculation must never compete with a request the
//                        user is actually waiting for. Extra work queues.
//   ONE FLIGHT PER KEY-- hovering the same link twice does not fetch twice.
//
// Nothing here is ever awaited by a render path: a prefetch that fails is
// simply forgotten, and the screen fetches normally.

export const PREFETCH_TTL_MS = 60_000;
export const PREFETCH_MAX_ENTRIES = 5;
export const PREFETCH_MAX_CONCURRENCY = 2;

export type PrefetchEntry<T = unknown> = { data: T; fetchedAt: number };

const entries = new Map<string, PrefetchEntry>();
const inFlight = new Set<string>();
const queue: { key: string; fetcher: () => Promise<unknown> }[] = [];

/** Test seam. */
export function resetPrefetchStore(): void {
  entries.clear();
  inFlight.clear();
  queue.length = 0;
}

export function prefetchStats(): { entries: number; inFlight: number; queued: number } {
  return { entries: entries.size, inFlight: inFlight.size, queued: queue.length };
}

/** Oldest-first eviction, so the cap is a real cap and not a leak. */
function evictToCap(): void {
  while (entries.size > PREFETCH_MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [key, entry] of entries) {
      if (entry.fetchedAt < oldestAt) {
        oldestAt = entry.fetchedAt;
        oldestKey = key;
      }
    }
    if (oldestKey === null) return;
    entries.delete(oldestKey);
  }
}

function pump(): void {
  while (inFlight.size < PREFETCH_MAX_CONCURRENCY && queue.length > 0) {
    const next = queue.shift();
    if (!next) return;
    if (inFlight.has(next.key)) continue;
    inFlight.add(next.key);
    void next
      .fetcher()
      .then((data) => {
        entries.set(next.key, { data, fetchedAt: Date.now() });
        evictToCap();
      })
      // A speculative fetch that fails is forgotten. The user never asked for
      // it, so it must never produce an error on screen; the real read will
      // report its own failure in its own words if it happens too.
      .catch(() => {})
      .finally(() => {
        inFlight.delete(next.key);
        pump();
      });
  }
}

/**
 * Speculatively fill `key`. Returns immediately; never throws.
 *
 * A key that is already fresh, already in flight or already queued is a no-op,
 * so a hover that fires repeatedly costs one request at most.
 */
export function prefetch(key: string, fetcher: () => Promise<unknown>): void {
  if (readPrefetch(key) !== null) return;
  if (inFlight.has(key) || queue.some((q) => q.key === key)) return;
  queue.push({ key, fetcher });
  pump();
}

/** A fresh speculative answer for `key`, or null. Expired entries are dropped. */
export function readPrefetch<T = unknown>(key: string, now: number = Date.now()): PrefetchEntry<T> | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (now - entry.fetchedAt >= PREFETCH_TTL_MS) {
    entries.delete(key);
    return null;
  }
  return entry as PrefetchEntry<T>;
}

/** Drop a speculative answer a write has just made wrong. */
export function invalidatePrefetch(key: string): void {
  entries.delete(key);
}

/** Drop every speculative answer whose key contains `fragment` (e.g. a module). */
export function invalidatePrefetchMatching(fragment: string): void {
  for (const key of [...entries.keys()]) {
    if (key.includes(fragment)) entries.delete(key);
  }
}

/**
 * True when speculation is worth the user's bytes: a fast connection, or one
 * the browser will not describe. Never speculate on 2g/3g or under Data Saver
 * -- on a site office's phone that is the user's own money.
 */
export function shouldSpeculate(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean };
  }).connection;
  if (!connection) return true; // unknown -- Safari and Firefox report nothing
  if (connection.saveData) return false;
  return connection.effectiveType === undefined || connection.effectiveType === "4g";
}

/**
 * Runs `task` when the browser is next idle, or on the next tick where
 * requestIdleCallback does not exist (Safari). Returns a cancel function.
 */
export function onIdle(task: () => void, timeoutMs = 2000): () => void {
  if (typeof window === "undefined") return () => {};
  const win = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof win.requestIdleCallback === "function") {
    const handle = win.requestIdleCallback(task, { timeout: timeoutMs });
    return () => win.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(task, 0);
  return () => clearTimeout(timer);
}

/** The 100 ms hover-intent delay: a cursor passing over a link is not intent. */
export const HOVER_INTENT_MS = 100;
