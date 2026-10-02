// Creates the real Web Worker executor in the browser; falls back to the in-process (sliced) executor when the
// browser cannot start a Worker, so offload never depends on one. Kept apart from worker.ts so tests never touch
// `new Worker(...)`.
import { createInProcessExecutor, createWorkerExecutor, type JobExecutor } from "./worker";

export function createBrowserExecutor(): JobExecutor {
  try {
    if (typeof Worker !== "undefined") {
      return createWorkerExecutor(new Worker(new URL("./worker-entry.ts", import.meta.url), { type: "module" }) as unknown as Parameters<typeof createWorkerExecutor>[0]);
    }
  } catch {
    /* no Worker (blocked, old browser): run sliced on this thread */
  }
  return createInProcessExecutor();
}
