"use client";

// LOCAL-FIRST shell, overview cluster: brings the OPEN project's copy up to date while an overview screen is on screen, and redraws it.
//
// WHY (lf-e10c, found by e2e/lf-overview-live.spec.ts in a real browser): after the first copy, nothing in the app read the sync service's
// change feed again -- the auto-sync scheduler (peer/peer-shared.ts startPeerSync) is not started anywhere, and the dashboard reads the
// laptop's database only when it is drawn. A colleague's new task or RFI never reached the open dashboard, and its counts stayed wrong
// until the person happened to edit a BOQ line (the one place that pulls). The person was looking at stale numbers with no way to know.
//
// WHAT IT DOES, cheaply (cost first): on the screen's first draw, when the laptop comes back online, when the person comes back to the tab
// (window focus) and when the tab becomes visible again -- never on a timer -- it asks ONE `GET /heads` (every project's feed head in one
// call, backend drizzle/0686). Only when the open project's head is past the position this laptop stored does it run the replica's
// one-project catch-up (`/changes` from that position, then a pull of only the rows it names), and only when that stored something does
// it ask the shell to redraw. Nothing moved: one request, nothing else. An older service without /heads (404) gets the replica's plain
// one-project run instead, which has its own "read a moment ago" shortcut.
//
// It never runs while the laptop is offline, and one run at a time per screen (a trigger during a run asks for exactly one more after it).

import { useEffect, useRef } from "react";
import { getConnectivity, reportServerFailure, reportServerSuccess } from "../../connectivity";
import { changeCursorKey, localDbNameFor, openLocalDb } from "../../local-db";
import { SyncError, type HeadsAnswer } from "../../sync-client";
import type { ShellApi } from "../types";

/** What a replica one-project run reports, as far as this reads it. */
export type CatchUpReport = { status: string; changesApplied?: number; itemsStored?: number; itemsRemoved?: number };

export type CatchUpDeps = {
  heads: () => Promise<HeadsAnswer>;
  /** The stored change-feed position of a project on this laptop, or null when it has none (never copied). */
  cursor: (projectId: string) => Promise<number | null>;
  /** The replica's one-project run (Replica.syncProject without a kind). */
  syncProject: (projectId: string, options?: { moved?: boolean }) => Promise<CatchUpReport>;
  /** /heads said nothing moved (Replica.noteFeedCurrent): a screen opened now need not ask again. */
  feedCurrent?: (projectId: string) => void;
};

/**
 * "moved": rows arrived or left (redraw); "current": nothing new; "skipped": nothing to compare against (not copied yet, or /heads does
 * not name the project); "failed": the server or network did not answer (kept as it was).
 */
export type CatchUpOutcome = "moved" | "current" | "skipped" | "failed";

const failedRun = (status: string) => status === "error" || status === "signed_out" || status === "update_required";
const changed = (r: CatchUpReport) => (r.changesApplied ?? 0) + (r.itemsStored ?? 0) + (r.itemsRemoved ?? 0) > 0;

/** One catch-up of one project. Never throws. */
export async function catchUpProject(deps: CatchUpDeps, projectId: string): Promise<CatchUpOutcome> {
  try {
    let answer: HeadsAnswer | null = null;
    try {
      answer = await deps.heads();
    } catch (err) {
      if (!(err instanceof SyncError && err.kind === "not_found")) throw err;
    }
    let report: CatchUpReport;
    if (answer === null) {
      // an older service without /heads: the replica's own one-project run (it knows when it read the feed a moment ago)
      report = await deps.syncProject(projectId);
    } else {
      const head = answer.heads[projectId];
      const cursor = await deps.cursor(projectId);
      if (typeof head !== "number" || cursor === null) return "skipped";
      if (head <= cursor) {
        deps.feedCurrent?.(projectId);
        return "current";
      }
      report = await deps.syncProject(projectId, { moved: true });
    }
    if (failedRun(report.status)) return "failed";
    return changed(report) ? "moved" : "current";
  } catch {
    return "failed";
  }
}

/** The browser's dependencies: the person's own sync client and replica, and their own database. Loaded lazily (no cost when offline). */
async function browserDeps(userId: string): Promise<CatchUpDeps> {
  const [{ createSharedSyncClient, sharedPacer }, { getSharedReplica }] = await Promise.all([import("../../shared-client"), import("../../replica-shared")]);
  const client = createSharedSyncClient({ timeoutMs: 15_000, maxRetries: 1 });
  const replica = getSharedReplica(userId);
  return {
    heads: async () => {
      if (!client.heads) throw new SyncError("not_found", "This sync client has no /heads.");
      await sharedPacer().take();
      return client.heads();
    },
    cursor: async (projectId) => {
      const db = await openLocalDb(globalThis.indexedDB, localDbNameFor(userId));
      try {
        const stored = await db.getMeta<{ seq?: unknown } | null>(changeCursorKey(projectId));
        return stored && typeof stored.seq === "number" ? stored.seq : null;
      } finally {
        db.close();
      }
    },
    syncProject: (projectId, options) => replica.syncProject(projectId, undefined, undefined, options),
    feedCurrent: (projectId) => replica.noteFeedCurrent?.(projectId),
  };
}

/**
 * Keeps the open project's copy current while this screen is shown (see the header). `deps` replaces the browser's own (tests).
 * Redraws through `shell.refresh()` only when something arrived.
 */
export function useOverviewCatchUp(shell: ShellApi, projectId: string | null, options: { deps?: CatchUpDeps } = {}): void {
  const latest = useRef({ shell, deps: options.deps });
  useEffect(() => {
    latest.current = { shell, deps: options.deps };
  });
  const online = shell.connectivity !== "offline";

  useEffect(() => {
    if (!projectId) return;
    let stopped = false;
    let running = false;
    let again = false;

    const run = async () => {
      if (stopped) return;
      if (running) { again = true; return; }
      // read live, not from the render: a focus can arrive between a connectivity change and the redraw it causes
      if (getConnectivity() === "offline" || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
      running = true;
      try {
        const { shell: s, deps } = latest.current;
        const outcome = await catchUpProject(deps ?? (await browserDeps(s.data.userId)), projectId);
        if (stopped) return;
        if (outcome === "failed") reportServerFailure();
        else reportServerSuccess();
        if (outcome === "moved") s.refresh();
      } catch {
        /* the next trigger tries again */
      } finally {
        running = false;
        if (again && !stopped) { again = false; void run(); }
      }
    };

    if (online) void run();
    const onFocus = () => void run();
    const onVisible = () => { if (document.visibilityState === "visible") void run(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [projectId, online]);
}
