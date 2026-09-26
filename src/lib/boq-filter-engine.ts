// PROJEXA-BUILD-001 U-33 (E-10). The project line search of the browser-first BOQ screen: an in-memory index of every line the gateway
// returned, and the message protocol the Web Worker speaks. This module is plain TypeScript with no browser API, so bun runs the very
// same code that boq-filter.worker.ts runs in the browser thread (src/lib/boq-filter-engine.test.ts, and a real worker in
// src/lib/boq-filter-client.test.ts).
//
// WHY A WORKER. A project can hold 10,907 lines. Matching them on the main thread on every keystroke, and structured-cloning the
// matches into React state, is exactly what freezes a screen on a phone. The worker owns the whole index; the main thread sends a query
// and gets back at most one window of rows (never the whole list), so the main thread's work per keystroke is a small message and a
// render of the window.
//
// WHAT MATCHES. Every whitespace-separated term of the query must appear (case and accent blind) somewhere in the line's description,
// item code, category, unit or BOQ title. An empty query matches every line. `boqId` narrows the scope to one BOQ; null searches every
// BOQ of the project (all revisions: the caller labels each row with its revision, see BoqLineExplorer.tsx).

import type { GatewayBoqLine } from "./boq-gateway-client"

/** No caller may ask for more than this many rows in one answer: a larger window is a bigger clone into the main thread. */
export const BOQ_FILTER_MAX_ROWS = 1000

export type BoqFilterQuery = { query: string; boqId: string | null; limit: number }

export type BoqFilterResult = {
  /** Lines inside the scope (one BOQ, or the whole project). */
  total: number
  /** Lines inside the scope that match every term. */
  matched: number
  /** The first `limit` matches, in index order. */
  rows: GatewayBoqLine[]
}

export type BoqFilterRequest =
  | { type: "reset"; id: number }
  | { type: "append"; id: number; lines: GatewayBoqLine[] }
  | ({ type: "filter"; id: number } & BoqFilterQuery)

export type BoqFilterReply =
  | { type: "ok"; id: number; indexed: number }
  | ({ type: "result"; id: number; indexed: number } & BoqFilterResult)
  | { type: "error"; id: number; message: string }

/** Lower-cases and strips accents, so "Concrète" is found by "concrete". */
export function normalizeForSearch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

function haystackOf(line: GatewayBoqLine): string {
  return normalizeForSearch(
    [line.description, line.itemCode, line.category, line.unit, line.boqTitle].filter((v): v is string => typeof v === "string" && v !== "").join("\n")
  )
}

export class BoqLineIndex {
  private lines: GatewayBoqLine[] = []
  private haystacks: string[] = []

  get size(): number {
    return this.lines.length
  }

  reset(): void {
    this.lines = []
    this.haystacks = []
  }

  append(lines: readonly GatewayBoqLine[]): number {
    for (const line of lines) {
      this.lines.push(line)
      this.haystacks.push(haystackOf(line))
    }
    return this.lines.length
  }

  search({ query, boqId, limit }: BoqFilterQuery): BoqFilterResult {
    const terms = normalizeForSearch(query).split(/\s+/).filter((t) => t !== "")
    const cap = Math.max(0, Math.min(Math.trunc(limit) || 0, BOQ_FILTER_MAX_ROWS))
    let total = 0
    let matched = 0
    const rows: GatewayBoqLine[] = []
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i]
      if (boqId !== null && line.boqId !== boqId) continue
      total += 1
      const hay = this.haystacks[i]
      let all = true
      for (const term of terms) {
        if (!hay.includes(term)) {
          all = false
          break
        }
      }
      if (!all) continue
      matched += 1
      if (rows.length < cap) rows.push(line)
    }
    return { total, matched, rows }
  }
}

function idOf(message: unknown): number {
  const id = (message as { id?: unknown } | null)?.id
  return typeof id === "number" ? id : -1
}

/** One request in, one reply out. Never throws: a malformed message is answered with an error reply so the caller's promise settles. */
export function answerBoqFilterMessage(index: BoqLineIndex, message: unknown): BoqFilterReply {
  const id = idOf(message)
  try {
    const m = message as { type?: unknown } | null
    switch (m?.type) {
      case "reset":
        index.reset()
        return { type: "ok", id, indexed: 0 }
      case "append": {
        const lines = (message as { lines?: unknown }).lines
        if (!Array.isArray(lines)) return { type: "error", id, message: "append needs a lines array" }
        return { type: "ok", id, indexed: index.append(lines as GatewayBoqLine[]) }
      }
      case "filter": {
        const q = message as { query?: unknown; boqId?: unknown; limit?: unknown }
        if (typeof q.query !== "string" || !(q.boqId === null || typeof q.boqId === "string") || typeof q.limit !== "number") {
          return { type: "error", id, message: "filter needs a query string, a BOQ id or null, and a numeric limit" }
        }
        return { type: "result", id, indexed: index.size, ...index.search({ query: q.query, boqId: q.boqId, limit: q.limit }) }
      }
      default:
        return { type: "error", id, message: "unknown request type" }
    }
  } catch (err) {
    return { type: "error", id, message: err instanceof Error ? err.message : "the search index failed" }
  }
}
