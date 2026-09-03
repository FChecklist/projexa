// R67 WS-A (A-16) -- WHAT THE SHELL DOES WHEN A READ FAILS, AND HOW IT AVOIDS
// SHOWING TWO DIFFERENT ANSWERS TO ONE QUESTION.
//
// THREE DEFECTS, ONE CAUSE. The shell issues four reads on mount -- the
// organisation, the projects, the pill ranking and the task list -- and each of
// them used to have its own private idea of what a failure means:
//
//   1. THE ORG LABEL FELL BACK TO A BARE EM-DASH. `info?.organization?.name ??
//      "—"` renders a single punctuation mark where the organisation's name
//      belongs. It is indistinguishable from a name that is still loading, from
//      an org with no name, and from a 500 -- and it is the top rail, the one
//      band M24 says must always answer "who am I, which org, which project".
//
//   2. A FIRST FAILURE WAS FINAL. One dropped request on a site connection put
//      the shell into its degraded state for the whole visit, with no retry and
//      no way for the user to ask again except a full reload.
//
//   3. THE STRIP COULD SHOW TWO DIFFERENT SETS OF CARDS. The cached ranking is
//      painted first and the server's answer replaces it -- even when the two
//      are identical, which re-renders the band for no reason, and even when
//      only the CACHE's owner has changed, which is how one user's strip can
//      appear in another user's session on a shared browser.
//
// EVERYTHING HERE IS PURE (or takes its fetch and its clock as arguments), so
// the rules are written down once and asserted without a browser. The shell
// only wires them up.

/** One entry of the server's ranking, as PROJEXA's proxy returns it. */
export type RankedEntryLike = { pillKey: string; label?: string | null; pinned?: boolean };

/**
 * A-16: "The server list replaces the strip only when it differs."
 *
 * Equality is by the rendered facts -- the key, the label and the pin -- in
 * order, because the order IS the ranking. A ranking that has not changed must
 * not cause a repaint: the band is what the user's finger is already moving
 * towards, and a re-render that reorders nothing still costs a frame in which
 * the cards can move.
 */
export function sameRanking(
  a: readonly RankedEntryLike[] | null | undefined,
  b: readonly RankedEntryLike[] | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((entry, i) => {
    const other = b[i];
    return (
      entry.pillKey === other.pillKey &&
      (entry.label ?? null) === (other.label ?? null) &&
      Boolean(entry.pinned) === Boolean(other.pinned)
    );
  });
}

/**
 * THE CACHE, KEYED BY USER ID (A-16).
 *
 * WHY THE KEY MATTERS. The ranking is a statement about one person's work. A
 * single browser is regularly shared -- a site office laptop, a supervisor
 * handing a phone over -- and a cache with no owner hands the second person the
 * first person's strip, which on this product is a row of write actions
 * ordered by somebody else's job.
 *
 * WHY THERE IS ALSO A `last` POINTER. The identity is resolved asynchronously
 * and the strip has to paint on the FIRST render, before it is known. `last`
 * names whoever most recently used this browser -- overwhelmingly the same
 * person -- so the first paint has something real to show; the moment the real
 * identity lands and disagrees, the shell repaints from that user's own entry
 * (or from nothing). Never from someone else's.
 */
export type RankedCache = {
  /** The user whose ranking was written most recently in this browser. */
  last: string | null;
  byUser: Readonly<Record<string, RankedEntryLike[]>>;
  /**
   * A ranking written by the version of this shell that had no per-user key at
   * all. It belongs to an unknown user, so it is used ONLY for the pre-identity
   * first paint and is never attributed to a named user.
   */
  legacy?: RankedEntryLike[];
};

export const EMPTY_RANKED_CACHE: RankedCache = { last: null, byUser: {} };

function asEntries(value: unknown): RankedEntryLike[] | null {
  if (!Array.isArray(value)) return null;
  const entries = value.filter(
    (x): x is RankedEntryLike => Boolean(x) && typeof (x as RankedEntryLike).pillKey === "string"
  );
  return entries.length === value.length ? entries : null;
}

/** Reads whatever is in storage, including the shape this key used to hold. */
export function parseRankedCache(raw: string | null | undefined): RankedCache {
  if (!raw) return EMPTY_RANKED_CACHE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_RANKED_CACHE;
  }
  const legacy = asEntries(parsed);
  if (legacy) return { last: null, byUser: {}, legacy };
  if (!parsed || typeof parsed !== "object") return EMPTY_RANKED_CACHE;
  const record = parsed as { last?: unknown; byUser?: unknown };
  const byUser: Record<string, RankedEntryLike[]> = {};
  if (record.byUser && typeof record.byUser === "object") {
    for (const [userId, value] of Object.entries(record.byUser as Record<string, unknown>)) {
      const entries = asEntries(value);
      if (entries) byUser[userId] = entries;
    }
  }
  const last = typeof record.last === "string" && byUser[record.last] ? record.last : null;
  return { last, byUser };
}

export function serialiseRankedCache(cache: RankedCache): string {
  return JSON.stringify({ last: cache.last, byUser: cache.byUser });
}

/** The ranking to paint. Null means "nothing cached", not "an empty ranking". */
export function rankingFor(cache: RankedCache, userId: string | null): RankedEntryLike[] | null {
  if (userId) return cache.byUser[userId] ?? null;
  if (cache.last) return cache.byUser[cache.last] ?? null;
  return cache.legacy ?? null;
}

/** Records this user's ranking and makes them the browser's last user. */
export function rememberRanking(
  cache: RankedCache,
  userId: string,
  entries: readonly RankedEntryLike[]
): RankedCache {
  return { last: userId, byUser: { ...cache.byUser, [userId]: [...entries] } };
}

/**
 * THE ORGANISATION LABEL. Three states, three sentences, and none of them is a
 * punctuation mark: a name that has not arrived says so, and a name that could
 * not be read says THAT, with the one control that can change it.
 */
export type OrganisationLabel = {
  text: string;
  /** True when the only useful thing left on screen is a Retry control. */
  retry: boolean;
};

export function organisationLabel(input: { name?: string | null; failed: boolean }): OrganisationLabel {
  const name = (input.name ?? "").trim();
  if (name) return { text: name, retry: false };
  if (input.failed) return { text: "Organisation unavailable", retry: true };
  return { text: "Loading…", retry: false };
}

/** The task pane's own notice, in the same shape and for the same reason. */
export const TASKS_UNAVAILABLE = "Could not load your tasks";

export type JsonRead<T> =
  | { ok: true; data: T; attempts: number }
  | { ok: false; error: string; attempts: number };

export type ReadJsonOptions = {
  fetcher?: (url: string) => Promise<Response>;
  /** How long to wait before the single retry. A-16 names one second. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Total attempts, including the first. A-16 asks for exactly two. */
  attempts?: number;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * ONE RETRY BEFORE ANY FALLBACK (A-16).
 *
 * A single failed read is usually a dropped request, not a broken backend --
 * this product is used on site connections, and the shell's four reads all
 * happen in the same first second of a page load, which is exactly when a
 * flaky link drops one. Retrying once costs a second and removes most of the
 * degraded states the user would otherwise have to reload out of; retrying
 * more would hold the shell in "loading" long past the point where saying so
 * is more useful than trying again.
 *
 * THE STATUS IS READ BEFORE THE BODY, every time: an error body parses
 * perfectly well as JSON, and treating it as data is how a failed request
 * becomes a confident-looking empty state. The backend's OWN message is kept.
 */
export async function readJsonWithRetry<T>(url: string, opts: ReadJsonOptions = {}): Promise<JsonRead<T>> {
  const fetcher = opts.fetcher ?? ((u: string) => fetch(u));
  const sleep = opts.sleep ?? wait;
  const delayMs = opts.delayMs ?? 1000;
  const total = Math.max(1, opts.attempts ?? 2);

  let error = "the request did not complete";
  for (let attempt = 1; attempt <= total; attempt += 1) {
    try {
      const res = await fetcher(url);
      const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
      if (res.ok) return { ok: true, data: (body ?? ({} as T)) as T, attempts: attempt };
      error = body && typeof body.error === "string" && body.error.trim() ? body.error : `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : "the request did not complete";
    }
    if (attempt < total) await sleep(delayMs);
  }
  return { ok: false, error, attempts: total };
}
