"use client";

// R67 F-18 / F-20 -- the one list-loading effect every module list client uses.
//
// It replaces the copy of this that each client carried:
//
//     const [rows, setRows] = useState([]);
//     const [loading, setLoading] = useState(true);
//     useEffect(() => { load(); }, [projectId]);
//
// and adds the three things D-04 and R-238 require of every one of them:
//
//   * IT DOES NOT FETCH WHAT IT WAS GIVEN. When page.tsx fetched the rows on
//     the server and passed them down, the first paint is the data. The effect
//     only runs when the URL it would fetch differs from the one the props
//     already answer -- a project switch, a filter change, an explicit reload.
//   * EVERY FETCH IS ABORTABLE. An AbortController per effect, aborted on
//     unmount and on any URL change, so a project switch cannot have two
//     in-flight reads racing to set the same state, and a pane the user left
//     stops occupying a connection.
//   * A CANCELLATION IS NOT AN ERROR. Aborting produces the same rejected
//     promise a real failure does; showing "Couldn't load permits: The
//     operation was aborted" on the screen the user just left is worse than
//     showing nothing.
//
// The HTTP status is read before the body (fetchJson), so a failed request can
// never arrive as a calm empty list -- R48_HTTP_ERROR_SWALLOWED_AS_EMPTY_LIST_01.

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, fetchJson } from "@/lib/fetch-json";
import { initialListState, isAbortError, type ModuleListInitial } from "@/lib/module-list-state";
import { invalidatePrefetch, readPrefetch } from "@/lib/prefetch-store";

export type { ModuleListInitial } from "@/lib/module-list-state";

export function useModuleList<T>({
  initial,
  url,
  pick,
  context,
}: {
  /** What the server component already fetched, or null to fetch on mount. */
  initial: ModuleListInitial<T>;
  /** The /api URL this list reads, query string included. */
  url: string;
  /** Pulls the rows out of the payload, e.g. (d) => d.permits. */
  pick: (payload: Record<string, unknown>) => T[] | undefined;
  /** What the user was trying to see, for the error sentence: "permits". */
  context: string;
}) {
  // R67 F-22: three possible starting points, in order of authority.
  //   1. What the SERVER fetched for this render (D-04). Authoritative.
  //   2. A fresh SPECULATIVE answer this session already fetched on hover or
  //      on dashboard idle. Rendered at once so the click feels instant, and
  //      revalidated in the background -- it is a head start, not the truth,
  //      so the screen stamps it "as of HH:MM" rather than passing it off as
  //      current.
  //   3. Nothing: fetch, with the loading state.
  const speculative = initial ? null : readPrefetch<Record<string, unknown>>(url);
  const start: { rows: T[]; error: string | null; loading: boolean } = initial
    ? initialListState(initial)
    : speculative
      ? { rows: (pick(speculative.data) ?? []) as T[], error: null, loading: false }
      : initialListState<T>(null);
  const [rows, setRows] = useState<T[]>(start.rows);
  const [error, setError] = useState<string | null>(start.error);
  const [loading, setLoading] = useState(start.loading);
  // When the rows on screen came from speculation, this is when they were
  // fetched. Null once a live read has replaced them.
  const [asOf, setAsOf] = useState<number | null>(speculative ? speculative.fetchedAt : null);

  // The URL the current rows answer. Seeded from the SERVER payload only:
  // a speculative answer still triggers a background revalidation, because it
  // may be up to a minute old.
  const answeredUrl = useRef<string | null>(initial ? url : null);

  // `pick` is written inline at every call site, so it is a new function on
  // every render; holding it in a ref keeps `load` stable and stops the effect
  // re-firing on every parent render.
  // Synced in an effect, not during render (react-hooks/refs). This effect is
  // declared BEFORE the load effect below, so on every commit -- mount
  // included -- the ref is up to date before any fetch reads it.
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  });

  const load = useCallback(
    async (signal?: AbortSignal, options: { background?: boolean } = {}) => {
      // A background revalidation runs UNDER rows that are already on screen;
      // showing a spinner over them would undo the speculation it is checking.
      if (!options.background) setLoading(true);
      try {
        const payload = await fetchJson<Record<string, unknown>>(url, signal ? { signal } : undefined);
        if (signal?.aborted) return;
        setRows(pickRef.current(payload) ?? []);
        setError(null);
        setAsOf(null);
        answeredUrl.current = url;
      } catch (err) {
        if (isAbortError(err, signal)) return;
        // A failed BACKGROUND check must not replace correct rows with an
        // error card: what is on screen is still the best answer anyone has.
        if (options.background) return;
        // Rows are emptied AND an error is set: the screen must be able to
        // tell "there are none" from "we could not find out".
        setRows([]);
        setError(errorMessage(err, `Couldn't load ${context}`));
      } finally {
        if (!signal?.aborted && !options.background) setLoading(false);
      }
    },
    [url, context]
  );

  // Whether the rows currently on screen came from speculation. Read inside
  // the effect only, so the effect does not re-run when it changes.
  const speculatedRef = useRef(speculative !== null);

  useEffect(() => {
    if (answeredUrl.current === url) return;
    const controller = new AbortController();
    const background = speculatedRef.current;
    speculatedRef.current = false;
    void load(controller.signal, { background });
    return () => controller.abort();
  }, [url, load]);

  /** Re-read this list now (after a create, or a Retry click). */
  const reload = useCallback(() => {
    answeredUrl.current = null;
    // A write has made any speculative copy of this list wrong.
    invalidatePrefetch(url);
    return load();
  }, [load, url]);

  return { rows, error, loading, asOf, reload, setRows };
}
