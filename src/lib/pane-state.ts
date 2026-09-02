// R67 F-25 (audit recommendation R-241) -- ONE TAB, ONE PANE, ONE LOAD.
//
// THE MEASURED PROBLEM. A tabbed screen in this app fetched EVERY tab on
// landing, under ONE shared `loading` flag. MaterialsClient asked for the
// material master, the inbound receipts and the cost report the moment it
// mounted, although only Material Master is open; LabourClient asked for the
// roster, the vendor list and the WHOLE undated attendance log although it
// opens on Roster. So the tab the user is looking at waited on two answers
// they had not asked for, and one shared spinner meant a failure in any of
// them looked like a failure in all of them.
//
// A pane is therefore its own little state machine, and this file is that
// machine with no React in it, so the rules are testable directly:
//
//   idle     -- never asked for. A tab that has not been opened is idle, and
//               that is not an error or an empty result: it is "no question
//               has been asked yet".
//   loading  -- in flight. KEEPS the rows it already had, so a refresh or a
//               background revalidation never blanks a table that is correct
//               on screen.
//   ready    -- rows, plus WHEN they were read (`asOf`), so a pane filled by
//               an idle-time prefetch can say so rather than implying it is
//               live.
//   error    -- the backend's own words. Also keeps the last known-good rows:
//               "this is what we had, and here is why it did not refresh" is
//               more useful than an empty table.
//
// `rows` and `error` are independent on purpose. Empty rows with no error
// means "there are none"; empty rows WITH an error means "we could not find
// out" -- the distinction read-outcome.ts exists to protect.

export type PaneStatus = "idle" | "loading" | "ready" | "error";

export type Pane<T> = {
  status: PaneStatus;
  rows: T[];
  /** When `rows` was read, as an epoch ms. null when nothing has been read. */
  asOf: number | null;
  /** The backend's own sentence. null when the last read succeeded. */
  error: string | null;
};

/** A tab nobody has opened yet. */
export function idlePane<T>(): Pane<T> {
  return { status: "idle", rows: [], asOf: null, error: null };
}

/**
 * A pane the SERVER already filled (the D-04 server-component fetch, F-18).
 * `errorMessage` is the server's own failure text, which still counts as
 * "answered" -- the screen must say so rather than sit on a spinner that will
 * never resolve.
 */
export function seededPane<T>(rows: T[], errorMessage: string | null, at: number): Pane<T> {
  return errorMessage
    ? { status: "error", rows: [], asOf: null, error: errorMessage }
    : { status: "ready", rows, asOf: at, error: null };
}

/** In flight. Rows already on screen stay on screen. */
export function loadingPane<T>(previous: Pane<T>): Pane<T> {
  return { ...previous, status: "loading", error: null };
}

export function readyPane<T>(rows: T[], at: number): Pane<T> {
  return { status: "ready", rows, asOf: at, error: null };
}

/** Failed. The last known-good rows are kept, and the reason is stated. */
export function errorPane<T>(previous: Pane<T>, message: string): Pane<T> {
  return { ...previous, status: "error", error: message };
}

/** True only for a pane that has never been asked for. */
export function needsLoad(pane: Pane<unknown>): boolean {
  return pane.status === "idle";
}

/** True when there is genuinely nothing to show yet -- the only case that earns
 *  a spinner. A pane refreshing rows it already has must not show one. */
export function paneIsBusy(pane: Pane<unknown>): boolean {
  return (pane.status === "idle" || pane.status === "loading") && pane.rows.length === 0;
}

/**
 * The stamp a pane should carry, or null for none.
 *
 * Only a pane filled by a speculative/idle-time prefetch that is now older than
 * `freshForMs` needs to admit its age; a pane read a moment ago is simply
 * current, and a stamp on it would be noise.
 */
export function paneAsOf(pane: Pane<unknown>, now: number, freshForMs = 60_000): number | null {
  if (pane.status !== "ready" || pane.asOf === null) return null;
  return now - pane.asOf >= freshForMs ? pane.asOf : null;
}
