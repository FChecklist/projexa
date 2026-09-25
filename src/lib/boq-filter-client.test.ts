/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-33 (E-10). The main-thread client of the project line search, against a stand-in worker, and against a real
// worker thread started from src/lib/boq-filter.worker.ts (the file the browser bundle starts).
import { describe, expect, test } from "bun:test"
import { createBoqFilterClient, type WorkerLike } from "./boq-filter-client"
import { BoqLineIndex, answerBoqFilterMessage } from "./boq-filter-engine"
import type { GatewayBoqLine } from "./boq-gateway-client"

function line(id: string, description = "Concrete", boqId = "boq-a"): GatewayBoqLine {
  return {
    id, boqId, boqTitle: "Villa 21", boqVersion: 1, boqStatus: "approved", parentLineItemId: null, activityId: null,
    itemCode: null, category: null, description, unit: "m3", quantity: "1", rate: "1", amount: "1",
  }
}

/** A stand-in worker that answers on a later tick, like the real one, using the same engine. */
function standInWorker(): WorkerLike & { posted: unknown[]; terminated: boolean; failNext: () => void } {
  const index = new BoqLineIndex()
  const worker: WorkerLike & { posted: unknown[]; terminated: boolean; failNext: () => void } = {
    posted: [],
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(message: unknown) {
      worker.posted.push(message)
      const reply = answerBoqFilterMessage(index, message)
      setTimeout(() => worker.onmessage?.({ data: reply }), 0)
    },
    terminate() {
      worker.terminated = true
    },
    failNext() {
      worker.postMessage = () => worker.onerror?.({})
    },
  }
  return worker
}

describe("createBoqFilterClient with a worker", () => {
  test("reports kind worker and sends every request to the worker, never running the search itself", async () => {
    const worker = standInWorker()
    const client = createBoqFilterClient({ createWorker: () => worker })
    expect(client.kind).toBe("worker")
    await client.reset()
    expect(await client.append([line("a"), line("b", "Steel")])).toBe(2)
    const result = await client.filter({ query: "steel", boqId: null, limit: 10 })
    expect(result).toMatchObject({ total: 2, matched: 1, indexed: 2 })
    expect(result.rows.map((r) => r.id)).toEqual(["b"])
    expect(worker.posted.map((m) => (m as { type: string }).type)).toEqual(["reset", "append", "filter"])
  })

  test("answers arrive against the right request even when they come back out of order", async () => {
    const index = new BoqLineIndex()
    index.append([line("a", "Concrete"), line("b", "Steel")])
    const held: Array<() => void> = []
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      terminate() {},
      postMessage(message: unknown) {
        const reply = answerBoqFilterMessage(index, message)
        held.push(() => worker.onmessage?.({ data: reply }))
      },
    }
    const client = createBoqFilterClient({ createWorker: () => worker })
    const first = client.filter({ query: "concrete", boqId: null, limit: 5 })
    const second = client.filter({ query: "steel", boqId: null, limit: 5 })
    held[1]()
    held[0]()
    expect((await first).rows.map((r) => r.id)).toEqual(["a"])
    expect((await second).rows.map((r) => r.id)).toEqual(["b"])
  })

  test("an error reply rejects the call with the worker's own message", async () => {
    const client = createBoqFilterClient({ createWorker: () => standInWorker() })
    const err = await client.filter({ query: 3 as unknown as string, boqId: null, limit: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain("query string")
  })

  test("a worker that fails rejects the requests waiting on it", async () => {
    const worker = standInWorker()
    worker.failNext()
    const client = createBoqFilterClient({ createWorker: () => worker })
    const err = await client.filter({ query: "a", boqId: null, limit: 1 }).catch((e) => e)
    expect(err.message).toContain("worker failed")
  })

  test("dispose terminates the worker and rejects what is still waiting and anything asked after", async () => {
    const worker: WorkerLike & { terminated: boolean } = {
      terminated: false, onmessage: null, onerror: null, postMessage() {}, terminate() { worker.terminated = true },
    }
    const client = createBoqFilterClient({ createWorker: () => worker })
    const waiting = client.filter({ query: "a", boqId: null, limit: 1 }).catch((e) => e)
    client.dispose()
    expect(worker.terminated).toBe(true)
    expect((await waiting).message).toContain("stopped")
    expect((await client.reset().catch((e) => e)).message).toContain("stopped")
  })
})

describe("createBoqFilterClient without a worker", () => {
  test("falls back to the main thread, says so, and still answers correctly", async () => {
    const client = createBoqFilterClient({ createWorker: () => null })
    expect(client.kind).toBe("main")
    await client.append([line("a"), line("b", "Steel")])
    const result = await client.filter({ query: "steel", boqId: null, limit: 10 })
    expect(result.rows.map((r) => r.id)).toEqual(["b"])
  })
})

describe("createBoqFilterClient with the real worker file", () => {
  test("starts src/lib/boq-filter.worker.ts on its own thread and searches 10,907 lines through it", async () => {
    const client = createBoqFilterClient({
      createWorker: () => new Worker(new URL("./boq-filter.worker.ts", import.meta.url)) as unknown as WorkerLike,
    })
    try {
      expect(client.kind).toBe("worker")
      await client.reset()
      const rows = Array.from({ length: 10_907 }, (_, i) => line(`r${i}`, i % 5 === 0 ? `Formwork ${i}` : `Concrete ${i}`, i < 4_000 ? "boq-a" : "boq-b"))
      for (let i = 0; i < rows.length; i += 500) await client.append(rows.slice(i, i + 500))
      const project = await client.filter({ query: "formwork", boqId: null, limit: 100 })
      expect(project).toMatchObject({ total: 10_907, matched: 2_182, indexed: 10_907 })
      expect(project.rows.length).toBe(100)
      const one = await client.filter({ query: "formwork", boqId: "boq-a", limit: 100 })
      expect(one).toMatchObject({ total: 4_000, matched: 800 })
    } finally {
      client.dispose()
    }
  })

  test("the default client, with no options, starts a real worker where the runtime has one", async () => {
    const client = createBoqFilterClient()
    try {
      expect(client.kind).toBe("worker")
      await client.append([line("a")])
      expect((await client.filter({ query: "", boqId: null, limit: 5 })).matched).toBe(1)
    } finally {
      client.dispose()
    }
  })
})
