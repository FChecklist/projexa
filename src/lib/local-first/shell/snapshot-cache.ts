// LOCAL-FIRST shell: the SNAPSHOT CACHE -- the last answer the server gave this person for a named read, kept on this laptop.
//
// WHY IT EXISTS. The overview screens (dashboard, reports, analysis) show NUMBERS the server computes: budgets against actuals,
// valuations, progress by BOQ value, the 28 exception checks. Those are never computed on the laptop (owner rule: money and approvals
// are decided by the server only). So while the laptop can reach the server, a screen fetches the SAME endpoint the online page uses and
// keeps the answer here; while it cannot (offline, or our server down), the screen shows that kept answer, labelled plainly
// "As of <date and time>, from this laptop" -- never a substitute worked out on the laptop.
//
// WHERE IT LIVES. In the person's OWN database (`projexa-local:<userId>`, localDbNameFor) as meta entries, so:
//   * another person on the same laptop never reads it (a different database; and every entry also records whose it is and is
//     ignored when that is not the reader);
//   * sign-out deletes it with the database when nothing is pending (sign-out.ts); when edits ARE pending and the database is kept,
//     the integrator calls clearSnapshots(userId) from sign-out (exported below; sign-out.ts is not edited by this package).
//
// ROLE. A snapshot records the role the person had when the server answered. If their role is different now, the snapshot is not
// shown: a number the server showed a project manager must not reach the same person after they were made a viewer. When the server
// later REFUSES the read (403/404: no longer allowed, or gone) the snapshot is removed, not kept "just in case".
//
// LIMITS. At most MAX_ENTRIES snapshots per person (the oldest goes first) and MAX_BYTES per answer: a cache, not a second database.
// Every read treats the stored body as untrusted input (the caller's validate()): a malformed entry is "no snapshot", never a cast.

import { formatDateTime } from "@/lib/format-date";
import type { MetaStore } from "../release/installer";
import { personMetaStore } from "../device-meta";
// AUDIT-100 A2: the one switch between the Vercel /api routes and the projexa-api Edge Function (same contract).
import { viaPxApi } from "@/lib/px-api";

export const SNAPSHOT_PREFIX = "snapshot:";
export const SNAPSHOT_INDEX_KEY = "snapshot:index";
export const MAX_ENTRIES = 60;
export const MAX_BYTES = 1_000_000;

/** Which read: the endpoint (route), the project it is about (null = not project-scoped) and its query. */
export type SnapshotName = {
  route: string;
  projectId: string | null;
  query?: string | URLSearchParams | Record<string, string | null | undefined>;
};

export type Snapshot<T = unknown> = {
  key: string;
  route: string;
  projectId: string | null;
  query: string;
  userId: string;
  /** The person's role when the server answered. */
  role: string | null;
  /** When the server answered (ms since epoch). */
  fetchedAt: number;
  body: T;
};

/** The query in one canonical order, so `?a=1&b=2` and `?b=2&a=1` are the same read. Empty values are dropped. */
export function canonicalQuery(query: SnapshotName["query"]): string {
  let params: URLSearchParams;
  if (query === undefined) params = new URLSearchParams();
  else if (typeof query === "string") params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  else if (query instanceof URLSearchParams) params = new URLSearchParams(query);
  else {
    params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (typeof v === "string") params.append(k, v);
  }
  const pairs = [...params.entries()].filter(([, v]) => v !== "").sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  return new URLSearchParams(pairs).toString();
}

export function snapshotKey(name: SnapshotName): string {
  return `${name.route}|${name.projectId ?? "-"}|${canonicalQuery(name.query)}`;
}

/** The label every snapshot is shown with. */
export function asOfLabel(fetchedAt: number): string {
  return `As of ${formatDateTime(fetchedAt)}, from this laptop`;
}

type IndexEntry = { key: string; fetchedAt: number };

function isIndexEntry(v: unknown): v is IndexEntry {
  return typeof v === "object" && v !== null && typeof (v as IndexEntry).key === "string" && typeof (v as IndexEntry).fetchedAt === "number";
}

function isSnapshotShape(v: unknown): v is Snapshot<unknown> {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.key === "string" && typeof o.route === "string" && typeof o.userId === "string" && typeof o.fetchedAt === "number"
    && (o.projectId === null || typeof o.projectId === "string") && typeof o.query === "string" && (o.role === null || typeof o.role === "string")
    && "body" in o;
}

export type SnapshotCache = {
  /** The person's snapshot of this read, or null (none, another person's, another role's, or a body validate() rejects). */
  read<T>(name: SnapshotName, validate: (body: unknown) => body is T): Promise<Snapshot<T> | null>;
  /** Keeps a fresh server answer. Returns null when the answer is too large to keep (it is then simply not cached). */
  write<T>(name: SnapshotName, body: T): Promise<Snapshot<T> | null>;
  remove(name: SnapshotName): Promise<void>;
  /** What is kept, newest first (keys and times only). */
  list(): Promise<IndexEntry[]>;
  /** Removes every snapshot of this person. */
  clear(): Promise<void>;
};

export type SnapshotCacheDeps = {
  userId: string;
  role: string | null;
  meta: MetaStore;
  now?: () => number;
  maxEntries?: number;
  maxBytes?: number;
};

export function createSnapshotCache(deps: SnapshotCacheDeps): SnapshotCache {
  const now = deps.now ?? (() => Date.now());
  const maxEntries = deps.maxEntries ?? MAX_ENTRIES;
  const maxBytes = deps.maxBytes ?? MAX_BYTES;

  // Every read-modify-write of the index goes through one lane, so two screens refreshing together cannot lose each other's entry.
  let lane: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lane.then(fn, fn);
    lane = run.then(() => undefined, () => undefined);
    return run;
  };

  const readIndex = async (): Promise<IndexEntry[]> => {
    const raw = await deps.meta.getMeta<unknown>(SNAPSHOT_INDEX_KEY);
    return Array.isArray(raw) ? raw.filter(isIndexEntry) : [];
  };

  return {
    async read<T>(name: SnapshotName, validate: (body: unknown) => body is T): Promise<Snapshot<T> | null> {
      const key = snapshotKey(name);
      let raw: unknown;
      try {
        raw = await deps.meta.getMeta<unknown>(SNAPSHOT_PREFIX + key);
      } catch {
        return null;
      }
      if (!isSnapshotShape(raw)) return null;
      if (raw.key !== key || raw.userId !== deps.userId) return null; // never another person's
      if ((raw.role ?? null) !== (deps.role ?? null)) return null; // the person's role changed since: the server must answer again
      if (!validate(raw.body)) return null;
      return raw as Snapshot<T>;
    },

    write<T>(name: SnapshotName, body: T): Promise<Snapshot<T> | null> {
      return exclusive(async () => {
        let size: number;
        try {
          size = JSON.stringify(body)?.length ?? 0;
        } catch {
          return null;
        }
        if (size > maxBytes) return null;
        const key = snapshotKey(name);
        const snapshot: Snapshot<T> = {
          key, route: name.route, projectId: name.projectId, query: canonicalQuery(name.query),
          userId: deps.userId, role: deps.role ?? null, fetchedAt: now(), body,
        };
        await deps.meta.setMeta(SNAPSHOT_PREFIX + key, snapshot);
        const index = [{ key, fetchedAt: snapshot.fetchedAt }, ...(await readIndex()).filter((e) => e.key !== key)];
        const kept = index.slice(0, maxEntries);
        for (const dropped of index.slice(maxEntries)) await deps.meta.setMeta(SNAPSHOT_PREFIX + dropped.key, null);
        await deps.meta.setMeta(SNAPSHOT_INDEX_KEY, kept);
        return snapshot;
      });
    },

    remove(name) {
      return exclusive(async () => {
        const key = snapshotKey(name);
        await deps.meta.setMeta(SNAPSHOT_PREFIX + key, null);
        await deps.meta.setMeta(SNAPSHOT_INDEX_KEY, (await readIndex()).filter((e) => e.key !== key));
      });
    },

    list: () => readIndex(),

    clear() {
      return exclusive(async () => {
        for (const entry of await readIndex()) await deps.meta.setMeta(SNAPSHOT_PREFIX + entry.key, null);
        await deps.meta.setMeta(SNAPSHOT_INDEX_KEY, []);
      });
    },
  };
}

/** The cache of the person a shell screen is drawn for, in their own database. */
export function snapshotCacheFor(person: { userId: string; role: string | null; idb?: IDBFactory }): SnapshotCache {
  return createSnapshotCache({ userId: person.userId, role: person.role, meta: personMetaStore(person.userId, person.idb) });
}

/**
 * Removes every snapshot this person has on this laptop. For sign-out (sign-out.ts deletes the whole database when nothing is pending;
 * when edits are pending it keeps the database, and this is what removes the snapshots from it). Never throws.
 */
export async function clearSnapshots(userId: string, idb?: IDBFactory): Promise<void> {
  if (!userId) return;
  try {
    await createSnapshotCache({ userId, role: null, meta: personMetaStore(userId, idb) }).clear();
  } catch {
    /* no database, or it cannot be opened: nothing to clear */
  }
}

// ─── refreshing from the server ──────────────────────────────────────────────────────────────────

export type RefreshOutcome<T> =
  | { state: "fresh"; snapshot: Snapshot<T> | null; body: T }
  /** Nothing reached the server (no network). The kept snapshot stays. */
  | { state: "offline" }
  /** The server is struggling (5xx, 429, a timeout). The kept snapshot stays. */
  | { state: "server" }
  /** Not signed in on the server just now (401). The kept snapshot stays; signing in again refreshes it. */
  | { state: "signed_out" }
  /** The server refused this person this read (403/404/...). The kept snapshot is REMOVED. */
  | { state: "refused"; status: number; message: string }
  /** The answer did not look like what the screen shows. The kept snapshot stays. */
  | { state: "invalid" };

/**
 * GETs `url` (the endpoint the online page uses) and keeps the answer as this read's snapshot. Never throws. Callers run it only while the
 * laptop is online; offline it would only return "offline".
 */
export async function refreshSnapshot<T>(
  cache: SnapshotCache,
  name: SnapshotName,
  url: string,
  validate: (body: unknown) => body is T,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<RefreshOutcome<T>> {
  const doFetch = options.fetchImpl ?? viaPxApi;
  let res: Response;
  try {
    res = await doFetch(url, { credentials: "same-origin", signal: options.signal, headers: { Accept: "application/json" } });
  } catch {
    return { state: "offline" };
  }
  if (res.status === 401) return { state: "signed_out" };
  if (res.status >= 500 || res.status === 429 || res.status === 408) return { state: "server" };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const message = typeof (body as { error?: unknown } | undefined)?.error === "string" ? (body as { error: string }).error : `The server did not allow this (HTTP ${res.status}).`;
    await cache.remove(name).catch(() => {});
    return { state: "refused", status: res.status, message };
  }
  if (!validate(body)) return { state: "invalid" };
  const snapshot = await cache.write(name, body).catch(() => null);
  return { state: "fresh", snapshot, body };
}
