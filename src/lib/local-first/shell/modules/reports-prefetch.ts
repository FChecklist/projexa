// Sumeet R-C11 / R-C15 offline (2026-10-13): the offline Reports screen showed "Not saved on this laptop yet" for every report the person had not opened while
// online (15 of 17 on the demo laptop). While the laptop is online, this keeps the server's last answer for EVERY fetch report of the open project, one after the
// other (never in parallel: the live database has a small connection pool), so a person who goes offline finds all of them. It never works a report out itself.
import { refreshSnapshot, type SnapshotCache } from "../snapshot-cache";
import { isReportBody, reportSnapshotName, type ReportEntry } from "./reports-adapter";

export const REPORT_FRESH_MS = 10 * 60 * 1000;

export type PrefetchResult = { refreshed: number; skippedFresh: number; skippedNeedsInput: number; stoppedBecause: "none" | "offline" | "server" | "signed_out" };

export async function prefetchReportSnapshots(opts: {
  cache: SnapshotCache;
  reports: readonly ReportEntry[];
  projectId: string;
  now?: number;
  freshMs?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<PrefetchResult> {
  const now = opts.now ?? Date.now();
  const freshMs = opts.freshMs ?? REPORT_FRESH_MS;
  const result: PrefetchResult = { refreshed: 0, skippedFresh: 0, skippedNeedsInput: 0, stoppedBecause: "none" };
  for (const r of opts.reports) {
    if (opts.signal?.aborted) break;
    if (r.kind !== "fetch") continue;
    // The weekly report is run for one chosen week; with none chosen there is nothing to ask the server for.
    if (r.value === "weekly-project" && !r.target.includes("weekStart=")) {
      result.skippedNeedsInput += 1;
      continue;
    }
    if (r.savedAt !== null && now - r.savedAt < freshMs) {
      result.skippedFresh += 1;
      continue;
    }
    const outcome = await refreshSnapshot(opts.cache, reportSnapshotName(r.target, opts.projectId), r.target, isReportBody, { fetchImpl: opts.fetchImpl, signal: opts.signal });
    if (outcome.state === "fresh") result.refreshed += 1;
    // A struggling server, no network or no sign-in will not get better with fourteen more requests: stop and keep what was saved.
    if (outcome.state === "offline" || outcome.state === "server" || outcome.state === "signed_out") {
      result.stoppedBecause = outcome.state;
      break;
    }
  }
  return result;
}
