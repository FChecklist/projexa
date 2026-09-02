// R67 F-05 (R-075). The Work Progress Report is the slowest thing on this
// screen: PROJEXA's /api/work-progress/report handler fans out six VERIDIAN
// calls (scope, activities, work-progress, attendance, labour-roster, vendors)
// and measured 2.7 s. Today a user clicks the Report tab, waits for the tab to
// mount, and only THEN does the request start.
//
// This starts it on the tab's own hover/focus instead -- typically 200-600 ms
// of otherwise-idle time before the click lands -- and hands the in-flight
// promise to the report component when it mounts, so the wait the user
// actually experiences is what is LEFT of the request, not all of it.
//
// It is a prewarm, not a cache. There is exactly one slot, it is keyed by the
// full parameter string so a hover with different parameters can never serve
// the wrong report, and it is consumed once: take() removes it, so a rerun
// with the same parameters is a real, fresh request. A rejected prewarm is
// dropped silently -- the component's own run then produces the real error
// message the user should read.
export type PrewarmedReport = { key: string; promise: Promise<unknown> };

// ONE definition of "the default range", shared by the tab that prewarms and
// the component that consumes. If these two ever disagreed by a single day the
// keys would never match and the prewarm would silently do nothing -- a
// performance fix that quietly stops working is worse than no fix, because
// nothing tells you.
export function defaultReportRange(): { from: string; to: string } {
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  return {
    from: firstOfMonth.toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  };
}

let slot: PrewarmedReport | null = null;

export function reportRequestUrl(params: { projectId: string; from: string; to: string; boqId?: string }): string {
  const search = new URLSearchParams({ projectId: params.projectId, from: params.from, to: params.to });
  if (params.boqId) search.set("boqId", params.boqId);
  return `/api/work-progress/report?${search.toString()}`;
}

/** Starts the request if one for these exact parameters is not already armed. */
export function prewarmReport(params: { projectId: string; from: string; to: string; boqId?: string }): void {
  const url = reportRequestUrl(params);
  if (slot?.key === url) return;
  const promise = fetch(url)
    .then(async (res) => {
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Couldn't generate the report");
      return body;
    })
    .catch((err) => {
      // Drop the slot so the component's own run reports the failure properly
      // rather than inheriting a stale rejection.
      if (slot?.key === url) slot = null;
      throw err;
    });
  // A prewarm nobody consumes must not surface as an unhandled rejection.
  promise.catch(() => {});
  slot = { key: url, promise };
}

/** Returns and clears the armed promise, if it is for these exact parameters. */
export function takePrewarmedReport(params: { projectId: string; from: string; to: string; boqId?: string }): Promise<unknown> | null {
  const url = reportRequestUrl(params);
  if (!slot || slot.key !== url) return null;
  const { promise } = slot;
  slot = null;
  return promise;
}

/** Test seam: `bun test` runs every file in one process. */
export function __resetReportPrewarmForTests(): void {
  slot = null;
}
