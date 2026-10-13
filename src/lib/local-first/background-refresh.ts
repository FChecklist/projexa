// UAT 2026-10-12 (offline finding): on the normal pages nothing ever brought the laptop copy up to date after its first copy, so the offline
// shell showed an old picture (BOQs, progress, permits made later were missing). The auto-sync scheduler (peer/peer-shared.ts) did that only
// inside the /local shell, and starting it on the normal pages too took the per-browser leader lock away from the local shell's own tab and changed
// the first-install flow (e2e regressions), so this is the small version: while the person is on a normal page, online and looking at it,
// bring the OPEN project's copy up to date through the replica's own incremental read (one POST /changes from the stored position, then only what
// moved), at most every `everyMs`, and the whole copy at most every `fullEveryMs` (new / removed projects). No lock, no peers, no release relay.
// It never runs before the laptop has been prepared (`ready()`), so it cannot race the first copy, and a failure is silent (the next trigger retries).

export type RefreshDeps = {
  now?: () => number;
  /** The laptop has been prepared for this person (first copy finished once). */
  ready: () => boolean;
  online: () => boolean;
  visible: () => boolean;
  activeProject: () => string | null;
  syncProject: (projectId: string) => Promise<unknown>;
  syncAll: () => Promise<unknown>;
  /**
   * After a sync of the open project: bring the server's own figures for it (the dashboard snapshot) onto the laptop, so the offline dashboard has
   * something to show "As of <date>". The callback decides itself whether it is due (dashboard-keep.ts topUpProjectDashboard); a failure is silent.
   */
  topUp?: (projectId: string) => Promise<unknown>;
  everyMs?: number;
  fullEveryMs?: number;
};

export const REFRESH_EVERY_MS = 2 * 60_000;
export const REFRESH_FULL_EVERY_MS = 6 * 60 * 60_000;

/** Returns `run()`: call it on mount, on visibility/online events and on an interval; it decides by itself whether anything is due. */
export function createBackgroundRefresh(d: RefreshDeps): () => Promise<"skipped" | "project" | "all" | "failed"> {
  const now = d.now ?? (() => Date.now());
  const everyMs = d.everyMs ?? REFRESH_EVERY_MS;
  const fullEveryMs = d.fullEveryMs ?? REFRESH_FULL_EVERY_MS;
  let lastRun = Number.NEGATIVE_INFINITY;
  let lastFull = Number.NEGATIVE_INFINITY;
  let busy = false;
  return async () => {
    if (busy || !d.ready() || !d.online() || !d.visible()) return "skipped";
    const t = now();
    if (t - lastRun < everyMs) return "skipped";
    busy = true;
    try {
      lastRun = t;
      const project = d.activeProject();
      if (!project || t - lastFull >= fullEveryMs) {
        await d.syncAll();
        lastFull = t;
        if (project) await d.topUp?.(project).catch(() => {});
        return "all";
      }
      await d.syncProject(project);
      await d.topUp?.(project).catch(() => {});
      return "project";
    } catch {
      return "failed";
    } finally {
      busy = false;
    }
  };
}
