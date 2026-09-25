/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-33 (BR-419, E-09). The read source of the BOQ Object Page: with the switches off it is the existing proxy read,
// with the gateway switch on the screen's lines come from the gateway filtered to this BOQ, and with browser-first on they are also kept
// on the device and answered from it when there is no network. Real cache (fake-indexeddb) and a real search index; the network is a
// stand-in.
import "fake-indexeddb/auto"
import { afterEach, describe, expect, test } from "bun:test"
import { createBoqFilterClient } from "./boq-filter-client"
import { BoqGatewayError, fetchAllBoqLines, type GatewayBoqLine } from "./boq-gateway-client"
import { clearBoqDeviceCopy, openProjectLineWriter, readBoqHeader, readProjectLines, saveBoqHeader } from "./boq-line-cache"
import {
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
