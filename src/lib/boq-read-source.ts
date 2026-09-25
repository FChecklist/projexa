// PROJEXA-BUILD-001 U-33. Where the BOQ Object Page (ScopeObjectClient) and its money grid (BoqDualViewGrid) read from. Every GET those
// two components used to send to /api/scope now lives here, so the components name no /api/scope read (register row BR-419) and the
// choice between the existing proxy and the Edge gateway is made in one place.
//
// TWO PATHS, ONE SWITCH (boq-read-flags.ts)
//   viaGateway OFF (the default): the same three requests as before, byte for byte. Nothing else in this file runs.
//   viaGateway ON: the screen's own line items come from the gateway's project-wide pages (boq-gateway-client.ts) and are filtered to
//   this BOQ. With browserFirst ON as well, the pages also go to the device copy (boq-line-cache.ts) and to the project search index
//   (boq-filter-client.ts), and a load with no network is answered from the device copy.
//
// WHAT THE SCREEN MUST DO ABOUT REVISIONS (PMD-36). The gateway returns the lines of every BOQ of the project, each tagged with its
// boqId, title, version and status. The REST list route returns one revision chain and needs `?revision=` to reach another; the gateway
// has no such parameter, so the choice happens here: the Object Page keeps only the lines whose boqId is the BOQ it was opened for (its
// own revision, exactly what GET /api/scope/{id} returned), and the project search shows other BOQs and revisions only when the person
// picks "All BOQs in project", labelling each row with its revision. A superseded revision's lines are therefore never mixed into the
// current one's.
//
// WHAT THE GATEWAY CANNOT ANSWER, AND WHERE THIS FILE STILL USES THE PROXY
//   * The BOQ header (project, version, title, status, parent, created): the gateway has no header function. A first visit reads it once
//     through GET /api/scope/{id}; with the device copy on it is kept, and later loads take title, version and status from the fresh
//     gateway rows.
//   * The money grid: its project-side cost columns are exactly what the gateway never returns, so readBoqDualView stays on the proxy.
//   * The revision banners (predecessor, successor, variation) read /api/scope?projectId= and /api/scope/{id}/compare in the component.

import { fetchJson } from "@/lib/fetch-json"
import type { Boq, BoqLineItemRow } from "@/lib/boq-helpers"
import { BoqGatewayError, fetchAllBoqLines, type GatewayBoqLine } from "@/lib/boq-gateway-client"
import type { BoqReadFlags } from "@/lib/boq-read-flags"
import type { BoqFilterClient } from "@/lib/boq-filter-client"
import { openProjectLineWriter, readBoqHeader, readProjectLines, saveBoqHeader } from "@/lib/boq-line-cache"
import { createClient } from "@/lib/supabase/client"

// ─── The existing proxy reads, moved out of the two components unchanged ───────────────────────────────────────────

export type BoqWithLines = Boq & { lineItems: BoqLineItemRow[] }

/** The BOQ header plus its own line items (VERIDIAN's getBoqRow, through the /api/scope proxy). */
export function readBoqWithLines(boqId: string): Promise<BoqWithLines> {
  return fetchJson<BoqWithLines>(`/api/scope/${boqId}`)
}

/** Every BOQ header of a project, for the predecessor and successor banners. */
export function readProjectBoqs(projectId: string): Promise<{ boqs?: Boq[] }> {
  return fetchJson<{ boqs?: Boq[] }>(`/api/scope?projectId=${encodeURIComponent(projectId)}`)
}

/** The variation of a BOQ against its parent. */
export function readBoqCompare(boqId: string): Promise<{ totalVariation?: number }> {
  return fetchJson<{ totalVariation?: number }>(`/api/scope/${boqId}/compare`)
}

/**
 * The money grid's payload: every line with its dual-view fields. `view: "customer"` asks the server for the redacted preview, a real
 * round trip every time (see BoqDualViewGrid.tsx's header for why that is deliberate).
 */
export async function readBoqDualView<T>(boqId: string, view?: "customer"): Promise<T> {
  const res = await fetch(`/api/scope/${boqId}${view ? `?view=${view}` : ""}`, { cache: "no-store" })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? "Couldn't load this BOQ's money view")
  return data as T
}

// ─── The gateway path ─────────────────────────────────────────────────────────────────────────────────────────────

export type BoqScreenSource = "rest" | "gateway" | "device-copy" | "rest-fallback"

export type BoqScreenLoad = {
  boq: Boq
  /** This BOQ's own line items, parents before their children. */
  lines: BoqLineItemRow[]
  source: BoqScreenSource
  /** When the device copy was saved (ISO). Set only when the lines came from it. */
  copySavedAt: string | null
  /** "saved": the copy was written this load. "failed": it could not be written. "off": browser-first is off. */
  copyStatus: "saved" | "failed" | "off"
  /** Lines in the project search index. 0 when browser-first is off or the index could not be filled. */
  indexedLines: number
}

/** What the screen keeps about its last load, next to the BOQ and its lines. */
export type BoqScreenState = Pick<BoqScreenLoad, "source" | "copySavedAt" | "copyStatus" | "indexedLines">

/**
 * The screen state after a load. A reload right after a write (afterWrite) reads through the proxy and does not touch the project search
 * index or the device copy, so what the previous load left in them still stands: indexedLines and copyStatus carry over, and the search
 * panel (shown while indexedLines is above 0) does not vanish until the person presses Refresh lines. The lines did come from the proxy,
 * so source and copySavedAt describe this load.
 */
export function screenStateAfter(previous: BoqScreenState | null, loaded: BoqScreenLoad, afterWrite: boolean): BoqScreenState {
  const own = { source: loaded.source, copySavedAt: loaded.copySavedAt }
  if (afterWrite && previous) return { ...own, copyStatus: previous.copyStatus, indexedLines: previous.indexedLines }
  return { ...own, copyStatus: loaded.copyStatus, indexedLines: loaded.indexedLines }
}

export type BoqSession = { accessToken: string; userId: string }

export type BoqScreenDeps = {
  readBoqWithLines: typeof readBoqWithLines
  fetchAllBoqLines: typeof fetchAllBoqLines
  getSession: () => Promise<BoqSession | null>
  isOnline: () => boolean
  cache: {
    readBoqHeader: typeof readBoqHeader
    saveBoqHeader: typeof saveBoqHeader
    openProjectLineWriter: typeof openProjectLineWriter
    readProjectLines: typeof readProjectLines
  }
}

async function browserSession(): Promise<BoqSession | null> {
  const { data } = await createClient().auth.getSession()
  const session = data.session
  if (!session?.access_token || !session.user?.id) return null
  return { accessToken: session.access_token, userId: session.user.id }
}

const defaultDeps: BoqScreenDeps = {
  readBoqWithLines,
  fetchAllBoqLines,
  getSession: browserSession,
  isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
  cache: { readBoqHeader, saveBoqHeader, openProjectLineWriter, readProjectLines },
}

/** The columns of Boq, taken from a row that may carry more. */
export function headerOf(data: Boq): Boq {
  return {
    id: data.id, projectId: data.projectId, version: data.version, title: data.title,
    status: data.status, parentBoqId: data.parentBoqId, createdAt: data.createdAt,
  }
}

/** A gateway line as the Object Page's table takes it. Project-side cost fields do not exist on either side of this mapping. */
export function toBoqLineItemRow(l: GatewayBoqLine): BoqLineItemRow {
  return {
    id: l.id, itemCode: l.itemCode, description: l.description, unit: l.unit,
    quantity: l.quantity, rate: l.rate, amount: l.amount, activityId: l.activityId,
    category: l.category, parentLineItemId: l.parentLineItemId,
    breakdownPercentage: l.breakdownPercentage ?? null, budgetPercentage: l.budgetPercentage ?? null,
    vendorId: l.vendorId ?? null, vendorAmount: l.vendorAmount ?? null,
    materialAmount: l.materialAmount ?? null, manpowerAmount: l.manpowerAmount ?? null,
  }
}

/**
 * The gateway pages lines by id, which is neither entry order nor family order. The table indents a sub-task but does not sort, so
 * a child that arrived before its parent would sit above it. This puts every line after its parent (roots and siblings by creation
 * time, then id), and keeps a line whose parent is not in the list as a root instead of dropping it.
 */
export function orderLinesForBoq(lines: readonly GatewayBoqLine[]): GatewayBoqLine[] {
  const byTime = [...lines].sort((a, b) => {
    const ta = a.createdAt ?? ""
    const tb = b.createdAt ?? ""
    if (ta !== tb) return ta < tb ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  const ids = new Set(byTime.map((l) => l.id))
  const children = new Map<string, GatewayBoqLine[]>()
  const roots: GatewayBoqLine[] = []
  for (const line of byTime) {
    const parent = line.parentLineItemId
    if (parent && parent !== line.id && ids.has(parent)) {
      const list = children.get(parent) ?? []
      list.push(line)
      children.set(parent, list)
    } else {
      roots.push(line)
    }
  }
  const out: GatewayBoqLine[] = []
  const placed = new Set<string>()
  const place = (line: GatewayBoqLine) => {
    if (placed.has(line.id)) return
    placed.add(line.id)
    out.push(line)
    for (const child of children.get(line.id) ?? []) place(child)
  }
  for (const root of roots) place(root)
  // A parent cycle leaves its members unplaced: append them rather than lose a line.
  for (const line of byTime) place(line)
  return out
}

function ownRows(mine: GatewayBoqLine[]): BoqLineItemRow[] {
  return orderLinesForBoq(mine).map(toBoqLineItemRow)
}

/**
 * What loadBoqForScreen rejects with when a newer load of the same screen started while this one was running. The older load stopped
 * touching the search index and the device copy at that moment, so the caller drops the rejection and shows the newer load's answer.
 */
export class BoqLoadSuperseded extends Error {
  constructor() {
    super("A newer load of this BOQ started, so this one was dropped")
    this.name = "BoqLoadSuperseded"
  }
}

export type LoadBoqForScreenInput = {
  boqId: string
  flags: BoqReadFlags
  /** The project search index to fill, or null when browser-first is off. */
  filter: BoqFilterClient | null
  /**
   * True for a reload right after a write (submit, approve, a header save that hit a conflict): the person just changed this BOQ, so
   * it is read back through the proxy that wrote it, and the project download is not repeated.
   */
  afterWrite?: boolean
  /**
   * False once a newer load of the same screen has started. The search index is one object shared by every load of a screen, and each
   * load empties it and then adds its pages, so two loads running together would add every line twice. Each step below that reaches
   * the index or the device copy checks this first, in the same synchronous run as the step itself, and a replaced load stops with
   * BoqLoadSuperseded. Left out, the load is never replaced.
   */
  isCurrent?: () => boolean
}

export async function loadBoqForScreen(input: LoadBoqForScreenInput, deps: BoqScreenDeps = defaultDeps): Promise<BoqScreenLoad> {
  const { boqId, flags, filter } = input
  const isCurrent = input.isCurrent ?? (() => true)
  const assertCurrent = () => {
    if (!isCurrent()) throw new BoqLoadSuperseded()
  }

  const viaProxy = async (source: "rest" | "rest-fallback", known: BoqWithLines | null): Promise<BoqScreenLoad> => {
    const data = known ?? (await deps.readBoqWithLines(boqId))
    return { boq: headerOf(data), lines: data.lineItems ?? [], source, copySavedAt: null, copyStatus: "off", indexedLines: 0 }
  }

  if (!flags.viaGateway || input.afterWrite) return viaProxy("rest", null)

  const session = await deps.getSession()
  if (!session) return viaProxy("rest-fallback", null)
  const scope = session.userId
  const keepCopy = flags.browserFirst

  const cachedHeader = keepCopy ? await deps.cache.readBoqHeader(scope, boqId).catch(() => null) : null

  // From the device copy: no network at all, or the gateway could not be reached.
  const fromDeviceCopy = async (): Promise<BoqScreenLoad> => {
    if (!cachedHeader) throw new Error("This BOQ has not been opened online on this device yet, so there is no copy to show")
    const projectId = cachedHeader.header.projectId
    const mine: GatewayBoqLine[] = []
    assertCurrent()
    if (filter) await filter.reset()
    let indexedLines = 0
    const info = await deps.cache.readProjectLines(scope, projectId, async (rows) => {
      assertCurrent()
      for (const row of rows) if (row.boqId === boqId) mine.push(row)
      if (filter) indexedLines = await filter.append(rows)
    })
    if (!info) throw new Error("There is no copy of this project's lines on this device yet")
    return {
      boq: cachedHeader.header, lines: ownRows(mine), source: "device-copy",
      copySavedAt: info.savedAt, copyStatus: "saved", indexedLines: filter ? indexedLines : 0,
    }
  }

  if (keepCopy && !deps.isOnline()) return fromDeviceCopy()

  // The header: the device copy's when there is one, otherwise one read through the proxy.
  let restData: BoqWithLines | null = null
  let baseHeader: Boq
  if (cachedHeader) {
    baseHeader = cachedHeader.header
  } else {
    restData = await deps.readBoqWithLines(boqId)
    baseHeader = headerOf(restData)
  }

  const projectId = baseHeader.projectId
  const mine: GatewayBoqLine[] = []
  let indexedLines = 0
  let indexOk = filter !== null
  const writer = keepCopy ? deps.cache.openProjectLineWriter(scope, projectId) : null
  let copyOk = writer !== null

  try {
    assertCurrent()
    if (filter) await filter.reset().catch(() => { indexOk = false })
    await deps.fetchAllBoqLines({
      projectId,
      getAccessToken: async () => session.accessToken,
      onPage: async ({ rows }) => {
        assertCurrent()
        for (const row of rows) if (row.boqId === boqId) mine.push(row)
        if (filter && indexOk) {
          try { indexedLines = await filter.append(rows) } catch { indexOk = false }
        }
        if (writer && copyOk) {
          try { await writer.addPage(rows) } catch { copyOk = false }
        }
      },
    })
  } catch (err) {
    if (writer) await writer.abort().catch(() => {})
    // A replaced load must not empty the index the newer load is filling, and its own failure no longer matters.
    assertCurrent()
    if (filter) await filter.reset().catch(() => {})
    if (err instanceof BoqGatewayError && err.isUnavailable) return viaProxy("rest-fallback", restData)
    if (err instanceof BoqGatewayError && err.isNetworkFailure && keepCopy && cachedHeader) return fromDeviceCopy()
    throw err
  }

  // A BOQ with no lines in the gateway's answer might be empty or might be gone; the proxy says which.
  if (mine.length === 0 && !restData) {
    try {
      restData = await deps.readBoqWithLines(boqId)
    } catch (err) {
      if (writer) await writer.abort().catch(() => {})
      throw err
    }
    baseHeader = headerOf(restData)
  }

  // Title, version and status are the fields a person changes; take them from the fresh rows. Lineage (parent, created) never changes.
  const first = mine[0]
  const boq: Boq = first ? { ...baseHeader, title: first.boqTitle, version: first.boqVersion, status: first.boqStatus } : baseHeader

  let copyStatus: BoqScreenLoad["copyStatus"] = "off"
  if (writer) {
    // A replaced load does not save its copy: the newer load is downloading the same project and saves its own.
    if (!isCurrent()) {
      await writer.abort().catch(() => {})
      throw new BoqLoadSuperseded()
    }
    try {
      if (!copyOk) throw new Error("copy not written")
      // The header goes first and the commit last: the commit is what makes the new lines the readable copy, and it is the one step
      // that cannot be taken back, so nothing that can still fail comes after it.
      await deps.cache.saveBoqHeader(scope, boq)
      await writer.commit()
      copyStatus = "saved"
    } catch {
      await writer.abort().catch(() => {})
      copyStatus = "failed"
    }
  }

  return {
    boq, lines: ownRows(mine), source: "gateway", copySavedAt: null, copyStatus,
    indexedLines: filter && indexOk ? indexedLines : 0,
  }
}
