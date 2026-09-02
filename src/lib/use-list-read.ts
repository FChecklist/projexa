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
};

export function useListRead<T>({ url, select }: UseListReadOptions<T>): ListRead<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [outcome, setOutcome] = useState<ListOutcome<T> | null>(null);
  const [status, setStatus] = useState<PaneStatus>(url ? "loading" : "idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [error, setError] = useState<ListReadError | null>(null);

  // `select` is nearly always an inline arrow, so it is a new function on
  // every render. Holding it in a ref keeps it out of the effect's dependency
  // list -- otherwise every render would re-issue the read.
  const selectRef = useRef(select);
  selectRef.current = select;

  const seqRef = useRef(0);

  const run = useCallback(async () => {
    if (!url) {
      setStatus("idle");
      setStartedAt(null);
      return;
    }
    const seq = ++seqRef.current;
    setStatus("loading");
    setStartedAt(Date.now());
    setError(null);

    let next: ListOutcome<T>;
    try {
      const body = await fetchJson<unknown>(url);
      const picked = selectRef.current(body);
      next = listOutcomeFromRows(Array.isArray(picked) ? picked : []);
    } catch (err) {
      next = listOutcomeFromError<T>(err);
    }

    // A response for a url we have already moved on from must not paint.
    if (seq !== seqRef.current) return;

    setOutcome(next);
    if (next.status === "error") {
      setError({ status: next.httpStatus, message: next.message });
      setStatus("error");
      return;
    }
    setRows(next.status === "ready" ? next.rows : []);
    setLoadedAt(new Date());
    setStatus("ready");
  }, [url]);

  useEffect(() => {
    void run();
  }, [run]);

  const reload = useCallback(() => {
    void run();
  }, [run]);

  return { status, rows, outcome, error, startedAt, loadedAt, reload };
}
