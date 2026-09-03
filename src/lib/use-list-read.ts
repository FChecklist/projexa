"use client";

// R67 D-71 -- THE shared list hook the item names.
//
// Before this, PermitsListClient and DrawingsClient each carried the same
// twenty lines: five useState calls, a useCallback that sets loading, stamps
// a start time, clears the error, awaits fetchJson, narrows the body, stamps
// a loaded time, and catches into a { status, message } pair. Identical, in
// two files, and every other list client that still maps a failed GET to
// `?? []` would have needed a third and a fourth copy of it.
//
// It is one function now, and it is the ONLY way a list screen in this repo
// gets rows. Three things it guarantees that hand-rolled copies did not:
//
//  1. THE EMPTY ANSWER IS MINTED, NOT DEFAULTED. Rows come back inside a
//     ListOutcome (src/lib/read-outcome.ts), so "there are none" exists only
//     where a 2xx was actually seen. There is no code path from a failure to
//     an empty array.
//  2. ROWS SURVIVE A FAILED REFRESH. The previous rows are kept and dated;
//     PaneState labels them "as of 14:32". Blanking the table on a failed
//     poll throws away information the user already had.
//  3. A LATE RESPONSE CANNOT LAND. Each read carries a sequence number and a
//     response from a superseded url is dropped. Without this, switching
//     project twice quickly can paint project A's rows under project B's
//     heading -- the same class of fault as the silent wrong-project
//     fallback D-20 removed, arriving by a different route.

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
// R67 MERGE (lane F2's F-18 / F-20 / F-22). Lane F2 built a second hook,
// useModuleList, for the same job. Under decision D-11 this one is canonical,
// so that hook is gone and its three capabilities live here instead:
//
//   * SERVER SEEDING (F-18) -- the `initial` option below.
//   * A REAL ABORT (F-20) -- an AbortController per read, aborted on unmount
//     and on any url change, so a superseded read is CANCELLED rather than
//     merely ignored, and a pane the user left stops occupying a connection.
//     The sequence guard stays as well: it is what protects against a stale
//     response that has already resolved.
//   * SPECULATION (F-22) -- rows this session already fetched on hover-intent
//     or on dashboard idle are rendered at once and revalidated underneath,
//     with `speculated` saying so, because a head start is not the truth.
import { invalidatePrefetch, readPrefetch } from "@/lib/prefetch-store";
import {
  listOutcomeFromError,
  listOutcomeFromRows,
  type ListOutcome,
} from "@/lib/read-outcome";
import type { PaneStatus } from "@/lib/pane-state";

export type ListReadError = { status: number | null; message: string | null };

export type ListRead<T> = {
  /** What PaneState branches on. "empty" is folded into "ready" -- an empty
   *  read succeeded, and PaneState's own mayShowEmptyState() decides the rest. */
  status: PaneStatus;
  /** The rows currently held. Kept from the last success across a failure. */
  rows: T[];
  /** The last outcome, for callers that want the code or the retry flag. */
  outcome: ListOutcome<T> | null;
  error: ListReadError | null;
  /** Date.now() when the in-flight read was issued, for the wait timeline. */
  startedAt: number | null;
  /** When the rows currently held were true. */
  loadedAt: Date | null;
  /**
   * True while the rows on screen came from a speculative prefetch and have
   * not yet been confirmed by a live read. The screen stamps them with
   * `loadedAt` rather than passing them off as current.
   */
  speculated: boolean;
  reload: () => void;
};

export type UseListReadOptions<T> = {
  /**
   * The url to read. `null` means "not yet askable" -- no project chosen,
   * a required parameter missing -- and leaves the hook idle rather than
   * firing a read that is certain to fail.
   */
  url: string | null;
  /** Pulls the array out of the parsed body. */
  select: (body: unknown) => T[] | null | undefined;
  /**
   * R67 MERGE (lane F2's F-18, decision D-04 option A). What the SERVER
   * COMPONENT already fetched for this url. When it is present the hook
   * starts answered rather than loading and makes NO round trip on first
   * paint -- which is the whole point of moving the read to the server: a
   * client fetch here would put the 6-8 s back on the screen the server just
   * spent it removing.
   *
   * An initial payload carrying an errorMessage still counts as ANSWERED, not
   * loading: the server tried and failed, and the screen must say so rather
   * than sit on a spinner that will never resolve (F2's seededPane rule, and
   * the same rule read-outcome.ts protects -- there is still no path from a
   * failure to an empty array).
   *
   * It seeds ONLY the first url. A project switch or a reload() re-reads
   * normally, so server rows can never be shown under a different question.
   */
  initial?: { rows: T[]; errorMessage: string | null } | null;
};

export function useListRead<T>({ url, select, initial = null }: UseListReadOptions<T>): ListRead<T> {
  // The url the server's payload answers. Compared by value on every read so
  // a switch away and back does not silently re-use a stale seed.
  const seed = url && initial ? initial : null;
  const seededUrl = useRef<string | null>(seed ? url : null);
  // A speculative answer is the SECOND-best starting point, behind the
  // server's own payload: it can be up to a minute old, so it renders at once
  // and is revalidated underneath rather than trusted.
  //
  // Read in a LAZY useState initializer, not during render: readPrefetch() and
  // `select` are calls React Compiler cannot see through, and calling them in
  // the render body made it bail on this whole hook -- after which it could no
  // longer prove the useState setters were stable and reported run()'s manual
  // memoization as unpreservable. Once per mount is also the correct
  // semantics: a head start is claimed at most once.
  const [speculative] = useState<{ rows: T[]; fetchedAt: number } | null>(() => {
    if (seed || !url) return null;
    const hit = readPrefetch<unknown>(url);
    if (!hit) return null;
    const picked = select(hit.data);
    return { rows: Array.isArray(picked) ? picked : [], fetchedAt: hit.fetchedAt };
  });
  const speculativeRows = speculative ? speculative.rows : null;

  const [rows, setRows] = useState<T[]>(
    seed && !seed.errorMessage ? seed.rows : speculativeRows ?? []
  );
  const [outcome, setOutcome] = useState<ListOutcome<T> | null>(
    seed && !seed.errorMessage
      ? listOutcomeFromRows(seed.rows)
      : speculativeRows
        ? listOutcomeFromRows(speculativeRows)
        : null
  );
  const [status, setStatus] = useState<PaneStatus>(
    seed ? (seed.errorMessage ? "error" : "ready") : speculativeRows ? "ready" : url ? "loading" : "idle"
  );
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(
    seed && !seed.errorMessage
      ? new Date()
      : speculative
        ? new Date(speculative.fetchedAt)
        : null
  );
  const [error, setError] = useState<ListReadError | null>(
    seed && seed.errorMessage ? { status: null, message: seed.errorMessage } : null
  );
  const [speculated, setSpeculated] = useState<boolean>(speculativeRows !== null);

  // `select` is nearly always an inline arrow, so it is a new function on
  // every render. Holding it in a ref keeps it out of the read effect's
  // dependency list -- otherwise every render would re-issue the read.
  //
  // The ref is synced in an EFFECT, not during render: writing a ref while
  // rendering is a real hazard (React may throw the render away), and the
  // repo's lint rule react-hooks/refs rejects it. Declaration order carries
  // the correctness -- this effect is declared before the read effect, so
  // within one commit the ref is fresh before a read is issued, and on the
  // very first render useRef's initial value is already the caller's own
  // `select`.
  const selectRef = useRef(select);
  useEffect(() => {
    selectRef.current = select;
  });

  const seqRef = useRef(0);
  // True while the rows on screen are speculative, so the read that confirms
  // them runs in the BACKGROUND: putting a spinner over rows that are probably
  // correct undoes the head start the speculation bought.
  const speculatedRef = useRef(speculativeRows !== null);

  // `background` and `seeded` are PARAMETERS rather than refs read inside the
  // callback: React Compiler could not otherwise prove what this closes over,
  // and reported the manual memoization as unpreservable. The two effects below
  // own the refs and pass their values in.
  const run = useCallback(async (signal?: AbortSignal, background = false) => {
    if (!url) {
      setStatus("idle");
      setStartedAt(null);
      return;
    }
    const seq = ++seqRef.current;
    if (!background) {
      setStatus("loading");
      setStartedAt(Date.now());
      setError(null);
    }

    let next: ListOutcome<T>;
    try {
      const body = await fetchJson<unknown>(url, signal ? { signal } : undefined);
      const picked = selectRef.current(body);
      next = listOutcomeFromRows(Array.isArray(picked) ? picked : []);
    } catch (err) {
      // A cancellation is not a failure: it belongs to a question nobody is
      // asking any more, and must never reach a screen as an error.
      if (signal?.aborted) return;
      next = listOutcomeFromError<T>(err);
    }

    // A response for a url we have already moved on from must not paint.
    if (seq !== seqRef.current || signal?.aborted) return;

    setOutcome(next);
    if (next.status === "error") {
      // A failed BACKGROUND check must not replace correct rows with an error
      // card: what is on screen is still the best answer anyone has.
      if (background) return;
      setError({ status: next.httpStatus, message: next.message });
      setStatus("error");
      return;
    }
    setRows(next.status === "ready" ? next.rows : []);
    setLoadedAt(new Date());
    setSpeculated(false);
    setStatus("ready");
  }, [url]);

  useEffect(() => {
    // The server already answered THIS url; do not ask again on first paint.
    // Consumed once, so reload() and every later url read normally.
    if (url && seededUrl.current === url) {
      seededUrl.current = null;
      return;
    }
    const controller = new AbortController();
    const background = speculatedRef.current;
    speculatedRef.current = false;
    void run(controller.signal, background);
    return () => controller.abort();
  }, [run, url]);

  const reload = useCallback(() => {
    // A Retry, or a read after a write, has made any speculative copy wrong.
    if (url) invalidatePrefetch(url);
    seededUrl.current = null;
    speculatedRef.current = false;
    void run();
  }, [run, url]);

  return { status, rows, outcome, error, startedAt, loadedAt, speculated, reload };
}
