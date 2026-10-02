// The Web Worker's entry file (loaded by browser-worker.ts). All logic is in worker.ts so it is testable without a Worker.
import { attachWorkerHandler, type WorkerScopeLike } from "./worker";

attachWorkerHandler(globalThis as unknown as WorkerScopeLike);
