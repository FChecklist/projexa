// R67 D-29 (audit R-070/R-080). One status per SOURCE, not one spinner per
// screen.
//
// THE DEFECT. WorkProgressAnalyticalClient awaited four reads with no catch
// anywhere (a Promise.all of three, then a serial /api/scope and /api/scope/:id)
// and set loading=false only on the last line of the happy path. A BOQ fetch
// that rejected therefore left the screen on "Loading…" for the rest of the
// session -- no error, no retry, nothing to click -- while the KPI tags above
// the table were already showing figures derived from the reads that HAD
// succeeded. Two numbers on screen, a third source silently missing, and a
// table that would never arrive.
//
// The fix is not a bigger try/catch: it is that each source carries its own
// state, so the screen can say which one failed, keep what it really has, and
// offer a retry for the part that is missing.

export type SourceStatus =
  | { state: "loading" }
  | { state: "ok" }
  | { state: "error"; text: string };

export const SOURCE_LOADING: SourceStatus = { state: "loading" };
export const SOURCE_OK: SourceStatus = { state: "ok" };

/** The backend's own words, kept, with what the user was trying to do in front of them. */
export function sourceError(err: unknown, context: string): SourceStatus {
  const message = err instanceof Error && err.message ? err.message : "";
  return { state: "error", text: message ? `${context}: ${message}` : context };
}

export function isLoading(...statuses: SourceStatus[]): boolean {
  return statuses.some((s) => s.state === "loading");
}

/** Every source that failed, in the order given -- a screen with two outages says both. */
export function errorTexts(...statuses: SourceStatus[]): string[] {
  return statuses.flatMap((s) => (s.state === "error" ? [s.text] : []));
}

/**
 * D-29's rule for the Analytics tab: a KPI tag is a claim about the data, so it
 * may be rendered only when the read that establishes it has SUCCEEDED. This is
 * the same rule read-outcome.ts states for empty states, applied to figures --
 * a number above a table that is still loading is the pair the item forbids.
 */
export function mayShowFigure(...statuses: SourceStatus[]): boolean {
  return statuses.every((s) => s.state === "ok");
}
