/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-33 (BR-419, E-09). The read source of the BOQ Object Page: with the switches off it is the existing proxy read,
// with the gateway switch on the screen's lines come from the gateway filtered to this BOQ, and with browser-first on they are also kept
// on the device and answered from it when there is no network. Real cache (fake-indexeddb) and a real search index; the network is a
// stand-in.
import "fake-indexeddb/auto"
import { afterEach, describe, expect, test } from "bun:test"
import { createStore, keys } from "idb-keyval"
import { createBoqFilterClient } from "./boq-filter-client"
import { BoqGatewayError, fetchAllBoqLines, type GatewayBoqLine } from "./boq-gateway-client"
import { clearBoqDeviceCopy, openProjectLineWriter, readBoqHeader, readProjectLines, saveBoqHeader } from "./boq-line-cache"
import {
  BoqLoadSuperseded,
  headerOf,
  loadBoqForScreen,
  orderLinesForBoq,
  toBoqLineItemRow,
  type BoqScreenDeps,
  type BoqWithLines,
} from "./boq-read-source"

const USER = "user-1"
const PROJECT = "proj-1"
const BOQ = "boq-2"

function gline(n: number, over: Partial<GatewayBoqLine> = {}): GatewayBoqLine {
  return {
    id: `line-${String(n).padStart(6, "0")}`, boqId: BOQ, boqTitle: "Villa 21 Rev1", boqVersion: 2, boqStatus: "approved",
    parentLineItemId: null, activityId: null, itemCode: `IC-${n}`, category: "Civil", description: `Concrete work ${n}`, unit: "m3",
    quantity: "10", rate: "5.50", amount: "55.00", createdAt: "2026-09-01T00:00:00Z", ...over,
  }
}

/** 10,907 lines of one project: 40 in the BOQ the screen is opened for (boq-2), the rest in three other BOQs and revisions. */
function projectLines(): GatewayBoqLine[] {
  const out: GatewayBoqLine[] = []
  for (let i = 1; i <= 10_907; i++) {
    const mine = i % 273 === 0 // 39 lines
    out.push(gline(i, mine ? {} : { boqId: i % 2 ? "boq-1" : "boq-3", boqTitle: i % 2 ? "Villa 21" : "Villa 22", boqVersion: 1, boqStatus: i % 2 ? "superseded" : "draft" }))
  }
  return out
}

const restHeader: BoqWithLines = {
  id: BOQ, projectId: PROJECT, version: 2, title: "Villa 21 Rev1 (old title)", status: "draft", parentBoqId: "boq-1",
  createdAt: "2026-08-28T00:00:00Z", lineItems: [],
}

type Spy = { rest: string[]; gatewayCalls: number; tokens: Array<string | null> }

function deps(over: Partial<BoqScreenDeps> = {}, opts: { lines?: GatewayBoqLine[]; online?: boolean; session?: boolean; gateway?: "ok" | "off" | "network" | "error" } = {}) {
  const spy: Spy = { rest: [], gatewayCalls: 0, tokens: [] }
  const lines = opts.lines ?? projectLines()
  const gateway = opts.gateway ?? "ok"
  const d: BoqScreenDeps = {
    readBoqWithLines: async (id) => {
      spy.rest.push(id)
      return { ...restHeader, id, lineItems: [{ id: "rest-line", itemCode: null, description: "From the proxy", unit: "m3", quantity: "1", rate: "1", amount: "1", activityId: null }] }
    },
    fetchAllBoqLines: async (o) => {
      spy.gatewayCalls += 1
      spy.tokens.push(await o.getAccessToken())
      if (gateway === "off") throw new BoqGatewayError("off", 503)
      if (gateway === "network") throw new BoqGatewayError("Failed to fetch", 0)
      if (gateway === "error") throw new BoqGatewayError("boom", 500)
      const fake = (async (input: RequestInfo | URL) => {
        const url = new URL(String(input))
        const after = url.searchParams.get("after")
        const limit = Number(url.searchParams.get("limit"))
        const start = after === null ? 0 : lines.findIndex((l) => l.id === after) + 1
        const rows = lines.slice(start, start + limit)
        const nextAfter = start + limit < lines.length ? rows[rows.length - 1].id : null
        return new Response(JSON.stringify({ rows, nextAfter }), { status: 200 })
      }) as typeof fetch
      return fetchAllBoqLines({ ...o, fetchImpl: fake })
    },
    getSession: async () => (opts.session === false ? null : { accessToken: "tok-1", userId: USER }),
    isOnline: () => opts.online !== false,
    cache: { readBoqHeader, saveBoqHeader, openProjectLineWriter, readProjectLines },
    ...over,
  }
  return { d, spy }
}

afterEach(async () => {
  await clearBoqDeviceCopy(USER)
})

describe("with both switches off", () => {
  test("it is the existing proxy read: one GET of the BOQ, the proxy's lines, no session, no gateway, no copy", async () => {
    const { d, spy } = deps({ getSession: async () => { throw new Error("session must not be read") } })
    const out = await loadBoqForScreen({ boqId: BOQ, flags: { viaGateway: false, browserFirst: false }, filter: null }, d)
    expect(spy.rest).toEqual([BOQ])
    expect(spy.gatewayCalls).toBe(0)
    expect(out.source).toBe("rest")
    expect(out.lines.map((l) => l.id)).toEqual(["rest-line"])
    expect(out.boq).toEqual(headerOf(restHeader))
    expect(out).toMatchObject({ copyStatus: "off", copySavedAt: null, indexedLines: 0 })
  })

  test("browser-first without the gateway switch is still the proxy read", async () => {
    const { d, spy } = deps()
    const out = await loadBoqForScreen({ boqId: BOQ, flags: { viaGateway: false, browserFirst: true }, filter: null }, d)
    expect(out.source).toBe("rest")
    expect(spy.gatewayCalls).toBe(0)
  })
})

describe("with the gateway switch on", () => {
  test("the screen's lines come from the gateway, only this BOQ's, and not from the proxy's lineItems", async () => {
    const { d, spy } = deps()
    const out = await loadBoqForScreen({ boqId: BOQ, flags: { viaGateway: true, browserFirst: false }, filter: null }, d)
    expect(out.source).toBe("gateway")
    expect(spy.gatewayCalls).toBe(1)
    expect(spy.tokens).toEqual(["tok-1"])
    expect(out.lines.length).toBe(39)
    expect(out.lines.some((l) => l.id === "rest-line")).toBe(false)
    expect(out.lines.every((l) => Number(l.id.slice(5)) % 273 === 0)).toBe(true)
    expect(out.copyStatus).toBe("off")
  })

  test("with no device copy the header is read once through the proxy, and title, version and status come from the fresh rows", async () => {
    const { d, spy } = deps()
    const out = await loadBoqForScreen({ boqId: BOQ, flags: { viaGateway: true, browserFirst: false }, filter: null }, d)
    expect(spy.rest).toEqual([BOQ])
    expect(out.boq).toEqual({ ...headerOf(restHeader), title: "Villa 21 Rev1", version: 2, status: "approved" })
    expect(out.boq.parentBoqId).toBe("boq-1")
  })

  test("a first visit whose lines response holds none of this BOQ's lines shows an empty BOQ, using the header it already read", async () => {
    const other = projectLines().map((l) => ({ ...l, boqId: "boq-9" }))
    const { d, spy } = deps({}, { lines: other })
    const out = await loadBoqForScreen({ boqId: BOQ, flags: { viaGateway: true, browserFirst: false }, filter: null }, d)
    expect(out.lines).toEqual([])
    expect(out.boq).toEqual(headerOf(restHeader))
    expect(spy.rest).toEqual([BOQ])
  })

  test("with a saved header, a lines response that has none of this BOQ's lines asks the proxy whether it is empty or gone, and a refusal is shown", async () => {
    const other = projectLines().map((l) => ({ ...l, boqId: "boq-9" }))
    await saveBoqHeader(USER, headerOf(restHeader))
    const { d, spy } = deps({ readBoqWithLines: async () => { throw new Error("Not found") } }, { lines: other })
    await expect(loadBoqForScreen({ boqId: BOQ, flags: { viaGateway: true, browserFirst: true }, filter: null }, d)).rejects.toThrow("Not found")
    expect(spy.gatewayCalls).toBe(1)
    // nothing half-written stays readable after the refusal
    expect(await readProjectLines(USER, PROJECT, () => {})).toBeNull()
  })

  test("the switch being off on the server (503) falls back to the proxy read instead of breaking the screen", async () => {
    const { d, spy } = deps({}, { gateway: "off" })
    const out = await loadBoqForScreen({ boqId: BOQ, flags: { viaGateway: true, browserFirst: false }, filter: null }, d)
    expect(out.source).toBe("rest-fallback")
    expect(out.lines.map((l) => l.id)).toEqual(["rest-line"])
    expect(spy.rest.length).toBeGreaterThanOrEqual(1)
  })

  test("any other gateway failure is shown, not hidden behind the proxy", async () => {
    const { d } = deps({}, { gateway: "error" })
    await expect(loadBoqForScreen({ boqId: BOQ, flags: { viaGateway: true, browserFirst: false }, filter: null }, d)).rejects.toThrow("boom")
  })

  test("a signed-out browser reads through the proxy, which answers it in its own words", async () => {
    const { d, spy } = deps({}, { session: false })
    const out = await loadBoqForScreen({ boqId: BOQ, flags: { viaGateway: true, browserFirst: true }, filter: null }, d)
    expect(out.source).toBe("rest-fallback")
    expect(spy.gatewayCalls).toBe(0)
  })

  test("a reload right after a write reads the BOQ back through the proxy and does not repeat the project download", async () => {
    const { d, spy } = deps()
    const out = await loadBoqForScreen({ boqId: BOQ, flags: { viaGateway: true, browserFirst: true }, filter: null, afterWrite: true }, d)
    expect(out.source).toBe("rest")
    expect(spy.gatewayCalls).toBe(0)
  })
})

describe("with browser-first on", () => {
  const flags = { viaGateway: true, browserFirst: true }

  test("the first online load fills the search index with every project line and saves the whole project on the device", async () => {
    const filter = createBoqFilterClient({ createWorker: () => null })
    const { d } = deps()
    const out = await loadBoqForScreen({ boqId: BOQ, flags, filter }, d)
    expect(out).toMatchObject({ source: "gateway", copyStatus: "saved", indexedLines: 10_907 })
    expect((await filter.filter({ query: "", boqId: null, limit: 1 })).total).toBe(10_907)
    expect((await filter.filter({ query: "", boqId: BOQ, limit: 1 })).total).toBe(39)

    const saved: GatewayBoqLine[] = []
    const info = await readProjectLines(USER, PROJECT, (rows) => {
      saved.push(...rows)
    })
    expect(info?.total).toBe(10_907)
    expect(saved.length).toBe(10_907)
    const header = await readBoqHeader(USER, BOQ)
    expect(header?.header).toMatchObject({ id: BOQ, projectId: PROJECT, title: "Villa 21 Rev1", status: "approved", parentBoqId: "boq-1" })
  })

  test("a second online load takes the project from the saved header, so the proxy is not asked for the header again", async () => {
    const first = deps()
    await loadBoqForScreen({ boqId: BOQ, flags, filter: null }, first.d)
    expect(first.spy.rest).toEqual([BOQ])
    const second = deps()
    const out = await loadBoqForScreen({ boqId: BOQ, flags, filter: null }, second.d)
    expect(second.spy.rest).toEqual([])
    expect(second.spy.gatewayCalls).toBe(1)
    expect(out.source).toBe("gateway")
  })

  test("with no network the lines come from the device copy, the gateway is not asked, and the save time is reported", async () => {
    const filter = createBoqFilterClient({ createWorker: () => null })
    const online = deps()
    await loadBoqForScreen({ boqId: BOQ, flags, filter }, online.d)

    const offline = deps({}, { online: false })
    const out = await loadBoqForScreen({ boqId: BOQ, flags, filter }, offline.d)
    expect(offline.spy.gatewayCalls).toBe(0)
    expect(offline.spy.rest).toEqual([])
    expect(out.source).toBe("device-copy")
    expect(out.lines.length).toBe(39)
    expect(out.copySavedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(out.boq).toMatchObject({ id: BOQ, title: "Villa 21 Rev1", status: "approved" })
    expect(out.indexedLines).toBe(10_907)
    expect((await filter.filter({ query: "", boqId: null, limit: 1 })).total).toBe(10_907)
  })

  test("a gateway that cannot be reached falls back to the device copy", async () => {
    await loadBoqForScreen({ boqId: BOQ, flags, filter: null }, deps().d)
    const flaky = deps({}, { gateway: "network" })
    const out = await loadBoqForScreen({ boqId: BOQ, flags, filter: null }, flaky.d)
    expect(flaky.spy.gatewayCalls).toBe(1)
    expect(out.source).toBe("device-copy")
    expect(out.lines.length).toBe(39)
  })

  test("with no network and nothing saved, it says so instead of showing an empty BOQ", async () => {
    const { d } = deps({}, { online: false })
    await expect(loadBoqForScreen({ boqId: BOQ, flags, filter: null }, d)).rejects.toThrow("not been opened online")
  })

  test("with a saved header but no saved lines, it says there is no copy", async () => {
    await saveBoqHeader(USER, headerOf(restHeader))
    const { d } = deps({}, { online: false })
    await expect(loadBoqForScreen({ boqId: BOQ, flags, filter: null }, d)).rejects.toThrow("no copy")
  })

  test("a save that fails leaves the screen working online, says the copy was not saved, and leaves no half copy", async () => {
    const { d } = deps({
      cache: {
        readBoqHeader, saveBoqHeader, readProjectLines,
        openProjectLineWriter: () => ({
          addPage: async () => { throw new Error("QuotaExceededError") },
          commit: async () => ({ total: 0, savedAt: "x" }),
          abort: async () => {},
        }),
      },
    })
    const out = await loadBoqForScreen({ boqId: BOQ, flags, filter: null }, d)
    expect(out.source).toBe("gateway")
    expect(out.copyStatus).toBe("failed")
    expect(out.lines.length).toBe(39)
  })

  test("a download that fails halfway keeps the previous complete copy", async () => {
    await loadBoqForScreen({ boqId: BOQ, flags, filter: null }, deps().d)
    const broken = deps({
      fetchAllBoqLines: async (o) => {
        await o.onPage({ rows: projectLines().slice(0, 500), page: 1, received: 500 })
        throw new BoqGatewayError("boom", 500)
      },
    })
    await expect(loadBoqForScreen({ boqId: BOQ, flags, filter: null }, broken.d)).rejects.toThrow("boom")
    const info = await readProjectLines(USER, PROJECT, () => {})
    expect(info?.total).toBe(10_907)
  })
})

// The screen runs loadBoqForScreen again while an earlier run is still going (the route moved to another BOQ, a submit reloaded the page),
// and every run of a screen shares ONE search index that each run empties and then fills page by page. Without a rule for who owns the
// index, the two runs interleave and every line is listed twice. `current` below is the screen's own load counter, and `isCurrent` is
// what the screen passes in.
describe("two loads that overlap on one search index", () => {
  const flags = { viaGateway: true, browserFirst: true }
  const six = (): GatewayBoqLine[] => Array.from({ length: 6 }, (_, i) => gline(i + 1))

  function gate() {
    let open!: () => void
    let reached!: () => void
    const opened = new Promise<void>((resolve) => { open = resolve })
    const arrived = new Promise<void>((resolve) => { reached = resolve })
    return { open, opened, reached, arrived }
  }

  /** A gateway stand-in that sends the six lines as two pages of three and, given a gate, stops after the first page until it opens. */
  function twoPages(hold?: ReturnType<typeof gate>, then?: "fail"): BoqScreenDeps["fetchAllBoqLines"] {
    return async (o) => {
      const lines = six()
      await o.onPage({ rows: lines.slice(0, 3), page: 1, received: 3 })
      if (hold) {
        hold.reached()
        await hold.opened
      }
      if (then === "fail") throw new BoqGatewayError("Failed to fetch", 0)
      await o.onPage({ rows: lines.slice(3), page: 2, received: 6 })
      return { lines: 6, pages: 2 }
    }
  }

  /** Two lines per stored chunk, so a three- or six-line copy really is several chunks. */
  const smallChunks: BoqScreenDeps["cache"] = {
    readBoqHeader, saveBoqHeader, readProjectLines,
    openProjectLineWriter: (scope, projectId) => openProjectLineWriter(scope, projectId, { chunkRows: 2 }),
  }

  const outcome = (p: Promise<unknown>) => p.then(() => "resolved" as const, (err: unknown) => err)

  async function indexed(filter: ReturnType<typeof createBoqFilterClient>) {
    const all = await filter.filter({ query: "", boqId: null, limit: 1000 })
    return { total: all.total, distinct: new Set(all.rows.map((r) => r.id)).size }
  }

  async function chunkGenerations(): Promise<Set<string>> {
    const store = createStore(`projexa-boq-cache::${USER}`, "cache")
    return new Set((await keys(store)).map(String).filter((k) => k.startsWith(`lines:${PROJECT}:`)).map((k) => k.split(":")[2]))
  }

  test("a load started while another is downloading replaces it: the index holds each line once, the older load rejects, and only the newer one saves a copy", async () => {
    const filter = createBoqFilterClient({ createWorker: () => null })
    const hold = gate()
    let current = 1
    const first = outcome(loadBoqForScreen({ boqId: BOQ, flags, filter, isCurrent: () => current === 1 }, deps({ fetchAllBoqLines: twoPages(hold), cache: smallChunks }, { lines: [] }).d))
    await hold.arrived // the older load has put its first three lines in the index
    current = 2
    const second = await loadBoqForScreen({ boqId: BOQ, flags, filter, isCurrent: () => current === 2 }, deps({ fetchAllBoqLines: twoPages(), cache: smallChunks }, { lines: [] }).d)
    hold.open() // the older load's second page arrives late
    expect(await first).toBeInstanceOf(BoqLoadSuperseded)

    expect(second).toMatchObject({ source: "gateway", copyStatus: "saved", indexedLines: 6 })
    expect(await indexed(filter)).toEqual({ total: 6, distinct: 6 })
    const saved: string[] = []
    const info = await readProjectLines(USER, PROJECT, (rows) => { saved.push(...rows.map((r) => r.id)) })
    expect(info?.total).toBe(6)
    expect(new Set(saved).size).toBe(6)
    // the older load's stored chunk was removed: one generation of chunks is left, the newer load's three
    expect((await chunkGenerations()).size).toBe(1)
  })

  test("an older load that fails after a newer one started does not empty the newer load's index, and reports itself as replaced", async () => {
    const filter = createBoqFilterClient({ createWorker: () => null })
    const hold = gate()
    let current = 1
    const first = outcome(loadBoqForScreen({ boqId: BOQ, flags, filter, isCurrent: () => current === 1 }, deps({ fetchAllBoqLines: twoPages(hold, "fail") }, { lines: [] }).d))
    await hold.arrived
    current = 2
    await loadBoqForScreen({ boqId: BOQ, flags, filter, isCurrent: () => current === 2 }, deps({ fetchAllBoqLines: twoPages() }, { lines: [] }).d)
    hold.open() // the older load's network drops now
    expect(await first).toBeInstanceOf(BoqLoadSuperseded)
    expect(await indexed(filter)).toEqual({ total: 6, distinct: 6 })
  })

  test("an older load that was still waiting for its session when a newer one ran does not empty the newer load's index when it wakes", async () => {
    const filter = createBoqFilterClient({ createWorker: () => null })
    const hold = gate()
    let current = 1
    const slowSession = deps({
      fetchAllBoqLines: twoPages(),
      getSession: async () => {
        hold.reached()
        await hold.opened
        return { accessToken: "tok-1", userId: USER }
      },
    }, { lines: [] })
    const first = outcome(loadBoqForScreen({ boqId: BOQ, flags, filter, isCurrent: () => current === 1 }, slowSession.d))
    await hold.arrived
    current = 2
    await loadBoqForScreen({ boqId: BOQ, flags, filter, isCurrent: () => current === 2 }, deps({ fetchAllBoqLines: twoPages() }, { lines: [] }).d)
    hold.open()
    expect(await first).toBeInstanceOf(BoqLoadSuperseded)
    expect(await indexed(filter)).toEqual({ total: 6, distinct: 6 })
  })

  test("the same rule holds when the lines come from the device copy: an older load stops adding chunks once a newer one started", async () => {
    // First an online load saves a six-line copy in three chunks of two.
    await loadBoqForScreen({ boqId: BOQ, flags, filter: null }, deps({ fetchAllBoqLines: twoPages(), cache: smallChunks }, { lines: [] }).d)
    const filter = createBoqFilterClient({ createWorker: () => null })
    const hold = gate()
    let current = 1
    const slowRead: typeof readProjectLines = async (scope, projectId, onChunk) => {
      let firstChunk = true
      return readProjectLines(scope, projectId, async (rows) => {
        await onChunk(rows)
        if (firstChunk) {
          firstChunk = false
          hold.reached()
          await hold.opened
        }
      })
    }
    const older = deps({ cache: { readBoqHeader, saveBoqHeader, openProjectLineWriter, readProjectLines: slowRead } }, { lines: [], online: false })
    const first = outcome(loadBoqForScreen({ boqId: BOQ, flags, filter, isCurrent: () => current === 1 }, older.d))
    await hold.arrived // two lines of the copy are in the index
    current = 2
    const second = await loadBoqForScreen({ boqId: BOQ, flags, filter, isCurrent: () => current === 2 }, deps({}, { lines: [], online: false }).d)
    hold.open()
    expect(await first).toBeInstanceOf(BoqLoadSuperseded)
    expect(second).toMatchObject({ source: "device-copy", indexedLines: 6 })
    expect(await indexed(filter)).toEqual({ total: 6, distinct: 6 })
  })

  test("an older load that finished downloading but was replaced before it saved does not replace the saved copy", async () => {
    // A complete six-line copy is saved first.
    await loadBoqForScreen({ boqId: BOQ, flags, filter: null }, deps({ fetchAllBoqLines: twoPages(), cache: smallChunks }, { lines: [] }).d)
    // The older load's answer holds none of this BOQ's lines, so it asks the proxy whether the BOQ is empty or gone, and waits there.
    const hold = gate()
    let current = 1
    const older = deps({
      fetchAllBoqLines: async (o) => {
        await o.onPage({ rows: [gline(1, { boqId: "boq-9" }), gline(2, { boqId: "boq-9" })], page: 1, received: 2 })
        return { lines: 2, pages: 1 }
      },
      readBoqWithLines: async () => {
        hold.reached()
        await hold.opened
        return restHeader
      },
    }, { lines: [] })
    const first = outcome(loadBoqForScreen({ boqId: BOQ, flags, filter: null, isCurrent: () => current === 1 }, older.d))
    await hold.arrived
    current = 2 // a newer load starts while the older one waits for the proxy
    hold.open()
    expect(await first).toBeInstanceOf(BoqLoadSuperseded)
    expect((await readProjectLines(USER, PROJECT, () => {}))?.total).toBe(6)
  })

  test("a load that is never replaced (no isCurrent) is unchanged", async () => {
    const filter = createBoqFilterClient({ createWorker: () => null })
    const out = await loadBoqForScreen({ boqId: BOQ, flags, filter }, deps({ fetchAllBoqLines: twoPages() }, { lines: [] }).d)
    expect(out).toMatchObject({ source: "gateway", copyStatus: "saved", indexedLines: 6 })
    expect(await indexed(filter)).toEqual({ total: 6, distinct: 6 })
  })
})

describe("orderLinesForBoq", () => {
  test("puts every child after its parent and orders roots by creation time then id", () => {
    const lines = [
      gline(3, { id: "c", parentLineItemId: "a", createdAt: "2026-09-01T00:00:00Z" }),
      gline(2, { id: "b", createdAt: "2026-09-01T00:00:01Z" }),
      gline(1, { id: "a", createdAt: "2026-09-01T00:00:00Z" }),
      gline(4, { id: "d", parentLineItemId: "b", createdAt: "2026-09-01T00:00:00Z" }),
    ]
    expect(orderLinesForBoq(lines).map((l) => l.id)).toEqual(["a", "c", "b", "d"])
  })

  test("keeps a line whose parent is not in the list, and does not lose lines in a parent cycle", () => {
    const lines = [gline(1, { id: "x", parentLineItemId: "gone" }), gline(2, { id: "p", parentLineItemId: "q" }), gline(3, { id: "q", parentLineItemId: "p" })]
    expect(orderLinesForBoq(lines).map((l) => l.id).sort()).toEqual(["p", "q", "x"])
  })
})

describe("toBoqLineItemRow", () => {
  test("carries the fields the table shows and none of the project-side cost fields", () => {
    const row = toBoqLineItemRow(gline(1, { budgetPercentage: "25", vendorId: "v1", vendorAmount: "3", materialAmount: "1", manpowerAmount: "2", breakdownPercentage: "50" }))
    expect(row).toEqual({
      id: "line-000001", itemCode: "IC-1", description: "Concrete work 1", unit: "m3", quantity: "10", rate: "5.50", amount: "55.00",
      activityId: null, category: "Civil", parentLineItemId: null, breakdownPercentage: "50", budgetPercentage: "25", vendorId: "v1",
      vendorAmount: "3", materialAmount: "1", manpowerAmount: "2",
    })
    for (const forbidden of ["qtyProject", "rateProject", "projectValue", "variance"]) expect(forbidden in row).toBe(false)
  })
})
