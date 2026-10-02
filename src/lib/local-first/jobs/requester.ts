// The requesting side: hand a job to an online machine and wait, but NEVER depend on it.
//
// `requestJob` enqueues, polls `/jobs/get` every `pollMs` until `timeoutMs`, and the moment anything is not a clean
// "done with a result of the right shape" (offline, signed out, any API error, the job failed or was cancelled, the
// timeout, a result that does not look like the type's answer) it computes the SAME thing itself with `fallback` --
// the same pure function a claimant would run (job-types computeJob). So offload can only make a screen faster, never
// stop it working. Colleagues may help ONLY when the caller opts in (`allowColleagues`): the default is the requester's
// own devices (server rule 1).
//
// The answer is a PROPOSAL (`proposal: true`): the type is for display and export; callers must never write money,
// approvals or permissions from it.

import type { JobsApi } from "./jobs-api";
import { isJobType, type JobType } from "./job-types";

export const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
export const DEFAULT_REQUEST_POLL_MS = 1_500;

export type JobOutcome<T> = { source: "remote" | "local"; result: T; proposal: true; fallbackReason: string | null };

export type RequestJobOptions<T> = {
  api: JobsApi;
  type: JobType;
  projectId: string;
  params: Record<string, unknown>;
  /** Computes the answer on this laptop. Always available; always correct. */
  fallback: () => Promise<T>;
  /** Looks like this type's answer? A remote result that fails this is thrown away. */
  accept?: (result: unknown) => result is T;
  allowColleagues?: boolean;
  timeoutMs?: number;
  pollMs?: number;
  /** False skips the server entirely (offline, or the person turned offload off for their own requests). */
  isOnline?: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function requestJob<T>(o: RequestJobOptions<T>): Promise<JobOutcome<T>> {
  const local = async (reason: string): Promise<JobOutcome<T>> => ({ source: "local", result: await o.fallback(), proposal: true, fallbackReason: reason });
  if (!isJobType(o.type)) return local("unknown_type");
  if (o.isOnline && !o.isOnline()) return local("offline");
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? realSleep;
  const timeout = o.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const poll = o.pollMs ?? DEFAULT_REQUEST_POLL_MS;
  try {
    const started = now();
    const { jobId } = await o.api.enqueue({ projectId: o.projectId, type: o.type, params: o.params, visibility: o.allowColleagues ? "project" : "requester" }, o.signal);
    for (;;) {
      if (o.signal?.aborted) return local("aborted");
      if (now() - started >= timeout) return local("timeout");
      await sleep(poll);
      const j = await o.api.get({ jobId }, o.signal);
      if (j.jobStatus === "done") {
        if (j.result !== null && (!o.accept || o.accept(j.result))) return { source: "remote", result: j.result as T, proposal: true, fallbackReason: null };
        return local("bad_result");
      }
      if (j.jobStatus === "failed" || j.jobStatus === "cancelled") return local(j.errorCode ?? j.jobStatus);
    }
  } catch (err) {
    return local(typeof (err as { kind?: unknown })?.kind === "string" ? String((err as { kind: string }).kind) : "error");
  }
}
