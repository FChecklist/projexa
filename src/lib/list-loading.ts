// R67 F-31 (audit recommendation R-275) / decision D-04 -- WHAT A LIST SAYS
// WHILE IT IS STILL LOADING, AND HOW A MACHINE CAN TELL.
//
// TWO DEFECTS, ONE FILE.
//
// 1. A SPINNER WITH NO WORDS. Every module list in this app answered a slow
//    read with an animated circle and nothing else, for as long as the read
//    took -- 6 to 8 s on the screens the audit measured, and forever on the
//    /scope hang that R66 reproduced live. A circle is not an answer: it does
//    not say what is being fetched, how long it has been going, or that
//    anything can be done about it. After three seconds the honest thing is to
//    name the wait; after eight it is to admit it is abnormal and offer the
//    retry.
//
// 2. NOTHING TO MEASURE. The pass-2 latency script had no way to ask "is this
//    screen usable yet", so its `usable` column was empty for all 13 pages and
//    the audit had to reconstruct per-page numbers from dev-server log lines.
//    A machine-readable `data-state` on the list region fixes that at the
//    source: the same attribute a Playwright budget waits on is the one the
//    screen genuinely flips when the first row -- or the empty-state sentence,
//    which is equally an answer -- renders.
//
// The React that consumes this is in src/components/ListScreenFrame.tsx; the
// rules live here, with no React in them, so they are testable directly and
// the two cannot drift.

/**
 * The four honest answers to "what is this list showing?".
 *
 *   loading -- we have asked and have nothing yet. The ONLY state that earns a
 *              spinner, and only for the first three seconds of it.
 *   ready   -- rows are on screen.
 *   empty   -- the backend answered, and the answer is "there are none". A
 *              real answer, and deliberately NOT the same state as `loading`
 *              (that conflation is how an unfinished read reads as "no data")
 *              nor the same as `error` (read-outcome.ts's standing rule).
 *   error   -- we asked and could not find out. The backend's own sentence is
 *              rendered inside the region.
 */
export type ListDataState = "loading" | "ready" | "empty" | "error";

/**
 * The state of a list region, from the three facts every list client already
 * holds. Order matters and is deliberate:
 *
 *   * An ERROR wins over rows that are still on screen from a previous read --
 *     the screen must say the refresh failed rather than imply what is shown
 *     is current. (Panes that deliberately keep last-known-good rows pass
 *     rowCount anyway; the region still reports `error`, and the words in it
 *     say why.)
 *   * LOADING only counts while there is genuinely nothing to show. A
 *     background revalidation under rows that are already correct is `ready`,
 *     not `loading` -- putting a spinner over correct rows is the defect F-22
 *     removed, and flipping data-state back to `loading` would make a latency
 *     measurement report a screen as unusable while the user is reading it.
 */
export function listDataState(input: {
  loading: boolean;
  error?: string | null;
  rowCount: number;
}): ListDataState {
  if (input.error) return "error";
  if (input.loading && input.rowCount === 0) return "loading";
  return input.rowCount === 0 ? "empty" : "ready";
}

/**
 * Three seconds: the point at which a wait stops reading as "the click
 * registered" and starts reading as "nothing is happening". Below it, words
 * would be noise on a screen that is about to paint anyway.
 */
export const STILL_LOADING_AFTER_MS = 3_000;

/**
 * Eight seconds: D-04's abort budget, and the SAME figure
 * VERIDIAN_FETCH_TIMEOUT_MS in veridian-client.ts uses to abort the upstream
 * call. Deliberately one number, not two: the moment the screen says this is
 * abnormal is the moment the request behind it is actually given up on, so
 * "This is taking longer than usual" is never said about a call that is still
 * quietly running, and Retry is never offered for something that is about to
 * succeed on its own.
 */
export const TAKING_LONGER_AFTER_MS = 8_000;

export type LoadingWords = {
  /** The sentence to render, or null while the wait is still ordinary. */
  text: string | null;
  /** True once the wait is abnormal and a Retry control is warranted. */
  showRetry: boolean;
  /** Whole seconds elapsed, the live counter in the "Still loading" sentence. */
  seconds: number;
};

/**
 * What a loading list region says after `elapsedMs`.
 *
 * `label` is what the user was trying to see, in the user's own vocabulary --
 * "minutes", "roster", "permits" -- never a route, an endpoint or a function
 * id. It is interpolated into a sentence, so it reads as a noun: "Still
 * loading minutes… 4 s".
 */
export function loadingWords(label: string, elapsedMs: number): LoadingWords {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (elapsedMs >= TAKING_LONGER_AFTER_MS) {
    return { text: "This is taking longer than usual", showRetry: true, seconds };
  }
  if (elapsedMs >= STILL_LOADING_AFTER_MS) {
    return { text: `Still loading ${label}… ${seconds} s`, showRetry: false, seconds };
  }
  return { text: null, showRetry: false, seconds };
}
