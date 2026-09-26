// PROJEXA-BUILD-001 U-33 (PMD-01, PMD-32). The browser side of the identity gateway: a signed-in PROJEXA session reads the BOQ line
// items of its own organisation from the Supabase Edge Function `projexa-read` on the VERIDIAN project, with its own access token, and
// no Vercel function in the path. Nothing here runs unless BUILD001_BOQ_READ_VIA_GATEWAY is on (see boq-read-flags.ts).
//
// THE CONTRACT (compliance-tracker supabase/functions/projexa-read/README.md)
//   GET <gateway>?fn=boq_lines&projectId=<id>[&after=<line id>][&limit=1..500]   Authorization: Bearer <PROJEXA access token>
//   200 {"fn","projectId","rows":[...],"nextAfter":"<line id>"|null}: the project's line items across ALL of its BOQs, in line id
//   order, one page per call; the caller passes nextAfter back as `after` until it is null. Numbers are strings. The project-side cost
//   fields are never returned. 401 no or bad token, 403 USER_NOT_LINKED, 404 another organisation's project, 503 the switch is off.
//
// WHAT THIS FILE SENDS: the Bearer token and nothing else. The request is made with credentials omitted, so no cookie travels, and the
// URL carries only the project id and the paging cursor (never a person, an organisation or a token).
//
// THE URL IS A CODE CONSTANT. It is a public address (the Edge Function's own hostname) and changing it is a code change with a review,
// not an environment variable that can drift between deployments.

export const BOQ_READ_GATEWAY_URL = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-read"

/** The gateway's own maximum page size. */
export const BOQ_GATEWAY_PAGE_LIMIT = 500

/** 200,000 lines. A gateway that keeps answering a fresh cursor forever cannot hold the browser in a loop past this. */
export const BOQ_GATEWAY_MAX_PAGES = 400

/** One row of `fn=boq_lines` (drizzle/0618 projexa_read_boq_lines). Money and percentages arrive as exact text. */
export type GatewayBoqLine = {
  id: string
  boqId: string
  boqTitle: string
  boqVersion: number
  boqStatus: string
  parentLineItemId: string | null
  activityId: string | null
  itemCode: string | null
  category: string | null
  description: string
  unit: string
  quantity: string
  rate: string
  amount: string
  qtyContract?: string | null
  rateContract?: string | null
  materialCost?: string | null
  labourCost?: string | null
  equipmentCost?: string | null
  overheadPercent?: string | null
  profitPercent?: string | null
  breakdownPercentage?: string | null
  budgetPercentage?: string | null
  vendorId?: string | null
  vendorAmount?: string | null
  materialAmount?: string | null
  manpowerAmount?: string | null
  createdAt?: string | null
}

/** A gateway answer that is not a page of lines. `status` is the HTTP status, or 0 when nothing was received at all. */
export class BoqGatewayError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = "BoqGatewayError"
    this.status = status
    this.code = code
  }

  /** The switch is off (or the key set could not be fetched): the caller may fall back to the REST read. */
  get isUnavailable(): boolean {
    return this.status === 503
  }

  /** The request never reached the gateway (no network): the caller may fall back to the device copy. */
  get isNetworkFailure(): boolean {
    return this.status === 0
  }
}

export type BoqGatewayPage = {
  rows: GatewayBoqLine[]
  /** 1-based page number. */
  page: number
  /** Lines received so far, this page included. */
  received: number
}

export type FetchAllBoqLinesOptions = {
  projectId: string
  /** The signed-in user's PROJEXA access token, or null when there is no session. */
  getAccessToken: () => Promise<string | null>
  /** Called once per page, in order. The function keeps nothing itself: a caller that wants the rows holds them. */
  onPage: (page: BoqGatewayPage) => void | Promise<void>
  fetchImpl?: typeof fetch
  gatewayUrl?: string
  pageLimit?: number
  maxPages?: number
  signal?: AbortSignal
}

function gatewayUrlFor(base: string, projectId: string, after: string | null, limit: number): string {
  const url = new URL(base)
  url.searchParams.set("fn", "boq_lines")
  url.searchParams.set("projectId", projectId)
  if (after !== null) url.searchParams.set("after", after)
  url.searchParams.set("limit", String(limit))
  return url.toString()
}

function bodyText(body: unknown): { error: string | null; code: string | null } {
  if (!body || typeof body !== "object") return { error: null, code: null }
  const o = body as { error?: unknown; code?: unknown }
  return {
    error: typeof o.error === "string" && o.error.trim() !== "" ? o.error.trim() : null,
    code: typeof o.code === "string" ? o.code : null,
  }
}

function assertLine(row: unknown, index: number): GatewayBoqLine {
  if (!row || typeof row !== "object") throw new BoqGatewayError(`The gateway sent a malformed line at position ${index}`, 502)
  const r = row as Record<string, unknown>
  if (typeof r.id !== "string" || r.id === "" || typeof r.boqId !== "string" || r.boqId === "") {
    throw new BoqGatewayError(`The gateway sent a line with no id or no BOQ id at position ${index}`, 502)
  }
  return row as GatewayBoqLine
}

/**
 * Reads every page of one project's line items, following nextAfter until it is null.
 *
 * Fails loudly rather than returning a partial list: a page that is not a page, a cursor that does not move, or more pages than
 * BOQ_GATEWAY_MAX_PAGES all throw, because a screen that shows the first 500 lines of 10,907 as if they were all of them is the
 * fault this whole unit exists to remove. Resolves with the number of lines received.
 */
export async function fetchAllBoqLines(opts: FetchAllBoqLinesOptions): Promise<{ lines: number; pages: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const base = opts.gatewayUrl ?? BOQ_READ_GATEWAY_URL
  const limit = opts.pageLimit ?? BOQ_GATEWAY_PAGE_LIMIT
  const maxPages = opts.maxPages ?? BOQ_GATEWAY_MAX_PAGES

  const token = await opts.getAccessToken()
  if (!token) throw new BoqGatewayError("You are signed out - sign in again to read this BOQ", 401, "NO_SESSION")

  const seen = new Set<string>()
  let after: string | null = null
  let received = 0
  let page = 0

  for (;;) {
    if (page >= maxPages) throw new BoqGatewayError(`The gateway kept returning pages after ${maxPages} pages`, 502)

    let res: Response
    try {
      res = await fetchImpl(gatewayUrlFor(base, opts.projectId, after, limit), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "omit",
        cache: "no-store",
        signal: opts.signal,
      })
    } catch (err) {
      if (opts.signal?.aborted) throw err
      throw new BoqGatewayError(err instanceof Error && err.message ? err.message : "The gateway could not be reached", 0)
    }

    const body: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const { error, code } = bodyText(body)
      throw new BoqGatewayError(error ?? `The gateway answered HTTP ${res.status}`, res.status, code)
    }

    const b = body as { rows?: unknown; nextAfter?: unknown } | null
    if (!b || !Array.isArray(b.rows) || !(b.nextAfter === null || typeof b.nextAfter === "string")) {
      throw new BoqGatewayError("The gateway sent a page that is not a page of lines", 502)
    }
    const rows = b.rows.map((row, i) => assertLine(row, received + i))
    page += 1
    received += rows.length
    await opts.onPage({ rows, page, received })

    if (b.nextAfter === null) return { lines: received, pages: page }
    if (b.nextAfter === after || seen.has(b.nextAfter)) {
      throw new BoqGatewayError("The gateway did not move its cursor forward", 502)
    }
    seen.add(b.nextAfter)
    after = b.nextAfter
  }
}
