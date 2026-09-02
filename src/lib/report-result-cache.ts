"use client";

// R67 F-10 (R-134). /reports is a screen with one select and one button, and
// it took eight blocking calls to become usable -- then every Run Report was a
// full round trip with a spinner in place of the result, including running the
// SAME report on the SAME project again a few seconds later.
//
// A report result is a snapshot of data that changed at most minutes ago, and
// the user has already seen it. So it is remembered per (report, project,
// params) and painted immediately while a fresh run replaces it: the reader
// gets something to read at once, and the number they end up with is still the
// current one.
//
// sessionStorage, not localStorage, and not a module variable:
//   * it must survive a navigation away and back -- that is most of the win;
//   * it must NOT survive the tab, because a report is org-scoped data and a
//     different sign-in must never see the previous one's figures.
//
// sessionStorage alone only delivers half of that second rule: it dies with the
// tab, but it survives a SIGN-OUT inside one tab. So M24Shell's SIGNED_OUT
// handler calls clearCachedReports() -- see that call site. (Keys include the
// projectId, so a cross-org collision was never possible; what the sign-out
// clear removes is the previous user's results lingering in a tab the next
// one is looking at.)
//
// Every operation is wrapped: private mode, disabled storage and a full quota
// all mean "no cache", never a thrown error on a render path.
const STORAGE_PREFIX = "px.report.";

// A cached result is shown as a starting point, not as the answer -- anything
// older than this is discarded rather than painted, so nobody reads a figure
// from a previous working session as if it were current.
export const REPORT_CACHE_MAX_AGE_MS = 30 * 60_000;

export type CachedReport = { data: unknown; at: number };

/**
 * The cache key. Params are sorted so two callers building the same query in a
 * different order share one entry -- an unsorted key silently halves the hit
 * rate and is invisible in testing.
 */
export function reportCacheKey(reportName: string, projectId: string, params: Record<string, string> = {}): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `${STORAGE_PREFIX}${reportName}|${projectId}${sorted ? `|${sorted}` : ""}`;
}

export function readCachedReport(key: string, maxAgeMs: number = REPORT_CACHE_MAX_AGE_MS): unknown | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedReport;
    if (!parsed || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > maxAgeMs) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeCachedReport(key: string, data: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, at: Date.now() } satisfies CachedReport));
  } catch {
    // Quota exceeded or storage unavailable. The report still rendered from
    // the live response; only the next visit's head start is lost.
  }
}

/** Drops every cached report -- used on sign-out and by tests. */
export function clearCachedReports(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}
