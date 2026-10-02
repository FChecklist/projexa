// LOCAL-FIRST: tells OUR side what this laptop's "Preparing your PROJEXA workspace" run is doing (owner directive 2026-10-03: "if the
// download is happening and, for any reason, it stops, we should know at our end ... we cannot lose a customer").
//
// WHAT IS SENT (POST /prepare of projexa-sync, drizzle/0688): the stage the run is in, the percentage, a status (running | retrying | done |
// failed), the attempt number and, on a failure, a reason CLASS (service_unreachable | signed_out | not_linked | worker_failed |
// no_service_worker | storage_blocked | download_failed | timeout | project_unreadable | rate_limited | update_required | other) with a short
// detail. Nothing about the person's data is in it.
//
// WHEN: on every stage change and every 10 percentage points, at least every HEARTBEAT_MS while the run is alive (SILENCE IS THE SIGNAL: a
// closed tab, a dead network or a crashed browser stops the heartbeat, and the server marks the laptop STALLED), on every failure, on
// every retry, and at 100%. A report that cannot be sent is kept (localStorage) and sent with the next one, so a laptop that was offline
// for a while still tells us, afterwards, what happened to it.
//
// A second, independent line: when the service cannot be reached at all, the same report goes to this site's own /api/local-first/prepare-report
// (its runtime log), so a Supabase outage is not also a blind spot.
//
// Pure apart from the injected clock, timers, storage and senders (tests pass fakes).

import type { PrepareProgress } from "./prepare-workspace";

export const HEARTBEAT_MS = 20_000;
export const MIN_GAP_MS = 8_000;
export const PENDING_KEY = "px-prepare-report-pending";

export type PrepareStage = "start" | "worker" | "app" | "database" | "projects" | "done";
export type PrepareStatus = "running" | "retrying" | "done" | "failed";
export type ErrorClass =
  | "service_unreachable" | "signed_out" | "not_linked" | "worker_failed" | "no_service_worker" | "storage_blocked"
  | "download_failed" | "timeout" | "project_unreadable" | "rate_limited" | "update_required" | "other";

export type PrepareReport = {
  device_id: string;
  release_version: string | null;
  stage: PrepareStage;
  percent: number;
  status: PrepareStatus;
  attempt: number;
  error_class: ErrorClass | null;
  error_detail: string | null;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ReporterDeps = {
  deviceId: string;
  release: () => string | null;
  /** Sends to the sync service; true when it recorded the report. */
  send: (report: PrepareReport) => Promise<boolean>;
  /** The independent line (this site's own log); fire-and-forget. */
  beacon?: (report: PrepareReport) => void;
  storage?: StorageLike | null;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
};

/** What the screen is doing, in the closed vocabulary of the server: the first step that is not done. */
export function stageOf(progress: Pick<PrepareProgress, "steps" | "finished" | "timedOut">): PrepareStage {
  if (progress.finished && !progress.timedOut && progress.steps.every((s) => s.state === "done")) return "done";
  const open = progress.steps.find((s) => s.state === "running") ?? progress.steps.find((s) => s.state === "failed") ?? progress.steps.find((s) => s.state !== "done");
  const id = open?.id;
  return id === "worker" || id === "app" || id === "database" || id === "projects" ? id : "start";
}

/** The reason class of a failed step, from the step and the words its error carries (no free text is trusted as the key). */
export function classifyFailure(stepId: string | undefined, error: string | undefined, timedOut: boolean): ErrorClass {
  const e = (error ?? "").toLowerCase();
  if (timedOut) return "timeout";
  if (stepId === "worker") return e.includes("no service worker") ? "no_service_worker" : "worker_failed";
  if (e.includes("signed out") || e.includes("sign in again")) return "signed_out";
  if (e.includes("not linked")) return "not_linked";
  if (e.includes("update")) return "update_required";
  if (e.includes("too many")) return "rate_limited";
  if (e.includes("storage") || e.includes("quota") || e.includes("indexeddb") || e.includes("blocked")) return "storage_blocked";
  if (stepId === "projects" && (e.includes("not reachable") || e.includes("unreachable") || e.includes("service"))) return "service_unreachable";
  if (stepId === "projects" && e.includes("not available")) return "project_unreadable";
  if (stepId === "app") return "download_failed";
  return "other";
}

export function createPrepareReporter(deps: ReporterDeps) {
  const now = deps.now ?? (() => Date.now());
  const setIv = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearIv = deps.clearInterval ?? ((id: unknown) => clearInterval(id as ReturnType<typeof setInterval>));
  const storage = deps.storage === undefined ? safeStorage() : deps.storage;

  let attempt = 1;
  let last: PrepareReport | null = null;
  let lastSentAt = 0;
  let lastBucket = -1;
  let timer: unknown = null;
  let stopped = false;

  const readPending = (): PrepareReport | null => {
    try {
      const raw = storage?.getItem(PENDING_KEY);
      return raw ? (JSON.parse(raw) as PrepareReport) : null;
    } catch {
      return null;
    }
  };
  const writePending = (r: PrepareReport | null) => {
    try {
      if (!storage) return;
      if (r) storage.setItem(PENDING_KEY, JSON.stringify(r));
      else storage.removeItem(PENDING_KEY);
    } catch { /* storage refused: the report is simply not kept */ }
  };

  async function deliver(report: PrepareReport): Promise<void> {
    lastSentAt = now();
    let ok = false;
    try {
      ok = await deps.send(report);
    } catch {
      ok = false;
    }
    if (ok) {
      writePending(null);
      return;
    }
    writePending(report); // kept: the next report (or the next visit) carries the news
    if (report.status === "failed" || report.status === "retrying") deps.beacon?.(report);
  }

  function build(progress: Pick<PrepareProgress, "percent" | "steps" | "finished" | "timedOut">, status?: PrepareStatus): PrepareReport {
    const stage = stageOf(progress);
    const failedStep = progress.steps.find((s) => s.state === "failed");
    const s: PrepareStatus = status ?? (stage === "done" ? "done" : progress.finished ? "failed" : attempt > 1 ? "retrying" : "running");
    const failing = s === "failed" || (s === "retrying" && !!failedStep);
    return {
      device_id: deps.deviceId,
      release_version: deps.release(),
      stage,
      percent: stage === "done" ? 100 : Math.max(0, Math.min(99, Math.round(progress.percent))),
      status: s,
      attempt,
      error_class: failing ? classifyFailure(failedStep?.id, failedStep?.error, progress.timedOut) : null,
      error_detail: failing ? (failedStep?.error ?? (progress.timedOut ? "The preparation took longer than its time limit." : null))?.slice(0, 300) ?? null : null,
    };
  }

  return {
    /** Called on every progress event of the screen. Throttled; stage changes, failures and completion always go. */
    progress(progress: PrepareProgress) {
      if (stopped) return;
      const report = build(progress);
      const bucket = Math.floor(report.percent / 10);
      const changed = !last || last.stage !== report.stage || last.status !== report.status || bucket !== lastBucket || last.error_class !== report.error_class;
      last = report;
      lastBucket = bucket;
      // the first report, a finish and a failure always go at once; any other change goes unless one left a moment ago (the heartbeat covers the rest)
      const send = lastSentAt === 0 || report.status === "done" || report.status === "failed" || (changed && now() - lastSentAt >= MIN_GAP_MS);
      if (send) void deliver(report);
    },
    /** A new attempt starts (automatic retry or the person's own): reported as `retrying` with the attempt number. */
    retry() {
      attempt += 1;
    },
    /** While the run is alive: tells us every HEARTBEAT_MS that it still is. Silence is the signal. */
    start() {
      if (timer !== null) return;
      const pending = readPending();
      if (pending) void deliver(pending); // news from an earlier run that could not be sent
      timer = setIv(() => { if (last && !stopped && last.status !== "done") void deliver({ ...last, release_version: deps.release() }); }, HEARTBEAT_MS);
    },
    stop() {
      stopped = true;
      if (timer !== null) clearIv(timer);
      timer = null;
    },
    /** For tests and the screen: what would be sent next. */
    peek: () => last,
  };
}

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
