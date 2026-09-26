/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-33 (BR-419, E-11). The browser side of the identity gateway: the URL is a code constant, the request carries the
// signed-in person's token as Bearer and nothing else, and every page is followed until nextAfter is null.
import { describe, expect, test } from "bun:test"
import {
  BOQ_GATEWAY_PAGE_LIMIT,
  BOQ_READ_GATEWAY_URL,
  BoqGatewayError,
  fetchAllBoqLines,
  type GatewayBoqLine,
} from "./boq-gateway-client"

function line(n: number, boqId = "boq-1"): GatewayBoqLine {
  const id = `line-${String(n).padStart(6, "0")}`
  return {
    id, boqId, boqTitle: "Villa 21", boqVersion: 1, boqStatus: "approved", parentLineItemId: null, activityId: null,
    itemCode: `IC-${n}`, category: "Civil", description: `Concrete work ${n}`, unit: "m3", quantity: "10", rate: "5.50", amount: "55.00",
  }
}

type Call = { url: URL; init: RequestInit }

/** A fake gateway holding `total` lines in id order, paging exactly as the Edge Function does. */
function fakeGateway(total: number) {
  const all = Array.from({ length: total }, (_, i) => line(i + 1))
  const calls: Call[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, init: init ?? {} })
    const after = url.searchParams.get("after")
    const limit = Number(url.searchParams.get("limit"))
    const start = after === null ? 0 : all.findIndex((l) => l.id === after) + 1
    const rows = all.slice(start, start + limit)
    const nextAfter = start + limit < all.length ? rows[rows.length - 1].id : null
    return new Response(JSON.stringify({ fn: "boq_lines", projectId: url.searchParams.get("projectId"), rows, nextAfter }), { status: 200 })
  }) as typeof fetch
  return { impl, calls }
}

async function collect(opts: Partial<Parameters<typeof fetchAllBoqLines>[0]> & { fetchImpl: typeof fetch }) {
  const pages: number[] = []
  const ids: string[] = []
  const result = await fetchAllBoqLines({
    projectId: "proj-1",
    getAccessToken: async () => "token-abc",
    onPage: ({ rows, page }) => {
      pages.push(page)
      for (const r of rows) ids.push(r.id)
    },
    ...opts,
  })
  return { result, pages, ids }
}

describe("the gateway URL", () => {
  test("is a code constant naming the projexa-read Edge Function on the VERIDIAN project", () => {
    expect(BOQ_READ_GATEWAY_URL).toBe("https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-read")
  })

  test("is the address a request is sent to, with no environment value in between", async () => {
    const gw = fakeGateway(3)
    await collect({ fetchImpl: gw.impl })
    expect(gw.calls[0].url.origin + gw.calls[0].url.pathname).toBe(BOQ_READ_GATEWAY_URL)
  })
})

describe("fetchAllBoqLines", () => {
  test("follows nextAfter until it is null: 10,907 lines arrive as 22 pages, none dropped, none repeated", async () => {
    const gw = fakeGateway(10_907)
    const { result, pages, ids } = await collect({ fetchImpl: gw.impl })
    expect(result).toEqual({ lines: 10_907, pages: 22 })
    expect(pages).toEqual(Array.from({ length: 22 }, (_, i) => i + 1))
    expect(ids.length).toBe(10_907)
    expect(new Set(ids).size).toBe(10_907)
    expect(ids[0]).toBe("line-000001")
    expect(ids[10_906]).toBe("line-010907")
  })

  test("passes the previous page's nextAfter back as `after`, and asks for the gateway's largest page", async () => {
    const gw = fakeGateway(1_200)
    await collect({ fetchImpl: gw.impl })
    const afters = gw.calls.map((c) => c.url.searchParams.get("after"))
    expect(afters).toEqual([null, "line-000500", "line-001000"])
    expect(gw.calls.every((c) => c.url.searchParams.get("limit") === String(BOQ_GATEWAY_PAGE_LIMIT))).toBe(true)
    expect(BOQ_GATEWAY_PAGE_LIMIT).toBe(500)
  })

  test("sends the person's token as Bearer and nothing else: no cookie, no other header, and only the three query keys", async () => {
    const gw = fakeGateway(2)
    await collect({ fetchImpl: gw.impl })
    const { url, init } = gw.calls[0]
    expect(init.method).toBe("GET")
    expect(init.headers).toEqual({ Authorization: "Bearer token-abc" })
    expect(init.credentials).toBe("omit")
    expect([...url.searchParams.keys()].sort()).toEqual(["fn", "limit", "projectId"])
    expect(url.searchParams.get("fn")).toBe("boq_lines")
    expect(url.searchParams.get("projectId")).toBe("proj-1")
    expect(String(url)).not.toContain("token-abc")
  })

  test("a signed-out person is refused before any request is sent", async () => {
    const gw = fakeGateway(2)
    const err = await collect({ fetchImpl: gw.impl, getAccessToken: async () => null }).catch((e) => e)
    expect(err).toBeInstanceOf(BoqGatewayError)
    expect(err.status).toBe(401)
    expect(err.code).toBe("NO_SESSION")
    expect(gw.calls.length).toBe(0)
  })

  test("503 (the switch is off) is reported as unavailable so the screen can read the usual way", async () => {
    const impl = (async () => new Response(JSON.stringify({ error: "off" }), { status: 503 })) as typeof fetch
    const err = await collect({ fetchImpl: impl }).catch((e) => e)
    expect(err).toBeInstanceOf(BoqGatewayError)
    expect(err.isUnavailable).toBe(true)
    expect(err.isNetworkFailure).toBe(false)
  })

  test("403 keeps the gateway's own sentence and code", async () => {
    const impl = (async () =>
      new Response(JSON.stringify({ error: "Your PROJEXA account is not linked to a VERIDIAN user - ask your admin", code: "USER_NOT_LINKED" }), { status: 403 })) as typeof fetch
    const err = await collect({ fetchImpl: impl }).catch((e) => e)
    expect(err.status).toBe(403)
    expect(err.code).toBe("USER_NOT_LINKED")
    expect(err.message).toContain("not linked")
  })

  test("a request that never reaches the gateway is a network failure, not an HTTP answer", async () => {
    const impl = (async () => {
      throw new TypeError("Failed to fetch")
    }) as typeof fetch
    const err = await collect({ fetchImpl: impl }).catch((e) => e)
    expect(err).toBeInstanceOf(BoqGatewayError)
    expect(err.isNetworkFailure).toBe(true)
    expect(err.isUnavailable).toBe(false)
  })

  test("a body that is not a page of lines fails instead of showing a partial list", async () => {
    for (const body of [{}, { rows: "no", nextAfter: null }, { rows: [], nextAfter: 5 }, null]) {
      const impl = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch
      const err = await collect({ fetchImpl: impl }).catch((e) => e)
      expect(err).toBeInstanceOf(BoqGatewayError)
      expect(err.status).toBe(502)
    }
  })

  test("a line with no id or no BOQ id fails", async () => {
    const impl = (async () => new Response(JSON.stringify({ rows: [{ id: "a" }], nextAfter: null }), { status: 200 })) as typeof fetch
    const err = await collect({ fetchImpl: impl }).catch((e) => e)
    expect(err).toBeInstanceOf(BoqGatewayError)
    expect(err.message).toContain("no id or no BOQ id")
  })

  test("a cursor that does not move fails instead of looping", async () => {
    let n = 0
    const impl = (async () => {
      n += 1
      return new Response(JSON.stringify({ rows: [line(n)], nextAfter: "line-000001" }), { status: 200 })
    }) as typeof fetch
    const err = await collect({ fetchImpl: impl }).catch((e) => e)
    expect(err).toBeInstanceOf(BoqGatewayError)
    expect(err.message).toContain("cursor")
    expect(n).toBeLessThanOrEqual(3)
  })

  test("a gateway that never ends stops at the page cap", async () => {
    let n = 0
    const impl = (async () => {
      n += 1
      return new Response(JSON.stringify({ rows: [line(n)], nextAfter: `line-${n}` }), { status: 200 })
    }) as typeof fetch
    const err = await collect({ fetchImpl: impl, maxPages: 5 }).catch((e) => e)
    expect(err).toBeInstanceOf(BoqGatewayError)
    expect(n).toBe(5)
  })
})
