// The claim loop: this laptop helps another request by running a job on its own RAM and CPU.
//
// COST RULE (the owner's first priority): one tiny POST /jobs/claim per interval per IDLE, VISIBLE laptop, and the
// interval adapts: 20 s when there was recent activity, 120 s otherwise, and NO request at all when the tab is hidden,
// the device is offline, on low battery or in data-saver, the person opted out, or the session ended. Failures back off
// (doubling, 10 min at most). When polling is paused nothing is scheduled; `refresh()` (called on visibility / online /
// battery events) starts it again.
//
// SAFETY: only the four known job types are ever requested or run; a job for a project that is not in the local
// manifest is never run; a result is a PROPOSAL. LEASES: the server gives 60 s and extends on each heartbeat (5 min in
// all). This loop heartbeats every `heartbeatMs`, treats the lease as lost when the server says `lease_expired` or when
// its own deadline has passed (clock-skew safe: the deadline is the server's lease expiry minus the server's own `now`,
// added to OUR clock), stops the work, and then submits NOTHING: a result after expiry is never counted as a success.

import { JOB_TYPES, isJobType } from "./job-types";
import { errorCode, type JobExecutor } from "./worker";
import { JobsError, type ClaimedJob, type JobsApi } from "./jobs-api";
import type { JobInput } from "./job-input";

export const ACTIVE_POLL_MS = 20_000;
export const IDLE_POLL_MS = 120_000;
export const MAX_BACKOFF_MS = 600_000;
export const RECENT_ACTIVITY_MS = 5 * 60_000;
export const HEARTBEAT_MS = 20_000;
export const MAX_RESULT_CHARS = 262_144;

export type PauseReason = "opted_out" | "hidden" | "offline" | "low_battery" | "data_saver" | "signed_out" | "update_required" | "stopped";
export type HelperIndicator = {
  /** off: opted out or stopped; paused: cannot poll now (reason says why); waiting: polling calmly; helping: running a job. */
  state: "off" | "paused" | "waiting" | "helping";
  reason: PauseReason | null;
  /** While helping: what kind of work, and whether it is your own (true) or a colleague's (false). */
  jobType: string | null;
  forYou: boolean | null;
  /** Jobs completed and accepted by the server since this page opened. */
  helped: number;
};

export type RunnerEnv = {
  now(): number;
  isVisible(): boolean;
  isOnline(): boolean;
  isLowBattery(): boolean;
  saveData(): boolean;
  /** The last moment the person (or a job) was active; recent activity shortens the interval. */
  lastActivityAt(): number;
  /** Something heavy is already running on this page (e.g. a sync). The loop will not claim while true. */
  isBusy?(): boolean;
};
export type Timers = { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };

export type RunnerOptions = {
  api: JobsApi;
  executor: JobExecutor;
  env: RunnerEnv;
  timers?: Timers;
  deviceId: string;
  /** The rows and params a claimed job runs over, read from this laptop's database; null = cannot run here. */
  loadInput(job: ClaimedJob): Promise<JobInput | null>;
  /** True when the job's project is in this laptop's manifest. */
  hasProject(projectId: string): Promise<boolean>;
  loadOptOut(): Promise<boolean>;
  saveOptOut(optedOut: boolean): Promise<void>;
  heartbeatMs?: number;
  onError?(err: unknown): void;
};

export type PollOutcome = "paused" | "busy" | "no_job" | "ran" | "lost" | "failed" | "refused" | "error";

export type JobRunner = {
  start(): Promise<void>;
  stop(): void;
  /** Re-evaluates the environment (call on visibilitychange, online/offline, battery, save-data changes). */
  refresh(): void;
  setOptedOut(optedOut: boolean): Promise<void>;
  pollOnce(): Promise<PollOutcome>;
  getIndicator(): HelperIndicator;
  subscribe(cb: (i: HelperIndicator) => void): () => void;
};

const realTimers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export function createJobRunner(opts: RunnerOptions): JobRunner {
  const timers = opts.timers ?? realTimers;
  const env = opts.env;
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  let optedOut = false;
  let started = false;
  let fatal: PauseReason | null = null;
  let pollTimer: unknown = null;
  let backoff = 0;
  let running: { abort: AbortController } | null = null;
  let lastJobAt = 0;
  let helped = 0;
  let indicator: HelperIndicator = { state: "off", reason: "stopped", jobType: null, forYou: null, helped: 0 };
  const listeners = new Set<(i: HelperIndicator) => void>();

  const setIndicator = (patch: Partial<HelperIndicator>) => {
    indicator = { ...indicator, helped, ...patch };
    for (const cb of listeners) cb(indicator);
  };

  function pauseReason(): PauseReason | null {
    if (!started) return "stopped";
    if (optedOut) return "opted_out";
    if (fatal) return fatal;
    if (!env.isOnline()) return "offline";
    if (!env.isVisible()) return "hidden";
    if (env.isLowBattery()) return "low_battery";
    if (env.saveData()) return "data_saver";
    return null;
  }

  function interval(): number {
    const recent = env.now() - Math.max(env.lastActivityAt(), lastJobAt) < RECENT_ACTIVITY_MS;
    return (recent ? ACTIVE_POLL_MS : IDLE_POLL_MS) + backoff;
  }

  function clearPoll() {
    if (pollTimer !== null) timers.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function schedule() {
    clearPoll();
    const reason = pauseReason();
    if (reason) {
      setIndicator({ state: reason === "opted_out" || reason === "stopped" ? "off" : "paused", reason, jobType: null, forYou: null });
      return;
    }
    if (running) return;
    setIndicator({ state: "waiting", reason: null, jobType: null, forYou: null });
    pollTimer = timers.setTimeout(() => { pollTimer = null; void pollOnce(); }, interval());
  }

  async function submit(job: ClaimedJob, ok: boolean, result: unknown, error: string): Promise<"accepted" | "lost"> {
    const r = await opts.api.result({ jobId: job.job_id, leaseId: job.lease_id, ok, ...(ok ? { result } : { error }) });
    if (r.outcome === "lease_expired") return "lost";
    return r.outcome === "accepted" || (r.outcome === "duplicate" && r.jobStatus === "done") ? "accepted" : "lost";
  }

  async function runJob(job: ClaimedJob, serverTime: string | null): Promise<PollOutcome> {
    // never run what we do not know or do not hold: tell the server so the requester falls back at once
    if (!isJobType(job.type)) {
      await submit(job, false, null, "UNKNOWN_TYPE").catch(() => undefined);
      return "refused";
    }
    if (!(await opts.hasProject(job.project_id))) {
      await submit(job, false, null, "PROJECT_NOT_LOCAL").catch(() => undefined);
      return "refused";
    }
    const abort = new AbortController();
    running = { abort };
    lastJobAt = env.now();
    setIndicator({ state: "helping", reason: null, jobType: job.type, forYou: job.requested_by_you });

    // our own clock's deadline for this lease: server expiry minus server now (skew-proof), or 60 s if the server sent no time
    const remaining = (expiry: string, st: string | null) => {
      const e = Date.parse(expiry);
      const s = st ? Date.parse(st) : NaN;
      return Number.isFinite(e) && Number.isFinite(s) ? e - s : 60_000;
    };
    let deadline = env.now() + remaining(job.lease_expires_at, serverTime);
    let lost = false;
    let hbTimer: unknown = null;
    const lose = () => { lost = true; abort.abort(); };
    const beat = () => {
      hbTimer = timers.setTimeout(async () => {
        try {
          const h = await opts.api.heartbeat({ jobId: job.job_id, leaseId: job.lease_id });
          if (h.outcome === "lease_expired") return lose();
          if (h.leaseExpiresAt) deadline = env.now() + remaining(h.leaseExpiresAt, h.serverTime);
        } catch (err) {
          opts.onError?.(err); // a missed heartbeat is not fatal: the deadline below decides
        }
        if (env.now() >= deadline) return lose();
        if (!lost) beat();
      }, heartbeatMs);
    };
    beat();

    let outcome: PollOutcome = "ran";
    try {
      const input = await opts.loadInput(job);
      if (!input) throw Object.assign(new Error("no input"), { code: "NO_INPUT" });
      const answer = await opts.executor(job.type, input.rows, input.params, abort.signal);
      if (lost || env.now() >= deadline) {
        outcome = "lost"; // never submit after the lease ran out, and never count it as success
      } else if (JSON.stringify(answer).length > MAX_RESULT_CHARS) {
        outcome = (await submit(job, false, null, "RESULT_TOO_LARGE")) === "accepted" ? "failed" : "lost";
      } else {
        outcome = (await submit(job, true, answer, "")) === "accepted" ? "ran" : "lost";
        if (outcome === "ran") { helped += 1; lastJobAt = env.now(); }
      }
    } catch (err) {
      if (lost || abort.signal.aborted) {
        outcome = "lost";
      } else {
        outcome = "failed";
        const code = (err as { code?: unknown })?.code === "NO_INPUT" ? "NO_INPUT" : errorCode(err);
        await submit(job, false, null, code).catch((e) => opts.onError?.(e));
      }
    } finally {
      if (hbTimer !== null) timers.clearTimeout(hbTimer);
      lost = true; // any heartbeat still in flight must not re-arm
      running = null;
    }
    return outcome;
  }

  async function pollOnce(): Promise<PollOutcome> {
    if (pauseReason()) { schedule(); return "paused"; }
    if (running || env.isBusy?.()) { return "busy"; }
    let outcome: PollOutcome;
    try {
      const { job, serverTime } = await opts.api.claim({ deviceId: opts.deviceId, types: [...JOB_TYPES] });
      backoff = 0;
      outcome = job ? await runJob(job, serverTime) : "no_job";
    } catch (err) {
      opts.onError?.(err);
      outcome = "error";
      if (err instanceof JobsError && err.kind === "signed_out") fatal = "signed_out";
      else if (err instanceof JobsError && err.kind === "update_required") fatal = "update_required";
      else backoff = Math.min(Math.max(backoff * 2, ACTIVE_POLL_MS), MAX_BACKOFF_MS);
    }
    schedule();
    return outcome;
  }

  return {
    async start() {
      started = true;
      fatal = null;
      try { optedOut = await opts.loadOptOut(); } catch { optedOut = false; }
      schedule();
    },
    stop() {
      started = false;
      running?.abort.abort();
      schedule();
    },
    refresh() {
      if (started) schedule();
    },
    async setOptedOut(v) {
      optedOut = v;
      await opts.saveOptOut(v);
      if (v) running?.abort.abort(); // the lease simply lapses and the job is offered again
      schedule();
    },
    pollOnce,
    getIndicator: () => indicator,
    subscribe(cb) {
      listeners.add(cb);
      cb(indicator);
      return () => { listeners.delete(cb); };
    },
  };
}
