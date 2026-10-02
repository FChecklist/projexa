// The typed message protocol between the page and the job Web Worker, and the executors that speak it.
//
//   page  -> worker   { kind: "run", id, type, rows, params }   |   { kind: "cancel", id }
//   worker -> page    { id, ok: true, result }                  |   { id, ok: false, error }
//
// `error` is always a short code (UNKNOWN_TYPE, BAD_REQUEST, CANCELLED, RUN_FAILED): it is what the runner reports
// to the server, which stores at most 64 characters of it.
//
// A JobExecutor is "run this job over these rows": in the browser it is a real Web Worker (worker-entry.ts, created by
// browser-worker.ts), in tests it is the in-process one below. Both slice the work (job-types runReducer) so the 50 ms
// main-thread budget holds even when no Worker is available; and a `cancel` message can be handled between slices
// because every slice yields to the event loop.

import { JobCancelledError, UnknownJobTypeError, computeJob, isJobType, type SliceOptions } from "./job-types";

export type WorkerRequest =
  | { kind: "run"; id: string; type: string; rows: unknown[]; params: unknown }
  | { kind: "cancel"; id: string };
export type WorkerResponse = { id: string; ok: true; result: unknown } | { id: string; ok: false; error: string };

export type JobExecutor = (type: string, rows: readonly unknown[], params: unknown, signal?: AbortSignal) => Promise<unknown>;

export class JobExecutionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Job failed: ${code}`);
    this.name = "JobExecutionError";
    this.code = code;
  }
}

/** The short code a failure is reported under. */
export function errorCode(err: unknown): string {
  if (err instanceof JobExecutionError) return err.code;
  if (err instanceof UnknownJobTypeError) return "UNKNOWN_TYPE";
  if (err instanceof JobCancelledError) return "CANCELLED";
  return "RUN_FAILED";
}

/** Runs one request. Never throws: every failure is a coded response. */
export async function handleRunRequest(req: Extract<WorkerRequest, { kind: "run" }>, slice: SliceOptions = {}): Promise<WorkerResponse> {
  if (!isJobType(req.type)) return { id: req.id, ok: false, error: "UNKNOWN_TYPE" };
  if (!Array.isArray(req.rows)) return { id: req.id, ok: false, error: "BAD_REQUEST" };
  try {
    return { id: req.id, ok: true, result: await computeJob(req.type, req.rows, req.params, slice) };
  } catch (err) {
    return { id: req.id, ok: false, error: errorCode(err) };
  }
}

/** The inside of the Worker: answers `run` and `cancel` messages. `scope` is the worker's global (self). */
export type WorkerScopeLike = {
  onmessage: ((ev: { data: WorkerRequest }) => void) | null;
  postMessage(msg: WorkerResponse): void;
};
export function attachWorkerHandler(scope: WorkerScopeLike, slice: SliceOptions = {}): void {
  const cancelled = new Set<string>();
  scope.onmessage = (ev) => {
    const msg = ev.data;
    if (msg?.kind === "cancel") {
      cancelled.add(msg.id);
    } else if (msg?.kind === "run") {
      void handleRunRequest(msg, { ...slice, shouldStop: () => cancelled.has(msg.id) }).then((res) => {
        cancelled.delete(msg.id);
        scope.postMessage(res);
      });
    }
  };
}

/** The in-process executor: the same code the Worker runs, on the calling thread (sliced). Used in tests and when no Worker exists. */
export function createInProcessExecutor(slice: SliceOptions = {}): JobExecutor {
  let n = 0;
  return async (type, rows, params, signal) => {
    const res = await handleRunRequest({ kind: "run", id: String(++n), type, rows: rows as unknown[], params }, { ...slice, shouldStop: () => signal?.aborted === true || slice.shouldStop?.() === true });
    if (!res.ok) throw new JobExecutionError(res.error);
    return res.result;
  };
}

/** What the page needs of a real Worker (so a test can pass a fake). */
export type WorkerLike = {
  postMessage(msg: WorkerRequest): void;
  terminate(): void;
  onmessage: ((ev: { data: WorkerResponse }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

/** Talks to a Worker through the protocol above. One request at a time per id; an abort sends `cancel` and rejects at once. */
export function createWorkerExecutor(worker: WorkerLike): JobExecutor & { terminate(): void } {
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  let n = 0;
  worker.onmessage = (ev) => {
    const res = ev.data;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.result); else p.reject(new JobExecutionError(res.error));
  };
  worker.onerror = () => {
    for (const p of pending.values()) p.reject(new JobExecutionError("RUN_FAILED"));
    pending.clear();
  };
  const exec: JobExecutor = (type, rows, params, signal) =>
    new Promise((resolve, reject) => {
      const id = String(++n);
      if (signal?.aborted) return reject(new JobExecutionError("CANCELLED"));
      pending.set(id, { resolve, reject });
      signal?.addEventListener("abort", () => {
        if (!pending.delete(id)) return;
        worker.postMessage({ kind: "cancel", id });
        reject(new JobExecutionError("CANCELLED"));
      }, { once: true });
      worker.postMessage({ kind: "run", id, type, rows: rows as unknown[], params });
    });
  return Object.assign(exec, { terminate: () => worker.terminate() });
}
