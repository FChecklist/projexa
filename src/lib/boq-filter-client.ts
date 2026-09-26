// PROJEXA-BUILD-001 U-33 (E-10). The main-thread side of the project line search: a small promise API over the Web Worker in
// boq-filter.worker.ts. `kind` says where the search really runs ("worker", or "main" when the browser cannot start a worker), and the
// screen prints it, so a run that silently fell back to the main thread is visible instead of just slower.
//
// The worker is created through `new Worker(new URL(..., import.meta.url))`, the form Next.js recognises and bundles as a separate chunk.
// Tests pass their own createWorker, so this file needs no browser to be tested.

import {
  BoqLineIndex,
  answerBoqFilterMessage,
  type BoqFilterQuery,
  type BoqFilterReply,
  type BoqFilterRequest,
  type BoqFilterResult,
} from "./boq-filter-engine"
import type { GatewayBoqLine } from "./boq-gateway-client"

/** The part of a Worker this client uses, so a test can supply a stand-in. */
export type WorkerLike = {
  postMessage: (message: unknown) => void
  terminate: () => void
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
}

export type BoqFilterClient = {
  readonly kind: "worker" | "main"
  /** Empties the index. */
  reset: () => Promise<void>
  /** Adds lines to the index and resolves with the index size. */
  append: (lines: readonly GatewayBoqLine[]) => Promise<number>
  filter: (query: BoqFilterQuery) => Promise<BoqFilterResult & { indexed: number }>
  /** Stops the worker. Requests still in flight are rejected. */
  dispose: () => void
}

export type CreateBoqFilterClientOptions = {
  /** Returns a started worker, or null when the environment has none. Defaults to the real one. */
  createWorker?: () => WorkerLike | null
}

function startRealWorker(): WorkerLike | null {
  if (typeof Worker === "undefined") return null
  try {
    return new Worker(new URL("./boq-filter.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike
  } catch {
    return null
  }
}

/** Wraps "send one request, get one reply" into the four calls the screen uses. */
function makeClient(
  kind: "worker" | "main",
  run: (request: BoqFilterRequest) => Promise<BoqFilterReply>,
  nextId: () => number,
  stop: () => void
): BoqFilterClient {
  async function ask(request: BoqFilterRequest): Promise<BoqFilterReply> {
    const reply = await run(request)
    if (reply.type === "error") throw new Error(reply.message)
    return reply
  }
  return {
    kind,
    async reset() {
      await ask({ type: "reset", id: nextId() })
    },
    async append(lines) {
      const reply = await ask({ type: "append", id: nextId(), lines: lines as GatewayBoqLine[] })
      return reply.type === "ok" ? reply.indexed : 0
    },
    async filter(query) {
      const reply = await ask({ type: "filter", id: nextId(), ...query })
      if (reply.type !== "result") throw new Error("The line search answered with the wrong reply type")
      return { total: reply.total, matched: reply.matched, rows: reply.rows, indexed: reply.indexed }
    },
    dispose: stop,
  }
}

export function createBoqFilterClient(options: CreateBoqFilterClientOptions = {}): BoqFilterClient {
  const worker = (options.createWorker ?? startRealWorker)()
  let counter = 0
  const nextId = () => ++counter

  if (!worker) {
    // No worker in this environment: run the same engine on this thread. Correct, and the screen says so.
    const index = new BoqLineIndex()
    return makeClient("main", (request) => Promise.resolve(answerBoqFilterMessage(index, request)), nextId, () => {})
  }

  let stopped = false
  const pending = new Map<number, { resolve: (reply: BoqFilterReply) => void; reject: (err: Error) => void }>()

  function rejectAll(reason: string) {
    for (const entry of pending.values()) entry.reject(new Error(reason))
    pending.clear()
  }

  worker.onmessage = (event) => {
    const reply = event.data as BoqFilterReply
    const entry = pending.get(reply?.id)
    if (!entry) return
    pending.delete(reply.id)
    entry.resolve(reply)
  }
  worker.onerror = () => rejectAll("The line search worker failed")

  const run = (request: BoqFilterRequest): Promise<BoqFilterReply> =>
    new Promise<BoqFilterReply>((resolve, reject) => {
      if (stopped) {
        reject(new Error("The line search worker was stopped"))
        return
      }
      pending.set(request.id, { resolve, reject })
      worker.postMessage(request)
    })

  return makeClient("worker", run, nextId, () => {
    stopped = true
    rejectAll("The line search worker was stopped")
    worker.terminate()
  })
}
