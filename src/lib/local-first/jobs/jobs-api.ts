// The typed fetch client for the five job routes of the projexa-sync Edge Function (compliance-tracker
// supabase/functions/projexa-sync/handler.ts `jobs()`, migration 0682):
//   POST /jobs/enqueue | claim | heartbeat | result | get
// One attempt per call and NO retry inside: the claim loop already polls on its own schedule, and a retry here would
// make the per-idle-laptop request rate higher than the cost rule allows. Same headers as sync-client.ts.

import { LOCAL_DB_VERSION } from "../local-db";
import { SYNC_BASE_URL, SYNC_PROTOCOL } from "../sync-client";

export type ClaimedJob = {
  job_id: string;
  type: string;
  project_id: string;
  params: unknown;
  lease_id: string;
  lease_expires_at: string;
  attempt: number;
  requested_by_you: boolean;
};
export type JobStatus = "queued" | "claimed" | "done" | "failed" | "cancelled";

export type JobsErrorKind = "signed_out" | "not_found" | "update_required" | "rate_limited" | "bad_request" | "server" | "network" | "timeout" | "bad_response";
export class JobsError extends Error {
  readonly kind: JobsErrorKind;
  readonly status: number;
  constructor(kind: JobsErrorKind, message: string, status = 0) {
    super(message);
    this.name = "JobsError";
    this.kind = kind;
    this.status = status;
  }
}

export type JobsApi = {
  enqueue(req: { projectId: string; type: string; params: unknown; visibility?: "requester" | "project" }, signal?: AbortSignal): Promise<{ jobId: string }>;
  claim(req: { deviceId: string; types: string[]; leaseSeconds?: number }, signal?: AbortSignal): Promise<{ job: ClaimedJob | null; serverTime: string | null }>;
  heartbeat(req: { jobId: string; leaseId: string }, signal?: AbortSignal): Promise<{ outcome: "extended" | "lease_expired"; leaseExpiresAt: string | null; serverTime: string | null }>;
  result(req: { jobId: string; leaseId: string; ok: boolean; result?: unknown; error?: string }, signal?: AbortSignal): Promise<{ outcome: "accepted" | "duplicate" | "lease_expired"; jobStatus: JobStatus | null }>;
  get(req: { jobId: string }, signal?: AbortSignal): Promise<{ jobStatus: JobStatus; attempts: number; type: string; result: unknown; errorCode: string | null; ranHere: boolean }>;
};

export type JobsApiOptions = {
  getAccessToken: () => Promise<string | null>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  getReleaseVersion?: () => string;
  timeoutMs?: number;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const STATUSES = ["queued", "claimed", "done", "failed", "cancelled"];

export function createJobsApi(options: JobsApiOptions): JobsApi {
  const base = (options.baseUrl ?? SYNC_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const release = options.getReleaseVersion ?? (() => "dev");

  async function post(path: string, body: unknown, outer?: AbortSignal): Promise<Record<string, unknown>> {
    const token = await options.getAccessToken();
    if (!token) throw new JobsError("signed_out", "Signed out.", 401);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 15_000);
    const onAbort = () => controller.abort();
    outer?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await doFetch(`${base}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", "X-Px-Client": `${release()}; protocol=${SYNC_PROTOCOL}; schema=${LOCAL_DB_VERSION}` },
        body: JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });
      if (res.status === 401) throw new JobsError("signed_out", "Signed out.", 401);
      if (res.status === 426) throw new JobsError("update_required", "Update required.", 426);
      if (res.status === 404) throw new JobsError("not_found", "Not found.", 404);
      if (res.status === 429) throw new JobsError("rate_limited", "Rate limited.", 429);
      if (res.status === 400) throw new JobsError("bad_request", "Bad request.", 400);
      if (res.status >= 500) throw new JobsError("server", `Server ${res.status}.`, res.status);
      if (!res.ok) throw new JobsError("bad_response", `Unexpected ${res.status}.`, res.status);
      let json: unknown;
      try { json = await res.json(); } catch { throw new JobsError("bad_response", "Not JSON.", res.status); }
      if (!isObj(json)) throw new JobsError("bad_response", "Not an object.", res.status);
      return json;
    } catch (err) {
      if (err instanceof JobsError) throw err;
      throw timedOut ? new JobsError("timeout", "Timed out.") : new JobsError("network", "Could not be reached.");
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    }
  }

  const serverTime = (j: Record<string, unknown>) => (typeof j.server_time === "string" ? j.server_time : null);
  return {
    async enqueue(req, signal) {
      const j = await post("/jobs/enqueue", { project_id: req.projectId, type: req.type, params: req.params, visibility: req.visibility ?? "requester" }, signal);
      if (typeof j.job_id !== "string") throw new JobsError("bad_response", "No job id.");
      return { jobId: j.job_id };
    },
    async claim(req, signal) {
      const j = await post("/jobs/claim", { device_id: req.deviceId, types: req.types, ...(req.leaseSeconds !== undefined ? { lease_seconds: req.leaseSeconds } : {}) }, signal);
      const job = j.job;
      if (job === null || job === undefined) return { job: null, serverTime: serverTime(j) };
      if (!isObj(job) || typeof job.job_id !== "string" || typeof job.type !== "string" || typeof job.project_id !== "string" || typeof job.lease_id !== "string" || typeof job.lease_expires_at !== "string") {
        throw new JobsError("bad_response", "Malformed job.");
      }
      return { job: job as unknown as ClaimedJob, serverTime: serverTime(j) };
    },
    async heartbeat(req, signal) {
      const j = await post("/jobs/heartbeat", { job_id: req.jobId, lease_id: req.leaseId }, signal);
      return { outcome: j.outcome === "extended" ? "extended" : "lease_expired", leaseExpiresAt: typeof j.lease_expires_at === "string" ? j.lease_expires_at : null, serverTime: serverTime(j) };
    },
    async result(req, signal) {
      const j = await post("/jobs/result", { job_id: req.jobId, lease_id: req.leaseId, ok: req.ok, ...(req.ok ? { result: req.result } : { error: req.error ?? "FAILED" }) }, signal);
      const outcome = j.outcome === "accepted" || j.outcome === "duplicate" ? j.outcome : "lease_expired";
      return { outcome, jobStatus: typeof j.job_status === "string" && STATUSES.includes(j.job_status) ? (j.job_status as JobStatus) : null };
    },
    async get(req, signal) {
      const j = await post("/jobs/get", { job_id: req.jobId }, signal);
      if (typeof j.job_status !== "string" || !STATUSES.includes(j.job_status)) throw new JobsError("bad_response", "No status.");
      return { jobStatus: j.job_status as JobStatus, attempts: typeof j.attempts === "number" ? j.attempts : 0, type: typeof j.type === "string" ? j.type : "", result: j.result ?? null, errorCode: typeof j.error_code === "string" ? j.error_code : null, ranHere: j.ran_here === true };
    },
  };
}
