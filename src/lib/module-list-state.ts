// R67 F-18 / F-20 -- the two decisions a module list client makes about its
// own data, kept out of React so they can be tested directly.
//
// 1. What state does the screen START in? Under D-04 the server has usually
//    already fetched the rows and passed them down, so the list must render
//    them on the FIRST paint with no spinner and no fetch. When it has not
//    (a filtered arrival, a project switch), the screen starts loading.
//    Getting this wrong in either direction is visible: a spinner over rows
//    that are already present, or an empty table that never fetches.
//
// 2. Is this failure a real failure? Every list fetch now carries an
//    AbortController and is aborted on unmount and on project switch, so
//    "the request was cancelled because nobody wants it any more" arrives on
//    the same catch path as "the backend is down". Reporting the first one to
//    the user would put an error on a screen they just navigated away from.

export type ModuleListInitial<T> = { rows: T[]; errorMessage: string | null } | null;

export type ModuleListState<T> = { rows: T[]; error: string | null; loading: boolean };

/**
 * The state a list starts in, given whatever the server component passed down.
 *
 * An initial payload that carries an errorMessage still counts as "not
 * loading": the server tried and failed, and the screen must say so rather
 * than sit on a spinner that will never resolve.
 */
export function initialListState<T>(initial: ModuleListInitial<T>): ModuleListState<T> {
  if (!initial) return { rows: [], error: null, loading: true };
  return { rows: initial.rows, error: initial.errorMessage, loading: false };
}

/** True for a cancellation, which is never shown to the user. */
export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}
